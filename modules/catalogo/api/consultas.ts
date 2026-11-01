/**
 * Consulta `catalogo.precos_cliente@1` na API (ADR 0012). Só SQL em `catalogo.*`, na transação de quem consulta (RLS do
 * tenant). Carrega a tabela ativa do cliente e os itens dos produtos pedidos; a decisão (RN-CAT-05/06, P-4) é do
 * domain, igual ao aparelho.
 */
import { implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_PRECOS_CLIENTE, type ItemTabelaPreco } from '../contracts';
import { precosDoCliente } from '../domain/precos-cliente';
import { verPrecoDoPerfil } from '../domain/visibilidade';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

export const consultaPrecosCliente = implementarConsulta(CONSULTA_PRECOS_CLIENTE, async (entrada, ctx) => {
  const verPreco = verPrecoDoPerfil(ctx.usuario.perfil, ctx.parametros());
  let tabelaId: string | null = null;
  let itens: ItemTabelaPreco[] = [];
  if (verPreco) {
    const t = await ctx.db.query(
      `select ct.tabela_preco_id
         from catalogo.cliente_tabela_preco ct
         join catalogo.tabela_preco t on t.tenant_id = ct.tenant_id and t.id = ct.tabela_preco_id and t.ativo and t.deleted_at is null
        where ct.cliente_id = $1::uuid and ct.deleted_at is null`,
      [entrada.cliente_id],
    );
    tabelaId = (t.rows[0] as { tabela_preco_id: string } | undefined)?.tabela_preco_id ?? null;
    if (tabelaId && entrada.produto_ids.length > 0) {
      const r = await ctx.db.query(
        `select produto_id, preco_cents::float8 as preco_cents,
                to_char(vigencia_inicio at time zone 'UTC', ${UTC}) as vigencia_inicio,
                to_char(vigencia_fim at time zone 'UTC', ${UTC}) as vigencia_fim
           from catalogo.tabela_preco_item
          where tabela_preco_id = $1::uuid and produto_id = any($2::uuid[]) and deleted_at is null`,
        [tabelaId, entrada.produto_ids],
      );
      const id = tabelaId;
      itens = (r.rows as Array<{ produto_id: string; preco_cents: number; vigencia_inicio: string | null; vigencia_fim: string | null }>).map((x) => ({
        price_table_id: id,
        product_id: x.produto_id,
        price_cents: x.preco_cents,
        valid_from: x.vigencia_inicio,
        valid_to: x.vigencia_fim,
      }));
    }
  }
  return precosDoCliente({ produtoIds: entrada.produto_ids, tabelaId, itens, em: entrada.em, agora: ctx.agora().toISOString(), verPreco });
});
