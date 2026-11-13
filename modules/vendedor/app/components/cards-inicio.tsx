/**
 * Início do Campo (slot `inicio.cards` do Core): só a retomada do pedido não terminado (RN-VEN-38).
 * Os cartões Orçamentos e A faturar saíram: os números moram nos 3 cards de Pedidos (T-0170, RD-0248).
 */
import { RetomadaDoPedido } from './retomada-do-pedido';

export function CardsPedidosInicio() {
  return <RetomadaDoPedido />;
}
