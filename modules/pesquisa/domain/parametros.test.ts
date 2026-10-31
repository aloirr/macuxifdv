import { describe, expect, it } from 'vitest';
import { PARAMETROS_PADRAO, resolverParametros } from './parametros';

describe('parâmetros do tenant da Pesquisa', () => {
  it('RN-PES-04: tolerância padrão de 24 h e fuso America/Manaus (doc 03, tabela de parâmetros)', () => {
    expect(PARAMETROS_PADRAO.tolerancia_vigencia_h).toBe(24);
    expect(PARAMETROS_PADRAO.fuso).toBe('America/Manaus');
  });

  it('premissa T-0012: limites do construtor têm padrão', () => {
    expect(PARAMETROS_PADRAO).toMatchObject({ max_perguntas: 50, max_opcoes_por_pergunta: 20, max_fotos_por_pergunta: 10, texto_max_caracteres: 2000, escala_amplitude_max: 10 });
  });

  it('resolverParametros mistura o parcial com o padrão', () => {
    const p = resolverParametros({ tolerancia_vigencia_h: 48 });
    expect(p.tolerancia_vigencia_h).toBe(48);
    expect(p.max_perguntas).toBe(50);
  });

  it('RN-PES-04: tolerância negativa ou fracionada é recusada, em português', () => {
    expect(() => resolverParametros({ tolerancia_vigencia_h: -1 })).toThrow(/Parâmetro tolerancia_vigencia_h inválido/);
    expect(() => resolverParametros({ tolerancia_vigencia_h: 1.5 })).toThrow(/inválido/);
  });

  it('fuso inexistente é recusado', () => {
    expect(() => resolverParametros({ fuso: 'Marte/Olympus' })).toThrow(/Fuso horário inválido/);
  });
});
