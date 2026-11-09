/** Quais abas e quais pedidos a lista mostra em cada app (T-0029 §8). Puro, sem React. */
import { localIsoDate } from '@macuxi/comum/fuso';

import type { OrderFilter } from './order-status';
import type { PedidoDaLista } from './pedidos';
import { situacaoNaTela } from './pre-venda';

/** Gestão (equipe) não tem "Na fila" nem "Integrados"; o Campo mostra todas. */
export function rotuloDaAba(filtro: OrderFilter, gestao: boolean): boolean {
  if (!gestao) return true;
  return filtro !== 'queued' && filtro !== 'integrated';
}

/** Janela do pull no aparelho (dias): o seletor de mês não oferece meses fora dela. */
export const JANELA_PEDIDOS_DIAS = 90;

/**
 * Campo: pedidos do mês (no fuso do tenant) — criados no mês OU com mudança de status no mês (`updated_at`: aprovado,
 * rejeitado, integrado, faturado, cancelado) — e, no mês atual, o que ainda não terminou (fila, aguardando aprovação).
 * Gestão: toda a janela do aparelho (a equipe inteira).
 * `mesAtual` ausente = `mes` é o atual.
 */
export function pedidosDaLista(pedidos: readonly PedidoDaLista[], o: { gestao: boolean; mes: string; tz: string; mesAtual?: string }): PedidoDaLista[] {
  if (o.gestao) return [...pedidos];
  const ehAtual = (o.mesAtual ?? o.mes) === o.mes;
  return pedidos.filter((p) => {
    if (ehAtual && (p.local || p.status === 'pending_approval')) return true;
    if (p.local) return false;
    return localIsoDate(p.received_at, o.tz).slice(0, 7) === o.mes || (Boolean(p.updated_at) && localIsoDate(p.updated_at, o.tz).slice(0, 7) === o.mes);
  });
}

/** Meses (AAAA-MM, do mais novo ao mais antigo) que o seletor oferece: o atual e os que têm pedido dentro da janela de 90 dias. */
export function mesesDoSeletor(pedidos: readonly PedidoDaLista[], o: { mesAtual: string; tz: string; agora: Date }): string[] {
  const limite = localIsoDate(new Date(o.agora.getTime() - JANELA_PEDIDOS_DIAS * 86_400_000), o.tz).slice(0, 7);
  const meses = new Set<string>([o.mesAtual]);
  for (const p of pedidos) {
    if (p.local) continue;
    for (const iso of [p.received_at, p.updated_at]) {
      if (!iso) continue;
      const m = localIsoDate(iso, o.tz).slice(0, 7);
      if (m >= limite && m <= o.mesAtual) meses.add(m);
    }
  }
  return [...meses].sort().reverse();
}

/** Subtítulo honesto: a Gestão não filtra por mês, então não diz o mês. */
export function subtituloDaLista(o: { gestao: boolean; mesNome: string; quantidade: number; totalTexto: string }): string {
  const n = `${o.quantidade} ${o.quantidade === 1 ? 'pedido' : 'pedidos'}`;
  return `${o.gestao ? 'Equipe' : o.mesNome} · ${n} · ${o.totalTexto}`;
}

/**
 * RN-VEN-18: o filtro "Pedidos | Orçamentos" da lista. Orçamentos: os abertos primeiro, do mais novo ao mais antigo (não
 * há validade, RN-VEN-18); depois convertidos e cancelados, do mais novo ao mais antigo. Calcula a situação pelo relógio do
 * aparelho (funciona offline).
 */
export function porTipo(pedidos: readonly PedidoDaLista[], tipo: 'pedido' | 'orcamento', agora: Date): PedidoDaLista[] {
  if (tipo === 'pedido') return pedidos.filter((p) => p.tipo !== 'orcamento');
  const abertos = (p: PedidoDaLista) => situacaoNaTela(p, agora) === 'aberto';
  const orcamentos = pedidos.filter((p) => p.tipo === 'orcamento');
  const a = orcamentos.filter(abertos).sort((x, y) => y.received_at.localeCompare(x.received_at));
  const b = orcamentos.filter((p) => !abertos(p)).sort((x, y) => y.received_at.localeCompare(x.received_at));
  return [...a, ...b];
}
