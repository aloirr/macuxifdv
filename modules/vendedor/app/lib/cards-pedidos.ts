import { formatBRL } from '@macuxi/comum';
import type { QuantidadeEValor } from '../../domain/resumo-pedidos';

/** RN-VEN-43: "quantidade · valor"; sem resposta do servidor, traço. */
export function textoDoCard(q: QuantidadeEValor | null): string {
  return q ? `${q.quantidade} · ${formatBRL(q.valor_cents)}` : '—';
}
