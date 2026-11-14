/**
 * Etapa pendente do checkout (T-0039, RN-CORE-12; docs/design/checkout-pendencia.md §1.1 e §1.2). Puro.
 * O aparelho só conhece a contagem (`visita.etapas_pendentes`, vinda do pull): o texto é genérico ("uma etapa").
 * Datas no fuso do tenant; sem ponto final nos avisos.
 */
import { dataLocal } from '../../domain';
import type { LocalVisit } from './route';

export const ROTULO_CHIP_ETAPA_PENDENTE = 'Etapa pendente';
export const ROTULO_ACESSIVEL_CHIP_ETAPA_PENDENTE = 'Visita feita com etapa pendente';

export interface AvisoEtapaPendente {
  linha1: string;
  linha2: string;
}

type VisitaMinima = Pick<LocalVisit, 'customer_id' | 'checkin_at' | 'etapas_pendentes'>;

/** Visita mais recente ENTRE as que têm etapa pendente (§1.2): uma visita nova sem pendência não esconde a anterior. */
export function visitaComEtapaPendente(visitas: readonly VisitaMinima[], clienteId: string): { checkin_at: string; etapas: number } | null {
  let ultima: VisitaMinima | null = null;
  for (const v of visitas) if (v.customer_id === clienteId && (v.etapas_pendentes ?? 0) > 0 && (!ultima || v.checkin_at > ultima.checkin_at)) ultima = v;
  return ultima ? { checkin_at: ultima.checkin_at, etapas: ultima.etapas_pendentes ?? 0 } : null;
}

/** Texto do Banner da ficha do cliente (§1.2); com etapa na fila não há aviso (RD-0181). */
export function avisoDeEtapaPendente(o: { checkin_at: string; etapas: number; agora: Date; fuso: string; naFila: number}): AvisoEtapaPendente | null {
  if (o.naFila > 0) return null;
  const dia = dataLocal(o.checkin_at, o.fuso);
  const quando = dia === dataLocal(o.agora, o.fuso) ? 'de hoje' : `de ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  const linha1 = o.etapas === 1 ? `Uma etapa da visita ${quando} não chegou` : `${o.etapas} etapas da visita ${quando} não chegaram`;
  return { linha1, linha2: 'Fale com seu supervisor' };
}
