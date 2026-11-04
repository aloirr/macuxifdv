import { describe, expect, it } from 'vitest';
import type { MetaDoDia } from '../contracts/inicio';
import { CALENDARIO_PADRAO, calendarioDoTenant, diasUteisRestantes, ehDiaUtil, metaDoDia, metaDoDiaDaEquipe, type CalendarioTenant } from './meta-do-dia';

const SEG_SEX: CalendarioTenant = { dias_uteis_semana: [1, 2, 3, 4, 5] };
const base = { indicador: 'venda_cents' as const, periodo: '2026-11', calendario: CALENDARIO_PADRAO, meta_mes: 3_000_000, realizado_ate_ontem: 1_200_000, realizado_hoje: 0 };

describe('RN-CORE-26: calendário do tenant (caso 7)', () => {
  it('RN-CORE-26: sem parâmetro vale o padrão segunda a sábado, sem feriados', () => {
    expect(calendarioDoTenant([])).toEqual(CALENDARIO_PADRAO);
    expect(CALENDARIO_PADRAO.dias_uteis_semana).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('RN-CORE-26: lê metas.dias_uteis_semana do módulo core (segunda a sexta)', () => {
    const cal = calendarioDoTenant([{ modulo: 'core', chave: 'metas.dias_uteis_semana', valor: [1, 2, 3, 4, 5] }]);
    expect(cal.dias_uteis_semana).toEqual([1, 2, 3, 4, 5]);
  });
  it('RN-CORE-26: parâmetro inválido ("x", [], fora de 0 a 6, removido, de outro módulo) cai no padrão', () => {
    for (const valor of ['x', [], [7], [1.5], [1, 'a'], null, 3]) {
      expect(calendarioDoTenant([{ modulo: 'core', chave: 'metas.dias_uteis_semana', valor }]), JSON.stringify(valor)).toEqual(CALENDARIO_PADRAO);
    }
    expect(calendarioDoTenant([{ modulo: 'core', chave: 'metas.dias_uteis_semana', valor: [1], deleted_at: '2026-11-01T00:00:00Z' }])).toEqual(CALENDARIO_PADRAO);
    expect(calendarioDoTenant([{ modulo: 'vendedor', chave: 'metas.dias_uteis_semana', valor: [1] }])).toEqual(CALENDARIO_PADRAO);
  });
  it('RN-CORE-26: ehDiaUtil segue a semana do tenant e os feriados', () => {
    expect(ehDiaUtil('2026-11-15', CALENDARIO_PADRAO)).toBe(false); // domingo
    expect(ehDiaUtil('2026-11-14', CALENDARIO_PADRAO)).toBe(true); // sábado
    expect(ehDiaUtil('2026-11-14', SEG_SEX)).toBe(false);
    expect(ehDiaUtil('2026-11-16', { ...CALENDARIO_PADRAO, feriados: ['2026-11-16'] })).toBe(false);
  });
});

describe('RN-CORE-26: dias úteis restantes contando hoje', () => {
  it('RN-CORE-26: 10/11/2026 (terça), seg–sáb = 18 dias', () => expect(diasUteisRestantes('2026-11', '2026-11-10', CALENDARIO_PADRAO)).toBe(18));
  it('RN-CORE-26: 10/11/2026 com calendário seg–sex = 15 dias (caso 4b)', () => expect(diasUteisRestantes('2026-11', '2026-11-10', SEG_SEX)).toBe(15));
  it('RN-CORE-26: domingo 15/11 não conta hoje: 13 dias (16 a 30 sem 22 e 29)', () => expect(diasUteisRestantes('2026-11', '2026-11-15', CALENDARIO_PADRAO)).toBe(13));
  it('RN-CORE-26: hoje antes do período conta todos (25 em novembro); depois do período, zero', () => {
    expect(diasUteisRestantes('2026-11', '2026-10-20', CALENDARIO_PADRAO)).toBe(25);
    expect(diasUteisRestantes('2026-11', '2026-12-01', CALENDARIO_PADRAO)).toBe(0);
  });
  it('RN-CORE-26: feriado sai da conta', () => expect(diasUteisRestantes('2026-11', '2026-11-10', { ...CALENDARIO_PADRAO, feriados: ['2026-11-20'] })).toBe(17));
});

describe('RN-CORE-26: meta do dia', () => {
  it('RN-CORE-26: caso 1: (30.000 − 12.000) ÷ 18 dias úteis = R$ 1.000 = 100.000 centavos, a cumprir', () => {
    const m = metaDoDia({ ...base, hoje: '2026-11-10' });
    expect(m.dias_uteis_restantes).toBe(18);
    expect(m.meta_dia).toBe(100_000);
    expect(m.situacao).toBe('a_cumprir');
    expect(m.atingimento_hoje_pct).toBe(0);
    expect(m.membros).toBe(1);
  });
  it('RN-CORE-26: caso 1b: vendeu 100.000 hoje = dia batido, 100% (10000 pontos-base)', () => {
    const m = metaDoDia({ ...base, hoje: '2026-11-10', realizado_hoje: 100_000 });
    expect(m.situacao).toBe('dia_batido');
    expect(m.atingimento_hoje_pct).toBe(10_000);
  });
  it('RN-CORE-26: atingimento passa de 100% sem teto', () => {
    expect(metaDoDia({ ...base, hoje: '2026-11-10', realizado_hoje: 150_000 }).atingimento_hoje_pct).toBe(15_000);
  });
  it('RN-CORE-26: caso 2: meta do mês batida até ontem = mes_batido, meta do dia 0, nunca negativa', () => {
    const m = metaDoDia({ ...base, hoje: '2026-11-10', realizado_ate_ontem: 3_100_000 });
    expect(m.situacao).toBe('mes_batido');
    expect(m.meta_dia).toBe(0);
    expect(m.membros_mes_batido).toBe(1);
  });
  it('RN-CORE-26: caso 3: último dia do mês (segunda 30/11) = 1 dia e meta do dia 50.000', () => {
    const m = metaDoDia({ ...base, hoje: '2026-11-30', realizado_ate_ontem: 2_950_000 });
    expect(m.dias_uteis_restantes).toBe(1);
    expect(m.meta_dia).toBe(50_000);
  });
  it('RN-CORE-26: caso 3b: último dia não útil (sábado 31/10 com seg–sex) = dia_nao_util, 0 dias, meta do dia nula', () => {
    const m = metaDoDia({ ...base, periodo: '2026-10', calendario: SEG_SEX, hoje: '2026-10-31' });
    expect(m.situacao).toBe('dia_nao_util');
    expect(m.dias_uteis_restantes).toBe(0);
    expect(m.meta_dia).toBeNull();
    expect(m.atingimento_hoje_pct).toBeNull();
  });
  it('RN-CORE-26: caso 4: domingo fora do calendário = dia_nao_util com 13 dias restantes', () => {
    const m = metaDoDia({ ...base, hoje: '2026-11-15' });
    expect(m.situacao).toBe('dia_nao_util');
    expect(m.dias_uteis_restantes).toBe(13);
    expect(m.meta_dia).toBeNull();
  });
  it('RN-CORE-26: caso 4b: calendário do tenant seg–sex dá 15 dias e meta do dia 120.000', () => {
    const m = metaDoDia({ ...base, calendario: SEG_SEX, hoje: '2026-11-10' });
    expect(m.dias_uteis_restantes).toBe(15);
    expect(m.meta_dia).toBe(120_000);
  });
  it('RN-CORE-26: caso 5: contagem arredonda para cima (positivação 40, 21 feitas, 18 dias = 2)', () => {
    const m = metaDoDia({ ...base, indicador: 'positivacao', meta_mes: 40, realizado_ate_ontem: 21, hoje: '2026-11-10' });
    expect(m.meta_dia).toBe(2);
  });
  it('RN-CORE-26: caso 8: cobertura é razão do mês: do_mes, sem meta do dia', () => {
    const m = metaDoDia({ ...base, indicador: 'cobertura_pct', meta_mes: 9000, realizado_ate_ontem: 7000, hoje: '2026-11-10' });
    expect(m.situacao).toBe('do_mes');
    expect(m.meta_dia).toBeNull();
    expect(m.atingimento_hoje_pct).toBeNull();
  });
  it('RN-CORE-26: o mês batido vale mesmo em dia não útil (nunca mostra valor negativo)', () => {
    expect(metaDoDia({ ...base, hoje: '2026-11-15', realizado_ate_ontem: 3_000_000 }).situacao).toBe('mes_batido');
  });
});

describe('RN-CORE-26: meta do dia da equipe é a soma das metas do dia (caso 6)', () => {
  const entrada = { ...base, hoje: '2026-11-10' };
  const A = metaDoDia({ ...entrada, meta_mes: 3_000_000, realizado_ate_ontem: 1_200_000, realizado_hoje: 50_000 });
  const B = metaDoDia({ ...entrada, meta_mes: 1_800_000, realizado_ate_ontem: 2_000_000 });
  const C = metaDoDia({ ...entrada, meta_mes: 900_000, realizado_ate_ontem: 0 });

  it('RN-CORE-26: soma 100.000 + 0 + 50.000 = 150.000 (a conta pelo total daria 138.889 e não vale)', () => {
    expect([A.meta_dia, B.meta_dia, C.meta_dia]).toEqual([100_000, 0, 50_000]);
    const eq = metaDoDiaDaEquipe('venda_cents', [A, B, C])!;
    expect(eq.meta_dia).toBe(150_000);
    expect(eq.realizado_hoje).toBe(50_000);
    expect(eq.membros).toBe(3);
    expect(eq.membros_mes_batido).toBe(1);
    expect(eq.situacao).toBe('a_cumprir');
    expect(eq.meta_mes).toBe(5_700_000);
    expect(eq.realizado_ate_ontem).toBe(3_200_000);
    expect(eq.dias_uteis_restantes).toBe(18);
    expect(eq.atingimento_hoje_pct).toBe(3333);
  });
  it('RN-CORE-26: a soma de hoje bate a soma das metas do dia = dia_batido', () => {
    const batido = [{ ...A, realizado_hoje: 100_000 }, B, { ...C, realizado_hoje: 50_000 }];
    expect(metaDoDiaDaEquipe('venda_cents', batido)!.situacao).toBe('dia_batido');
  });
  it('RN-CORE-26: todos com o mês batido = mes_batido; sem ninguém com meta no indicador = null', () => {
    expect(metaDoDiaDaEquipe('venda_cents', [B, B])!.situacao).toBe('mes_batido');
    expect(metaDoDiaDaEquipe('venda_cents', [])).toBeNull();
    expect(metaDoDiaDaEquipe('visitas', [A])).toBeNull(); // A é de venda_cents
  });
  it('RN-CORE-26: dia não útil para o tenant vale para a equipe, e cobertura da equipe é do_mes', () => {
    const dom = (m: Partial<Parameters<typeof metaDoDia>[0]>) => metaDoDia({ ...entrada, hoje: '2026-11-15', ...m });
    expect(metaDoDiaDaEquipe('venda_cents', [dom({}), dom({ meta_mes: 1_800_000, realizado_ate_ontem: 2_000_000 })])!.situacao).toBe('dia_nao_util');
    const cob: MetaDoDia[] = [dom({ indicador: 'cobertura_pct', meta_mes: 8000, realizado_ate_ontem: 6000 }), dom({ indicador: 'cobertura_pct', meta_mes: 10000, realizado_ate_ontem: 8000 })];
    const eq = metaDoDiaDaEquipe('cobertura_pct', cob)!;
    expect(eq.situacao).toBe('do_mes');
    expect(eq.meta_dia).toBeNull();
    expect(eq.membros).toBe(2);
  });
});
