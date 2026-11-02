/** Conversão do que o usuário digita no app para o formato do contrato (RF-PES-01). Puro e testado. */

/** "12,5" ou "1.234,5" → número; vazio ou inválido → `null` (o campo fica sem resposta). */
export function lerNumero(texto: string): number | null {
  const limpo = texto.trim().replace(/\./g, '').replace(',', '.');
  if (limpo === '' || !/^-?\d+(\.\d+)?$/.test(limpo)) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/** "31/10/2026" → "2026-10-31", só se a data existir no calendário; senão `null`. */
export function lerData(texto: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** "2026-10-31" → "31/10/2026". */
export const dataBr = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
