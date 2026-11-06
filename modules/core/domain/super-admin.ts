/**
 * Super-admin de plataforma como regras puras (T-0087; ADR 0029; RN-CORE-31 e desenho docs/desenho/T-0087.md §2).
 * - TOTP RFC 6238: SHA-1, 6 dígitos, 30 s, janela ±1, sem reuso do mesmo passo (nem de passo anterior ao último usado).
 * - Código de recuperação `XXXXX-XXXXX` (alfabeto base32): só o SHA-256 vai ao banco.
 * - Convite do primeiro acesso: comparação em tempo constante, mínimo de 32 caracteres.
 * - 5 falhas = 15 min de bloqueio; token de 15 min limitado ao teto de 8 h da sessão.
 * O relógio e as primitivas criptográficas (HMAC-SHA1, SHA-256) entram por parâmetro (a api injeta `node:crypto`);
 * nada aqui lê banco, ambiente ou grava log.
 */

/** Primitivas injetadas pela api (domain sem `node:crypto`). */
export type HmacSha1 = (chave: Uint8Array, dados: Uint8Array) => Uint8Array;
export type Sha256 = (texto: string) => Uint8Array;

export const TOTP_PERIODO_S = 30;
export const TOTP_DIGITOS = 6;
export const TOTP_JANELA = 1;
export const MAX_FALHAS_SUPER_ADMIN = 5;
export const BLOQUEIO_SUPER_ADMIN_MIN = 15;
export const TOKEN_PLATAFORMA_MIN = 15;
export const CONVITE_MIN = 32;
const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Codificar(dados: Uint8Array): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const byte of dados) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
    valor &= (1 << bits) - 1;
  }
  if (bits > 0) saida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];
  return saida;
}

/** Passo de 30 s desde a época Unix. */
export const passoTotp = (agora: Date): number => Math.floor(agora.getTime() / 1000 / TOTP_PERIODO_S);

/** Comparação em tempo constante de dois vetores (tamanhos diferentes = falso). */
export function iguaisEmTempoConstante(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

const bytesDe = (t: string): Uint8Array => Uint8Array.from(t, (c) => c.charCodeAt(0));

/** HOTP (RFC 4226) sobre o passo; 6 dígitos com zeros à esquerda. */
export function codigoTotp(segredo: Uint8Array, passo: number, hmacSha1: HmacSha1): string {
  const contador = new Uint8Array(8);
  new DataView(contador.buffer).setBigUint64(0, BigInt(passo));
  const h = hmacSha1(segredo, contador);
  const o = h[h.length - 1]! & 0x0f;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 10 ** TOTP_DIGITOS).padStart(TOTP_DIGITOS, '0');
}

export type ResultadoTotp = { ok: true; passo: number } | { ok: false };

/**
 * Confere o código nos passos atual ±1. Só vale passo MAIOR que o último usado (`ultimoPasso`; 0 = nunca): o mesmo código
 * não entra duas vezes e um código anterior ao já usado não é aceito. Quem chama grava `passo` de forma atômica.
 */
export function verificarTotp(segredo: Uint8Array, codigo: string, agora: Date, ultimoPasso: number, hmacSha1: HmacSha1): ResultadoTotp {
  if (!/^\d{6}$/.test(codigo)) return { ok: false };
  const alvo = bytesDe(codigo);
  const atual = passoTotp(agora);
  let achado: number | null = null;
  for (let d = -TOTP_JANELA; d <= TOTP_JANELA; d++) {
    const passo = atual + d;
    const igual = iguaisEmTempoConstante(bytesDe(codigoTotp(segredo, passo, hmacSha1)), alvo);
    if (igual && passo > ultimoPasso && achado === null) achado = passo;
  }
  return achado === null ? { ok: false } : { ok: true, passo: achado };
}

/** `otpauth://` para o aplicativo autenticador (o portal desenha o QR). */
export function uriOtpauth(segredoBase32: string, rotulo: string): string {
  const emissor = encodeURIComponent('Macuxi FDV');
  return `otpauth://totp/${emissor}:${encodeURIComponent(rotulo)}?secret=${segredoBase32}&issuer=${emissor}&algorithm=SHA1&digits=${TOTP_DIGITOS}&period=${TOTP_PERIODO_S}`;
}

export const normalizarRecuperacao = (c: string): string => c.replace(/[\s-]/g, '').toUpperCase();
export const formatarCodigoRecuperacao = (c: string): string => {
  const n = normalizarRecuperacao(c);
  return `${n.slice(0, 5)}-${n.slice(5, 10)}`;
};
/** Convite do primeiro acesso: o configurado precisa ter ≥ 32 caracteres; comparação em tempo constante (por hash, sem vazar o tamanho). */
export function conviteConfere(configurado: string | undefined, informado: string, sha256: Sha256): boolean {
  if (!configurado || configurado.length < CONVITE_MIN) return false;
  const a = sha256(configurado);
  const b = sha256(informado);
  return iguaisEmTempoConstante(a, b);
}

export type EstadoSuperAdmin = 'ok' | 'inativo' | 'bloqueado';
export function estadoDoSuperAdmin(e: { ativo: boolean; bloqueadoAte: Date | null; agora: Date }): EstadoSuperAdmin {
  if (!e.ativo) return 'inativo';
  if (e.bloqueadoAte && e.bloqueadoAte.getTime() > e.agora.getTime()) return 'bloqueado';
  return 'ok';
}

/**
 * Falha de senha ou de código (espelha sa_registrar_falha da 0035): com bloqueio vivo nada muda (não conta nem estende);
 * passado o bloqueio a contagem recomeça; a 5ª falha seguida bloqueia por 15 min e zera o contador.
 */
export function decidirFalhaSuperAdmin(atual: { falhas: number; bloqueadoAte: Date | null }, agora: Date): { falhas: number; bloqueadoAte: Date | null } {
  if (atual.bloqueadoAte !== null && atual.bloqueadoAte.getTime() > agora.getTime()) return atual;
  const expirou = atual.bloqueadoAte !== null;
  const falhas = (expirou ? 0 : atual.falhas) + 1;
  if (falhas >= MAX_FALHAS_SUPER_ADMIN) return { falhas: 0, bloqueadoAte: new Date(agora.getTime() + BLOQUEIO_SUPER_ADMIN_MIN * 60_000) };
  return { falhas, bloqueadoAte: null };
}

/** Fim do token: 15 min, nunca depois do teto absoluto da sessão (8 h). */
export function expiracaoDoTokenPlataforma(agora: Date, tetoDaSessao: Date): Date {
  return new Date(Math.min(agora.getTime() + TOKEN_PLATAFORMA_MIN * 60_000, tetoDaSessao.getTime()));
}
