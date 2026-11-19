import { formatBRL } from '@macuxi/comum';
import type { QuantidadeEValor, ResumoDePedidos } from '../../domain/resumo-pedidos';

/** RN-VEN-47: "quantidade · valor"; sem resposta do servidor, traço. */
export function textoDoCard(q: QuantidadeEValor | null): string {
  return q ? `${q.quantidade} · ${formatBRL(q.valor_cents)}` : '—';
}

/** RN-VEN-47: quantidade em destaque no cartão ("7"); sem resposta do servidor, traço. */
export function quantidadeDoCard(q: QuantidadeEValor | null): string {
  return q ? String(q.quantidade) : '—';
}

/** RN-VEN-47: valor em R$ do cartão; sem resposta do servidor, nulo (o cartão mostra só o traço da quantidade). */
export function valorDoCard(q: QuantidadeEValor | null): string | null {
  return q ? formatBRL(q.valor_cents) : null;
}

/**
 * RD-0263: período sem nenhum pedido (total zerado e lista do período vazia, sem busca). A tela esconde os cartões e os chips
 * e fica só com a frase do vazio. Sem resposta do servidor (resumo nulo) não é vazio: o cartão mostra o estado.
 */
export function periodoSemPedidos(e: { resumo: ResumoDePedidos | null; itensNoPeriodo: number; buscando: boolean }): boolean {
  return e.resumo !== null && e.resumo.total.quantidade === 0 && e.itensNoPeriodo === 0 && !e.buscando;
}
