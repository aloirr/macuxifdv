/** Permanência na loja (RN-PRO-07) e coleta só com check-in aberto (RN-PRO-02). */
import { PARAMETROS_PADRAO } from './parametros';

/** Tolerância (min) entre a permanência guardada e a recalculada (arredondamento do aparelho). */
export const PERMANENCIA_TOLERANCIA_MIN = 0.5;

/** Permanência em minutos entre check-in e checkout (instantes ISO UTC). */
export function permanenciaMinutos(checkin_em: string, checkout_em: string): number {
  const ini = Date.parse(checkin_em);
  const fim = Date.parse(checkout_em);
  if (Number.isNaN(ini) || Number.isNaN(fim)) throw new RangeError('Datas de check-in e checkout inválidas.');
  if (fim < ini) throw new RangeError('O checkout não pode ser anterior ao check-in.');
  return (fim - ini) / 60_000;
}

/** RN-PRO-07: a visita só conta nos indicadores com permanência mínima ([10 min]). Visita aberta (null) não conta. */
export function visitaConta(permanencia_min: number | null, minimo_min: number = PARAMETROS_PADRAO.permanencia_min_min): boolean {
  return permanencia_min !== null && permanencia_min >= minimo_min;
}

/** RN-PRO-07: visita encerrada abaixo do mínimo é sinalizada ao gestor. */
export function visitaCurta(permanencia_min: number | null, minimo_min: number = PARAMETROS_PADRAO.permanencia_min_min): boolean {
  return permanencia_min !== null && permanencia_min < minimo_min;
}

/** RN-PRO-02: coletas (fotos, gôndola, share, preço, ruptura, validade) só com check-in aberto na loja. */
export function coletaPermitida(visita: { checkin_em: string | null; checkout_em: string | null } | null | undefined): boolean {
  return !!visita && !!visita.checkin_em && !visita.checkout_em;
}
