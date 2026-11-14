import { formatBRL } from '@macuxi/comum';
import type { QuantidadeEValor } from '../../domain/resumo-pedidos';

/** RN-VEN-43: "quantidade · valor"; sem resposta do servidor, traço. */
export function textoDoCard(q: QuantidadeEValor | null): string {
  return q ? `${q.quantidade} · ${formatBRL(q.valor_cents)}` : '—';
}

/** RN-VEN-43: quantidade em destaque no cartão ("7"); sem resposta do servidor, traço. */
export function quantidadeDoCard(q: QuantidadeEValor | null): string {
  return q ? String(q.quantidade) : '—';
}

/** RN-VEN-43: valor em R$ do cartão; sem resposta do servidor, nulo (o cartão mostra só o traço da quantidade). */
export function valorDoCard(q: QuantidadeEValor | null): string | null {
  return q ? formatBRL(q.valor_cents) : null;
}
