/**
 * Cores dos faróis (positivação, projeção, integração) — copiado de apps/web/lib/rules.ts da Fase M.
 * Apresentação compartilhada pelas páginas de módulos no BKO.
 */
export type Tone = 'success' | 'accent' | 'danger' | 'ink' | 'warning';

/** Positivação: ≥ 70 verde, ≥ 55 laranja, abaixo vermelho. */
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

/** % integrado sem intervenção vs meta: na meta verde, até 10 p.p. abaixo laranja, senão vermelho. */
export function integratedTone(pct: number, target: number): Tone {
  if (pct >= target) return 'success';
  if (pct >= target - 10) return 'warning';
  return 'danger';
}

export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success',
  /** T-0094: número laranja é texto → accent-ink (o accent dá 4,17:1 no fundo); a barra continua `bg-accent`. */
  accent: 'text-accent-ink',
  danger: 'text-danger',
  ink: 'text-ink',
  warning: 'text-accent-ink',
};

export const TONE_BG: Record<Tone, string> = {
  success: 'bg-success',
  accent: 'bg-accent',
  danger: 'bg-danger',
  ink: 'bg-ink',
  warning: 'bg-accent-ink',
};
