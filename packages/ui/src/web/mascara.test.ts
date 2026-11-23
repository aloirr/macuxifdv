import { describe, expect, it } from 'vitest';
import { aplicarMascara, propsDoInputComMascara } from './mascara';

describe('máscaras do campo do BKO (v1.0.29, bko-pre-cadastros-recusados §4)', () => {
  it('telefone: fixo e celular ao digitar, sem separador pendurado, corta o excesso', () => {
    expect(aplicarMascara('telefone', '9')).toBe('(9');
    expect(aplicarMascara('telefone', '92')).toBe('(92');
    expect(aplicarMascara('telefone', '923')).toBe('(92) 3');
    expect(aplicarMascara('telefone', '9232321000')).toBe('(92) 3232-1000');
    expect(aplicarMascara('telefone', '92991234567')).toBe('(92) 99123-4567');
    expect(aplicarMascara('telefone', '(92) 99123-45678')).toBe('(92) 99123-4567');
  });

  it('CPF/CNPJ e CEP iguais aos do Campo', () => {
    expect(aplicarMascara('documento', '11222333000181')).toBe('11.222.333/0001-81');
    expect(aplicarMascara('documento', '12345678909')).toBe('123.456.789-09');
    expect(aplicarMascara('cep', '69053000')).toBe('69053-000');
  });

  it('o maxLength cabe o texto formatado mais longo de cada máscara', () => {
    expect(propsDoInputComMascara('telefone')).toEqual({ inputMode: 'tel', maxLength: '(92) 99123-4567'.length, autoComplete: 'tel' });
    expect(propsDoInputComMascara('documento').maxLength).toBe('11.222.333/0001-81'.length);
    expect(propsDoInputComMascara('cep')).toEqual({ inputMode: 'numeric', maxLength: '69053-000'.length, autoComplete: 'postal-code' });
  });
});
