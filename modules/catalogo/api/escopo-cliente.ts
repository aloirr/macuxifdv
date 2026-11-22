/**
 * RN-CAT-22 / RN-CAT-06: o escopo de produtos de `catalogo.veiculos@1` na API, o mesmo do aparelho (`app/escopo-cliente.ts`): `produto_ids`,
 * ou os produtos vendáveis na tabela de preço do cliente (viva e ativa, na filial dele, RN-CORE-39). A decisão de "vendável" é do domain
 * (`produtosVendaveisNaTabela`), igual ao aparelho; quem não vê preço (RN-CAT-05) não tem vendável, como no aparelho.
 */
import type { ContextoConsulta } from '@macuxi/platform-sdk';
import type { ItemTabelaPreco } from '../contracts';
import { produtosVendaveisNaTabela } from '../domain/arvore';
import { verPrecoDoPerfil } from '../domain/visibilidade';
import { consultarDoContexto, filialDaTabela, filialDoClienteNoCore } from './filiais-core';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

/** `null` = sem escopo (o catálogo inteiro). `produto_ids` vale mais que `cliente_id`, como na busca. */
export async function escopoDaApi(ctx: ContextoConsulta, e: { produto_ids?: readonly string[] | undefined; cliente_id?: string | undefined }): Promise<Set<string> | null> {
  if (e.produto_ids) return new Set(e.produto_ids);
  if (!e.cliente_id) return null;
  const perfil = ctx.usuario?.perfil;
  if (!perfil || !verPrecoDoPerfil(perfil, ctx.parametros())) return new Set();
  const t = await ctx.db.query(
    `select ct.tabela_preco_id
       from catalogo.cliente_tabela_preco ct
       join catalogo.tabela_preco t on t.tenant_id = ct.tenant_id and t.id = ct.tabela_preco_id and t.ativo and t.deleted_at is null
      where ct.cliente_id = $1::uuid and ct.deleted_at is null`,
    [e.cliente_id],
  );
  const tabelaId = (t.rows[0] as { tabela_preco_id: string } | undefined)?.tabela_preco_id ?? null;
  if (!tabelaId) return new Set();
  const filial = await filialDaTabela(ctx.db, tabelaId, await filialDoClienteNoCore(consultarDoContexto(ctx), e.cliente_id));
  const r = await ctx.db.query(
    `select produto_id, preco_cents::float8 as preco_cents,
            to_char(vigencia_inicio at time zone 'UTC', ${UTC}) as vigencia_inicio,
            to_char(vigencia_fim at time zone 'UTC', ${UTC}) as vigencia_fim
       from catalogo.tabela_preco_item
      where tabela_preco_id = $1::uuid and filial_id = $2::uuid and deleted_at is null`,
    [tabelaId, filial.filialId],
  );
  const itens = (r.rows as Array<{ produto_id: string; preco_cents: number; vigencia_inicio: string | null; vigencia_fim: string | null }>).map(
    (x): ItemTabelaPreco => ({ price_table_id: tabelaId, product_id: x.produto_id, price_cents: x.preco_cents, valid_from: x.vigencia_inicio, valid_to: x.vigencia_fim }),
  );
  return produtosVendaveisNaTabela(itens, tabelaId, ctx.agora().toISOString());
}
