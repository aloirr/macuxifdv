import { describe, expect, it } from 'vitest';
import type { CalendarioTenant } from '../meta-do-dia';
import { calendarioDoPeriodo, diasUteisDoIntervalo } from './calendario';
import { datasDoIntervalo, mesesDoIntervalo, minutoDoDia, msDoDia, ultimoDiaDoMes } from './tempo';

const SEG_SEX: CalendarioTenant = { dias_uteis_semana: [1, 2, 3, 4, 5] };
const SEG_SAB: CalendarioTenant = { dias_uteis_semana: [1, 2, 3, 4, 5, 6] };

describe('RN-CORE-41: calendário das metas (calendarioDoPeriodo)', () => {
  it('RN-CORE-41 (D1, D4): novembro/2026 seg–sex com os nacionais (02/11 e 20/11): quinta 12/11 é o DU 8 de 19', () => {
    const c = calendarioDoPeriodo('2026-11-01', '2026-11-30', '2026-11-12', SEG_SEX);
    expect(c).toEqual({ du_total: 19, du_decorridos: 8, du_restantes: 12, du_hoje: 8 });
  });
  it('RN-CORE-41: novembro/2026 seg–sáb: 12/11 é o DU 9 de 23', () => {
    const c = calendarioDoPeriodo('2026-11-01', '2026-11-30', '2026-11-12', SEG_SAB);
    expect(c.du_total).toBe(23);
    expect(c.du_hoje).toBe(9);
  });
  it('RN-CORE-41 (D1): hoje útil conta nos decorridos e nos restantes: decorridos + restantes = total + 1', () => {
    const c = calendarioDoPeriodo('2026-04-01', '2026-04-30', '2026-04-14', SEG_SEX);
    expect(c).toEqual({ du_total: 20, du_decorridos: 9, du_restantes: 12, du_hoje: 9 });
    expect(c.du_decorridos + c.du_restantes).toBe(c.du_total + 1);
  });
  it('RN-CORE-41 (D4): os nacionais contam sempre, mesmo sem feriado do tenant cadastrado', () => {
    // Sexta-feira Santa 03/04/2026 e Tiradentes 21/04/2026 fora; abril seg–sex tem 22 dias de semana.
    expect(calendarioDoPeriodo('2026-04-01', '2026-04-30', '2026-04-01', SEG_SEX).du_total).toBe(20);
    expect(
      calendarioDoPeriodo('2026-04-01', '2026-04-30', '2026-04-01', { ...SEG_SEX, feriados: [] }).du_total,
    ).toBe(20);
  });
  it('RN-CORE-41: o feriado do tenant sai da conta, junto com os nacionais', () => {
    const c = calendarioDoPeriodo('2026-04-01', '2026-04-30', '2026-04-14', {
      ...SEG_SEX,
      feriados: ['2026-04-10'],
    });
    expect(c).toEqual({ du_total: 19, du_decorridos: 8, du_restantes: 12, du_hoje: 8 });
  });
  it('RN-CORE-41: hoje não útil (domingo) tem DU nulo e não entra nos restantes', () => {
    const c = calendarioDoPeriodo('2026-11-01', '2026-11-30', '2026-11-15', SEG_SAB);
    expect(c.du_hoje).toBeNull();
    expect(c.du_decorridos).toBe(11); // 3..14 sem o domingo 08 e o feriado 02 (15/11 é domingo)
    expect(c.du_restantes).toBe(12); // 16..30 sem 20 (feriado), 22 e 29 (domingos)
    expect(c.du_decorridos + c.du_restantes).toBe(c.du_total);
  });
  it('RN-CORE-41: período encerrado: todos decorridos e nenhum restante; período futuro: o contrário', () => {
    expect(calendarioDoPeriodo('2026-10-01', '2026-10-31', '2026-11-12', SEG_SEX)).toEqual({
      du_total: 21,
      du_decorridos: 21,
      du_restantes: 0,
      du_hoje: null,
    });
    expect(calendarioDoPeriodo('2026-12-01', '2026-12-31', '2026-11-12', SEG_SEX)).toEqual({
      du_total: 22,
      du_decorridos: 0,
      du_restantes: 22,
      du_hoje: null,
    });
  });
  it('RN-CORE-41: o último dia útil do mês ainda tem 1 restante (hoje conta)', () => {
    expect(calendarioDoPeriodo('2026-11-01', '2026-11-30', '2026-11-30', SEG_SEX).du_restantes).toBe(1);
  });
  it('RN-CORE-41: período fora do mês (semana) conta só os dias do intervalo', () => {
    expect(calendarioDoPeriodo('2026-11-09', '2026-11-15', '2026-11-12', SEG_SEX)).toEqual({
      du_total: 5,
      du_decorridos: 4,
      du_restantes: 2,
      du_hoje: 4,
    });
  });
  it('RN-CORE-41: datas invertidas ou inválidas dão erro', () => {
    expect(() => calendarioDoPeriodo('2026-11-30', '2026-11-01', '2026-11-12', SEG_SEX)).toThrow(RangeError);
    expect(() => calendarioDoPeriodo('2026-02-30', '2026-03-01', '2026-11-12', SEG_SEX)).toThrow(RangeError);
  });
  it('RN-CORE-41: diasUteisDoIntervalo devolve as datas em ordem', () => {
    expect(diasUteisDoIntervalo('2026-11-13', '2026-11-17', SEG_SEX)).toEqual([
      '2026-11-13',
      '2026-11-16',
      '2026-11-17',
    ]);
  });
});

describe('RN-CORE-41: datas e horas no fuso do tenant (§1.2)', () => {
  it('RN-CORE-41: minutoDoDia em Manaus (UTC−4): 11:52Z = 07:52 = 472', () => {
    expect(minutoDoDia('2026-11-12T11:52:00Z', 'America/Manaus')).toBe(472);
    expect(minutoDoDia('2026-11-12T11:52:00Z', 'America/Sao_Paulo')).toBe(532);
  });
  it('RN-CORE-41: minutoDoDia vai de 0 a 1439', () => {
    expect(minutoDoDia('2026-11-12T04:00:00Z', 'America/Manaus')).toBe(0);
    expect(minutoDoDia('2026-11-13T03:59:59Z', 'America/Manaus')).toBe(1439);
  });
  it('RN-CORE-41: msDoDia guarda os segundos', () => {
    expect(msDoDia('2026-11-12T16:00:30.500Z', 'America/Manaus')).toBe(12 * 3_600_000 + 30_500);
  });
  it('RN-CORE-41: instante inválido dá erro', () => {
    expect(() => minutoDoDia('ontem', 'America/Manaus')).toThrow(RangeError);
  });
  it('RN-CORE-41: datas, meses e último dia do mês', () => {
    expect(datasDoIntervalo('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(mesesDoIntervalo('2026-11-20', '2027-01-05')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(ultimoDiaDoMes('2028-02')).toBe('2028-02-29');
    expect(ultimoDiaDoMes('2026-12')).toBe('2026-12-31');
  });
});
