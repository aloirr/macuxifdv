/**
 * T-0170 — calendário da Performance (`calendarioDoPeriodo`, RN-CORE-41, D1 e D4), sem banco.
 * Roteiro e oráculo: docs/testes/T-0170-performance.md §2 (CAL-1 a CAL-10), contados à mão no calendário de novembro de 2026.
 * Divergência com o desenho fica em `it.fails` e vai por recado ao modulo-core.
 */
import { describe, expect, it } from 'vitest';

import { calendarioDoPeriodo, diasUteisDoIntervalo } from '../../modules/core/domain/performance/calendario';
import type { CalendarioTenant } from '../../modules/core/domain/meta-do-dia';

const SEG_SEX: CalendarioTenant = { dias_uteis_semana: [1, 2, 3, 4, 5], feriados: [] };
const SEG_SAB: CalendarioTenant = { dias_uteis_semana: [1, 2, 3, 4, 5, 6], feriados: [] };
const NOV = ['2026-11-01', '2026-11-30'] as const;

describe('T-0170 · calendário de novembro de 2026, segunda a sexta (RN-CORE-41)', () => {
  it.each([
    ['CAL-1 caso base, hoje no meio do mês', '2026-11-13', 19, 9, 11, 9],
    ['CAL-2 quinta 12/11 é o DU 8 de 19', '2026-11-12', 19, 8, 12, 8],
    ['CAL-3 feriado nacional 20/11 não é útil (D4)', '2026-11-20', 19, 13, 6, null],
    ['CAL-4 dia 1 num domingo', '2026-11-01', 19, 0, 19, null],
    ['CAL-5 último dia útil', '2026-11-30', 19, 19, 1, 19],
    ['CAL-6 sábado depois de hoje-útil', '2026-11-14', 19, 9, 10, null],
  ])('%s', (_caso, hoje, total, decorridos, restantes, duHoje) => {
    expect(calendarioDoPeriodo(NOV[0], NOV[1], hoje, SEG_SEX)).toEqual({
      du_total: total,
      du_decorridos: decorridos,
      du_restantes: restantes,
      du_hoje: duHoje,
    });
  });

  it('CAL-1 · D1: em dia útil, hoje conta nos decorridos e nos restantes (9 + 11 = 19 + 1)', () => {
    const c = calendarioDoPeriodo(NOV[0], NOV[1], '2026-11-13', SEG_SEX);
    expect(c.du_decorridos + c.du_restantes).toBe(c.du_total + 1);
  });

  it('CAL-7 · outubro (Mês passado) com hoje 13/11: 21 DU (12/10 é feriado), 0 restantes, du_hoje nulo', () => {
    expect(calendarioDoPeriodo('2026-10-01', '2026-10-31', '2026-11-13', SEG_SEX)).toEqual({
      du_total: 21,
      du_decorridos: 21,
      du_restantes: 0,
      du_hoje: null,
    });
  });

  it('CAL-8 · Esta semana 09–15/11: 5 DU, 5 decorridos, 1 restante (13/11)', () => {
    const c = calendarioDoPeriodo('2026-11-09', '2026-11-15', '2026-11-13', SEG_SEX);
    expect([c.du_total, c.du_decorridos, c.du_restantes]).toEqual([5, 5, 1]);
  });

  // D-T0170-CAL8 encerrado pelo desenho §11.2 (era it.fails): du_hoje é a posição de hoje entre os dias úteis do período.
  // No mês coincide com o "DU 9" do Início; na semana a tela mostra "DU 5 de 5 · 1 restante".
  it('CAL-8 · RN-CORE-41: du_hoje é a posição no período (5 na semana 09–15/11)', () => {
    expect(calendarioDoPeriodo('2026-11-09', '2026-11-15', '2026-11-13', SEG_SEX).du_hoje).toBe(5);
  });

  it('CAL-9 · segunda a sábado: quinta 12/11 é o DU 9 de 23, com 15 restantes', () => {
    expect(calendarioDoPeriodo(NOV[0], NOV[1], '2026-11-12', SEG_SAB)).toEqual({
      du_total: 23,
      du_decorridos: 9,
      du_restantes: 15,
      du_hoje: 9,
    });
  });

  it('CAL-10 · D4: sem feriado do tenant, 02/11 e 20/11 continuam fora dos dias úteis (19, nunca 21)', () => {
    const uteis = diasUteisDoIntervalo(NOV[0], NOV[1], { dias_uteis_semana: [1, 2, 3, 4, 5] });
    expect(uteis).toHaveLength(19);
    expect(uteis).not.toContain('2026-11-02');
    expect(uteis).not.toContain('2026-11-20');
  });
});
