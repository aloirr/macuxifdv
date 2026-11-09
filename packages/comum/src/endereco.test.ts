import { describe, expect, it } from 'vitest';

import { UFS_BRASIL, cepValido, ehUf, formatarCep, normalizarCep } from './endereco';

describe('RN-VEN-17: endereço do pedido (UF e CEP)', () => {
  it('RN-VEN-17: as 27 UFs, sem repetição', () => {
    expect(UFS_BRASIL).toHaveLength(27);
    expect(new Set(UFS_BRASIL).size).toBe(27);
  });

  it('RN-VEN-17: UF válida aceita minúscula e espaço; sigla inexistente é inválida', () => {
    expect(ehUf('AM')).toBe(true);
    expect(ehUf(' rr ')).toBe(true);
    expect(ehUf('XX')).toBe(false);
    expect(ehUf('')).toBe(false);
    expect(ehUf(null)).toBe(false);
  });

  it('RN-VEN-17: CEP com 8 dígitos, formatado ou não; zeros, curto ou longo é inválido', () => {
    expect(cepValido('69053-000')).toBe(true);
    expect(cepValido('69053000')).toBe(true);
    expect(cepValido('00000-000')).toBe(false);
    expect(cepValido('6905300')).toBe(false);
    expect(cepValido('690530001')).toBe(false);
    expect(cepValido(undefined)).toBe(false);
  });

  it('RN-VEN-17: normaliza para dígitos e formata 00000-000', () => {
    expect(normalizarCep('69.053-000')).toBe('69053000');
    expect(formatarCep('69053000')).toBe('69053-000');
    expect(formatarCep('123')).toBe('123');
    expect(formatarCep(null)).toBe('');
  });
});
