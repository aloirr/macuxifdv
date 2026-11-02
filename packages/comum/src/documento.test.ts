import { describe, expect, it } from 'vitest';

import { completarCnpj, completarCpf, cnpjValido, cpfValido, formatarDocumento, somenteDigitos, tipoDocumento } from './documento';

describe('RN-CORE-16: CNPJ e CPF com dígito verificador', () => {
  it('RN-CORE-16: CNPJ válido, formatado ou só dígitos', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11222333000181')).toBe(true);
    expect(cnpjValido('11.444.777/0001-61')).toBe(true);
  });

  it('RN-CORE-16: CNPJ com dígito errado, tamanho errado ou todos iguais é inválido', () => {
    expect(cnpjValido('11.222.333/0001-82')).toBe(false);
    expect(cnpjValido('1122233300018')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
    expect(cnpjValido('11111111111111')).toBe(false);
    expect(cnpjValido('')).toBe(false);
    expect(cnpjValido(null)).toBe(false);
  });

  it('RN-CORE-16: CPF válido e inválido', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
    expect(cpfValido('5299822472')).toBe(false);
    expect(cpfValido(undefined)).toBe(false);
  });

  it('RN-CORE-16: tipoDocumento diz cnpj, cpf ou null (inválido conta como ausente, RN-INT-14)', () => {
    expect(tipoDocumento('11.222.333/0001-81')).toBe('cnpj');
    expect(tipoDocumento('529.982.247-25')).toBe('cpf');
    expect(tipoDocumento('529.982.247-24')).toBeNull();
    expect(tipoDocumento('  ')).toBeNull();
    expect(tipoDocumento(null)).toBeNull();
  });

  it('completarCnpj/completarCpf geram documento fictício válido a partir da base (seeds e testes)', () => {
    expect(completarCnpj('112223330001')).toBe('11222333000181');
    expect(completarCpf('529982247')).toBe('52998224725');
    for (let i = 1; i <= 50; i++) {
      const base = String(10_000_000 + i * 7919).padStart(8, '0') + '0001';
      expect(cnpjValido(completarCnpj(base))).toBe(true);
    }
    expect(() => completarCnpj('123')).toThrow();
    expect(() => completarCpf('12a456789')).toThrow();
  });

  it('somenteDigitos e formatarDocumento', () => {
    expect(somenteDigitos(' 11.222.333/0001-81 ')).toBe('11222333000181');
    expect(formatarDocumento('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatarDocumento('52998224725')).toBe('529.982.247-25');
    expect(formatarDocumento('123')).toBe('123');
    expect(formatarDocumento(null)).toBe('');
  });
});
