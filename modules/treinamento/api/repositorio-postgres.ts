/**
 * Repositório do Treinamento no Postgres (T-0058): só SQL no schema `treinamento` (migração 0017), dentro da transação
 * do tenant (`ctx.comTenant`, papel macuxi_app, RLS). Nenhum `tenant_id` vem de fora além do da transação (o da sessão).
 *
 * Regras de gravação (docs/banco/treinamento.md):
 *  - conteúdo (BKO): a trilha é UMA linha do pull com a árvore inteira; `atualizarTrilha` troca a árvore (apaga
 *    alternativa → questão → quiz → lição → módulo por `trilha_id` e reinsere) e o gatilho `tocar_trilha` sobe o
 *    `updated_at` da trilha; o `updated_at` quem decide é o banco (`now()`), por isso as gravações devolvem os carimbos;
 *  - aluno: append-only (a aplicação só tem select e insert; UPDATE/DELETE = 42501). Idempotência pela chave natural
 *    com `insert ... on conflict (<chave>) do nothing`: reenvio não duplica linha nem soma XP duas vezes;
 *  - escrita do aluno serializada por `pg_advisory_xact_lock(hash(tenant:usuário))` (tetos de XP são ler-depois-gravar);
 *  - usuários do tenant: pela consulta pública do Core (ADR 0012), nunca por `core.*` (regra 1).
 */
import { ErroHttpModulo, PERFIS, ehConsultaIndisponivel, type ClienteBanco, type LinhaSync, type PedidoPull, type Perfil, type TransacaoTenant } from '@macuxi/platform-sdk';
import { CONSULTA_CADASTRO_RESUMO, CONSULTA_USUARIOS_RESUMO } from '@macuxi/core/contracts';
import type { AlternativaConteudo, LicaoConteudo, ModuloConteudo, QuestaoConteudo, Trilha } from '../contracts/conteudo';
import type { ConclusaoDoAluno, ConquistaDoAluno, TentativaDoAluno } from '../domain/atividade';
import type { ConclusaoDoUsuario, TentativaDoUsuario } from '../domain/painel';
import type { LancamentoXp } from '../domain/xp';
import type {
  CarimbosTrilha,
  EntidadeDoAluno,
  EstadoGravadoDoAluno,
  FabricaRepositorio,
  MudancaDeStatus,
  PublicacaoGravada,
  RepositorioTreinamento,
  TrilhaGravada,
  UsuarioTreinamento,
} from './repositorio';

/** Instante UTC: milissegundos (fatos do aluno, iguais ao que o aparelho enviou) ou microssegundos (cursor do pull). */
const MS = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const US = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const ts = (coluna: string, formato = MS) => `to_char(${coluna} at time zone 'UTC', ${formato})`;
/** `updated_at`/`deleted_at` do pull: microssegundos, para o cursor `(updated_at, id)` não repetir nem pular linha. */
const CURSOR = `${ts('updated_at', US)} as updated_at, ${ts('deleted_at', US)} as deleted_at`;

const LOTE_CONSULTA = 500;

/** O que a fonte devolveu e se é o tenant inteiro (`completa`) ou só quem tem atividade (base parcial). */
export interface UsuariosLidos {
  usuarios: UsuarioTreinamento[];
  completa: boolean;
}

/**
 * Quem informa perfil/equipe dos usuários do tenant. Padrão: `core.usuarios_resumo@1` (tenant inteiro, paginado por
 * cursor, com equipe e `ativo`); se a consulta estiver indisponível, cai em `core.cadastro_resumo@1` só para quem tem
 * atividade (equipe nula) e devolve `completa: false` (o painel avisa "base parcial").
 */
export type FonteDeUsuarios = (tx: TransacaoTenant, idsComAtividade: readonly string[]) => Promise<UsuariosLidos>;

const PERFIS_CONHECIDOS: ReadonlySet<string> = new Set(PERFIS);

export const usuariosPeloCadastroResumo: FonteDeUsuarios = async (tx, ids) => {
  const saida: UsuarioTreinamento[] = [];
  for (let i = 0; i < ids.length; i += LOTE_CONSULTA) {
    const r = await tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [], produto_ids: [], usuario_ids: ids.slice(i, i + LOTE_CONSULTA) });
    for (const u of r.usuarios) {
      if (!PERFIS_CONHECIDOS.has(u.perfil)) continue;
      saida.push({ id: u.id, nome: u.nome, perfil: u.perfil as Perfil, equipe_id: null, regional_id: null, ativo: true });
    }
  }
  return { usuarios: saida, completa: false };
};

/** RN-TRE-07: usuários do tenant pelo Core, página a página (cursor); indisponível → cadastro_resumo (parcial). */
export const usuariosPeloCoreResumo: FonteDeUsuarios = async (tx, ids) => {
  const saida: UsuarioTreinamento[] = [];
  try {
    let apos: string | undefined;
    do {
      const r = await tx.consultar(CONSULTA_USUARIOS_RESUMO, { limite: LOTE_CONSULTA, ...(apos ? { apos_id: apos } : {}) });
      for (const u of r.usuarios) {
        if (!PERFIS_CONHECIDOS.has(u.perfil)) continue;
        saida.push({ id: u.id, nome: u.nome, perfil: u.perfil as Perfil, equipe_id: u.equipe_id, regional_id: u.regional_id, ativo: u.ativo });
      }
      apos = r.proximo_cursor ?? undefined;
    } while (apos);
    return { usuarios: saida, completa: true };
  } catch (e) {
    if (!ehConsultaIndisponivel(e)) throw e;
    return usuariosPeloCadastroResumo(tx, ids);
  }
};

export interface OpcoesFabricaPostgres {
  /** Padrão: `usuariosPeloCoreResumo`. */
  usuarios?: FonteDeUsuarios;
}

// ---------------------------------------------------------------------------------------------------------------
// conteúdo

const COLUNAS_TRILHA = `id, tenant_id, titulo, descricao, status, obrigatoria, sequencial, prazo::text as prazo,
       publico_perfis::text[] as publico_perfis, publico_equipes::text[] as publico_equipes,
       ${ts('publicada_em')} as publicada_em, ${ts('arquivada_em')} as arquivada_em, ${ts('created_at', US)} as created_at, ${CURSOR}`;

interface LinhaTrilha {
  id: string;
  tenant_id: string;
  titulo: string;
  descricao: string | null;
  status: Trilha['status'];
  obrigatoria: boolean;
  sequencial: boolean;
  prazo: string | null;
  publico_perfis: string[];
  publico_equipes: string[];
  publicada_em: string | null;
  arquivada_em: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

async function carregarArvores(db: ClienteBanco, ids: readonly string[]): Promise<Map<string, ModuloConteudo[]>> {
  const porTrilha = new Map<string, ModuloConteudo[]>();
  if (ids.length === 0) return porTrilha;
  const lista = [...ids];
  const filtro = `where trilha_id = any($1::uuid[]) and deleted_at is null`;
  const modulos = await db.query<{ id: string; trilha_id: string; ordem: number; titulo: string; pre_requisitos: string[] }>(
    `select id, trilha_id, ordem, titulo, pre_requisitos::text[] as pre_requisitos from treinamento.modulo_trilha ${filtro} order by trilha_id, ordem, id`,
    [lista],
  );
  const licoes = await db.query<{ id: string; trilha_id: string; modulo_id: string; ordem: number; titulo: string; tipo: LicaoConteudo['tipo']; texto: string | null; midia_url: string | null; duracao_estimada_seg: number | null; pre_requisitos: string[] }>(
    `select id, trilha_id, modulo_id, ordem, titulo, tipo, texto, midia_url, duracao_estimada_seg, pre_requisitos::text[] as pre_requisitos from treinamento.licao ${filtro} order by trilha_id, ordem, id`,
    [lista],
  );
  const quizzes = await db.query<{ id: string; licao_id: string }>(`select id, licao_id from treinamento.quiz ${filtro} order by id`, [lista]);
  const questoes = await db.query<{ id: string; quiz_id: string; ordem: number; enunciado: string }>(
    `select id, quiz_id, ordem, enunciado from treinamento.questao ${filtro} order by quiz_id, ordem, id`,
    [lista],
  );
  const alternativas = await db.query<{ id: string; questao_id: string; texto: string; correta: boolean }>(
    `select id, questao_id, texto, correta from treinamento.alternativa ${filtro} order by questao_id, ordem, id`,
    [lista],
  );

  const altsDaQuestao = new Map<string, AlternativaConteudo[]>();
  for (const a of alternativas.rows) altsDaQuestao.set(a.questao_id, [...(altsDaQuestao.get(a.questao_id) ?? []), { id: a.id, texto: a.texto, correta: a.correta }]);
  const questoesDoQuiz = new Map<string, QuestaoConteudo[]>();
  for (const q of questoes.rows) {
    questoesDoQuiz.set(q.quiz_id, [...(questoesDoQuiz.get(q.quiz_id) ?? []), { id: q.id, ordem: q.ordem, enunciado: q.enunciado, alternativas: altsDaQuestao.get(q.id) ?? [] }]);
  }
  const quizDaLicao = new Map(quizzes.rows.map((q) => [q.licao_id, { id: q.id, questoes: questoesDoQuiz.get(q.id) ?? [] }]));
  const licoesDoModulo = new Map<string, LicaoConteudo[]>();
  for (const l of licoes.rows) {
    licoesDoModulo.set(l.modulo_id, [
      ...(licoesDoModulo.get(l.modulo_id) ?? []),
      { id: l.id, ordem: l.ordem, titulo: l.titulo, tipo: l.tipo, texto: l.texto, midia_url: l.midia_url, duracao_estimada_seg: l.duracao_estimada_seg, pre_requisitos: l.pre_requisitos, quiz: quizDaLicao.get(l.id) ?? null },
    ]);
  }
  for (const m of modulos.rows) {
    porTrilha.set(m.trilha_id, [...(porTrilha.get(m.trilha_id) ?? []), { id: m.id, ordem: m.ordem, titulo: m.titulo, pre_requisitos: m.pre_requisitos, licoes: licoesDoModulo.get(m.id) ?? [] }]);
  }
  return porTrilha;
}

async function montarTrilhas(db: ClienteBanco, linhas: readonly LinhaTrilha[]): Promise<TrilhaGravada[]> {
  const arvores = await carregarArvores(db, linhas.map((l) => l.id));
  return linhas.map((l) => ({
    id: l.id,
    tenant_id: l.tenant_id,
    titulo: l.titulo,
    descricao: l.descricao,
    obrigatoria: l.obrigatoria,
    sequencial: l.sequencial,
    prazo: l.prazo,
    publico_alvo: { perfis: l.publico_perfis as Perfil[], equipes: l.publico_equipes },
    modulos: arvores.get(l.id) ?? [],
    status: l.status,
    publicada_em: l.publicada_em,
    arquivada_em: l.arquivada_em,
    created_at: l.created_at,
    updated_at: l.updated_at,
    deleted_at: l.deleted_at,
  }));
}

/** Insere a árvore (ordem das FKs). Ids do BKO; `trilha_id` desnormalizado em todo nó. */
async function inserirArvore(db: ClienteBanco, tenantId: string, t: Trilha): Promise<void> {
  for (const m of t.modulos) {
    await db.query(
      `insert into treinamento.modulo_trilha (id, tenant_id, trilha_id, ordem, titulo, pre_requisitos) values ($1, $2, $3, $4, $5, $6::uuid[])`,
      [m.id, tenantId, t.id, m.ordem, m.titulo, m.pre_requisitos],
    );
    for (const l of m.licoes) {
      await db.query(
        `insert into treinamento.licao (id, tenant_id, trilha_id, modulo_id, ordem, titulo, tipo, texto, midia_url, duracao_estimada_seg, pre_requisitos)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid[])`,
        [l.id, tenantId, t.id, m.id, l.ordem, l.titulo, l.tipo, l.texto, l.midia_url, l.duracao_estimada_seg, l.pre_requisitos],
      );
      if (!l.quiz) continue;
      await db.query(`insert into treinamento.quiz (id, tenant_id, trilha_id, licao_id) values ($1, $2, $3, $4)`, [l.quiz.id, tenantId, t.id, l.id]);
      for (const q of l.quiz.questoes) {
        await db.query(`insert into treinamento.questao (id, tenant_id, trilha_id, quiz_id, ordem, enunciado) values ($1, $2, $3, $4, $5, $6)`, [q.id, tenantId, t.id, l.quiz.id, q.ordem, q.enunciado]);
        for (const [i, a] of q.alternativas.entries()) {
          await db.query(
            `insert into treinamento.alternativa (id, tenant_id, trilha_id, questao_id, ordem, texto, correta) values ($1, $2, $3, $4, $5, $6, $7)`,
            [a.id, tenantId, t.id, q.id, i, a.texto, a.correta],
          );
        }
      }
    }
  }
}

/** Apaga a árvore na ordem inversa das FKs. */
async function apagarArvore(db: ClienteBanco, trilhaId: string): Promise<void> {
  for (const tabela of ['alternativa', 'questao', 'quiz', 'licao', 'modulo_trilha']) {
    await db.query(`delete from treinamento.${tabela} where trilha_id = $1::uuid`, [trilhaId]);
  }
}

async function carimbos(db: ClienteBanco, trilhaId: string): Promise<CarimbosTrilha> {
  const r = await db.query<CarimbosTrilha>(`select ${ts('created_at', US)} as created_at, ${ts('updated_at', US)} as updated_at from treinamento.trilha where id = $1::uuid`, [trilhaId]);
  const linha = r.rows[0];
  if (!linha) throw new Error('trilha inexistente no tenant');
  return linha;
}

// ---------------------------------------------------------------------------------------------------------------
// aluno

const COLUNAS_ALUNO = {
  progresso: `id, tenant_id, usuario_id, trilha_id, licao_id, ${ts('concluida_em')} as concluida_em, tempo_gasto_seg`,
  tentativa: `id, tenant_id, usuario_id, quiz_id, ${ts('realizada_em')} as realizada_em, respostas, acertos, total_questoes, nota_pct::float8 as nota_pct, aprovada, primeira_tentativa, finalizada`,
  xp_lancamento: `id, tenant_id, usuario_id, origem, referencia_id, pontos, pontos_base, limitado_pelo_teto, ${ts('ocorrido_em')} as ocorrido_em, dia::text as dia`,
  medalha_usuario: `id, tenant_id, usuario_id, medalha_codigo, ${ts('conquistada_em')} as conquistada_em`,
} satisfies Record<EntidadeDoAluno, string>;

type LinhaTentativa = { respostas: { questao_id: string; alternativa_ids: string[] }[] };

export function criarFabricaPostgres(opcoes: OpcoesFabricaPostgres = {}): FabricaRepositorio {
  const fonteDeUsuarios = opcoes.usuarios ?? usuariosPeloCoreResumo;
  return {
    doTenant(db, tenantId, _agora, tx): RepositorioTreinamento {
      const doAluno = async <L>(entidade: EntidadeDoAluno, usuarioId: string): Promise<L[]> =>
        (await db.query<L>(`select ${COLUNAS_ALUNO[entidade]} from treinamento.${entidade} where usuario_id = $1::uuid and deleted_at is null order by updated_at, id`, [usuarioId])).rows;

      let completa = false; // vira true quando usuarios() recebeu o tenant inteiro do Core
      return {
        async travarAluno(usuarioId) {
          await db.query(`select pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))`, [tenantId, usuarioId]);
        },

        // ---- conteúdo ----
        async trilhas() {
          const r = await db.query<LinhaTrilha>(`select ${COLUNAS_TRILHA} from treinamento.trilha where deleted_at is null order by created_at, id`);
          return montarTrilhas(db, r.rows);
        },
        async trilha(id) {
          const r = await db.query<LinhaTrilha>(`select ${COLUNAS_TRILHA} from treinamento.trilha where id = $1::uuid and deleted_at is null`, [id]);
          return (await montarTrilhas(db, r.rows))[0] ?? null;
        },
        async inserirTrilha(t) {
          await db.query(
            `insert into treinamento.trilha (id, tenant_id, titulo, descricao, status, obrigatoria, sequencial, prazo, publico_perfis, publico_equipes, publicada_em, arquivada_em)
             values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::text[], $10::uuid[], $11, $12)`,
            [t.id, tenantId, t.titulo, t.descricao, t.status, t.obrigatoria, t.sequencial, t.prazo, t.publico_alvo.perfis, t.publico_alvo.equipes, t.publicada_em, t.arquivada_em],
          );
          await inserirArvore(db, tenantId, t);
          return carimbos(db, t.id);
        },
        async atualizarTrilha(t) {
          const r = await db.query(
            `update treinamento.trilha
                set titulo = $2, descricao = $3, obrigatoria = $4, sequencial = $5, prazo = $6::date, publico_perfis = $7::text[], publico_equipes = $8::uuid[]
              where id = $1::uuid and deleted_at is null`,
            [t.id, t.titulo, t.descricao, t.obrigatoria, t.sequencial, t.prazo, t.publico_alvo.perfis, t.publico_alvo.equipes],
          );
          if (r.rowCount !== 1) throw new Error('trilha inexistente no tenant');
          await apagarArvore(db, t.id);
          await inserirArvore(db, tenantId, t);
          return carimbos(db, t.id);
        },
        async mudarStatusTrilha(m: MudancaDeStatus) {
          const r = await db.query(
            `update treinamento.trilha set status = $2, publicada_em = $3, arquivada_em = $4 where id = $1::uuid and status = $5 and deleted_at is null`,
            [m.trilha_id, m.para, m.publicada_em, m.arquivada_em, m.de],
          );
          // outra requisição mudou o status antes: não grava a linha do tempo de uma transição que não aconteceu
          if (r.rowCount !== 1) throw new ErroHttpModulo(409, 'TRILHA_STATUS_MUDOU', 'A trilha foi alterada por outra pessoa. Recarregue a página e tente de novo.');
          await db.query(
            `insert into treinamento.trilha_publicacao (tenant_id, trilha_id, acao, de, para, autor_id, ocorrido_em, request_id) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [tenantId, m.trilha_id, m.acao, m.de, m.para, m.autor_id, m.ocorrido_em, m.request_id],
          );
          return carimbos(db, m.trilha_id);
        },
        async publicacoesDaTrilha(id) {
          const r = await db.query<PublicacaoGravada>(
            `select trilha_id, acao, de, para, autor_id, ${ts('ocorrido_em')} as ocorrido_em, request_id from treinamento.trilha_publicacao where trilha_id = $1::uuid and deleted_at is null order by ocorrido_em, created_at, id`,
            [id],
          );
          return r.rows;
        },
        async trilhasDesde(p: PedidoPull) {
          const r = await db.query<LinhaTrilha>(
            `select ${COLUNAS_TRILHA}
               from treinamento.trilha
              where updated_at < $1::timestamptz
                and ($2::timestamptz is null or (updated_at, id) > ($2::timestamptz, $3::uuid))
              order by updated_at, id
              limit $4`,
            [p.ate, p.desde?.updated_at ?? null, p.desde?.id ?? null, p.limite],
          );
          return montarTrilhas(db, r.rows);
        },

        // ---- aluno ----
        async estadoDoAluno(usuarioId): Promise<EstadoGravadoDoAluno> {
          const conclusoes = await doAluno<ConclusaoDoAluno>('progresso', usuarioId);
          const tentativas = (await doAluno<TentativaDoAluno & LinhaTentativa>('tentativa', usuarioId)).map((t) => ({
            ...t,
            respostas: t.respostas.map((x) => ({ questao_id: x.questao_id, alternativa_ids: [...x.alternativa_ids] })),
          }));
          const lancamentos = await doAluno<LancamentoXp>('xp_lancamento', usuarioId);
          const conquistas = await doAluno<ConquistaDoAluno>('medalha_usuario', usuarioId);
          return {
            conclusoes: conclusoes.map(({ id, trilha_id, licao_id, tempo_gasto_seg, concluida_em }) => ({ id, trilha_id, licao_id, tempo_gasto_seg, concluida_em })),
            tentativas,
            lancamentos,
            conquistas: conquistas.map(({ id, medalha_codigo, conquistada_em }) => ({ id, medalha_codigo, conquistada_em })),
          };
        },
        async gravarAtividade(usuarioId, e) {
          // O domain já separou o que é novo (duplicado = nada chega aqui); o `on conflict do nothing` é o cinto de
          // segurança contra a corrida de dois envios iguais: a chave natural impede linha a mais e XP em dobro.
          if (e.conclusao) {
            const c = e.conclusao;
            await db.query(
              `insert into treinamento.progresso (id, tenant_id, usuario_id, trilha_id, licao_id, concluida_em, tempo_gasto_seg)
               values ($1, $2, $3, $4, $5, $6, $7)
               on conflict (tenant_id, usuario_id, licao_id) do nothing`,
              [c.id, tenantId, usuarioId, c.trilha_id, c.licao_id, c.concluida_em, c.tempo_gasto_seg],
            );
          }
          if (e.tentativa) {
            const t = e.tentativa;
            await db.query(
              `insert into treinamento.tentativa (id, tenant_id, usuario_id, quiz_id, realizada_em, respostas, acertos, total_questoes, nota_pct, aprovada, primeira_tentativa, finalizada)
               values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
               on conflict (id) do nothing`,
              [t.id, tenantId, usuarioId, t.quiz_id, t.realizada_em, JSON.stringify(t.respostas), t.acertos, t.total_questoes, t.nota_pct, t.aprovada, t.primeira_tentativa, t.finalizada],
            );
          }
          for (const l of e.lancamentos) {
            await db.query(
              `insert into treinamento.xp_lancamento (id, tenant_id, usuario_id, origem, referencia_id, pontos, pontos_base, limitado_pelo_teto, ocorrido_em, dia)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date)
               on conflict (tenant_id, usuario_id, origem, referencia_id) do nothing`,
              [l.id, tenantId, usuarioId, l.origem, l.referencia_id, l.pontos, l.pontos_base, l.limitado_pelo_teto, l.ocorrido_em, l.dia],
            );
          }
          for (const c of e.conquistas) {
            await db.query(
              `insert into treinamento.medalha_usuario (id, tenant_id, usuario_id, medalha_codigo, conquistada_em)
               values ($1, $2, $3, $4, $5)
               on conflict (tenant_id, usuario_id, medalha_codigo) do nothing`,
              [c.id, tenantId, usuarioId, c.medalha_codigo, c.conquistada_em],
            );
          }
        },
        async linhasDoAluno(entidade, usuarioId, p) {
          const r = await db.query<LinhaSync>(
            `select ${COLUNAS_ALUNO[entidade]}, ${CURSOR}
               from treinamento.${entidade}
              where usuario_id = $1::uuid
                and updated_at < $2::timestamptz
                and ($3::timestamptz is null or (updated_at, id) > ($3::timestamptz, $4::uuid))
              order by updated_at, id
              limit $5`,
            [usuarioId, p.ate, p.desde?.updated_at ?? null, p.desde?.id ?? null, p.limite],
          );
          return r.rows;
        },

        // ---- ranking e painel (tenant inteiro; o recorte de escopo é da rota) ----
        async conclusoesDoTenant() {
          const r = await db.query<ConclusaoDoUsuario>(`select usuario_id, trilha_id, licao_id, ${ts('concluida_em')} as concluida_em from treinamento.progresso where deleted_at is null`);
          return r.rows;
        },
        async tentativasDoTenant() {
          const r = await db.query<TentativaDoUsuario>(
            `select usuario_id, quiz_id, ${ts('realizada_em')} as realizada_em, nota_pct::float8 as nota_pct, aprovada from treinamento.tentativa where deleted_at is null`,
          );
          return r.rows;
        },
        async lancamentosDoTenant() {
          const r = await db.query<LancamentoXp>(`select ${COLUNAS_ALUNO.xp_lancamento} from treinamento.xp_lancamento where deleted_at is null`);
          return r.rows;
        },
        get usuariosCompletos() {
          return completa;
        },
        async usuarios() {
          if (!tx) throw new Error('usuarios(): a transação da rota é necessária para a consulta do Core (ADR 0012)');
          const r = await db.query<{ usuario_id: string }>(
            `select usuario_id from treinamento.xp_lancamento where deleted_at is null
             union select usuario_id from treinamento.progresso where deleted_at is null
             union select usuario_id from treinamento.tentativa where deleted_at is null
             union select usuario_id from treinamento.medalha_usuario where deleted_at is null`,
          );
          const lidos = await fonteDeUsuarios(tx, r.rows.map((x) => x.usuario_id));
          completa = lidos.completa;
          return lidos.usuarios;
        },
      };
    },
  };
}
