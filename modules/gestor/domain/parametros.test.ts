import { describe, expect, it } from 'vitest';
import { PARAMETROS_PADRAO, resolverParametros } from './parametros';

describe('parâmetros do tenant do Gestor (doc 03, tabela de parâmetros)', () => {
  it('padrões: fuso Manaus, base aprovado (RN-CORE-21), permanência 10 min (RN-PRO-07), peso do parcial 0 (RN-PRO-11)', () => {
    expect(PARAMETROS_PADRAO).toMatchObject({
      fuso: 'America/Manaus',
      base_apuracao: 'aprovado',
      permanencia_min_min: 10,
      peso_parcial_conformidade: 0,
      aprovacao_prazo_horas: 24,
      aprovacao_aviso_horas: 4,
    });
    expect(PARAMETROS_PADRAO.feriados).toEqual([]);
  });

  it('mistura o parcial do tenant com o padrão', () => {
    const p = resolverParametros({ base_apuracao: 'faturado', feriados: ['2026-11-02'] });
    expect(p.base_apuracao).toBe('faturado');
    expect(p.fuso).toBe('America/Manaus');
    expect(p.feriados).toEqual(['2026-11-02']);
  });

  it('recusa valores inválidos com mensagem em português', () => {
    expect(() => resolverParametros({ fuso: 'Marte/Olympus' })).toThrow(/Fuso/);
    expect(() => resolverParametros({ aprovacao_prazo_horas: 0 })).toThrow();
    expect(() => resolverParametros({ aprovacao_prazo_horas: 4, aprovacao_aviso_horas: 4 })).toThrow(/aviso/i);
    expect(() => resolverParametros({ peso_parcial_conformidade: 2 })).toThrow();
    expect(() => resolverParametros({ feriados: ['02/11/2026'] })).toThrow();
  });
});
