/**
 * Share de gôndola por categoria (RF-PRO-04) e atingimento contra a meta da loja/categoria (RN-PRO-03).
 * Share (%) = frentes nossas ÷ frentes totais × 100, ou cm nossos ÷ cm totais quando medido em cm.
 */
import { arredondar, ehInteiroNaoNegativo, media, percentual } from './numeros';

export interface EntradaShare {
  frentes_nossas: number;
  frentes_total: number;
  /** Centímetros lineares (opcional): informe os dois ou nenhum. */
  cm_nossos?: number | null;
  cm_total?: number | null;
}

export type StatusShare = 'ok' | 'sem_dados' | 'inconsistente';

export interface ResultadoShare {
  status: StatusShare;
  share_pct: number | null;
  /** Base usada no cálculo; `null` quando não há share. */
  base: 'frentes' | 'cm' | null;
  /** Explicação em português quando `status` é `inconsistente`. */
  motivo?: string;
}

const inconsistente = (motivo: string): ResultadoShare => ({ status: 'inconsistente', share_pct: null, base: null, motivo });
const ehMedida = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/**
 * RN-PRO-03: calcula o share. Com cm informado (nossos e total) a base é cm; senão, frentes.
 * Total zero → `sem_dados` (sem divisão por zero); nossas > total ou valor inválido → `inconsistente`.
 */
export function calcularShare(e: EntradaShare): ResultadoShare {
  if (!ehInteiroNaoNegativo(e.frentes_nossas) || !ehInteiroNaoNegativo(e.frentes_total)) {
    return inconsistente('Informe as frentes como números inteiros, sem valores negativos.');
  }
  if (e.frentes_nossas > e.frentes_total) {
    return inconsistente('As frentes nossas não podem passar do total de frentes da categoria. Confira a contagem.');
  }
  const temNossos = e.cm_nossos !== null && e.cm_nossos !== undefined;
  const temTotal = e.cm_total !== null && e.cm_total !== undefined;
  if (temNossos !== temTotal) return inconsistente('Informe os centímetros nossos e o total da categoria, ou deixe os dois em branco.');
  if (temNossos && temTotal) {
    if (!ehMedida(e.cm_nossos) || !ehMedida(e.cm_total)) return inconsistente('Informe os centímetros como números, sem valores negativos.');
    if (e.cm_nossos > e.cm_total) return inconsistente('Os centímetros nossos não podem passar do total da categoria. Confira a medição.');
    const pct = percentual(e.cm_nossos, e.cm_total);
    return pct === null ? { status: 'sem_dados', share_pct: null, base: null } : { status: 'ok', share_pct: pct, base: 'cm' };
  }
  const pct = percentual(e.frentes_nossas, e.frentes_total);
  return pct === null ? { status: 'sem_dados', share_pct: null, base: null } : { status: 'ok', share_pct: pct, base: 'frentes' };
}

export type SituacaoShare = 'atingiu' | 'abaixo' | 'sem_meta' | 'sem_dados';

export interface AtingimentoShare {
  meta_pct: number | null;
  /** share ÷ meta × 100 */
  atingimento_pct: number | null;
  /** share − meta, em pontos percentuais */
  desvio_pp: number | null;
  situacao: SituacaoShare;
}

/** RN-PRO-03: atingimento = share ÷ meta de share da loja/categoria. Meta ausente ou zero → `sem_meta`. */
export function atingimentoShare(share_pct: number | null, meta_pct: number | null | undefined): AtingimentoShare {
  const meta = typeof meta_pct === 'number' && Number.isFinite(meta_pct) && meta_pct > 0 ? meta_pct : null;
  if (share_pct === null || !Number.isFinite(share_pct)) return { meta_pct: meta, atingimento_pct: null, desvio_pp: null, situacao: 'sem_dados' };
  if (meta === null) return { meta_pct: null, atingimento_pct: null, desvio_pp: null, situacao: 'sem_meta' };
  return {
    meta_pct: meta,
    atingimento_pct: arredondar((share_pct / meta) * 100),
    desvio_pp: arredondar(share_pct - meta),
    situacao: share_pct >= meta ? 'atingiu' : 'abaixo',
  };
}

export interface ShareDaCategoria {
  share_pct: number | null;
  meta_pct: number | null;
}

export interface MediaShare {
  share_medio_pct: number | null;
  meta_media_pct: number | null;
  atingimento_pct: number | null;
  categorias_medidas: number;
}

/**
 * RF-PRO-12: share médio (média simples das categorias medidas) × meta média. A meta média e o atingimento
 * consideram só as categorias que têm share e meta, para comparar o mesmo conjunto.
 */
export function mediaShare(itens: readonly ShareDaCategoria[]): MediaShare {
  const medidas = itens.filter((i): i is { share_pct: number; meta_pct: number | null } => i.share_pct !== null && Number.isFinite(i.share_pct));
  const comMeta = medidas.filter((i): i is { share_pct: number; meta_pct: number } => i.meta_pct !== null && i.meta_pct > 0);
  const shareMedio = media(medidas.map((i) => i.share_pct));
  const metaMedia = media(comMeta.map((i) => i.meta_pct));
  const shareDasComMeta = media(comMeta.map((i) => i.share_pct), 6);
  const metaPrecisa = media(comMeta.map((i) => i.meta_pct), 6);
  return {
    share_medio_pct: shareMedio,
    meta_media_pct: metaMedia,
    atingimento_pct: shareDasComMeta !== null && metaPrecisa !== null && metaPrecisa > 0 ? arredondar((shareDasComMeta / metaPrecisa) * 100) : null,
    categorias_medidas: medidas.length,
  };
}
