/** Percentual digitado (vírgula ou ponto) de 0 a 100: vazio = `null`; inválido = `undefined`. Uma cópia só (RD-1877). */
export const paraPct = (t: string): number | null | undefined => {
  const s = t.trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
};
