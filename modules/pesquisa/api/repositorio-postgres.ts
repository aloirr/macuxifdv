/**
 * Repositório da Pesquisa no Postgres (T-0057, migração 0016; SQL de cada método em docs/banco/pesquisa.md). Só SQL no
 * schema `pesquisa` (regra 1), SEMPRE dentro da transação do tenant (`ctx.comTenant`): a RLS isola os tenants, então
 * nenhuma consulta filtra `tenant_id` na mão para LER (o `tenant_id` só entra nos INSERTs, e a política recusa o que não
 * for do tenant do contexto).
 *
 * Instantes: o contrato usa ISO 8601 em UTC. Instantes de NEGÓCIO (vigência, respondida_em, criado_em...) voltam com
 * milissegundos, como o JavaScript os produz (ida e volta sem mudar a grafia); instantes de CURSOR (`updated_at`) voltam
 * com microssegundos (`...SS.US"Z"`), como o Catálogo, para o cursor `(updated_at, id)` do pull não pular nem repetir linha.
 *
 * Regras do banco que viram erro de negócio (nunca 500): ver `traduzirErroBanco`.
 *  - 23514 (check): RN-PES-01 — versão publicada imutável / resposta só para versão publicada.
 *  - 23505 (único): outro rascunho aberto, número de versão repetido, resposta já gravada.
 *  - 23503 (FK): versão fora do questionário, questionário ou arquivo inexistente.
 */
import { ErroHttpModulo, type ClienteBanco } from '@macuxi/platform-sdk';
import type { Questionario, QuestionarioVersao, QuestionarioVersaoSync, RespostaPesquisa, RespostaPesquisaSync } from '../contracts';
import { conflito, naoEncontrado, recusar, RESPOSTA_JA_EXISTE } from './comum';
import type { FabricaRepositorio, JanelaPull, QuestionarioCarregado, RepositorioPesquisa } from './repositorio';

/** Instante de negócio (milissegundos) e de cursor (microssegundos) em UTC. */
const ms = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const us = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Tamanho mínimo do lote lido do banco no pull de respostas (o filtro de escopo roda em código, depois do SQL). */
const LOTE_MINIMO_PULL = 1000;

interface ErroPg {
  code?: string;
  constraint?: string;
}

/**
 * Traduz as violações de integridade do banco para os erros de negócio da API (RN-PES-01 e RF-PES-04). Erro de outro
 * tipo (conexão, permissão) segue como veio: é falha de infraestrutura e vira 500 com o log da API.
 */
export function traduzirErroBanco(e: unknown): never {
  if (e instanceof ErroHttpModulo) throw e;
  const { code, constraint = '' } = (e ?? {}) as ErroPg;
  if (code === '23514') {
    if (constraint === 'questionario_versao_publicada_imutavel') {
      return recusar('VERSAO_PUBLICADA_IMUTAVEL', 'Esta versão já foi publicada e não pode mudar. Crie uma nova versão para editar o questionário.');
    }
    if (constraint === 'resposta_versao_publicada') {
      return recusar('VERSAO_NAO_PUBLICADA', 'Essa versão do questionário ainda não foi publicada, então não recebe respostas.');
    }
    if (constraint.startsWith('questionario_versao_')) return recusar('RASCUNHO_INVALIDO', 'O banco recusou o rascunho. Revise título, vigência e perguntas e salve de novo.');
    if (constraint.startsWith('resposta_')) return recusar('RESPOSTA_INVALIDA', 'O banco recusou a resposta. Atualize o app e responda de novo.');
    return recusar('DADO_INVALIDO', 'O banco recusou os dados enviados. Revise e tente de novo.');
  }
  if (code === '23505') {
    if (constraint === 'questionario_versao_rascunho_uk' || constraint === 'questionario_versao_numero_uk') {
      return conflito('VERSAO_EM_EDICAO', 'Outra pessoa abriu uma nova versão deste questionário agora há pouco. Recarregue a página e continue pela versão aberta.');
    }
    if (constraint === 'resposta_pkey') return conflito(RESPOSTA_JA_EXISTE, 'Esta resposta já foi recebida.');
    return conflito('JA_EXISTE', 'Este registro já existe. Recarregue a página e confira.');
  }
  if (code === '23503') {
    if (constraint === 'resposta_versao_fk') return recusar('VERSAO_INEXISTENTE', 'A versão do questionário citada pela resposta não existe. Atualize o app e responda de novo.');
    if (constraint.endsWith('questionario_fk')) return naoEncontrado();
    if (constraint === 'resposta_foto_arquivo_fk') return recusar('RESPOSTA_INVALIDA', 'Uma foto da resposta não chegou ao servidor. Reenvie a pesquisa.');
    return recusar('REFERENCIA_INVALIDA', 'Um dado citado não existe mais. Atualize a página (ou o app) e tente de novo.');
  }
  throw e;
}

const COLUNAS_VERSAO = `v.id, v.questionario_id, v.tenant_id, v.numero, v.status, v.titulo, v.descricao, v.modo, v.frequencia, v.publico_alvo,
       ${ms('v.vigencia_inicio')} as vigencia_inicio, ${ms('v.vigencia_fim')} as vigencia_fim, v.perguntas, v.regras,
       ${ms('v.criada_em')} as criada_em, ${ms('v.publicada_em')} as publicada_em, v.publicada_por`;

const COLUNAS_RESPOSTA = `r.id, r.tenant_id, r.questionario_id, r.versao_id, r.usuario_id, r.equipe_id, r.cliente_id, r.visita_id,
       ${ms('r.respondida_em')} as respondida_em, ${ms('r.recebida_em')} as recebida_em`;

interface LinhaVersao {
  id: string;
  questionario_id: string;
  tenant_id: string;
  numero: number;
  status: QuestionarioVersao['status'];
  titulo: string;
  descricao: string | null;
  modo: QuestionarioVersao['modo'];
  frequencia: QuestionarioVersao['frequencia'];
  publico_alvo: QuestionarioVersao['publico_alvo'];
  vigencia_inicio: string;
  vigencia_fim: string | null;
  perguntas: QuestionarioVersao['perguntas'];
  regras: QuestionarioVersao['regras'];
  criada_em: string;
  publicada_em: string | null;
  publicada_por: string | null;
}

interface LinhaResposta {
  id: string;
  tenant_id: string;
  questionario_id: string;
  versao_id: string;
  usuario_id: string;
  equipe_id: string | null;
  cliente_id: string | null;
  visita_id: string | null;
  respondida_em: string;
  recebida_em: string;
}

/** Linha → contrato: `vigencia = { inicio, fim }`; `descricao` nula vira ausente. */
function versaoDaLinha(l: LinhaVersao): QuestionarioVersao {
  return {
    id: l.id,
    questionario_id: l.questionario_id,
    tenant_id: l.tenant_id,
    numero: l.numero,
    status: l.status,
    titulo: l.titulo,
    ...(l.descricao !== null ? { descricao: l.descricao } : {}),
    modo: l.modo,
    frequencia: l.frequencia,
    publico_alvo: l.publico_alvo,
    vigencia: { inicio: l.vigencia_inicio, fim: l.vigencia_fim },
    perguntas: l.perguntas,
    regras: l.regras,
    criada_em: l.criada_em,
    publicada_em: l.publicada_em,
    publicada_por: l.publicada_por,
  };
}

function respostaDaLinha(l: LinhaResposta & { motivos_suspeita: string[]; suspeita: boolean; itens: RespostaPesquisa['itens'] }): RespostaPesquisa {
  return {
    id: l.id,
    tenant_id: l.tenant_id,
    questionario_id: l.questionario_id,
    versao_id: l.versao_id,
    usuario_id: l.usuario_id,
    equipe_id: l.equipe_id,
    cliente_id: l.cliente_id,
    visita_id: l.visita_id,
    respondida_em: l.respondida_em,
    recebida_em: l.recebida_em,
    suspeita: l.suspeita,
    motivos_suspeita: l.motivos_suspeita as RespostaPesquisa['motivos_suspeita'],
    itens: l.itens,
  };
}

const maior = (a: string, b: string) => (b > a ? b : a);

/** Cursor do pull: `(updated_at, id) > desde` (microssegundos) e `updated_at < ate`; `$1/$2` nulos = primeira página. */
const params = (j: JanelaPull, limite: number) => [j.desde?.updated_at ?? null, j.desde?.id ?? null, j.ate, limite];

export interface OpcoesRepositorioPostgres {
  /** Linhas lidas por consulta no pull de respostas (padrão: o maior entre o limite da página e 1000). Só os testes mudam. */
  lotePull?: number;
}

/** Fábrica por requisição: `db` é o cliente da transação do tenant (RLS); `tenantId` só preenche os INSERTs. */
export function criarRepositorioPostgres(opcoes: OpcoesRepositorioPostgres = {}): FabricaRepositorio {
  return (tenantId: string, db: ClienteBanco): RepositorioPesquisa => {
    /** Toda consulta passa por aqui: violação de integridade do banco vira erro de negócio. */
    const sql = async <R>(texto: string, valores: readonly unknown[] = []): Promise<R[]> => {
      try {
        return (await db.query<R>(texto, valores)).rows;
      } catch (e) {
        return traduzirErroBanco(e);
      }
    };

    const versoesDe = async (ids: readonly string[]) => {
      const porQuestionario = new Map<string, { versoes: QuestionarioVersao[]; atualizado_em: string }>();
      if (ids.length === 0) return porQuestionario;
      const linhas = await sql<LinhaVersao & { updated_at: string }>(
        `select ${COLUNAS_VERSAO}, ${us('v.updated_at')} as updated_at
           from pesquisa.questionario_versao v
          where v.questionario_id = any($1::uuid[]) and v.deleted_at is null
          order by v.questionario_id, v.numero`,
        [ids],
      );
      for (const l of linhas) {
        const atual = porQuestionario.get(l.questionario_id) ?? { versoes: [], atualizado_em: '' };
        atual.versoes.push(versaoDaLinha(l));
        atual.atualizado_em = maior(atual.atualizado_em, l.updated_at);
        porQuestionario.set(l.questionario_id, atual);
      }
      return porQuestionario;
    };

    const cabecalhos = (where: string, valores: readonly unknown[]) =>
      sql<{ id: string; tenant_id: string; criado_em: string; arquivado_em: string | null; updated_at: string; respostas: string }>(
        `select q.id, q.tenant_id, ${ms('q.criado_em')} as criado_em, ${ms('q.arquivado_em')} as arquivado_em, ${us('q.updated_at')} as updated_at,
                (select count(*) from pesquisa.resposta r where r.questionario_id = q.id and r.deleted_at is null) as respostas
           from pesquisa.questionario q
          where q.deleted_at is null ${where}
          order by q.criado_em desc, q.id`,
        valores,
      );

    const montar = async (linhas: Awaited<ReturnType<typeof cabecalhos>>): Promise<(QuestionarioCarregado & { respostas: number })[]> => {
      const versoes = await versoesDe(linhas.map((l) => l.id));
      return linhas.map((l) => {
        const v = versoes.get(l.id);
        const questionario: Questionario = { id: l.id, tenant_id: l.tenant_id, criado_em: l.criado_em, arquivado_em: l.arquivado_em };
        return { questionario, versoes: v?.versoes ?? [], atualizado_em: maior(l.updated_at, v?.atualizado_em ?? ''), respostas: Number(l.respostas) };
      });
    };

    const gravarCampos = (v: QuestionarioVersao) => [
      v.status,
      v.titulo,
      v.descricao ?? null,
      v.modo,
      v.frequencia,
      JSON.stringify(v.publico_alvo),
      v.vigencia.inicio,
      v.vigencia.fim,
      JSON.stringify(v.perguntas),
      JSON.stringify(v.regras),
      v.publicada_em,
      v.publicada_por,
    ];

    return {
      async listarQuestionarios() {
        return montar(await cabecalhos('', []));
      },

      async carregar(id) {
        const [c] = await montar(await cabecalhos('and q.id = $1::uuid', [id]));
        if (!c) return null;
        return { questionario: c.questionario, versoes: c.versoes, atualizado_em: c.atualizado_em };
      },

      async criarQuestionario(q, primeira) {
        await sql(`insert into pesquisa.questionario (id, tenant_id, criado_em, arquivado_em) values ($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz)`, [q.id, tenantId, q.criado_em, q.arquivado_em]);
        await sql(
          `insert into pesquisa.questionario_versao
             (id, tenant_id, questionario_id, numero, criada_em, status, titulo, descricao, modo, frequencia, publico_alvo, vigencia_inicio, vigencia_fim, perguntas, regras, publicada_em, publicada_por)
           values ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz, $6, $7, $8, $9, $10, $11::jsonb, $12::timestamptz, $13::timestamptz, $14::jsonb, $15::jsonb, $16::timestamptz, $17::uuid)`,
          [primeira.id, tenantId, primeira.questionario_id, primeira.numero, primeira.criada_em, ...gravarCampos(primeira)],
        );
      },

      /** Só o conteúdo muda no conflito (número, questionário e criação nunca); o banco recusa a publicada (23514, RN-PES-01). */
      async gravarVersao(v) {
        await sql(
          `insert into pesquisa.questionario_versao
             (id, tenant_id, questionario_id, numero, criada_em, status, titulo, descricao, modo, frequencia, publico_alvo, vigencia_inicio, vigencia_fim, perguntas, regras, publicada_em, publicada_por)
           values ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz, $6, $7, $8, $9, $10, $11::jsonb, $12::timestamptz, $13::timestamptz, $14::jsonb, $15::jsonb, $16::timestamptz, $17::uuid)
           on conflict (id) do update set
             status = excluded.status, titulo = excluded.titulo, descricao = excluded.descricao, modo = excluded.modo,
             frequencia = excluded.frequencia, publico_alvo = excluded.publico_alvo, vigencia_inicio = excluded.vigencia_inicio,
             vigencia_fim = excluded.vigencia_fim, perguntas = excluded.perguntas, regras = excluded.regras,
             publicada_em = excluded.publicada_em, publicada_por = excluded.publicada_por`,
          [v.id, tenantId, v.questionario_id, v.numero, v.criada_em, ...gravarCampos(v)],
        );
      },

      /** O gatilho `questionario_arquivado_toca_versoes` toca as versões publicadas (descem de novo no pull). */
      async arquivar(id, agora) {
        // greatest(): relógio do servidor atrás do criado_em não pode violar `arquivado_em >= criado_em`
        await sql(`update pesquisa.questionario set arquivado_em = greatest($2::timestamptz, criado_em) where id = $1::uuid and arquivado_em is null and deleted_at is null`, [id, agora]);
      },

      async contarRespostas(questionarioId) {
        const [l] = await sql<{ n: string }>(`select count(*) as n from pesquisa.resposta where questionario_id = $1::uuid and deleted_at is null`, [questionarioId]);
        return Number(l?.n ?? 0);
      },

      async obterResposta(id) {
        const [l] = await sql<LinhaResposta & { suspeita: boolean; motivos_suspeita: string[]; itens: RespostaPesquisa['itens'] }>(
          `select ${COLUNAS_RESPOSTA}, r.suspeita, r.motivos_suspeita, r.itens from pesquisa.resposta r where r.id = $1::uuid`,
          [id],
        );
        return l ? respostaDaLinha(l) : null;
      },

      /** Só inserção: itens e fotos saem do gatilho `resposta_normalizar`. `23505` no id = outra transação gravou antes. */
      async inserirResposta(r) {
        await sql(
          `insert into pesquisa.resposta
             (id, tenant_id, questionario_id, versao_id, usuario_id, equipe_id, cliente_id, visita_id, respondida_em, recebida_em, suspeita, motivos_suspeita, itens)
           values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid, $9::timestamptz, $10::timestamptz, $11, $12::text[], $13::jsonb)`,
          [r.id, tenantId, r.questionario_id, r.versao_id, r.usuario_id, r.equipe_id, r.cliente_id, r.visita_id, r.respondida_em, r.recebida_em, r.suspeita, [...r.motivos_suspeita], JSON.stringify(r.itens)],
        );
      },

      async listarRespostas(questionarioId) {
        const linhas = await sql<LinhaResposta & { suspeita: boolean; motivos_suspeita: string[]; itens: RespostaPesquisa['itens'] }>(
          `select ${COLUNAS_RESPOSTA}, r.suspeita, r.motivos_suspeita, r.itens
             from pesquisa.resposta r
            where r.questionario_id = $1::uuid and r.deleted_at is null
            order by r.respondida_em desc, r.id`,
          [questionarioId],
        );
        return linhas.map(respostaDaLinha);
      },

      async respostasParaCheckout(f) {
        if (f.questionario_ids.length === 0) return [];
        const linhas = await sql<{ questionario_id: string; usuario_id: string; cliente_id: string | null; visita_id: string | null; respondida_em: string }>(
          `select r.questionario_id, r.usuario_id, r.cliente_id, r.visita_id, ${ms('r.respondida_em')} as respondida_em
             from pesquisa.resposta r
            where r.deleted_at is null
              and r.questionario_id = any($1::uuid[])
              and (r.visita_id = $2::uuid or ((r.cliente_id = $3::uuid or r.usuario_id = $4::uuid) and r.respondida_em >= $5::timestamptz))`,
          [[...f.questionario_ids], f.visita_id, f.cliente_id, f.usuario_id, f.desde],
        );
        return linhas;
      },

      async puxarVersoes(janela) {
        const linhas = await sql<LinhaVersao & { updated_at: string; deleted_at: string | null; arquivado_em: string | null; questionario_criado_em: string }>(
          `select ${COLUNAS_VERSAO}, ${us('v.updated_at')} as updated_at, ${us('v.deleted_at')} as deleted_at,
                  ${ms('q.arquivado_em')} as arquivado_em, ${ms('q.criado_em')} as questionario_criado_em
             from pesquisa.questionario_versao v
             join pesquisa.questionario q on q.tenant_id = v.tenant_id and q.id = v.questionario_id
            where v.status = 'publicada'
              and ($1::timestamptz is null or (v.updated_at, v.id) > ($1::timestamptz, $2::uuid))
              and v.updated_at < $3::timestamptz
            order by v.updated_at, v.id
            limit $4`,
          params(janela, janela.limite),
        );
        return linhas.map(
          (l): QuestionarioVersaoSync => ({
            id: l.id,
            updated_at: l.updated_at,
            deleted_at: l.deleted_at,
            questionario_id: l.questionario_id,
            numero: l.numero,
            status: l.status,
            arquivado_em: l.arquivado_em,
            questionario_criado_em: l.questionario_criado_em,
            versao: versaoDaLinha(l),
          }),
        );
      },

      /**
       * O escopo (usuário/carteira) é decidido em código, depois do SQL: para a página sair cheia (e o motor do pull não
       * achar que acabou), lê lotes pelo cursor e só para quando juntar `limite` linhas do escopo ou o banco esgotar.
       */
      async puxarRespostas(janela, noEscopo) {
        const lote = opcoes.lotePull ?? Math.max(janela.limite, LOTE_MINIMO_PULL);
        const saida: RespostaPesquisaSync[] = [];
        let desde = janela.desde;
        for (;;) {
          const linhas = await sql<LinhaResposta & { updated_at: string; deleted_at: string | null }>(
            `select ${COLUNAS_RESPOSTA}, ${us('r.updated_at')} as updated_at, ${us('r.deleted_at')} as deleted_at
               from pesquisa.resposta r
              where ($1::timestamptz is null or (r.updated_at, r.id) > ($1::timestamptz, $2::uuid))
                and r.updated_at < $3::timestamptz
              order by r.updated_at, r.id
              limit $4`,
            params({ ...janela, desde }, lote),
          );
          for (const l of linhas) {
            if (!noEscopo({ usuario_id: l.usuario_id, cliente_id: l.cliente_id })) continue;
            saida.push({
              id: l.id,
              updated_at: l.updated_at,
              deleted_at: l.deleted_at,
              questionario_id: l.questionario_id,
              versao_id: l.versao_id,
              usuario_id: l.usuario_id,
              cliente_id: l.cliente_id,
              visita_id: l.visita_id,
              respondida_em: l.respondida_em,
              recebida_em: l.recebida_em,
            });
            if (saida.length >= janela.limite) return saida;
          }
          const ultima = linhas[linhas.length - 1];
          if (linhas.length < lote || !ultima) return saida;
          desde = { updated_at: ultima.updated_at, id: ultima.id };
        }
      },
    };
  };
}
