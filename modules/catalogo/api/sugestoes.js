/**
 * Consulta `catalogo.sugestoes_pedido@1` na API (T-0071 §4.2; RF-CAT-03). Só SQL em `catalogo.*` na transação de quem
 * consulta (RLS do tenant): relações, tabela do cliente, itens e saldo. A decisão (ordem, exclusões, limite, RN-CAT-05/06/07)
 * é do domain, igual ao aparelho.
 */
import { implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_SUGESTOES_PEDIDO } from '../contracts';
import { consultarDoContexto, filialDaTabela, filialDoClienteNoCore } from './filiais-core';
import { precosDoCliente } from '../domain/precos-cliente';
import { sugestoesDoPedido, vendaveisDe } from '../domain/sugestoes';
import { verPrecoDoPerfil } from '../domain/visibilidade';
const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const VAZIA = () => ({ complementares: [], superiores: [] });
export const consultaSugestoesPedido = implementarConsulta(CONSULTA_SUGESTOES_PEDIDO, async (entrada, ctx) => {
    const verPreco = verPrecoDoPerfil(ctx.usuario.perfil, ctx.parametros());
    if (!verPreco)
        return VAZIA();
    const t = await ctx.db.query(`select ct.tabela_preco_id
       from catalogo.cliente_tabela_preco ct
       join catalogo.tabela_preco t on t.tenant_id = ct.tenant_id and t.id = ct.tabela_preco_id and t.ativo and t.deleted_at is null
      where ct.cliente_id = $1::uuid and ct.deleted_at is null`, [entrada.cliente_id]);
    const tabelaId = t.rows[0]?.tabela_preco_id ?? null;
    if (!tabelaId)
        return VAZIA();
    // RN-CORE-39: o preço sai da filial do preço (cliente, ou padrão por fallback de tabela) e o estoque, da filial do cliente
    const filialCliente = await filialDoClienteNoCore(consultarDoContexto(ctx), entrada.cliente_id);
    const filial = await filialDaTabela(ctx.db, tabelaId, filialCliente);
    const r = await ctx.db.query(`select produto_id, relacionado_id, tipo, ordem::int as ordem, ativo
       from catalogo.produto_relacao
      where produto_id = any($1::uuid[]) and tipo in ('complementar', 'superior') and ativo and deleted_at is null`, [entrada.produto_ids]);
    const relacoes = r.rows;
    const candidatos = [...new Set(relacoes.map((x) => x.relacionado_id))];
    if (candidatos.length === 0)
        return VAZIA();
    const p = await ctx.db.query(`select produto_id, preco_cents::float8 as preco_cents,
            to_char(vigencia_inicio at time zone 'UTC', ${UTC}) as vigencia_inicio,
            to_char(vigencia_fim at time zone 'UTC', ${UTC}) as vigencia_fim,
            unidade
       from catalogo.tabela_preco_item
      where tabela_preco_id = $1::uuid and filial_id = $3::uuid and produto_id = any($2::uuid[]) and deleted_at is null`, [tabelaId, candidatos, filial.filialId]);
    const itens = p.rows.map((x) => ({
        price_table_id: tabelaId,
        product_id: x.produto_id,
        price_cents: x.preco_cents,
        valid_from: x.vigencia_inicio,
        valid_to: x.vigencia_fim,
        unit: x.unidade,
    }));
    const precos = precosDoCliente({ produtoIds: candidatos, tabelaId, itens, em: entrada.em, agora: ctx.agora().toISOString(), verPreco });
    const s = await ctx.db.query(`select s.produto_id, sum(s.quantidade)::float8 as saldo
       from catalogo.estoque_saldo s
       join catalogo.deposito d on d.tenant_id = s.tenant_id and d.id = s.deposito_id and d.deleted_at is null
      where s.produto_id = any($1::uuid[]) and s.deleted_at is null and d.filial_id = $2::uuid
      group by s.produto_id`, [candidatos, filialCliente.filialCliente]);
    const saldos = new Map(s.rows.map((x) => [x.produto_id, x.saldo]));
    return sugestoesDoPedido(relacoes, entrada.produto_ids, vendaveisDe(precos, saldos), entrada.limite, verPreco);
});
