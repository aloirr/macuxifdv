/**
 * Primitivas de segurança do super-admin de plataforma (T-0087; ADR 0029), só `node:crypto`.
 * - Segredo do TOTP: 20 bytes, cifrado AES-256-GCM com `MACUXI_CHAVE_TOTP` (32 bytes em base64); formato
 *   `v1.<iv>.<tag>.<cifra>` (base64url); o AAD é o id do super-admin (o segredo de um não decifra na linha de outro).
 * - Token de plataforma: JWT HS256 com segredo próprio (`MACUXI_JWT_SEGREDO_PLATAFORMA`), `aud=macuxi-plataforma`,
 *   `sub`, `sid`, `amr=["pwd","otp"]`. O token de tenant não tem `aud` nem `sid` e é assinado por outro segredo.
 * - Desafio da 2ª etapa e códigos de recuperação: aleatórios; o banco guarda só o SHA-256.
 * Nada daqui registra segredo, código ou token em log.
 */
import * as crypto from 'node:crypto';
import { AUDIENCIA_TOKEN_PLATAFORMA } from '@macuxi/platform-sdk';
import {
  codigoTotp as codigoTotpPuro,
  conviteConfere as conviteConferePuro,
  formatarCodigoRecuperacao,
  normalizarRecuperacao,
  verificarTotp as verificarTotpPuro,
  type HmacSha1,
  type ResultadoTotp,
} from '../domain/super-admin';

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

function chaveTotp(base64: string | undefined): Buffer {
  const k = base64 ? Buffer.from(base64, 'base64') : Buffer.alloc(0);
  if (k.length !== 32) throw new ConfiguracaoPlataformaInvalida('MACUXI_CHAVE_TOTP');
  return k;
}

export function cifrarSegredoTotp(segredo: Uint8Array, chaveBase64: string | undefined, superAdminId: string, iv: Buffer = crypto.randomBytes(12)): string {
  const c = crypto.createCipheriv('aes-256-gcm', chaveTotp(chaveBase64), iv);
  c.setAAD(Buffer.from(superAdminId, 'utf8'));
  const cifra = Buffer.concat([c.update(segredo), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${cifra.toString('base64url')}`;
}

/** `null` para qualquer problema (formato, chave, AAD ou texto adulterado). */
export function decifrarSegredoTotp(texto: string, chaveBase64: string | undefined, superAdminId: string): Buffer | null {
  const [v, iv, tag, cifra, resto] = texto.split('.');
  if (v !== 'v1' || !iv || !tag || !cifra || resto !== undefined) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', chaveTotp(chaveBase64), Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(superAdminId, 'utf8'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(cifra, 'base64url')), d.final()]);
  } catch (e) {
    if (e instanceof ConfiguracaoPlataformaInvalida) throw e;
    return null;
  }
}

export const novoSegredoTotp = (): Buffer => crypto.randomBytes(20);

/** Desafio opaco de 256 bits (43 caracteres) e o seu hash. */
export function novoDesafio(): { desafio: string; hash: string } {
  const desafio = crypto.randomBytes(32).toString('base64url');
  return { desafio, hash: hashDoDesafio(desafio) };
}
export const hashDoDesafio = (d: string): string => crypto.createHash('sha256').update(d).digest('hex');

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** 10 códigos `XXXXX-XXXXX` (50 bits cada, sorteio sem viés: 32 símbolos dividem 256). */
export function gerarCodigosRecuperacao(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const bytes = crypto.randomBytes(10);
    return formatarCodigoRecuperacao([...bytes].map((b) => ALFABETO[b % 32]).join(''));
  });
}

// ---------- primitivas injetadas no domain ----------
export const hmacSha1: HmacSha1 = (chave, dados) => crypto.createHmac('sha1', chave).update(dados).digest();
export const sha256Bytes = (texto: string): Uint8Array => crypto.createHash('sha256').update(texto).digest();

export const codigoTotp = (segredo: Uint8Array, passo: number): string => codigoTotpPuro(segredo, passo, hmacSha1);
export const verificarTotp = (segredo: Uint8Array, codigo: string, agora: Date, ultimoPasso: number): ResultadoTotp =>
  verificarTotpPuro(segredo, codigo, agora, ultimoPasso, hmacSha1);
export const conviteConfere = (configurado: string | undefined, informado: string): boolean => conviteConferePuro(configurado, informado, sha256Bytes);
/** SHA-256 do código normalizado (sem hífen, maiúsculas). O código tem 50 bits aleatórios e é de uso único. */
export const hashCodigoRecuperacao = (c: string): string => crypto.createHash('sha256').update(normalizarRecuperacao(c)).digest('hex');

// ---------- token de plataforma ----------
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const assinar = (dados: string, segredo: string) => crypto.createHmac('sha256', segredo).update(dados).digest();

export interface ClaimsPlataforma {
  sub: string;
  sid: string;
  aud: string;
  amr: string[];
  iat: number;
  exp: number;
}

export function assinarTokenPlataforma(c: { sub: string; sid: string }, agora: Date, expiraEm: Date, segredo: string): string {
  const cab = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = b64url(
    JSON.stringify({ sub: c.sub, sid: c.sid, aud: AUDIENCIA_TOKEN_PLATAFORMA, amr: ['pwd', 'otp'], iat: Math.floor(agora.getTime() / 1000), exp: Math.floor(expiraEm.getTime() / 1000) }),
  );
  return `${cab}.${corpo}.${b64url(assinar(`${cab}.${corpo}`, segredo))}`;
}

/** `null` para assinatura, algoritmo, `aud`, `amr`, campos ou prazo inválidos. Nunca lança. */
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
    if (typeof c.sub !== 'string' || !UUID_RE.test(c.sub) || typeof c.sid !== 'string' || !UUID_RE.test(c.sid)) return null;
    if (!Array.isArray(c.amr) || !c.amr.includes('pwd') || !c.amr.includes('otp')) return null;
    if (typeof c.exp !== 'number' || typeof c.iat !== 'number' || c.exp * 1000 <= agora.getTime()) return null;
    return c as ClaimsPlataforma;
  } catch {
    return null;
  }
}
