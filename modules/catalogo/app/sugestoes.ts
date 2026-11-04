/**
 * Consulta `catalogo.sugestoes_pedido@1` no aparelho (T-0071 §4.2): lê só as linhas locais do Catálogo
 * (`produto_relacao`, `cliente_tabela_preco`, `tabela_preco`, `tabela_preco_item`, `estoque_saldo`) e decide com o mesmo
 * domain da API. Funciona sem sinal.
 */
import { implementarConsultaAparelho } from '@macuxi/platform-sdk';
import {
  CONSULTA_SUGESTOES_PEDIDO,
  type ClienteTabelaPrecoSync,
  type EstoqueSaldoSync,
  type ItemTabelaPreco,
  type ProdutoRelacaoSync,
  type TabelaPrecoItemSync,
  type TabelaPrecoSync,
} from '../contracts';
import { precosDoCliente } from '../domain/precos-cliente';
import { sugestoesDoPedido, vendaveisDe } from '../domain/sugestoes';
import { verPrecoDoPerfil } from '../domain/visibilidade';

const VAZIA = () => ({ complementares: [], superiores: [] });

export const consultaSugestoesPedidoAparelho = implementarConsultaAparelho(CONSULTA_SUGESTOES_PEDIDO, async (entrada, ctx) => {
  const perfil = ctx.usuario()?.perfil ?? null;
  // sem usuário logado não há perfil para liberar o preço (falha fechada)
  const verPreco = perfil !== null && verPrecoDoPerfil(perfil, ctx.parametros());
  if (!verPreco) return VAZIA();

  const vinculo = (await ctx.linhas<ClienteTabelaPrecoSync>('cliente_tabela_preco')).find((l) => l.cliente_id === entrada.cliente_id && !l.deleted_at);
  if (!vinculo) return VAZIA();
  const [tabela] = await ctx.linhasPorIds<TabelaPrecoSync>('tabela_preco', [vinculo.tabela_preco_id]);
  if (!tabela || !tabela.ativo || tabela.deleted_at) return VAZIA();
  const tabelaId = vinculo.tabela_preco_id;

  const doPedido = new Set(entrada.produto_ids);
  const relacoes = (await ctx.linhas<ProdutoRelacaoSync>('produto_relacao')).filter((l) => doPedido.has(l.produto_id) && !l.deleted_at && l.ativo);
  const candidatos = [...new Set(relacoes.map((l) => l.relacionado_id))];
  if (candidatos.length === 0) return VAZIA();
  const alvo = new Set(candidatos);

  const itens: ItemTabelaPreco[] = (await ctx.linhas<TabelaPrecoItemSync>('tabela_preco_item'))
    .filter((l) => l.tabela_preco_id === tabelaId && alvo.has(l.produto_id) && !l.deleted_at)
    .map((l) => ({ price_table_id: tabelaId, product_id: l.produto_id, price_cents: l.preco_cents, valid_from: l.vigencia_inicio, valid_to: l.vigencia_fim, unit: l.unidade ?? null }));
  const precos = precosDoCliente({ produtoIds: candidatos, tabelaId, itens, em: entrada.em, agora: ctx.agora().toISOString(), verPreco });

  const saldos = new Map<string, number>();
  for (const s of await ctx.linhas<EstoqueSaldoSync>('estoque_saldo')) {
    if (s.deleted_at || !alvo.has(s.produto_id)) continue;
    saldos.set(s.produto_id, (saldos.get(s.produto_id) ?? 0) + Number(s.quantidade));
  }

  return sugestoesDoPedido(relacoes, entrada.produto_ids, vendaveisDe(precos, saldos), entrada.limite, verPreco);
});
