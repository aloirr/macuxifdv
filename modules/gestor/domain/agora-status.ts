/**
 * Status "agora" de cada pessoa da equipe (T-0073, RN-CORE-26; §1.5 do desenho): em visita / em rota / PARADO / sem check-in /
 * rota concluída. PARADO = sem check-in aberto, com paradas pendentes na rota e `parado_min` minutos (padrão 60, parâmetro
 * `inicio.parado_min`) desde o último checkout; sem expediente nem GPS (RN-CORE-13). Puro e leve (sem a projeção): roda
 * no aparelho, com o relógio dele, sobre os fatos que a API grava no painel do dia (por isso o status não envelhece no cache).
 */
import type { StatusDia } from '../contracts';
import { instanteMs } from './numeros';

export const STATUS_AGORA = ['em_visita', 'em_rota', 'parado', 'sem_checkin', 'rota_concluida'] as const;
export type StatusAgora = (typeof STATUS_AGORA)[number];

/** Ordem da lista "Equipe agora": quem precisa de atenção primeiro (depois, por nome). */
export const ORDEM_STATUS_AGORA: Readonly<Record<StatusAgora, number>> = { parado: 0, sem_checkin: 1, em_rota: 2, em_visita: 3, rota_concluida: 4 };

export interface EntradaStatusAgora {
  status_dia: StatusDia;
  paradas_planejadas?: number;
  paradas_pendentes?: number;
  ultimo_checkout_em?: string | null;
  parado_min: number;
  /** Instante UTC de agora (relógio do aparelho ou da API). */
  agora: string;
}

/** RN-CORE-26: status "agora" de uma pessoa. `minutos_sem_atividade` só quando há checkout e a rota segue. */
export function statusAgora(e: EntradaStatusAgora): { status: StatusAgora; minutos_sem_atividade: number | null } {
  if (e.status_dia === 'em_visita') return { status: 'em_visita', minutos_sem_atividade: null };
  if (e.status_dia === 'sem_checkin') return { status: 'sem_checkin', minutos_sem_atividade: null };
  if (e.paradas_pendentes === undefined || e.paradas_planejadas === undefined) return { status: 'em_rota', minutos_sem_atividade: null };
  if (e.paradas_pendentes === 0) return { status: 'rota_concluida', minutos_sem_atividade: null };
  if (!e.ultimo_checkout_em) return { status: 'em_rota', minutos_sem_atividade: null };
  const min = Math.max(0, Math.floor((instanteMs(e.agora) - instanteMs(e.ultimo_checkout_em)) / 60_000));
  return { status: min >= e.parado_min ? 'parado' : 'em_rota', minutos_sem_atividade: min };
}
