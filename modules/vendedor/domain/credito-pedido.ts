/**
 * Crédito e inadimplência mandam o pedido para aprovação (T-0184, P-6; simulação aprovada em 18/11, P1 A, P3 B, P4 A).
 * Funções puras, usadas pelo app (offline, para avisar e mostrar a pergunta "Enviar para aprovação?"). O servidor revalida
 * ao receber (critério 4); a regra dele ainda é a anterior até o desenho do servidor (S3).
 *  - RN-VEN-12: a prazo, total acima do crédito disponível (limite − saldo em aberto − aprovados não faturados) vai para
 *    aprovação com o motivo `credito`; igual ao disponível não vai; à vista nunca vai por crédito; cliente sem limite
 *    informado pelo ERP, a prazo, vai (P4 A).
 *  - RN-VEN-13: título vencido há mais que o limite vai para aprovação com o motivo `inadimplencia`, também à vista (P1 A).
 */
export type MotivoFinanceiro = 'credito' | 'inadimplencia';

export interface EntradaCreditoPedido {
  /** `undefined` = prazo ainda não escolhido (conta como a prazo, o pedido nem segue sem prazo) */
  prazo_medio_dias: number | undefined;
  total_cents: number;
  /** o ERP informou limite (ou disponível) para o cliente */
  limite_informado: boolean;
  disponivel_cents: number;
}

const aVista = (prazo: number | undefined): boolean => prazo === 0;

export function exigeAprovacaoPorCredito(i: EntradaCreditoPedido): boolean {
  if (aVista(i.prazo_medio_dias) || i.total_cents <= 0) return false;
  return !i.limite_informado || i.total_cents > i.disponivel_cents;
}

export function exigeAprovacaoPorInadimplencia(i: { maior_atraso_dias: number; limite_dias: number }): boolean {
  return i.maior_atraso_dias > i.limite_dias;
}

/** Os motivos financeiros do pedido, na ordem crédito, inadimplência (uma aprovação por motivo, P3 B). */
export function motivosFinanceirosDoPedido(i: EntradaCreditoPedido & { maior_atraso_dias: number; limite_dias: number }): MotivoFinanceiro[] {
  return [...(exigeAprovacaoPorCredito(i) ? (['credito'] as const) : []), ...(exigeAprovacaoPorInadimplencia(i) ? (['inadimplencia'] as const) : [])];
}

/** O disponível que alimenta o alerta "Limite de crédito excedido": `null` = sem alerta (à vista); sem limite informado = 0. */
export function disponivelParaAlerta(i: Pick<EntradaCreditoPedido, 'prazo_medio_dias' | 'limite_informado' | 'disponivel_cents'>): number | null {
  if (aVista(i.prazo_medio_dias)) return null;
  return i.limite_informado ? i.disponivel_cents : 0;
}
