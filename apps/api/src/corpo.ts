/**
 * Tetos do corpo JSON (proteção do Zod, GHSA-mrhx-c7xc-m3w5): o Zod acumula um problema por elemento inválido de array, sem
 * teto. As rotas de usuário usam `MAX_ELEMENTOS_CORPO`; as de Conector (ADR 0013) o `maxElementosCorpo` da rota.
 */

/** Teto de elementos de array num corpo JSON (push: 500 itens × payload; lote do Hub: até 5.000 linhas). */
export const MAX_ELEMENTOS_CORPO = 50_000;
/** Teto de problemas devolvidos num 400 de validação. */
export const MAX_PROBLEMAS_RESPOSTA = 50;

/** `true` se o valor (JSON já lido) tem mais de `max` elementos de array somados. Bytes (Buffer) não contam. */
export function excedeElementos(valor: unknown, max = MAX_ELEMENTOS_CORPO): boolean {
  let total = 0;
  const pilha: unknown[] = [valor];
  while (pilha.length > 0) {
    const v = pilha.pop();
    if (v === null || typeof v !== 'object' || ArrayBuffer.isView(v)) continue;
    if (Array.isArray(v)) {
      total += v.length;
      if (total > max) return true;
      for (const x of v) if (x !== null && typeof x === 'object') pilha.push(x);
    } else {
      for (const x of Object.values(v)) if (x !== null && typeof x === 'object') pilha.push(x);
    }
  }
  return false;
}

