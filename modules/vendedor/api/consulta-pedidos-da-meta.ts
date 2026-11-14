/**
 * Consulta `vendedor.pedidos_da_meta@1` na API (ADR 0012; RN-CORE-21; T-0065 B). Só SQL em `vendedor.*`, na transação de quem
 * consulta (RLS do tenant). Pedido: aprovados pela data de emissão (aparelho, senão criação); pedido em nome conta para o
 * `vendedor_id`. Faturamento: uma linha por retorno faturado do ERP, pela data do faturamento; pedido cancelado depois
 * abate o valor. Devolução ainda não existe (RN-VEN-37 proposta): `devolvido_cents` nulo. O frete não tem valor (CIF/FOB).
 * `itens_distintos`: produtos distintos de cada pedido (indicador `itens_por_pedido`), contados no domain.
 * Vendedor e promotor só recebem o próprio número; os demais perfis, os `usuario_ids` pedidos (o Core já os escopou).
 */
import { implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_PEDIDOS_DA_META } from '../contracts';
import { DIAS_PRECO_RETROATIVO, itensDistintos, janelaDoPeriodo, STATUS_QUE_CONTAM_NA_META, statusParaMeta } from '../domain';

/**
 * Emissão LIMITADA (T-0138): o espelho em SQL de `emitidoEm` (domain/aprovacao.ts), com o recebimento como "agora". Sem hora do
 * aparelho, a criação. É o mesmo instante do `emitido_em` de `vendedor.pedido.criado@1`.
 */
export const EMITIDO_EM_SQL = `(case when p.criado_no_aparelho_em is null then p.created_at
    else least(greatest(p.criado_no_aparelho_em, coalesce(p.recebido_em, p.created_at) - interval '${DIAS_PRECO_RETROATIVO} days'), coalesce(p.recebido_em, p.created_at)) end)`;
const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

interface LinhaPedidoMeta {
  id: string;
  vendedor_id: string;
  autor_id: string | null;
  cliente_id: string | null;
  emitido_em: string;
  aprovado_em: string | null;
  status: string;
  total_cents: number;
}
interface LinhaItemMeta {
  pedido_id: string;
  produto_id: string;
  quantidade: number;
}
interface LinhaFaturamentoMeta {
  vendedor_id: string;
  cliente_id: string | null;
  faturado_em: string;
  valor_cents: number;
  cancelado: boolean;
}

export const consultaPedidosDaMeta = implementarConsulta(CONSULTA_PEDIDOS_DA_META, async (entrada, ctx) => {
  const proprioApenas = ctx.usuario.perfil === 'vendedor' || ctx.usuario.perfil === 'promotor';
  const ids = proprioApenas ? entrada.usuario_ids.filter((i) => i === ctx.usuario.id) : entrada.usuario_ids;
  if (ids.length === 0) return { pedidos: [], faturamentos: [] };
  const { de, ate } = janelaDoPeriodo(entrada.periodo);

  const ped = await ctx.db.query<LinhaPedidoMeta>(
    `select p.id, p.vendedor_id, p.autor_id, p.cliente_id, p.status, p.total_cents::float8 as total_cents,
            to_char(${EMITIDO_EM_SQL} at time zone 'UTC', ${UTC}) as emitido_em,
            to_char(p.decidido_em at time zone 'UTC', ${UTC}) as aprovado_em
       from vendedor.pedido p
      where p.deleted_at is null and p.tipo = 'pedido'
        and p.vendedor_id = any($1::uuid[]) and p.status = any($2::text[])
        and ${EMITIDO_EM_SQL} >= $3::timestamptz and ${EMITIDO_EM_SQL} < $4::timestamptz
      order by emitido_em, p.id`,
    [ids, [...STATUS_QUE_CONTAM_NA_META], de, ate],
  );
  const itensPorPedido = new Map<string, LinhaItemMeta[]>();
  if (ped.rows.length > 0) {
    const it = await ctx.db.query<LinhaItemMeta>(
      `select pedido_id, produto_id, quantidade::float8 as quantidade
         from vendedor.pedido_item
        where deleted_at is null and pedido_id = any($1::uuid[])`,
      [ped.rows.map((r) => r.id)],
    );
    for (const i of it.rows) itensPorPedido.set(i.pedido_id, [...(itensPorPedido.get(i.pedido_id) ?? []), { ...i, quantidade: Number(i.quantidade) }]);
  }
  const fat = await ctx.db.query<LinhaFaturamentoMeta>(
    `select p.vendedor_id, p.cliente_id, (p.status = 'cancelled') as cancelado,
            to_char(f.faturado_em at time zone 'UTC', ${UTC}) as faturado_em,
            coalesce(f.nota_total_cents, (select coalesce(sum((i->>'total_cents')::bigint), 0) from jsonb_array_elements(f.itens) i))::float8 as valor_cents
       from vendedor.pedido_faturamento f
       join vendedor.pedido p on p.tenant_id = f.tenant_id and p.id = f.pedido_id
      where f.deleted_at is null and p.deleted_at is null
        and p.vendedor_id = any($1::uuid[]) and f.faturado_em >= $2::timestamptz and f.faturado_em < $3::timestamptz
      order by f.faturado_em, f.id`,
    [ids, de, ate],
  );

  return {
    pedidos: ped.rows.map((r) => ({
      vendedor_id: r.vendedor_id,
      criado_por: r.autor_id,
      cliente_id: r.cliente_id,
      emitido_em: r.emitido_em,
      aprovado_em: r.aprovado_em,
      status: statusParaMeta(r.status) ?? 'aprovado',
      total_cents: Number(r.total_cents),
      frete_cents: null,
      cancelado_cents: null,
      itens_distintos: itensDistintos(itensPorPedido.get(r.id) ?? []),
    })),
    faturamentos: fat.rows.map((r) => ({
      vendedor_id: r.vendedor_id,
      cliente_id: r.cliente_id,
      faturado_em: r.faturado_em,
      valor_cents: Number(r.valor_cents),
      cancelado_cents: r.cancelado ? Number(r.valor_cents) : null,
      devolvido_cents: null,
    })),
  };
});
