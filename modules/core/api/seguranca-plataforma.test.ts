import { describe, expect, it } from 'vitest';
import { passoTotp } from '../domain/super-admin';
import { codigoTotp, conviteConfere, hashCodigoRecuperacao, verificarTotp } from './seguranca-plataforma';

// RFC 6238 apêndice B (SHA-1), segredo ASCII "12345678901234567890"; os 6 últimos dígitos dos valores de 8 dígitos.
const SEGREDO = Buffer.from('12345678901234567890', 'ascii');
const VETORES: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('RN-CORE-31/ADR 0029: primitivas reais injetadas no domain', () => {
  it.each(VETORES)('RN-CORE-31: vetor do RFC 6238 em t=%i dá %s', (t, esperado) => {
    expect(codigoTotp(SEGREDO, passoTotp(new Date(t * 1000)))).toBe(esperado);
  });

  it('RN-CORE-31: verificarTotp com HMAC real aceita o passo atual e recusa reuso', () => {
    const t = new Date(1111111109 * 1000);
    const passo = passoTotp(t);
    expect(verificarTotp(SEGREDO, codigoTotp(SEGREDO, passo), t, 0)).toEqual({ ok: true, passo });
    expect(verificarTotp(SEGREDO, codigoTotp(SEGREDO, passo), t, passo).ok).toBe(false);
  });

  it('RN-CORE-31: hash do código de recuperação é SHA-256 estável, sem hífen nem caixa', () => {
    expect(hashCodigoRecuperacao('abcde-23456')).toBe(hashCodigoRecuperacao('ABCDE23456'));
    expect(hashCodigoRecuperacao('ABCDE23456')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCodigoRecuperacao('ABCDE23456')).not.toContain('ABCDE');
  });

  it('RN-CORE-31: convite com SHA-256 real confere e exige 32 caracteres', () => {
    const convite = 'c'.repeat(40);
    expect(conviteConfere(convite, convite)).toBe(true);
    expect(conviteConfere(convite, 'd'.repeat(40))).toBe(false);
    expect(conviteConfere('curto', 'curto')).toBe(false);
  });
});
