/** Mesma validação do servidor, sem lançar: a tela mostra os avisos e bloqueia o envio quando recusado. */
import type { DiscountPolicy } from '../../contracts';
import { validateOrder } from '../../domain/order';
import { toDomainPolicy } from './catalog';

export function validarSemLancar(a: {
  sellerId: string;
  discountPct: number;
  lines: Array<{ product_id: string; quantity: number; unit_price_cents: number | null }>;
  politica: DiscountPolicy;
}) {
  return validateOrder({
    seller_id: a.sellerId,
    discount_pct: a.discountPct,
    lines: a.lines,
    policy: toDomainPolicy(a.politica),
    // P-6 (T-0029): crédito fora da fatia, igual ao servidor
    credit: null,
  });
}
