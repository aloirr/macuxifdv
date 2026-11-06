/**
 * Token do convite de 1º acesso (T-0087, RN-CORE-31). Formato `<tenant_id>.<segredo>` (como o refresh): o tenant só localiza a
 * linha sob RLS; a validade é pelo SHA-256 do segredo. O banco guarda SÓ o hash; o token aparece uma vez na resposta ao admin.
 * Nada disto vai a log.
 */
import crypto from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const hashDoConvite = (segredo: string): string => crypto.createHash('sha256').update(segredo).digest('hex');

export function novoConvite(tenantId: string): { token: string; hash: string } {
  const segredo = crypto.randomBytes(32).toString('base64url');
  return { token: `${tenantId}.${segredo}`, hash: hashDoConvite(segredo) };
}

/** `null` se o formato não é `<uuid>.<segredo>`. */
export function lerConvite(token: string): { tenantId: string; hash: string } | null {
  const i = token.indexOf('.');
  if (i !== 36) return null;
  const tenantId = token.slice(0, i);
  const segredo = token.slice(i + 1);
  if (!UUID_RE.test(tenantId) || !/^[A-Za-z0-9_-]{40,60}$/.test(segredo)) return null;
  return { tenantId: tenantId.toLowerCase(), hash: hashDoConvite(segredo) };
}
