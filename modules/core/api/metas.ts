/**
 * Metas e indicadores (`/v1/core/metas`, `/v1/core/indicadores`; RF-CORE-08, RN-CORE-20..22; desenho T-0016 §6).
 * Escopo de equipe (`usuariosVisiveis`): fora do escopo é 404, como em rotas. O cálculo é do domínio
 * (`painelDoUsuario`), a MESMA função que o app roda sobre as linhas locais: o BKO e o aparelho mostram os mesmos números.
 * Realizado de venda vem do read-model `core.indicador_diario` (o Core não lê `vendedor.*`); enquanto ele estiver
 * vazio, `realizado_cents` sai 0 e `positivados` nulo ("aguardando pedidos" no app).
 */
import { ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import type { z } from 'zod';
import {
  EVENTO_META_DEFINIDA,
  IndicadoresListaSchema,
  MetaParamsSchema,
  MetasListaSchema,
  MetasQuerySchema,
  PutMetaSchema,
  type IndicadoresLista,
  type MetasLista,
} from '../contracts';
import { dataDoFechamento, dataLocal, painelDoUsuario, situacaoDoPeriodo, type BaseApuracao, type FaturamentoApuravel, type IndicadorMeta, type PedidoDaMeta, type TipoMeta } from '../domain';
import { auditar } from './auditoria';

const naoEncontrado = () => new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado na sua equipe. Atualize a lista e tente de novo.');

/** Parâmetro `metas.base_apuracao` (aprovado|faturado); ausente ou inválido = aprovado. */
export async function baseDeApuracao(db: ClienteBanco): Promise<BaseApuracao> {
  const r = await db.query<{ valor: unknown }>("select valor from plataforma.parametro where modulo = 'core' and chave = 'metas.base_apuracao' and deleted_at is null limit 1");
  return r.rows[0]?.valor === 'faturado' ? 'faturado' : 'aprovado';
}

/**
 * T-0065 B (RN-CORE-21): porta para os pedidos e faturamentos do Vendedor. A implementação real é a consulta pública
 * `vendedor.pedidos_da_meta@1` via `tx.consultar` (contrato pedido ao modulo-vendedor, R-20261103 T-0065); o Core não lê
 * `vendedor.*`. Devolve `null` quando a consulta está indisponível: o painel cai no read-model `indicador_diario`.
 * `periodo` é AAAA-MM; a fonte traz uma folga de 1 dia para cada lado (o domínio decide o mês pelo fuso do tenant).
 */
export type FontePedidosDaMeta = (q: { usuario_ids: string[]; periodo: string }) => Promise<{ pedidos: PedidoDaMeta[]; faturamentos: FaturamentoApuravel[] } | null>;

/** Tipo da meta de venda (RN-CORE-21). Enquanto `core.meta` não tem a coluna `tipo` (pedido ao banco-dados), vale 'pedido'. */
const tipoDaMeta = (_usuarioId: string): TipoMeta => 'pedido';

const periodoDe = (hoje: string, informado?: string): string => informado ?? hoje.slice(0, 7);

/** Usuários de campo do escopo (vendedor e promotor), ordenados por nome; `um` restringe a um usuário do escopo. */
async function usuariosDoPainel(db: ClienteBanco, visiveis: ReadonlySet<string> | 'tenant', um?: string) {
  if (um && visiveis !== 'tenant' && !visiveis.has(um)) throw naoEncontrado();
  const valores: unknown[] = [];
  let filtro = '';
  if (um) {
    valores.push(um);
    filtro = `and id = $${valores.length}`;
  } else if (visiveis !== 'tenant') {
    valores.push([...visiveis]);
    filtro = `and id = any($${valores.length}::uuid[])`;
  }
  const perfis = um ? '' : "and perfil in ('vendedor', 'promotor')";
  const r = await db.query<{ id: string; nome: string }>(`select id, nome from core.usuario where deleted_at is null and ativo ${perfis} ${filtro} order by nome, id`, valores);
  if (um && r.rows.length === 0) throw naoEncontrado();
  return r.rows;
}

export async function calcularIndicadores(db: ClienteBanco, visiveis: ReadonlySet<string> | 'tenant', agora: Date, fuso: string, q: { periodo?: string; usuario_id?: string }, fonte?: FontePedidosDaMeta): Promise<IndicadoresLista> {
  const hoje = dataLocal(agora, fuso);
  const periodo = periodoDe(hoje, q.periodo);
  const usuarios = await usuariosDoPainel(db, visiveis, q.usuario_id);
  const ids = usuarios.map((u) => u.id);
  const base = await baseDeApuracao(db);
  const situacao = situacaoDoPeriodo(periodo, hoje);
  const fechamento_em = dataDoFechamento(periodo);
  if (ids.length === 0) return IndicadoresListaSchema.parse({ periodo, base_apuracao: base, situacao, fechamento_em, itens: [] });
  const paradas = await db.query<{ usuario_id: string; cliente_id: string; data: string }>(
    "select usuario_id, cliente_id, to_char(data, 'YYYY-MM-DD') as data from core.rota_parada where deleted_at is null and usuario_id = any($1::uuid[]) and to_char(data, 'YYYY-MM') = $2",
    [ids, periodo],
  );
  const visitas = await db.query<{ usuario_id: string; cliente_id: string; data_local: string }>(
    "select usuario_id, cliente_id, to_char(data_local, 'YYYY-MM-DD') as data_local from core.visita where deleted_at is null and usuario_id = any($1::uuid[]) and to_char(data_local, 'YYYY-MM') = $2",
    [ids, periodo],
  );
  const diarios = await db.query<{ usuario_id: string; data: string; pedidos: number; vendido_cents: number; cancelado_cents: number }>(
    "select usuario_id, to_char(data, 'YYYY-MM-DD') as data, pedidos, vendido_cents::float8 as vendido_cents, cancelado_cents::float8 as cancelado_cents from core.indicador_diario where deleted_at is null and usuario_id = any($1::uuid[]) and to_char(data, 'YYYY-MM') = $2",
    [ids, periodo],
  );
  const metas = await db.query<{ usuario_id: string; periodo: string; indicador: IndicadorMeta; valor: number }>(
    'select usuario_id, periodo, indicador, valor::float8 as valor from core.meta where deleted_at is null and usuario_id = any($1::uuid[]) and periodo = $2',
    [ids, periodo],
  );
  const vendas = fonte ? await fonte({ usuario_ids: ids, periodo }) : null;
  const itens = usuarios.map((u) => {
    const p = painelDoUsuario({ periodo, usuario_id: u.id, hoje, base, paradas: paradas.rows, visitas: visitas.rows, diarios: diarios.rows, metas: metas.rows, apuracao: vendas ? { tipo: tipoDaMeta(u.id), fuso, pedidos: vendas.pedidos, faturamentos: vendas.faturamentos } : undefined });
    return { usuario_id: u.id, usuario_nome: u.nome, indicadores: p.indicadores, metas: p.metas };
  });
  return IndicadoresListaSchema.parse({ periodo, base_apuracao: base, situacao, fechamento_em, itens });
}

export const rotasDeMetas: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'metas',
    carteira: 'filtrar_no_dominio',
    query: MetasQuerySchema,
    executar: async (ctx): Promise<MetasLista> => {
      const visiveis = await ctx.usuariosVisiveis();
      const q = ctx.query as z.infer<typeof MetasQuerySchema>;
      return ctx.comTenant(async (db) => {
        const hoje = dataLocal(ctx.agora(), ctx.fuso());
        const periodo = periodoDe(hoje, q.periodo);
        const usuarios = await usuariosDoPainel(db, visiveis, q.usuario_id);
        const r = await db.query<{ usuario_id: string; indicador: IndicadorMeta; valor: number }>(
          'select usuario_id, indicador, valor::float8 as valor from core.meta where deleted_at is null and periodo = $1 and usuario_id = any($2::uuid[]) order by usuario_id, indicador',
          [periodo, usuarios.map((u) => u.id)],
        );
        return MetasListaSchema.parse({ periodo, itens: r.rows });
      });
    },
  },
  {
    metodo: 'PUT',
    caminho: 'metas/:usuarioId/:periodo',
    acao: 'meta.editar',
    carteira: 'filtrar_no_dominio',
    params: MetaParamsSchema,
    corpo: PutMetaSchema,
    executar: async (ctx) => {
      const { usuarioId, periodo } = ctx.params as z.infer<typeof MetaParamsSchema>;
      const c = ctx.corpo as z.infer<typeof PutMetaSchema>;
      const visiveis = await ctx.usuariosVisiveis();
      if (visiveis !== 'tenant' && !visiveis.has(usuarioId)) throw naoEncontrado();
      if (c.indicador === 'cobertura_pct' && c.valor > 10000) throw new ErroRegraNegocio('RN-CORE-20', 'A meta de cobertura vai de 0 a 100%. Informe um valor até 100.');
      return ctx.comTenant(async (db, tx) => {
        const existe = await db.query('select 1 from core.usuario where id = $1 and deleted_at is null', [usuarioId]);
        if (existe.rowCount === 0) throw naoEncontrado();
        const atual = (
          await db.query<{ id: string; valor: number }>('select id, valor::float8 as valor from core.meta where usuario_id = $1 and periodo = $2 and indicador = $3 and deleted_at is null', [usuarioId, periodo, c.indicador])
        ).rows[0];
        if (atual && atual.valor === c.valor) return { usuario_id: usuarioId, periodo, indicador: c.indicador, valor: c.valor };
        if (atual) await db.query('update core.meta set valor = $2 where id = $1', [atual.id, c.valor]);
        else await db.query('insert into core.meta (tenant_id, usuario_id, periodo, indicador, valor) values (plataforma.tenant_atual(), $1, $2, $3, $4)', [usuarioId, periodo, c.indicador, c.valor]);
        await tx.publicar(EVENTO_META_DEFINIDA, { usuario_id: usuarioId, periodo, indicador: c.indicador, valor: c.valor, valor_anterior: atual?.valor ?? null, definido_por: ctx.usuario.id }, usuarioId);
        await auditar(db, ctx, {
          acao: 'meta.editar',
          entidade: 'meta',
          entidadeId: usuarioId,
          antes: atual ? { indicador: c.indicador, valor: atual.valor } : null,
          depois: { periodo, indicador: c.indicador, valor: c.valor },
        });
        return { usuario_id: usuarioId, periodo, indicador: c.indicador, valor: c.valor };
      });
    },
  },
  {
    metodo: 'GET',
    caminho: 'indicadores',
    carteira: 'filtrar_no_dominio',
    query: MetasQuerySchema,
    executar: async (ctx): Promise<IndicadoresLista> => {
      const visiveis = await ctx.usuariosVisiveis();
      return ctx.comTenant((db) => calcularIndicadores(db, visiveis, ctx.agora(), ctx.fuso(), ctx.query as z.infer<typeof MetasQuerySchema>));
    },
  },
];
