/** Mesma validação do servidor, sem lançar: a tela mostra os avisos e bloqueia o envio quando recusado. */
import type { DiscountPolicy } from '../../contracts';
import { resultadoDosAvisos, validateOrder } from '../../domain/order';
import { toDomainPolicy } from './catalog';
import { avisosFinanceiros, type EntradaPrepararPedido } from './pedidos';

export function validarSemLancar(a: {
  sellerId: string;
  discountPct: number;
  lines: Array<{ product_id: string; quantity: number; unit_price_cents: number | null }>;
  politica: DiscountPolicy;
  /** T-0184 (RN-VEN-12 e RN-VEN-13): crédito e título vencido mandam para aprovação; ausente = o app não decide */
  financeiro?: EntradaPrepararPedido['financeiro'];
}) {
  const v = validateOrder({
    seller_id: a.sellerId,
    discount_pct: a.discountPct,
    lines: a.lines,
    policy: toDomainPolicy(a.politica),
    // o crédito entra por `avisosFinanceiros` (prazo, limite não informado e à vista), não por `validateOrder`
    credit: null,
  });
  const issues = [...v.issues, ...avisosFinanceiros(a.financeiro, v.totals.total_cents)];
  const outcome = resultadoDosAvisos(issues);
  return { ...v, issues, outcome } as typeof v;
}
