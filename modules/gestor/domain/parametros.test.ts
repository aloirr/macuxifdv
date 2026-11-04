import { describe, expect, it } from 'vitest';
import { PARAMETROS_PADRAO, parametrosDoTenant, resolverParametros } from './parametros';

describe('parâmetros do tenant do Gestor (doc 03, tabela de parâmetros)', () => {
  it('padrões: fuso Manaus, base aprovado (RN-CORE-21), permanência 10 min (RN-PRO-07), peso do parcial 0 (RN-PRO-11)', () => {
    expect(PARAMETROS_PADRAO).toMatchObject({
      fuso: 'America/Manaus',
      base_apuracao: 'aprovado',
      permanencia_min_min: 10,
      peso_parcial_conformidade: 0,
      prazo_aprovacao_dias_uteis: 1,
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
    expect(() => resolverParametros({ prazo_aprovacao_dias_uteis: -1 })).toThrow(/prazo_aprovacao_dias_uteis/);
    const hc = PARAMETROS_PADRAO.horario_comercial;
    expect(() => resolverParametros({ horario_comercial: { ...hc, inicio: '18:00', fim: '08:00' } })).toThrow(/horario_comercial/);
    expect(() => resolverParametros({ horario_comercial: { ...hc, inicio: '25:00' } })).toThrow(/horario_comercial/);
    expect(() => resolverParametros({ horario_comercial: { ...hc, dias_semana: [] } })).toThrow(/horario_comercial/);
    expect(() => resolverParametros({ horario_comercial: { ...hc, dias_semana: [0, 8] } })).toThrow(/horario_comercial/);
    expect(() => resolverParametros({ horario_comercial: { ...hc, dias_semana: [1, 1] } })).toThrow(/horario_comercial/);
    expect(resolverParametros({ pct_tolerancia_frequencia: 0, dias_carencia_cliente_novo: 0 })).toMatchObject({ pct_tolerancia_frequencia: 0, dias_carencia_cliente_novo: 0 });
  });

  it('RN-GES-03: o prazo é em DIAS úteis (o parâmetro antigo em horas deixou de existir)', () => {
    expect(PARAMETROS_PADRAO).not.toHaveProperty('aprovacao_prazo_horas');
    expect(() => resolverParametros({ aprovacao_prazo_horas: 24 } as never)).toThrow();
    expect(resolverParametros({ prazo_aprovacao_dias_uteis: 3 }).prazo_aprovacao_dias_uteis).toBe(3);
  });

  it('RN-GES-03: o aviso "vencendo" (horas úteis restantes) tem de ser menor que o prazo em dias × a jornada do dia (padrão 10 h)', () => {
    expect(resolverParametros({ aprovacao_aviso_horas: 9.5 }).aprovacao_aviso_horas).toBe(9.5);
    expect(() => resolverParametros({ aprovacao_aviso_horas: 10 })).toThrow(/aviso/i); // 1 dia útil = 10 h úteis
    expect(() => resolverParametros({ aprovacao_aviso_horas: 12 })).toThrow(/aviso/i);
    expect(resolverParametros({ prazo_aprovacao_dias_uteis: 2, aprovacao_aviso_horas: 12 }).aprovacao_aviso_horas).toBe(12); // 2 dias = 20 h
    expect(() => resolverParametros({ prazo_aprovacao_dias_uteis: 2, aprovacao_aviso_horas: 20 })).toThrow(/aviso/i);
  });

  it('RN-GES-03: a jornada vem do horário comercial do tenant (08:00–12:00 = 4 h por dia útil)', () => {
    const meioDia = { dias_semana: [1, 2, 3, 4, 5], inicio: '08:00', fim: '12:00' };
    expect(() => resolverParametros({ horario_comercial: meioDia })).toThrow(/aviso/i); // aviso padrão 4 h não é menor que 4 h
    expect(resolverParametros({ horario_comercial: meioDia, aprovacao_aviso_horas: 2 }).aprovacao_aviso_horas).toBe(2);
  });

  it('mistura o parcial do tenant com o padrão', () => {
    const p = resolverParametros({ base_apuracao: 'faturado', feriados: ['2026-11-02'] });
    expect(p.base_apuracao).toBe('faturado');
    expect(p.fuso).toBe('America/Manaus');
    expect(p.feriados).toEqual(['2026-11-02']);
  });

  it('recusa valores inválidos com mensagem em português', () => {
    expect(() => resolverParametros({ fuso: 'Marte/Olympus' })).toThrow(/Fuso/);
    expect(() => resolverParametros({ prazo_aprovacao_dias_uteis: 0 })).toThrow(/prazo_aprovacao_dias_uteis/);
    expect(() => resolverParametros({ prazo_aprovacao_dias_uteis: 1.5 })).toThrow(/prazo_aprovacao_dias_uteis/);
    expect(() => resolverParametros({ peso_parcial_conformidade: 2 })).toThrow();
    expect(() => resolverParametros({ feriados: ['02/11/2026'] })).toThrow();
  });
});

describe('parâmetros vindos da plataforma (T-0055)', () => {
  it('RN-GES-03: só as chaves do Gestor entram e o fuso do tenant vence', () => {
    const r = parametrosDoTenant({ prazo_aprovacao_dias_uteis: 2, alheio: 1, fuso: 'UTC' }, 'America/Sao_Paulo');
    expect(r.erro).toBeNull();
    expect(r.params).toMatchObject({ prazo_aprovacao_dias_uteis: 2, fuso: 'America/Sao_Paulo' });
    expect(r.params).not.toHaveProperty('alheio');
  });

  it('RN-GES-03: valor inválido volta ao padrão com o erro em português (a tela não quebra)', () => {
    const r = parametrosDoTenant({ prazo_aprovacao_dias_uteis: 0 }, 'America/Manaus');
    expect(r.params.prazo_aprovacao_dias_uteis).toBe(1);
    expect(r.erro).toMatch(/prazo_aprovacao_dias_uteis/);
  });

  it('RN-CORE-26: inicio.parado_min do tenant vira parado_min (padrão 60); valor inválido volta ao padrão com aviso', () => {
    expect(PARAMETROS_PADRAO.parado_min).toBe(60);
    expect(parametrosDoTenant({ 'inicio.parado_min': 45 }, 'America/Manaus').params.parado_min).toBe(45);
    const ruim = parametrosDoTenant({ 'inicio.parado_min': 0 }, 'America/Manaus');
    expect(ruim.params.parado_min).toBe(60);
    expect(ruim.erro).toMatch(/parado_min/);
  });
});
