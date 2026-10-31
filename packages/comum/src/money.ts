/**
 * Dinheiro sempre em centavos inteiros (number inteiro). Nunca float para valor.
 * Conversões de/para decimal só nas bordas (planilha, banco, API externa).
 */
export type Cents = number;

/** Converte um valor decimal (ex.: 89.9) para centavos inteiros, arredondando meio para cima. */
export function toCents(value: number | string | null | undefined): Cents {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (!Number.isFinite(n)) return 0;
  // toFixed evita 1.005 * 100 = 100.49999
  return Math.round(Number((n * 100).toFixed(4)));
}

/** Converte centavos para decimal com 2 casas (para gravar em planilha/banco). */
export function fromCents(cents: Cents): number {
  return Math.round(cents) / 100;
}

/** Aplica percentual sobre centavos com arredondamento meio para cima. */
export function applyPct(cents: Cents, pct: number): Cents {
  return Math.round(Number(((cents * pct) / 100).toFixed(4)));
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl0 = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** R$ 1.234,56 */
export function formatBRL(cents: Cents): string {
  return brl.format(cents / 100).replace(/\u00a0/g, ' ');
}

/** R$ 1.235 (sem centavos) */
export function formatBRL0(cents: Cents): string {
  return brl0.format(Math.round(cents / 100)).replace(/\u00a0/g, ' ');
}

/** R$ 412,3 mil · R$ 9,84 mi */
export function formatBRLShort(cents: Cents): string {
  const v = cents / 100;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) {
    return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`;
  }
  if (abs >= 1_000) {
    return `R$ ${(v / 1_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`;
  }
  return formatBRL0(cents);
}

/** 4,5% */
export function formatPct(pct: number, digits = 1): string {
  return `${pct.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
