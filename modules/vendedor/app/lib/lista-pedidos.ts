/** Quais abas e quais pedidos a lista mostra em cada app (T-0029 §8). Puro, sem React. */
import { localIsoDate } from '@macuxi/comum/fuso';

import type { OrderFilter } from './order-status';
import type { PedidoDaLista } from './pedidos';

/** Gestão (equipe) não tem "Na fila" nem "Integrados"; o Campo mostra todas. */
export function rotuloDaAba(filtro: OrderFilter, gestao: boolean): boolean {
  if (!gestao) return true;
  return filtro !== 'queued' && filtro !== 'integrated';
}

/**
 * Campo: pedidos do mês (no fuso do tenant) e o que ainda não terminou (fila, aguardando aprovação).
 * Gestão: toda a janela do aparelho (a equipe inteira).
 */
export function pedidosDaLista(pedidos: readonly PedidoDaLista[], o: { gestao: boolean; mes: string; tz: string }): PedidoDaLista[] {
  if (o.gestao) return [...pedidos];
  return pedidos.filter((p) => localIsoDate(p.received_at, o.tz).slice(0, 7) === o.mes || p.local || p.status === 'pending_approval');
}

/** Subtítulo honesto: a Gestão não filtra por mês, então não diz o mês. */
export function subtituloDaLista(o: { gestao: boolean; mesNome: string; quantidade: number; totalTexto: string }): string {
  const n = `${o.quantidade} ${o.quantidade === 1 ? 'pedido' : 'pedidos'}`;
  return `${o.gestao ? 'Equipe' : o.mesNome} · ${n} · ${o.totalTexto}`;
}
