/** Geração de UUIDs estáveis para seeds e fixtures (asserts determinísticos, seed idempotente). */
import { createHash } from 'node:crypto';

/**
 * UUID legível: `<prefixo 8 hex>-<grupo 4 hex>-4000-8000-<seq 12 dígitos>`.
 * Ex.: idFixo('aaaaaaaa', 1, 7) = 'aaaaaaaa-0001-4000-8000-000000000007'.
 */
export function idFixo(prefixo: string, grupo: number, seq: number): string {
  if (!/^[0-9a-f]{8}$/.test(prefixo)) throw new Error(`prefixo inválido: ${prefixo}`);
  return `${prefixo}-${grupo.toString(16).padStart(4, '0')}-4000-8000-${String(seq).padStart(12, '0')}`;
}

/** UUID (formato v5) derivado de uma chave textual: mesma chave => mesmo id em toda execução. */
export function idDeterministico(chave: string): string {
  const h = createHash('sha1').update(`macuxi:${chave}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
