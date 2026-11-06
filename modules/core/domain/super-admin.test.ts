import { describe, expect, it } from 'vitest';
import {
  base32Codificar,
  codigoTotp,
  conviteConfere,
  decidirFalhaSuperAdmin,
  estadoDoSuperAdmin,
  expiracaoDoTokenPlataforma,
  formatarCodigoRecuperacao,
  normalizarRecuperacao,
  type HmacSha1,
  type Sha256,
  passoTotp,
  uriOtpauth,
  verificarTotp,
} from './super-admin';

// Primitivas falsas e determinísticas: o domain não conhece `node:crypto`. Os vetores reais do RFC 6238 e o SHA-256 ficam em
// api/seguranca-plataforma.test.ts, que injeta as primitivas de verdade.
const fnv = (bytes: Uint8Array, semente: number): number => bytes.reduce((h, b) => Math.imul(h ^ b, 16777619) >>> 0, semente >>> 0);
const hmacFalso: HmacSha1 = (chave, dados) => {
  const h = fnv(Uint8Array.from([...chave, ...dados]), 2166136261);
  return Uint8Array.from({ length: 20 }, (_, i) => (fnv(Uint8Array.from([i, h & 255, (h >>> 8) & 255, (h >>> 16) & 255, h >>> 24]), 7) >>> 8) & 255);
};
const sha256Falso: Sha256 = (t) => {
  const b = Uint8Array.from(t, (c) => c.charCodeAt(0));
  return Uint8Array.from({ length: 32 }, (_, i) => fnv(Uint8Array.from([i, ...b]), 99) & 255);
};
const codigo = (seg: Uint8Array, passo: number) => codigoTotp(seg, passo, hmacFalso);
const verificar = (seg: Uint8Array, c: string, t: Date, ultimo: number) => verificarTotp(seg, c, t, ultimo, hmacFalso);

const SEGREDO = Uint8Array.from(Buffer.from('12345678901234567890', 'ascii'));

describe('RN-CORE-31/ADR 0029: TOTP (RFC 6238)', () => {
  it('RN-CORE-31: o código tem 6 dígitos e muda a cada passo de 30 s', () => {
    expect(codigo(SEGREDO, 1)).toMatch(/^\d{6}$/);
    expect(codigo(SEGREDO, 1)).not.toBe(codigo(SEGREDO, 2));
    expect(passoTotp(new Date(59_000))).toBe(1);
    expect(passoTotp(new Date(60_000))).toBe(2);
  });

  it('RN-CORE-31: aceita o passo atual e os vizinhos (janela ±1) e recusa além', () => {
    const t = new Date(1111111109 * 1000);
    const passo = passoTotp(t);
    for (const d of [-1, 0, 1]) expect(verificar(SEGREDO, codigo(SEGREDO, passo + d), t, 0).ok).toBe(true);
    expect(verificar(SEGREDO, codigo(SEGREDO, passo + 2), t, 0).ok).toBe(false);
    expect(verificar(SEGREDO, codigo(SEGREDO, passo - 2), t, 0).ok).toBe(false);
  });

  it('RN-CORE-31: o mesmo passo não vale duas vezes (e nem um anterior ao último usado)', () => {
    const t = new Date(1111111109 * 1000);
    const passo = passoTotp(t);
    const primeiro = verificar(SEGREDO, codigo(SEGREDO, passo), t, 0);
    expect(primeiro).toEqual({ ok: true, passo });
    expect(verificar(SEGREDO, codigo(SEGREDO, passo), t, passo).ok).toBe(false);
    expect(verificar(SEGREDO, codigo(SEGREDO, passo - 1), t, passo).ok).toBe(false);
    expect(verificar(SEGREDO, codigo(SEGREDO, passo + 1), t, passo).ok).toBe(true);
  });

  it('RN-CORE-31: código malformado ou errado é recusado', () => {
    const t = new Date(59_000);
    expect(verificar(SEGREDO, '12345', t, 0).ok).toBe(false);
    expect(verificar(SEGREDO, 'abcdef', t, 0).ok).toBe(false);
    expect(verificar(SEGREDO, '000000', t, 0).ok).toBe(false);
  });

  it('RN-CORE-31: base32 (RFC 4648) e URI otpauth para o aplicativo autenticador', () => {
    expect(base32Codificar(Buffer.from('foobar', 'ascii'))).toBe('MZXW6YTBOI');
    expect(base32Codificar(SEGREDO)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    const uri = uriOtpauth('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'eu@macuxi.com');
    expect(uri).toBe('otpauth://totp/Macuxi%20FDV:eu%40macuxi.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Macuxi%20FDV&algorithm=SHA1&digits=6&period=30');
  });
});

describe('RN-CORE-31/ADR 0029: códigos de recuperação', () => {
  it('RN-CORE-31: formato XXXXX-XXXXX e hash estável sem hífen nem caixa', () => {
    expect(formatarCodigoRecuperacao('abcde23456')).toBe('ABCDE-23456');
    expect(normalizarRecuperacao('abcde-23456')).toBe(normalizarRecuperacao('ABCDE23456'));
    expect(normalizarRecuperacao('abcde-23456')).toBe('ABCDE23456');
  });
});

describe('RN-CORE-31/ADR 0029: convite do primeiro acesso', () => {
  const convite = 'c'.repeat(40);
  it('RN-CORE-31: confere em tempo constante e exige o mínimo de 32 caracteres', () => {
    expect(conviteConfere(convite, convite, sha256Falso)).toBe(true);
    expect(conviteConfere(convite, 'd'.repeat(40), sha256Falso)).toBe(false);
    expect(conviteConfere(convite, convite + 'x', sha256Falso)).toBe(false);
    expect(conviteConfere('curto', 'curto', sha256Falso)).toBe(false);
    expect(conviteConfere(undefined, convite, sha256Falso)).toBe(false);
  });
});

describe('RN-CORE-31/ADR 0029: bloqueio por 5 falhas e sessão', () => {
  const agora = new Date('2026-11-06T12:00:00Z');
  it('RN-CORE-31: a 5ª falha bloqueia por 15 min; passado o bloqueio, recomeça', () => {
    let c = { falhas: 0, bloqueadoAte: null as Date | null };
    for (let i = 1; i <= 4; i++) {
      c = decidirFalhaSuperAdmin(c, agora);
      expect(c.bloqueadoAte).toBeNull();
    }
    c = decidirFalhaSuperAdmin(c, agora);
    expect(c.falhas).toBe(5);
    expect(c.bloqueadoAte?.toISOString()).toBe('2026-11-06T12:15:00.000Z');
    expect(estadoDoSuperAdmin({ ativo: true, bloqueadoAte: c.bloqueadoAte, agora })).toBe('bloqueado');
    const depois = new Date(agora.getTime() + 16 * 60_000);
    expect(estadoDoSuperAdmin({ ativo: true, bloqueadoAte: c.bloqueadoAte, agora: depois })).toBe('ok');
    expect(decidirFalhaSuperAdmin(c, depois).falhas).toBe(1);
  });

  it('RN-CORE-31: inativo nunca entra', () => {
    expect(estadoDoSuperAdmin({ ativo: false, bloqueadoAte: null, agora })).toBe('inativo');
  });

  it('RN-CORE-31: token de 15 min limitado ao teto de 8 h da sessão', () => {
    const teto = new Date(agora.getTime() + 8 * 3600_000);
    expect(expiracaoDoTokenPlataforma(agora, teto).toISOString()).toBe('2026-11-06T12:15:00.000Z');
    const quase = new Date(teto.getTime() - 60_000);
    expect(expiracaoDoTokenPlataforma(quase, teto).toISOString()).toBe(teto.toISOString());
  });
});
