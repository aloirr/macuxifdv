import { describe, expect, it } from 'vitest';
import { idDoPayloadConfere } from './idempotencia';

describe('id do item × id do payload (ADR 0009 §1)', () => {
  it('ADR 0009: payload com o mesmo id do item é aceito', () => {
    expect(idDoPayloadConfere('a', { id: 'a' })).toBe(true);
  });
  it('ADR 0009: payload com id diferente do item é PAYLOAD_INVALIDO', () => {
    expect(idDoPayloadConfere('a', { id: 'b' })).toBe(false);
  });
  it('ADR 0009: payload sem id é aceito (vale o do item)', () => {
    expect(idDoPayloadConfere('a', {})).toBe(true);
  });
});
