import { describe, expect, it } from 'vitest';
import { aplicarMascara, propsDoInputComMascara } from './mascara';

describe('máscaras do campo do BKO (v1.0.30, bko-pre-cadastros-recusados §4)', () => {
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

  it('sem maxLength: o texto colado chega inteiro e a máscara limita os dígitos', () => {
    expect(propsDoInputComMascara('telefone')).toEqual({ inputMode: 'tel', autoComplete: 'tel' });
    expect(propsDoInputComMascara('cep')).toEqual({ inputMode: 'numeric', autoComplete: 'postal-code' });
    expect(propsDoInputComMascara('documento')).toEqual({ inputMode: 'numeric', autoComplete: 'off' });
    expect(aplicarMascara('telefone', '+55 (92) 99123-4567')).toBe('(92) 99123-4567');
    expect(aplicarMascara('telefone', '+55 92 3232-1000')).toBe('(92) 3232-1000');
    expect(aplicarMascara('telefone', '92 99123-4567')).toBe('(92) 99123-4567');
    expect(aplicarMascara('documento', '11.222.333/0001-81 ')).toBe('11.222.333/0001-81');
    expect(aplicarMascara('cep', 'CEP 69053-000')).toBe('69053-000');
  });

  it('a web lê os códigos do cliente do próprio kit, sem depender do kit mobile', async () => {
    const web = await import('./index');
    expect(web.textoDosCodigos({ erp: 'C5007', fdv: '00012' })).toBe('ERP C5007 · FDV 00012');
    expect(web.SEPARADOR_CODIGOS).toBe(' · ');
    expect(web.partesDosCodigos({ fdv: '00012' })).toEqual([{ sigla: 'FDV', valor: '00012' }]);
  });
});
