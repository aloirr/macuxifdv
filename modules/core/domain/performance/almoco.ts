/**
 * RN-CORE-44: almoço do dia (T-0170 §3.2). Função pura sobre as visitas de UM dia trabalhado do usuário.
 *
 * 1. Intervalos: do check-out REAL da visita i ao check-in da visita i + 1 (ordem de check-in). Visita sem check-out real
 *    (aberta, ou fechada na virada do dia, RN-CORE-11) não abre intervalo.
 * 2. Caso normal: o almoço é o intervalo que contém o corte (padrão 12:00): o "último check-out da manhã → primeiro check-in
 *    da tarde".
 * 3. Visita que atravessa o corte: o maior intervalo que começa dentro da janela (padrão 11:00 a 15:00, inclusive).
 * 4. Nenhum intervalo na janela, ou dia que termina antes do corte (meio expediente): sem almoço identificado.
 *
 * T-0180 (D5): com o horário de almoço CADASTRADO (`horario`: o do usuário ou o padrão da empresa) a detecção pela janela e pelo
 * corte sai: o almoço do dia é o intervalo que mais se sobrepõe ao horário cadastrado (empate: o mais longo); sem sobreposição
 * (inclusive meio expediente que acaba antes do horário), sem almoço identificado.
 */
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

/** Parâmetros `produtividade.almoco_corte` e `produtividade.almoco_janela`, em minutos do dia. */
export interface ParametrosAlmoco {
  corte_min: number;
  janela_inicio_min: number;
  janela_fim_min: number;
  /** D5: horário de almoço cadastrado (minutos do dia); quando existe, é ele que manda (RN-CORE-44). */
  horario?: { inicio_min: number; fim_min: number };
}
export const ALMOCO_PADRAO: ParametrosAlmoco = {
  corte_min: 12 * 60,
  janela_inicio_min: 11 * 60,
  janela_fim_min: 15 * 60,
};

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
export function intervaloDoAlmoco(
  visitas: readonly VisitaProdutividade[],
  fuso: string,
  p: ParametrosAlmoco = ALMOCO_PADRAO,
): Intervalo | null {
  const intervalos = intervalosDoDia(visitas);
  if (p.horario) {
    const [hi, hf] = [p.horario.inicio_min * 60_000, p.horario.fim_min * 60_000];
    let melhor: Intervalo | null = null;
    let melhorSobreposicao = 0;
    for (const i of intervalos) {
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
  const corte = p.corte_min * 60_000;
  const normal = intervalos.find(
    (i) => msDoDia(i.inicio_ms, fuso) < corte && msDoDia(i.fim_ms, fuso) > corte,
  );
  if (normal) return normal;
  // Caso 5: o dia não passou do corte (meio expediente): sem almoço.
  const vivas = ordenarPorCheckin(visitas);
  const passouDoCorte = vivas.some(
    (v) =>
      msDoDia(v.checkin_em, fuso) > corte || (temCheckoutReal(v) && msDoDia(v.checkout_em, fuso) > corte),
  );
  if (!passouDoCorte) return null;
  const [ini, fim] = [p.janela_inicio_min * 60_000, p.janela_fim_min * 60_000];
  let maior: Intervalo | null = null;
  for (const i of intervalos) {
    const m = msDoDia(i.inicio_ms, fuso);
    if (m >= ini && m <= fim && (maior === null || i.fim_ms - i.inicio_ms > maior.fim_ms - maior.inicio_ms))
      maior = i;
  }
  return maior;
}

/** RN-CORE-44: almoço do dia (instantes UTC e duração em minutos, meio para cima), ou nulo sem almoço identificado. */
export function almocoDoDia(
  visitas: readonly VisitaProdutividade[],
  fuso: string,
  p: ParametrosAlmoco = ALMOCO_PADRAO,
): Almoco | null {
  const i = intervaloDoAlmoco(visitas, fuso, p);
  if (!i) return null;
  return {
    inicio_em: new Date(i.inicio_ms).toISOString(),
    fim_em: new Date(i.fim_ms).toISOString(),
    minutos: Math.round((i.fim_ms - i.inicio_ms) / 60_000),
  };
}
