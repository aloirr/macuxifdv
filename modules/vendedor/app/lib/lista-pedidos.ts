/** Quais abas da lista de pedidos cada app mostra (T-0029 §8). Puro, sem React. */
import type { OrderFilter } from './order-status';

/** Gestão (equipe) não tem "Na fila" nem "Integrados"; o Campo mostra todas. */
export function rotuloDaAba(filtro: OrderFilter, gestao: boolean): boolean {
  if (!gestao) return true;
  return filtro !== 'queued' && filtro !== 'integrated';
}
