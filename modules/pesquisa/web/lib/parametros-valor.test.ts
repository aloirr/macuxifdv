import { describe, expect, it } from 'vitest';
import { parametrosEmUso, valorDoParametro } from './parametros-valor';

describe('Parâmetros › Pesquisa: valor em uso (RN-PES-04)', () => {
  it('RN-PES-04: sem valor do tenant mostra o padrão e não repete "Padrão"', () => {
    expect(valorDoParametro({}, 'tolerancia_vigencia_h')).toEqual({ valor: '24', padrao: null });
  });
  it('RN-PES-04: valor do tenant diferente aparece como em uso e o padrão vem à parte', () => {
    expect(valorDoParametro({ tolerancia_vigencia_h: 48 }, 'tolerancia_vigencia_h', (v) => `${v} h`)).toEqual({ valor: '48 h', padrao: 'Padrão: 24 h' });
  });
  it('RN-PES-04: valor do tenant igual ao padrão não mostra "Padrão"', () => {
    expect(valorDoParametro({ tolerancia_vigencia_h: 24 }, 'tolerancia_vigencia_h').padrao).toBeNull();
  });
  it('RN-PES-04: valor inválido do tenant cai no padrão', () => {
    expect(parametrosEmUso({ tolerancia_vigencia_h: -1 }).tolerancia_vigencia_h).toBe(24);
  });
});

describe('formato pt-BR dos números', () => {
  it('RN-PES-07: milhar com ponto ("2.000")', () => {
    expect(valorDoParametro({}, 'texto_max_caracteres').valor).toBe('2.000');
  });
});
