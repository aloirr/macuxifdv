/**
 * RN-CORE-44: almoço do dia (T-0170 §3.2; T-0180, D5). Função pura sobre as visitas de UM dia trabalhado do usuário.
 *
 * 1. Intervalos: do check-out REAL da visita i ao check-in da visita i + 1 (ordem de check-in). Visita sem check-out real
 *    (aberta, ou fechada na virada do dia, RN-CORE-11) não abre intervalo.
 * 2. Todo usuário tem horário de almoço: o próprio ou o padrão da empresa. O almoço do dia é o intervalo que mais se sobrepõe a
 *    esse horário (empate: o mais longo); sem sobreposição (inclusive meio expediente que acaba antes), sem almoço identificado.
 */
import { ALMOCO_PADRAO_EMPRESA, type HorarioAlmoco } from '../../contracts/jornada';
import { emMs, msDoDia } from './tempo';

/** O mínimo da visita (`core.visita` ou a fila local) que a Produtividade lê. Instantes em UTC. */
export interface VisitaProdutividade {
  cliente_id: string;
  /** Data civil do check-in no fuso do tenant, gravada pelo servidor (RN-CORE-11). */
  data_local: string;
  checkin_em: string;
  checkout_em?: string | null;
  resultado?: string | null;
  /** 'usuario' = check-out real; 'auto' = fechamento da virada do dia (`nao_finalizado`). A fila local grava 'usuario'. */
  fechada_por?: 'usuario' | 'auto' | null;
  sem_gps: boolean;
  /** Distância do check-in ao cliente; nula quando o cliente não tem coordenada. */
  distancia_m?: number | null;
  deleted_at?: string | null;
}

export interface Intervalo {
  inicio_ms: number;
  fim_ms: number;
}

export interface Almoco {
  inicio_em: string;
  fim_em: string;
  minutos: number;
}

/** RN-CORE-43: check-out real = feito pelo usuário (o fechamento automático da virada do dia não conta). */
export function temCheckoutReal(v: VisitaProdutividade): v is VisitaProdutividade & { checkout_em: string } {
  return Boolean(v.checkout_em) && v.fechada_por === 'usuario' && v.resultado !== 'nao_finalizado';
}

/** Visitas vivas do dia em ordem de check-in. */
export function ordenarPorCheckin(visitas: readonly VisitaProdutividade[]): VisitaProdutividade[] {
  return visitas.filter((v) => !v.deleted_at).sort((a, b) => emMs(a.checkin_em) - emMs(b.checkin_em));
}

/** Intervalos do dia (§3.2 passo 1): do check-out real de uma visita ao check-in da seguinte; sobreposição é descartada. */
export function intervalosDoDia(visitas: readonly VisitaProdutividade[]): Intervalo[] {
  const l = ordenarPorCheckin(visitas);
  const out: Intervalo[] = [];
  for (let i = 0; i + 1 < l.length; i++) {
    const v = l[i]!;
    if (!temCheckoutReal(v)) continue;
    const inicio = emMs(v.checkout_em);
    const fim = emMs(l[i + 1]!.checkin_em);
    if (fim >= inicio) out.push({ inicio_ms: inicio, fim_ms: fim });
  }
  return out;
}

/** RN-CORE-44: o intervalo do almoço do dia, ou nulo quando não há almoço identificado. */
export function intervaloDoAlmoco(visitas: readonly VisitaProdutividade[], fuso: string, horario: HorarioAlmoco = ALMOCO_PADRAO_EMPRESA): Intervalo | null {
  const [hi, hf] = [horario.inicio_min * 60_000, horario.fim_min * 60_000];
  let melhor: Intervalo | null = null;
  let melhorSobreposicao = 0;
  for (const i of intervalosDoDia(visitas)) {
    const [a, b] = [msDoDia(i.inicio_ms, fuso), msDoDia(i.fim_ms, fuso)];
    if (b < a) continue; // atravessa a virada do dia: não é almoço
    const sobreposicao = Math.min(b, hf) - Math.max(a, hi);
    if (sobreposicao <= 0) continue;
    if (sobreposicao > melhorSobreposicao || (sobreposicao === melhorSobreposicao && melhor !== null && i.fim_ms - i.inicio_ms > melhor.fim_ms - melhor.inicio_ms)) {
      melhor = i;
      melhorSobreposicao = sobreposicao;
    }
  }
  return melhor;
}

/** RN-CORE-44: almoço do dia (instantes UTC e duração em minutos, meio para cima), ou nulo sem almoço identificado. */
export function almocoDoDia(
  visitas: readonly VisitaProdutividade[],
  fuso: string,
  horario: HorarioAlmoco = ALMOCO_PADRAO_EMPRESA,
): Almoco | null {
  const i = intervaloDoAlmoco(visitas, fuso, horario);
  if (!i) return null;
  return {
    inicio_em: new Date(i.inicio_ms).toISOString(),
    fim_em: new Date(i.fim_ms).toISOString(),
    minutos: Math.round((i.fim_ms - i.inicio_ms) / 60_000),
  };
}
