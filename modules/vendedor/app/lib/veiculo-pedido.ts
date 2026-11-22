/**
 * Apoio puro do filtro de veículo na aba Itens do Novo pedido (RN-CAT-22; spec `docs/design/filtro-veiculo/spec.md` §3, §5 e §8; sem linha 3). A regra
 * (cascata e filtro) é do domain do Catálogo e chega pelas consultas `catalogo.veiculos@1` e `catalogo.busca_produtos@1`;
 * aqui só se decide a lista e se montam os textos. O veículo é estado da tela: não entra no rascunho, no pedido, no PDF nem no ERP (P5).
 */
import type { RotulosVeiculo, VeiculoEscolhido } from '@macuxi/catalogo/contracts';

import { buscaPodeComecar } from '../../domain/busca-seletor';

/** O veículo aplicado e os rótulos que a consulta devolveu junto (a tela não monta rótulo). */
export interface VeiculoDoPedido {
  veiculo: VeiculoEscolhido;
  rotulos: RotulosVeiculo;
}

/** O que a lista da aba mostra: os itens do pedido, as peças do veículo (sem texto) ou o resultado da busca. */
export function modoDaListaDoPedido(e: { veiculo: boolean; texto: string }): 'itens' | 'veiculo' | 'busca' {
  if (buscaPodeComecar(e.texto)) return 'busca';
  return e.veiculo ? 'veiculo' : 'itens';
}

/** RN-CAT-22 e RN-CAT-06: o escopo de venda do cliente, o MESMO na busca de itens e na cascata (botão, opções, busca da folha e lista). */
export function escopoDoCliente(clienteId: string | undefined, produtoIds: string[] | null): { cliente_id?: string; produto_ids?: string[] } {
  return clienteId ? { cliente_id: clienteId } : produtoIds ? { produto_ids: produtoIds } : {};
}

/** Chave estável do veículo, para a busca descartar resposta de outro veículo. */
export const chaveDoVeiculo = (v: VeiculoEscolhido | null): string => (v ? [v.montadora, v.modelo, v.ano, v.motor, v.versao].join('|') : '');
