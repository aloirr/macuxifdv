/**
 * Primitivas de segurança do acesso ao portal (T-0093; ADR 0031, que substitui o 2º fator da ADR 0029), só `node:crypto`.
 * - Token do portal: JWT HS256 com segredo próprio (`MACUXI_JWT_SEGREDO_PLATAFORMA`), `aud=macuxi-plataforma`, `amr=["pwd"]`,
 *   `typ` 'sa' (super-admin) ou 'cli' (admin do cliente), `sid` e, no admin do cliente com empresa escolhida, `tid`.
 *   O token de tenant não tem `aud`, `sid` nem `typ` e é assinado por outro segredo. Token sem `typ` (o da ADR 0029) é recusado.
 * - Chave de tentativas: HMAC-SHA256 do e-mail normalizado com o segredo da plataforma (o e-mail nunca vai à tabela de
 *   tentativas nem a log).
 * Nada daqui registra senha, e-mail ou token em log.
 */
import * as crypto from 'node:crypto';
import { AUDIENCIA_TOKEN_PLATAFORMA } from '@macuxi/platform-sdk';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGREDO_MIN = 32;

export class ConfiguracaoPlataformaInvalida extends Error {
  constructor(readonly variavel: string) {
    super(`${variavel} ausente ou inválida.`);
    this.name = 'ConfiguracaoPlataformaInvalida';
  }
}

export function exigirSegredoPlataforma(v: string | undefined): string {
  if (!v || v.length < SEGREDO_MIN) throw new ConfiguracaoPlataformaInvalida('MACUXI_JWT_SEGREDO_PLATAFORMA');
  return v;
}

/** Chave (64 hex) das tentativas de login do e-mail. O e-mail deve vir já normalizado (minúsculas, sem espaços). */
export const chaveDeTentativa = (segredo: string, emailNormalizado: string): string =>
  crypto.createHmac('sha256', segredo).update(`portal.login:${emailNormalizado}`).digest('hex');

// ---------- token do portal ----------
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const assinar = (dados: string, segredo: string) => crypto.createHmac('sha256', segredo).update(dados).digest();

export type TipoTokenPortal = 'sa' | 'cli';

export interface ClaimsPlataforma {
  sub: string;
  sid: string;
  typ: TipoTokenPortal;
  /** Empresa escolhida (só admin do cliente com empresa). */
  tid?: string;
  aud: string;
  amr: string[];
  iat: number;
  exp: number;
}

export function assinarTokenPlataforma(c: { sub: string; sid: string; typ: TipoTokenPortal; tid?: string | null }, agora: Date, expiraEm: Date, segredo: string): string {
  const cab = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = b64url(
    JSON.stringify({
      sub: c.sub,
      sid: c.sid,
      typ: c.typ,
      ...(c.tid ? { tid: c.tid } : {}),
      aud: AUDIENCIA_TOKEN_PLATAFORMA,
      amr: ['pwd'],
      iat: Math.floor(agora.getTime() / 1000),
      exp: Math.floor(expiraEm.getTime() / 1000),
    }),
  );
  return `${cab}.${corpo}.${b64url(assinar(`${cab}.${corpo}`, segredo))}`;
}

/** `null` para assinatura, algoritmo, `aud`, `amr`, `typ`, campos ou prazo inválidos. Nunca lança. */
export function verificarTokenPlataforma(token: string, agora: Date, segredo: string): ClaimsPlataforma | null {
  try {
    const partes = token.split('.');
    if (partes.length !== 3) return null;
    const [cab, corpo, assinatura] = partes as [string, string, string];
    const cabecalho = JSON.parse(Buffer.from(cab, 'base64url').toString('utf8')) as { alg?: unknown };
    if (cabecalho.alg !== 'HS256') return null;
    const esperada = assinar(`${cab}.${corpo}`, segredo);
    const recebida = Buffer.from(assinatura, 'base64url');
    if (recebida.length !== esperada.length || !crypto.timingSafeEqual(recebida, esperada)) return null;
    const c = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as Partial<ClaimsPlataforma>;
    if (c.aud !== AUDIENCIA_TOKEN_PLATAFORMA) return null;
    if (c.typ !== 'sa' && c.typ !== 'cli') return null;
    if (typeof c.sub !== 'string' || !UUID_RE.test(c.sub) || typeof c.sid !== 'string' || !UUID_RE.test(c.sid)) return null;
    if (c.tid !== undefined && (c.typ !== 'cli' || typeof c.tid !== 'string' || !UUID_RE.test(c.tid))) return null;
    if (!Array.isArray(c.amr) || !c.amr.includes('pwd')) return null;
    if (typeof c.exp !== 'number' || typeof c.iat !== 'number' || c.exp * 1000 <= agora.getTime()) return null;
    return c as ClaimsPlataforma;
  } catch {
    return null;
  }
}
