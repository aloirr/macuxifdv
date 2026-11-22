/**
 * RN-CAT-22 / RN-CAT-06: o escopo de produtos de uma consulta do aparelho (`produto_ids` ou os vendáveis na tabela do cliente), o mesmo
 * de `catalogo.busca_produtos@1`. Quem usa: a busca, a cascata de veículo e a folha Veículo do pedido.
 */
import type { ContextoConsultaAparelho } from '@macuxi/platform-sdk';
import { produtosVendaveisNaTabela } from '../domain/arvore';
import type { ProdutoCatalogo } from '../domain/vitrine';
import { contextoLocal, produtosLocais } from './lib/local';

/** RN-CAT-06: dentro da consulta, só os produtos com preço vigente na tabela do cliente (no lugar dos até 5.000 `produto_ids`). */
export async function soVendaveisDoCliente(ctx: ContextoConsultaAparelho, clienteId: string, produtos: readonly ProdutoCatalogo[]): Promise<ProdutoCatalogo[]> {
  const agora = ctx.agora().toISOString();
  const contexto = await contextoLocal(ctx, { perfil: ctx.usuario()?.perfil ?? null, parametros: ctx.parametros(), agora, clienteId, ...(ctx.usuario()?.fuso ? { fuso: ctx.usuario()!.fuso } : {}) }, produtos);
  const vendaveis = produtosVendaveisNaTabela(contexto.itensPreco, contexto.tabelaClienteId, agora);
  return produtos.filter((p) => vendaveis.has(p.id));
}

/** `null` = sem escopo (o catálogo inteiro). `produto_ids` vale mais que `cliente_id`, como na busca. */
export async function escopoLocal(ctx: ContextoConsultaAparelho, e: { produto_ids?: readonly string[] | undefined; cliente_id?: string | undefined }): Promise<Set<string> | null> {
  if (e.produto_ids) return new Set(e.produto_ids);
  if (!e.cliente_id) return null;
  const ativos = (await produtosLocais(ctx, { lerConcorrente: false })).filter((p) => p.ativo);
  return new Set((await soVendaveisDoCliente(ctx, e.cliente_id, ativos)).map((p) => p.id));
}
