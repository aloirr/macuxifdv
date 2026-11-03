/**
 * Apoio da consulta pública `vendedor.pedidos_da_meta@1` (RN-CORE-21; T-0065 B). Funções puras: quais status contam como
 * aprovados e a janela de datas que a consulta devolve. A conta do realizado é do Core; aqui só se entregam os fatos.
 */
import type { OrderStatus } from './order';

/** Status do Vendedor que contam como pedido aprovado na meta (aprovado, integrado, faturado). */
export const STATUS_QUE_CONTAM_NA_META: readonly OrderStatus[] = ['approved', 'sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced'];

/** Vocabulário do Core (STATUS_APROVADOS) ou null quando o status não conta. */
export function statusParaMeta(status: string): 'aprovado' | 'integrado' | 'faturado' | null {
  if (status === 'approved' || status === 'sent_to_erp') return 'aprovado';
  if (status === 'integrated') return 'integrado';
  if (status === 'invoiced' || status === 'invoiced_partial') return 'faturado';
  return null;
}

/** Janela [de, ate) em UTC do mês AAAA-MM com 1 dia de folga para cada lado. */
export function janelaDoPeriodo(periodo: string): { de: string; ate: string } {
  const [a, m] = periodo.split('-').map(Number) as [number, number];
  const DIA = 86_400_000;
  return { de: new Date(Date.UTC(a, m - 1, 1) - DIA).toISOString(), ate: new Date(Date.UTC(a, m, 1) + DIA).toISOString() };
}
