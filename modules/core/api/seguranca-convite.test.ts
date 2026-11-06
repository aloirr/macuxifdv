import { describe, expect, it } from 'vitest';
import { hashDoConvite, lerConvite, novoConvite } from './seguranca-convite';

const TENANT = '11111111-2222-4333-8444-555555555555';

describe('RN-CORE-31: token do convite de 1º acesso', () => {
  it('RN-CORE-31: o token leva o tenant e o segredo; o hash é SHA-256 do segredo e o token não é o hash', () => {
    const c = novoConvite(TENANT);
    const lido = lerConvite(c.token);
    expect(lido).toEqual({ tenantId: TENANT, hash: c.hash });
    expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.token).not.toContain(c.hash);
    expect(hashDoConvite(c.token.slice(37))).toBe(c.hash);
  });
  it('RN-CORE-31: dois convites nunca repetem o token', () => {
    expect(novoConvite(TENANT).token).not.toBe(novoConvite(TENANT).token);
  });
  it('RN-CORE-31: formato inválido (sem tenant, tenant malformado, segredo curto) é recusado', () => {
    expect(lerConvite('abc')).toBeNull();
    expect(lerConvite(`nao-uuid.${'a'.repeat(43)}`)).toBeNull();
    expect(lerConvite(`${TENANT}.curto`)).toBeNull();
    expect(lerConvite(`${TENANT}.${'a'.repeat(43)}`)).not.toBeNull();
  });
});
