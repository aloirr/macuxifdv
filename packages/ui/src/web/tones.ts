/**
 * Cores dos faróis (positivação, projeção, integração) — copiado de apps/web/lib/rules.ts da Fase M.
 * Apresentação compartilhada pelas páginas de módulos no BKO.
 */
export type Tone = 'success' | 'accent' | 'danger' | 'ink' | 'warning';

/** Positivação: ≥ 70 verde, ≥ 55 âmbar (barra laranja), abaixo vermelho. */
export function coverageTone(pct: number): Tone {
  if (pct >= 70) return 'success';
  if (pct >= 55) return 'accent';
  return 'danger';
}

/** Projeção de fechamento: ≥ 100 verde, ≥ 90 neutro, abaixo vermelho. */
export function projectionTone(pct: number): Tone {
  if (pct >= 100) return 'success';
  if (pct >= 90) return 'ink';
  return 'danger';
}

/** % integrado sem intervenção vs meta: na meta verde, até 10 p.p. abaixo âmbar, senão vermelho. */
export function integratedTone(pct: number, target: number): Tone {
  if (pct >= target) return 'success';
  if (pct >= target - 10) return 'warning';
  return 'danger';
}

/**
 * Marca v1 (T-0172): o laranja é só gráfico e o Azul noite é ação; o número do farol do meio fica no âmbar de aviso
 * (`text-warning`, 6,60:1 no Pérola) e a barra no laranja (`bg-grafico`).
 */
export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success',
  accent: 'text-warning',
  danger: 'text-danger',
  ink: 'text-ink',
  warning: 'text-warning',
};

export const TONE_BG: Record<Tone, string> = {
  success: 'bg-success',
  accent: 'bg-grafico',
  danger: 'bg-danger',
  ink: 'bg-ink',
  warning: 'bg-warning',
};
