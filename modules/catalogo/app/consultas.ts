/**
 * Consulta `catalogo.precos_cliente@1` no aparelho (ADR 0012): lê só as linhas locais do Catálogo (pull de
 * `cliente_tabela_preco`, `tabela_preco` e `tabela_preco_item`) e decide com o mesmo domain da API.
 */
import { implementarConsultaAparelho } from '@macuxi/platform-sdk';
import { CONSULTA_PRECOS_CLIENTE, type ClienteTabelaPrecoSync, type ItemTabelaPreco, type TabelaPrecoItemSync, type TabelaPrecoSync } from '../contracts';
import { precosDoCliente } from '../domain/precos-cliente';
import { verPrecoDoPerfil } from '../domain/visibilidade';

export const consultaPrecosClienteAparelho = implementarConsultaAparelho(CONSULTA_PRECOS_CLIENTE, async (entrada, ctx) => {
  const perfil = ctx.usuario()?.perfil ?? null;
  // sem usuário logado não há perfil para liberar o preço (falha fechada)
  const verPreco = perfil !== null && verPrecoDoPerfil(perfil, ctx.parametros());
  let tabelaId: string | null = null;
  let itens: ItemTabelaPreco[] = [];
  if (verPreco) {
    const vinculos = (await ctx.linhas<ClienteTabelaPrecoSync>('cliente_tabela_preco')).filter((l) => l.cliente_id === entrada.cliente_id && !l.deleted_at);
    const candidata = vinculos[0]?.tabela_preco_id ?? null;
    if (candidata) {
      const [tabela] = await ctx.linhasPorIds<TabelaPrecoSync>('tabela_preco', [candidata]);
      if (tabela && tabela.ativo && !tabela.deleted_at) tabelaId = candidata;
    }
    if (tabelaId) {
      const id = tabelaId;
      const pedidos = new Set(entrada.produto_ids);
      itens = (await ctx.linhas<TabelaPrecoItemSync>('tabela_preco_item'))
        .filter((l) => l.tabela_preco_id === id && pedidos.has(l.produto_id) && !l.deleted_at)
        .map((l) => ({ price_table_id: id, product_id: l.produto_id, price_cents: l.preco_cents, valid_from: l.vigencia_inicio, valid_to: l.vigencia_fim }));
    }
  }
  return precosDoCliente({ produtoIds: entrada.produto_ids, tabelaId, itens, em: entrada.em, agora: ctx.agora().toISOString(), verPreco });
});
