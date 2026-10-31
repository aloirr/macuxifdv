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

  it('RN-GES-01/02/03: padrões das decisões do Alexandre — tolerância 50%, 30 dias sem frequência, carência 15 dias, seg–sex 08:00–18:00', () => {
    expect(PARAMETROS_PADRAO).toMatchObject({
      pct_tolerancia_frequencia: 50,
      dias_sem_visita_padrao: 30,
      dias_carencia_cliente_novo: 15,
      horario_comercial: { dias_semana: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' },
    });
  });

  it('RN-GES-01/02/03: parâmetros novos recusam negativos e horário comercial incoerente', () => {
    expect(() => resolverParametros({ pct_tolerancia_frequencia: -1 })).toThrow(/pct_tolerancia_frequencia/);
    expect(() => resolverParametros({ dias_sem_visita_padrao: -1 })).toThrow(/dias_sem_visita_padrao/);
    expect(() => resolverParametros({ dias_sem_visita_padrao: 2.5 })).toThrow(/dias_sem_visita_padrao/);
    expect(() => resolverParametros({ dias_carencia_cliente_novo: -1 })).toThrow(/dias_carencia_cliente_novo/);
    expect(() => resolverParametros({ aprovacao_prazo_horas: -24 })).toThrow(/aprovacao_prazo_horas/);
    const hc = PARAMETROS_PADRAO.horario_comercial;
    expect(() => resolverParametros({ horario_comercial: { ...hc, inicio: '18:00', fim: '08:00' } })).toThrow(/horario_comercial/);
    expect(() => resolverParametros({ horario_comercial: { ...hc, inicio: '25:00' } })).toThrow(/horario_comercial/);
    expect(() => resolverParametros({ horario_comercial: { ...hc, dias_semana: [] } })).toThrow(/horario_comercial/);
    expect(() => resolverParametros({ horario_comercial: { ...hc, dias_semana: [0, 8] } })).toThrow(/horario_comercial/);
    expect(() => resolverParametros({ horario_comercial: { ...hc, dias_semana: [1, 1] } })).toThrow(/horario_comercial/);
    expect(resolverParametros({ pct_tolerancia_frequencia: 0, dias_carencia_cliente_novo: 0 })).toMatchObject({ pct_tolerancia_frequencia: 0, dias_carencia_cliente_novo: 0 });
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
