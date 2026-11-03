/**
 * `RepositorioPromotor` sobre o schema `promotor` (migração 0015, banco-dados; T-0056). Só persistência: repetido,
 * conflito, checkout e janela da visita são decididos pelo domain/recebimento; aqui só se lê e grava.
 * Roda no `ClienteBanco` da `SessaoTenant` (transação de `ctx.comTenant`: papel macuxi_app, RLS por `app.tenant_id`) —
 * nunca abre conexão própria. O `tenant_id` do filtro é redundância de leitura/índice; quem isola é o RLS.
 * O INSERT grava só `(id, tenant_id, promotor_id, [cliente_id,] payload, recebido_em)`: o gatilho `derivar_<tabela>`
 * preenche as colunas tipadas a partir do payload. A tabela de cada entidade vem de um MAPA FIXO (nunca texto do cliente).
 * SQL de referência: docs/banco/promotor.md ("SQL da RepositorioPromotor"). Sem dado pessoal em log nem em erro.
 */
import { ErroHttpModulo } from '@macuxi/platform-sdk';
import type { CadastroBko } from '../contracts';
import type { ColetaDaVisita, VisitaLojaGuardada } from '../domain';
import type { ColetaGuardada, FiltroVisitas, LinhaCadastro, RepositorioPromotor, SessaoTenant } from './repositorio';
import { COLUNAS_BASE, TABELAS_CADASTRO } from './sync-cadastros';

/** Entidade de coleta → tabela do schema `promotor` (lista fechada; interpolada no SQL só a partir daqui). */
export const TABELA_DA_COLETA: Readonly<Record<ColetaDaVisita, string>> = {
  foto_coleta: 'promotor.foto_coleta',
  checklist_resposta: 'promotor.checklist_resposta',
  gondola_registro: 'promotor.gondola_registro',
  medicao_share: 'promotor.medicao_share',
  coleta_preco: 'promotor.coleta_preco',
  ruptura_item: 'promotor.ruptura_item',
  validade_item: 'promotor.validade_item',
  ponto_extra: 'promotor.ponto_extra',
  acao_concorrencia: 'promotor.acao_concorrencia',
  tarefa_execucao: 'promotor.tarefa_execucao',
};

/** Instante em ISO 8601 UTC com `Z` (milissegundos), igual ao que o app e o recebimento usam. */
const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const COLUNAS_COLETA = `id, visita_loja_id, promotor_id, cliente_id, payload, to_char(recebido_em at time zone 'UTC', ${ISO_UTC}) as recebido_em`;

interface LinhaVisita {
  id: string;
  promotor_id: string;
  payload: Record<string, unknown>;
}
interface LinhaColeta {
  id: string;
  visita_loja_id: string;
  promotor_id: string;
  cliente_id: string;
  payload: Record<string, unknown>;
  recebido_em: string;
}

const paraVisita = (l: LinhaVisita): VisitaLojaGuardada => ({ ...(l.payload as unknown as Omit<VisitaLojaGuardada, 'promotor_id'>), promotor_id: l.promotor_id });

const paraColeta = (entidade: ColetaDaVisita, l: LinhaColeta): ColetaGuardada => ({
  entidade,
  id: l.id,
  visita_loja_id: l.visita_loja_id,
  promotor_id: l.promotor_id,
  cliente_id: l.cliente_id,
  payload: l.payload,
  recebido_em: l.recebido_em,
});

const tabelaDa = (entidade: ColetaDaVisita): string => {
  const t = TABELA_DA_COLETA[entidade];
  if (!t) throw new Error(`Entidade de coleta desconhecida: ${String(entidade)}`);
  return t;
};

/** Colunas EDITÁVEIS de cada cadastro (fixas no código, nunca texto do cliente); `itens` é jsonb. */
const ALVO_VIGENCIA = ['cliente_id', 'segmento', 'vigencia_inicio', 'vigencia_fim'] as const;
export const COLUNAS_ESCRITA: Readonly<Record<CadastroBko, readonly string[]>> = {
  categoria_gondola: ['nome', 'ordem', 'ativo'],
  checklist_loja: [...ALVO_VIGENCIA, 'nome', 'itens'],
  mix_obrigatorio: [...ALVO_VIGENCIA, 'produto_id', 'categoria_gondola_id'],
  meta_share: [...ALVO_VIGENCIA, 'categoria_gondola_id', 'meta_pct'],
  concorrente: ['nome', 'ativo'],
  produto_concorrente: ['concorrente_id', 'nome', 'produto_id', 'categoria_gondola_id', 'ativo'],
};
const COM_ATIVO: ReadonlySet<CadastroBko> = new Set(['categoria_gondola', 'concorrente', 'produto_concorrente']);
const ORDEM: Readonly<Record<CadastroBko, string>> = {
  categoria_gondola: 'ordem, lower(nome), id',
  checklist_loja: 'lower(nome), vigencia_inicio desc, id',
  mix_obrigatorio: 'vigencia_inicio desc, id',
  meta_share: 'vigencia_inicio desc, id',
  concorrente: 'lower(nome), id',
  produto_concorrente: 'lower(nome), id',
};
/** Índice único violado (23505) → mensagem em português com a ação seguinte. */
const MENSAGEM_RESTRICAO: Readonly<Record<string, string>> = {
  categoria_gondola_nome_uk: 'Já existe uma categoria com esse nome.',
  concorrente_nome_uk: 'Já existe um concorrente com esse nome.',
  produto_concorrente_nome_uk: 'Esse concorrente já tem um produto com esse nome.',
  checklist_loja_versao_uk: 'Já existe um checklist para esse alvo com o mesmo início de vigência. Edite o existente ou escolha outro início.',
  mix_obrigatorio_versao_uk: 'Esse produto já está no mix desse alvo com o mesmo início de vigência.',
  meta_share_versao_uk: 'Já existe uma meta para essa categoria e esse alvo com o mesmo início de vigência. Edite a existente ou escolha outro início.',
};

const marcador = (c: string, i: number) => (c === 'itens' ? `$${i}::jsonb` : `$${i}`);
const valorDaColuna = (c: string, v: unknown) => (c === 'itens' ? JSON.stringify(v ?? []) : (v ?? null));

/** SQL de escrita/leitura de um cadastro (exportado para o teste do texto). `updated_at` é sempre renovado (pull incremental). */
export function sqlDoCadastro(cadastro: CadastroBko): { inserir: string; atualizar: string; desativar: string; ler: string; listar: (incluirRemovidos: boolean) => string } {
  const t = TABELAS_CADASTRO[cadastro];
  const cols = COLUNAS_ESCRITA[cadastro];
  const selecao = `select ${COLUNAS_BASE}, ${t.colunas} from ${t.tabela} where tenant_id = $1`;
  return {
    inserir: `insert into ${t.tabela} (id, tenant_id, ${cols.join(', ')}) values ($1, $2, ${cols.map((c, i) => marcador(c, i + 3)).join(', ')})`,
    atualizar: `update ${t.tabela} set ${cols.map((c, i) => `${c} = ${marcador(c, i + 3)}`).join(', ')}, updated_at = now() where tenant_id = $1 and id = $2 and deleted_at is null`,
    desativar: `update ${t.tabela} set deleted_at = now(), updated_at = now()${COM_ATIVO.has(cadastro) ? ', ativo = false' : ''} where tenant_id = $1 and id = $2 and deleted_at is null`,
    ler: `${selecao} and id = $2`,
    listar: (incluirRemovidos) => `${selecao}${incluirRemovidos ? '' : ' and deleted_at is null'} order by ${ORDEM[cadastro]}`,
  };
}

function traduzirErroDeCadastro(e: unknown): never {
  const err = e as { code?: string; constraint?: string };
  if (err.code === '23505') throw new ErroHttpModulo(409, 'CADASTRO_DUPLICADO', (err.constraint && MENSAGEM_RESTRICAO[err.constraint]) || 'Já existe um cadastro igual a este. Revise os dados.');
  if (err.code === '23503') throw new ErroHttpModulo(422, 'REFERENCIA_INVALIDA', 'A categoria ou o concorrente escolhido não existe mais. Recarregue a tela e escolha outro.');
  if (err.code === '23514') throw new ErroHttpModulo(422, 'CADASTRO_INVALIDO', 'Os dados não passaram na validação do banco. Revise os campos.');
  throw e;
}

/** Lê a linha de volta (já com o `updated_at` do banco) depois de escrever. */
async function reler(s: SessaoTenant, c: CadastroBko, id: string): Promise<LinhaCadastro> {
  const r = await s.db.query<LinhaCadastro>(sqlDoCadastro(c).ler, [s.tenant_id, id]);
  if (!r.rows[0]) throw new ErroHttpModulo(404, 'CADASTRO_NAO_ENCONTRADO', 'Cadastro não encontrado.');
  return r.rows[0];
}
const valores = (c: CadastroBko, dados: Readonly<Record<string, unknown>>) => COLUNAS_ESCRITA[c].map((col) => valorDaColuna(col, dados[col]));

export function criarRepositorioSql(): RepositorioPromotor {
  return {
    async listarCadastro(s, c, incluirRemovidos) {
      return (await s.db.query<LinhaCadastro>(sqlDoCadastro(c).listar(incluirRemovidos), [s.tenant_id])).rows;
    },

    async cadastro(s, c, id) {
      const r = await s.db.query<LinhaCadastro>(`${sqlDoCadastro(c).ler} for update`, [s.tenant_id, id]);
      return r.rows[0] ?? null;
    },

    async inserirCadastro(s, c, dados) {
      try {
        await s.db.query(sqlDoCadastro(c).inserir, [String(dados.id), s.tenant_id, ...valores(c, dados)]);
      } catch (e) {
        traduzirErroDeCadastro(e);
      }
      return reler(s, c, String(dados.id));
    },

    async atualizarCadastro(s, c, id, dados) {
      let linhas = 0;
      try {
        linhas = (await s.db.query(sqlDoCadastro(c).atualizar, [s.tenant_id, id, ...valores(c, dados)])).rowCount ?? 0;
      } catch (e) {
        traduzirErroDeCadastro(e);
      }
      if (linhas === 0) throw new ErroHttpModulo(404, 'CADASTRO_NAO_ENCONTRADO', 'Cadastro não encontrado ou já desativado.');
      return reler(s, c, id);
    },

    async desativarCadastro(s, c, id) {
      await s.db.query(sqlDoCadastro(c).desativar, [s.tenant_id, id]);
      return reler(s, c, id);
    },

    async usosDoCadastro(s, c, id) {
      // nomes de tabela/coluna fixos; só valores por parâmetro; tenant_id explícito (além do RLS)
      const n = async (tabela: string, coluna: string) =>
        Number((await s.db.query<{ n: string }>(`select count(*)::int as n from promotor.${tabela} where tenant_id = $1 and ${coluna} = $2 and deleted_at is null`, [s.tenant_id, id])).rows[0]?.n ?? 0);
      if (c === 'categoria_gondola') {
        return {
          metas_share: await n('meta_share', 'categoria_gondola_id'),
          mix_obrigatorio: await n('mix_obrigatorio', 'categoria_gondola_id'),
          produtos_concorrente: await n('produto_concorrente', 'categoria_gondola_id'),
        };
      }
      if (c === 'concorrente') return { metas_share: 0, mix_obrigatorio: 0, produtos_concorrente: await n('produto_concorrente', 'concorrente_id') };
      return { metas_share: 0, mix_obrigatorio: 0, produtos_concorrente: 0 };
    },

    async visita(s: SessaoTenant, id) {
      const r = await s.db.query<LinhaVisita>('select id, promotor_id, payload from promotor.visita_loja where tenant_id = $1 and id = $2 for update', [s.tenant_id, id]);
      return r.rows[0] ? paraVisita(r.rows[0]) : null;
    },

    async gravarVisita(s, v) {
      // o promotor_id é coluna (vem do token); o payload é o contrato como o servidor o aceitou, sem ele
      const { promotor_id, ...payload } = v;
      const r = await s.db.query(
        `insert into promotor.visita_loja as v (id, tenant_id, promotor_id, payload, recebido_em)
         values ($1, $2, $3, $4::jsonb, now())
         on conflict (id) do update set payload = excluded.payload
          where v.checkout_em is null and v.promotor_id = excluded.promotor_id`,
        [v.id, s.tenant_id, promotor_id, JSON.stringify(payload)],
      );
      // 0 linhas = a visita já estava fechada (ou é de outro promotor): o domain já tinha decidido, então é corrida/bug — não segue
      if (r.rowCount === 0) throw new ErroHttpModulo(409, 'VISITA_LOJA_FECHADA', 'A visita de loja já foi encerrada e não aceita mais alteração.');
    },

    async coleta(s, entidade, id) {
      const r = await s.db.query<LinhaColeta>(`select ${COLUNAS_COLETA} from ${tabelaDa(entidade)} where tenant_id = $1 and id = $2`, [s.tenant_id, id]);
      return r.rows[0] ? paraColeta(entidade, r.rows[0]) : null;
    },

    async gravarColeta(s, c) {
      try {
        await s.db.query(
          `insert into ${tabelaDa(c.entidade)} (id, tenant_id, promotor_id, cliente_id, payload, recebido_em) values ($1, $2, $3, $4, $5::jsonb, $6)`,
          [c.id, s.tenant_id, c.promotor_id, c.cliente_id, JSON.stringify(c.payload), c.recebido_em],
        );
      } catch (e) {
        // corrida: outra transação gravou o mesmo id entre a leitura do recebimento e este INSERT. A transação já está
        // abortada (não dá para reler nela): erro retentável (503) — o reenvio lê a linha e decide repetida × conflito.
        if ((e as { code?: string }).code === '23505') throw new ErroHttpModulo(503, 'COLETA_EM_CORRIDA', 'A coleta chegou em duplicidade; reenvie para confirmar.');
        throw e;
      }
    },

    async coletasDasVisitas(s, entidade, visitaLojaIds) {
      if (visitaLojaIds.length === 0) return [];
      const r = await s.db.query<LinhaColeta>(
        `select ${COLUNAS_COLETA} from ${tabelaDa(entidade)}
          where tenant_id = $1 and visita_loja_id = any($2::uuid[]) and deleted_at is null
          order by visita_loja_id, id`,
        [s.tenant_id, [...visitaLojaIds]],
      );
      return r.rows.map((l) => paraColeta(entidade, l));
    },

    async visitasDoPeriodo(s, f: FiltroVisitas) {
      // data LOCAL do check-in no fuso do tenant -> [meia-noite de `de`, meia-noite de `ate + 1`) em instantes UTC
      const r = await s.db.query<LinhaVisita>(
        `select id, promotor_id, payload from promotor.visita_loja
          where tenant_id = $1
            and checkin_em >= ($2::date)::timestamp at time zone $4
            and checkin_em <  ($3::date + 1)::timestamp at time zone $4
            and ($5::uuid is null or cliente_id = $5)
            and deleted_at is null
          order by checkin_em, id`,
        [s.tenant_id, f.de, f.ate, f.fuso, f.cliente_id ?? null],
      );
      return r.rows.map(paraVisita);
    },

    async nomesDasCategorias(s, ids) {
      if (ids.length === 0) return new Map();
      const r = await s.db.query<{ id: string; nome: string }>('select id, nome from promotor.categoria_gondola where tenant_id = $1 and id = any($2::uuid[])', [s.tenant_id, [...ids]]);
      return new Map(r.rows.map((l) => [l.id, l.nome] as const));
    },
  };
}
