import { describe, expect, it } from 'vitest';
import { horasUteisEntre, instanteDoHorarioLocal, somarHorasUteis } from './horario-comercial';
import { PARAMETROS_PADRAO, resolverParametros } from './parametros';

// Calendário de referência: 30/10/2026 é sexta; 31/10 sábado; 01/11 domingo; 02/11 segunda; 04/11 quarta.
// Manaus = UTC−4 o ano todo; São Paulo = UTC−3; Nova York sai do horário de verão em 01/11/2026 (EDT −4 → EST −5).
const MANAUS = PARAMETROS_PADRAO;
const SP = resolverParametros({ fuso: 'America/Sao_Paulo' });
const NY = resolverParametros({ fuso: 'America/New_York' });
const SEXTA_17H_MANAUS = '2026-10-30T21:00:00Z';

describe('RN-GES-03: horário comercial do tenant (padrão seg–sex 08:00–18:00, no fuso do tenant)', () => {
  it('padrão do tenant: segunda a sexta, 08:00 às 18:00', () => {
    expect(PARAMETROS_PADRAO.horario_comercial).toEqual({ dias_semana: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' });
  });

  it('converte horário local do tenant em instante UTC (Manaus −4, São Paulo −3, Nova York com e sem horário de verão)', () => {
    expect(instanteDoHorarioLocal('2026-10-30', '08:00', 'America/Manaus')).toBe(Date.parse('2026-10-30T12:00:00Z'));
    expect(instanteDoHorarioLocal('2026-10-30', '08:00', 'America/Sao_Paulo')).toBe(Date.parse('2026-10-30T11:00:00Z'));
    expect(instanteDoHorarioLocal('2026-10-30', '08:00', 'America/New_York')).toBe(Date.parse('2026-10-30T12:00:00Z')); // EDT
    expect(instanteDoHorarioLocal('2026-11-02', '08:00', 'America/New_York')).toBe(Date.parse('2026-11-02T13:00:00Z')); // EST
    expect(instanteDoHorarioLocal('2026-10-30', '24:00', 'America/Manaus')).toBe(Date.parse('2026-10-31T04:00:00Z'));
  });

  it('horas úteis dentro da mesma janela e fora dela', () => {
    expect(horasUteisEntre('2026-11-02T12:30:00Z', '2026-11-02T14:00:00Z', MANAUS)).toBe(1.5); // seg 08:30 → 10:00
    expect(horasUteisEntre('2026-11-02T10:00:00Z', '2026-11-02T12:00:00Z', MANAUS)).toBe(0); // seg 06:00 → 08:00 (antes de abrir)
    expect(horasUteisEntre('2026-11-02T12:00:00Z', '2026-11-03T12:00:00Z', MANAUS)).toBe(10); // 24 h corridas = 10 h úteis
  });

  it('virada de fim de semana: sexta 17:00 → segunda 09:00 = 2 h úteis (1 h na sexta + 1 h na segunda); sábado e domingo não contam', () => {
    expect(horasUteisEntre(SEXTA_17H_MANAUS, '2026-11-02T13:00:00Z', MANAUS)).toBe(2);
    expect(horasUteisEntre('2026-10-31T12:00:00Z', '2026-11-01T20:00:00Z', MANAUS)).toBe(0);
  });

  it('feriado do tenant não conta (02/11 feriado: sexta 17:00 → terça 09:00 = 2 h)', () => {
    const comFeriado = resolverParametros({ feriados: ['2026-11-02'] });
    expect(horasUteisEntre(SEXTA_17H_MANAUS, '2026-11-03T13:00:00Z', comFeriado)).toBe(2);
    expect(horasUteisEntre(SEXTA_17H_MANAUS, '2026-11-03T13:00:00Z', MANAUS)).toBe(12);
  });

  it('o resultado tem sinal: fim antes do início = negativo', () => {
    expect(horasUteisEntre('2026-11-02T13:00:00Z', SEXTA_17H_MANAUS, MANAUS)).toBe(-2);
    expect(horasUteisEntre(SEXTA_17H_MANAUS, SEXTA_17H_MANAUS, MANAUS)).toBe(0);
  });

  it('mudança de fuso: o mesmo instante dá horas úteis diferentes em Manaus e em São Paulo', () => {
    // 30/10 21:30Z = sexta 17:30 em Manaus (meia hora útil) e 18:30 em São Paulo (já fechou)
    // até 02/11 13:00Z = segunda 09:00 em Manaus (1 h) e 10:00 em São Paulo (2 h)
    expect(horasUteisEntre('2026-10-30T21:30:00Z', '2026-11-02T13:00:00Z', MANAUS)).toBe(1.5);
    expect(horasUteisEntre('2026-10-30T21:30:00Z', '2026-11-02T13:00:00Z', SP)).toBe(2);
  });

  it('mudança de fuso no calendário (fim do horário de verão de Nova York no domingo): continua 2 h úteis de sexta 17:00 a segunda 09:00', () => {
    // 65 h corridas no relógio UTC, mas só 1 h na sexta (EDT) + 1 h na segunda (EST)
    expect(horasUteisEntre('2026-10-30T21:00:00Z', '2026-11-02T14:00:00Z', NY)).toBe(2);
    expect(somarHorasUteis('2026-10-30T21:00:00Z', 2, NY)).toBe('2026-11-02T14:00:00.000Z');
  });

  it('somar horas úteis: sexta 17:00 + 1 h = sexta 18:00 (fecha a janela); + 8 h = segunda 15:00; + 24 h = quarta 11:00', () => {
    expect(somarHorasUteis(SEXTA_17H_MANAUS, 1, MANAUS)).toBe('2026-10-30T22:00:00.000Z');
    expect(somarHorasUteis(SEXTA_17H_MANAUS, 8, MANAUS)).toBe('2026-11-02T19:00:00.000Z');
    expect(somarHorasUteis(SEXTA_17H_MANAUS, 24, MANAUS)).toBe('2026-11-04T15:00:00.000Z');
  });

  it('pedido feito fora do horário começa a contar na abertura seguinte (sábado 10:00 + 2 h = segunda 10:00)', () => {
    expect(somarHorasUteis('2026-10-31T14:00:00Z', 2, MANAUS)).toBe('2026-11-02T14:00:00.000Z');
    expect(somarHorasUteis('2026-10-31T14:00:00Z', 0, MANAUS)).toBe('2026-10-31T14:00:00.000Z');
  });

  it('janela 24×7 (todos os dias, 00:00–24:00) equivale a horas corridas', () => {
    const corrido = resolverParametros({ horario_comercial: { dias_semana: [1, 2, 3, 4, 5, 6, 7], inicio: '00:00', fim: '24:00' } });
    expect(horasUteisEntre('2026-10-29T06:00:00Z', '2026-10-31T12:00:00Z', corrido)).toBe(54);
    expect(somarHorasUteis('2026-10-29T06:00:00Z', 24, corrido)).toBe('2026-10-30T06:00:00.000Z');
  });

  it('janela configurável: sábado 08:00–12:00 entra se o tenant incluir o dia 6', () => {
    const comSabado = resolverParametros({ horario_comercial: { dias_semana: [1, 2, 3, 4, 5, 6], inicio: '08:00', fim: '12:00' } });
    expect(horasUteisEntre(SEXTA_17H_MANAUS, '2026-11-02T13:00:00Z', comSabado)).toBe(5); // sábado 4 h + segunda 1 h
  });
});
