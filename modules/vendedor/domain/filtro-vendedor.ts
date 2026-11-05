/**
 * Seletor de vendedor da lista de Pedidos no Gestão (T-0077, RF-VEN-05). Opções derivadas dos pedidos do aparelho: o sync
 * já entrega só a equipe do usuário (RN-CORE-04) e só vendedor cria pedido (RN-PRO-01), então nunca aparece promotor.
 * O filtro é aplicado antes da busca, do período, das contagens e do resumo. Funções puras.
 */
import { normalizarTexto } from './busca-periodo';

export const TODOS_OS_VENDEDORES = 'todos';

export interface OpcaoDeVendedor {
  id: string;
  nome: string;
}

interface ComVendedor {
  seller_id: string;
  seller_name: string;
}

export function opcoesDeVendedor(pedidos: readonly ComVendedor[]): OpcaoDeVendedor[] {
  const porId = new Map<string, string>();
  for (const p of pedidos) {
    if (!p.seller_id) continue;
    if (!porId.get(p.seller_id)) porId.set(p.seller_id, p.seller_name.trim());
  }
  const vendedores = [...porId].map(([id, nome]) => ({ id, nome: nome || 'Vendedor sem nome' }));
  vendedores.sort((a, b) => normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome), 'pt-BR'));
  return [{ id: TODOS_OS_VENDEDORES, nome: 'Todos os vendedores' }, ...vendedores];
}

export function filtrarPorVendedor<T extends ComVendedor>(pedidos: readonly T[], vendedorId: string): T[] {
  return vendedorId === TODOS_OS_VENDEDORES ? [...pedidos] : pedidos.filter((p) => p.seller_id === vendedorId);
}
