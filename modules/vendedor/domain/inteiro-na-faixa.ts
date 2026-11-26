/** Lê inteiro de uma faixa (número ou texto numérico); ausente, fora da faixa ou não inteiro devolve `padrao`. Única conferência de faixa dos parâmetros do Vendedor. */
export function lerInteiroNaFaixa(bruto: unknown, min: number, max: number, padrao: number): number {
  const n = typeof bruto === 'number' ? bruto : typeof bruto === 'string' && bruto.trim() !== '' ? Number(bruto) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : padrao;
}
