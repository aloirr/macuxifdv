import { describe, expect, it } from 'vitest';
import { ehDiaUtil, horasUteisEntre, inicioDaContagem, instanteDoHorarioLocal, somarDiasUteis, somarHorasUteis } from './horario-comercial';
import { PARAMETROS_PADRAO, resolverParametros } from './parametros';

// Calendário de referência: 06/11/2026 é sexta; 07/11 sábado; 08/11 domingo; 09/11 segunda; 10/11 terça; 11/11 quarta.
// ATENÇÃO: 02/11/2026 (segunda) é Finados, feriado nacional: não serve de "segunda comum".
// Manaus = UTC−4 o ano todo; São Paulo = UTC−3; Nova York tem horário de verão (EDT −4 / EST −5; termina em 01/11/2026 e
// recomeça em 14/03/2027).
const MANAUS = PARAMETROS_PADRAO;
const SP = resolverParametros({ fuso: 'America/Sao_Paulo' });
const NY = resolverParametros({ fuso: 'America/New_York' });
const SEXTA_17H_MANAUS = '2026-11-06T21:00:00Z';

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
    expect(horasUteisEntre('2026-11-09T12:30:00Z', '2026-11-09T14:00:00Z', MANAUS)).toBe(1.5); // seg 08:30 → 10:00
    expect(horasUteisEntre('2026-11-09T10:00:00Z', '2026-11-09T12:00:00Z', MANAUS)).toBe(0); // seg 06:00 → 08:00 (antes de abrir)
    expect(horasUteisEntre('2026-11-09T12:00:00Z', '2026-11-10T12:00:00Z', MANAUS)).toBe(10); // 24 h corridas = 10 h úteis
  });

  it('virada de fim de semana: sexta 17:00 → segunda 09:00 = 2 h úteis (1 h na sexta + 1 h na segunda); sábado e domingo não contam', () => {
    expect(horasUteisEntre(SEXTA_17H_MANAUS, '2026-11-09T13:00:00Z', MANAUS)).toBe(2);
    expect(horasUteisEntre('2026-11-07T12:00:00Z', '2026-11-08T20:00:00Z', MANAUS)).toBe(0);
  });

  it('feriado do tenant não conta (09/11 feriado: sexta 17:00 → terça 09:00 = 2 h)', () => {
    const comFeriado = resolverParametros({ feriados: ['2026-11-09'] });
    expect(horasUteisEntre(SEXTA_17H_MANAUS, '2026-11-10T13:00:00Z', comFeriado)).toBe(2);
    expect(horasUteisEntre(SEXTA_17H_MANAUS, '2026-11-10T13:00:00Z', MANAUS)).toBe(12);
  });

  it('feriado nacional não conta mesmo sem cadastro no tenant (Finados, segunda 02/11: sexta 17:00 → terça 09:00 = 2 h)', () => {
    expect(horasUteisEntre('2026-10-30T21:00:00Z', '2026-11-03T13:00:00Z', MANAUS)).toBe(2);
  });

  it('o resultado tem sinal: fim antes do início = negativo', () => {
    expect(horasUteisEntre('2026-11-09T13:00:00Z', SEXTA_17H_MANAUS, MANAUS)).toBe(-2);
    expect(horasUteisEntre(SEXTA_17H_MANAUS, SEXTA_17H_MANAUS, MANAUS)).toBe(0);
  });

  it('mudança de fuso: o mesmo instante dá horas úteis diferentes em Manaus e em São Paulo', () => {
    // 06/11 21:30Z = sexta 17:30 em Manaus (meia hora útil) e 18:30 em São Paulo (já fechou)
    // até 09/11 13:00Z = segunda 09:00 em Manaus (1 h) e 10:00 em São Paulo (2 h)
    expect(horasUteisEntre('2026-11-06T21:30:00Z', '2026-11-09T13:00:00Z', MANAUS)).toBe(1.5);
    expect(horasUteisEntre('2026-11-06T21:30:00Z', '2026-11-09T13:00:00Z', SP)).toBe(2);
  });

  it('mudança de fuso no calendário (início do horário de verão de Nova York, domingo 14/03/2027): sexta 17:00 → segunda 09:00 continua 2 h úteis', () => {
    // sexta 17:00 EST = 22:00Z; segunda 09:00 EDT = 13:00Z (63 h corridas, mas só 1 h na sexta + 1 h na segunda)
    expect(horasUteisEntre('2027-03-12T22:00:00Z', '2027-03-15T13:00:00Z', NY)).toBe(2);
    expect(somarHorasUteis('2027-03-12T22:00:00Z', 2, NY)).toBe('2027-03-15T13:00:00.000Z');
  });

  it('somar horas úteis: sexta 17:00 + 1 h = sexta 18:00 (fecha a janela); + 8 h = segunda 15:00; + 24 h = quarta 11:00', () => {
    expect(somarHorasUteis(SEXTA_17H_MANAUS, 1, MANAUS)).toBe('2026-11-06T22:00:00.000Z');
    expect(somarHorasUteis(SEXTA_17H_MANAUS, 8, MANAUS)).toBe('2026-11-09T19:00:00.000Z');
    expect(somarHorasUteis(SEXTA_17H_MANAUS, 24, MANAUS)).toBe('2026-11-11T15:00:00.000Z');
  });

  it('pedido feito fora do horário começa a contar na abertura seguinte (sábado 10:00 + 2 h = segunda 10:00)', () => {
    expect(somarHorasUteis('2026-11-07T14:00:00Z', 2, MANAUS)).toBe('2026-11-09T14:00:00.000Z');
    expect(somarHorasUteis('2026-11-07T14:00:00Z', 0, MANAUS)).toBe('2026-11-07T14:00:00.000Z');
  });

  it('janela 24×7 (todos os dias, 00:00–24:00) equivale a horas corridas', () => {
    const corrido = resolverParametros({ horario_comercial: { dias_semana: [1, 2, 3, 4, 5, 6, 7], inicio: '00:00', fim: '24:00' } });
    expect(horasUteisEntre('2026-10-29T06:00:00Z', '2026-10-31T12:00:00Z', corrido)).toBe(54);
    expect(somarHorasUteis('2026-10-29T06:00:00Z', 24, corrido)).toBe('2026-10-30T06:00:00.000Z');
  });

  it('janela configurável: sábado 08:00–12:00 entra se o tenant incluir o dia 6', () => {
    const comSabado = resolverParametros({ horario_comercial: { dias_semana: [1, 2, 3, 4, 5, 6], inicio: '08:00', fim: '12:00' }, aprovacao_aviso_horas: 2 });
    expect(horasUteisEntre(SEXTA_17H_MANAUS, '2026-11-09T13:00:00Z', comSabado)).toBe(5); // sábado 4 h + segunda 1 h
  });
});

describe('RN-GES-03: dia útil = dia da semana do horário comercial, sem feriado nacional nem do tenant', () => {
  it('segunda a sexta comuns são úteis; sábado e domingo não', () => {
    expect(ehDiaUtil('2026-11-06', MANAUS)).toBe(true); // sexta
    expect(ehDiaUtil('2026-11-07', MANAUS)).toBe(false); // sábado
    expect(ehDiaUtil('2026-11-08', MANAUS)).toBe(false); // domingo
    expect(ehDiaUtil('2026-11-09', MANAUS)).toBe(true); // segunda
  });

  it('feriado do tenant e feriado nacional tiram o dia útil', () => {
    expect(ehDiaUtil('2026-11-09', resolverParametros({ feriados: ['2026-11-09'] }))).toBe(false);
    expect(ehDiaUtil('2026-11-02', MANAUS)).toBe(false); // Finados
    expect(ehDiaUtil('2026-09-07', MANAUS)).toBe(false); // Independência (segunda)
    expect(ehDiaUtil('2026-04-03', MANAUS)).toBe(false); // Sexta-feira Santa
    expect(ehDiaUtil('2026-04-06', MANAUS)).toBe(true); // segunda depois da Páscoa
  });

  it('o tenant que trabalha no sábado (dia 6) tem sábado útil, exceto se for feriado', () => {
    const comSabado = resolverParametros({ horario_comercial: { dias_semana: [1, 2, 3, 4, 5, 6], inicio: '08:00', fim: '12:00' }, aprovacao_aviso_horas: 2 });
    expect(ehDiaUtil('2026-11-07', comSabado)).toBe(true);
    expect(ehDiaUtil('2026-11-08', comSabado)).toBe(false); // domingo não está na lista
    expect(ehDiaUtil('2026-11-07', resolverParametros({ feriados: ['2026-11-07'], horario_comercial: comSabado.horario_comercial, aprovacao_aviso_horas: 2 }))).toBe(false);
    expect(ehDiaUtil('2026-05-01', resolverParametros({ horario_comercial: { dias_semana: [1, 2, 3, 4, 5, 6], inicio: '08:00', fim: '12:00' }, aprovacao_aviso_horas: 2 }))).toBe(false); // sexta, Dia do Trabalho
    expect(ehDiaUtil('2026-09-12', comSabado)).toBe(true); // sábado comum
  });
});

describe('RN-GES-03: início da contagem do prazo (fora do expediente conta da próxima abertura)', () => {
  const ini = (iso: string, cal = MANAUS) => new Date(inicioDaContagem(iso, cal)).toISOString();

  it('dentro do expediente o início é o próprio instante', () => {
    expect(ini(SEXTA_17H_MANAUS)).toBe('2026-11-06T21:00:00.000Z');
    expect(ini('2026-11-09T12:00:00Z')).toBe('2026-11-09T12:00:00.000Z'); // abertura exata (segunda 08:00)
  });

  it('antes de abrir: abertura do mesmo dia; depois de fechar (18:00 exato já é fora) ou no fim de semana: próxima abertura útil', () => {
    expect(ini('2026-11-09T10:00:00Z')).toBe('2026-11-09T12:00:00.000Z'); // segunda 06:00 → 08:00
    expect(ini('2026-11-06T22:00:00Z')).toBe('2026-11-09T12:00:00.000Z'); // sexta 18:00 → segunda 08:00
    expect(ini('2026-11-06T23:00:00Z')).toBe('2026-11-09T12:00:00.000Z'); // sexta 19:00
    expect(ini('2026-11-07T14:00:00Z')).toBe('2026-11-09T12:00:00.000Z'); // sábado 10:00
  });

  it('feriado empurra a abertura: sábado antes de Finados abre na terça 08:00', () => {
    expect(ini('2026-10-31T14:00:00Z')).toBe('2026-11-03T12:00:00.000Z');
  });
});

describe('RN-GES-03: prazo em DIAS úteis (mesmo horário local do N-ésimo dia útil seguinte)', () => {
  const prazo = (iso: string, dias: number, cal = MANAUS) => somarDiasUteis(iso, dias, cal);

  it('sexta 17:00 + 1 dia útil vence segunda 17:00 (não terça, não sábado)', () => {
    expect(prazo(SEXTA_17H_MANAUS, 1)).toBe('2026-11-09T21:00:00.000Z');
  });

  it('quinta 10:00 + 1 dia útil vence sexta 10:00; + 2 dias vence segunda 10:00', () => {
    expect(prazo('2026-11-05T14:00:00Z', 1)).toBe('2026-11-06T14:00:00.000Z');
    expect(prazo('2026-11-05T14:00:00Z', 2)).toBe('2026-11-09T14:00:00.000Z');
  });

  it('sexta 17:00 + 2 dias úteis vence terça 17:00; + 0 dia devolve o início da contagem', () => {
    expect(prazo(SEXTA_17H_MANAUS, 2)).toBe('2026-11-10T21:00:00.000Z');
    expect(prazo(SEXTA_17H_MANAUS, 0)).toBe('2026-11-06T21:00:00.000Z');
  });

  it('preserva minutos e segundos do horário local', () => {
    expect(prazo('2026-11-06T21:07:30Z', 1)).toBe('2026-11-09T21:07:30.000Z');
  });

  it('pedido de sábado 10:00 conta a partir de segunda 08:00 e vence terça 08:00', () => {
    expect(prazo('2026-11-07T14:00:00Z', 1)).toBe('2026-11-10T12:00:00.000Z');
  });

  it('pedido de sexta 19:00 (fora do expediente) conta a partir de segunda 08:00 e vence terça 08:00; sexta 18:00 exato idem', () => {
    expect(prazo('2026-11-06T23:00:00Z', 1)).toBe('2026-11-10T12:00:00.000Z');
    expect(prazo('2026-11-06T22:00:00Z', 1)).toBe('2026-11-10T12:00:00.000Z');
  });

  it('pedido antes de abrir (segunda 06:00) conta a partir das 08:00 e vence terça 08:00', () => {
    expect(prazo('2026-11-09T10:00:00Z', 1)).toBe('2026-11-10T12:00:00.000Z');
  });

  it('feriado do TENANT na segunda empurra o prazo para terça: sexta 17:00 vence terça 17:00', () => {
    expect(prazo(SEXTA_17H_MANAUS, 1, resolverParametros({ feriados: ['2026-11-09'] }))).toBe('2026-11-10T21:00:00.000Z');
  });

  it('feriado NACIONAL na segunda empurra o prazo para terça (Finados 02/11 e Independência 07/09)', () => {
    expect(prazo('2026-10-30T21:00:00Z', 1)).toBe('2026-11-03T21:00:00.000Z'); // sexta 30/10 17:00 → terça 03/11 17:00
    expect(prazo('2026-09-04T21:00:00Z', 1)).toBe('2026-09-08T21:00:00.000Z'); // sexta 04/09 17:00 → terça 08/09 17:00
  });

  it('nacional ∪ tenant: Finados + feriado do tenant na terça → vence quarta', () => {
    expect(prazo('2026-10-30T21:00:00Z', 1, resolverParametros({ feriados: ['2026-11-03'] }))).toBe('2026-11-04T21:00:00.000Z');
  });

  it('pedido feito num feriado (Sexta-feira Santa 03/04/2026 10:00) conta da próxima abertura útil e vence terça 08:00', () => {
    expect(prazo('2026-04-03T14:00:00Z', 1)).toBe('2026-04-07T12:00:00.000Z');
  });

  it('fuso do tenant: sexta 21:00Z é 17:00 em Manaus (vence segunda 17:00) e 18:00 em São Paulo (já fechou: vence terça 08:00 local)', () => {
    expect(prazo(SEXTA_17H_MANAUS, 1, MANAUS)).toBe('2026-11-09T21:00:00.000Z');
    expect(prazo(SEXTA_17H_MANAUS, 1, SP)).toBe('2026-11-10T11:00:00.000Z'); // terça 08:00 em São Paulo (UTC−3)
    expect(prazo('2026-11-06T20:00:00Z', 1, SP)).toBe('2026-11-09T20:00:00.000Z'); // sexta 17:00 em São Paulo → segunda 17:00 SP
  });

  it('o mesmo pedido de sábado (14:00Z) vence terça 08:00 no relógio de cada fuso: 12:00Z em Manaus, 11:00Z em São Paulo', () => {
    expect(prazo('2026-11-07T14:00:00Z', 1, MANAUS)).toBe('2026-11-10T12:00:00.000Z');
    expect(prazo('2026-11-07T14:00:00Z', 1, SP)).toBe('2026-11-10T11:00:00.000Z');
  });

  it('fuso com horário de verão: o prazo mantém o horário LOCAL (a hora UTC muda quando o verão começa ou termina)', () => {
    // verão começa em 14/03/2027: sexta 17:00 EST (22:00Z) → segunda 17:00 EDT (21:00Z)
    expect(prazo('2027-03-12T22:00:00Z', 1, NY)).toBe('2027-03-15T21:00:00.000Z');
    // verão termina em 01/11/2026: sexta 17:00 EDT (21:00Z) → (segunda é Finados) terça 17:00 EST (22:00Z)
    expect(prazo('2026-10-30T21:00:00Z', 1, NY)).toBe('2026-11-03T22:00:00.000Z');
  });

  it('janela 24×7 (todos os dias): +1 dia útil = +24 h corridas no mesmo horário local', () => {
    const corrido = resolverParametros({ horario_comercial: { dias_semana: [1, 2, 3, 4, 5, 6, 7], inicio: '00:00', fim: '24:00' } });
    expect(prazo('2026-10-29T06:00:00Z', 1, corrido)).toBe('2026-10-30T06:00:00.000Z');
  });

  it('tenant que trabalha no sábado: sexta 11:00 + 1 dia útil vence sábado 11:00 (dentro da janela 08:00–12:00)', () => {
    const comSabado = resolverParametros({ horario_comercial: { dias_semana: [1, 2, 3, 4, 5, 6], inicio: '08:00', fim: '12:00' }, aprovacao_aviso_horas: 2 });
    expect(prazo('2026-11-06T15:00:00Z', 1, comSabado)).toBe('2026-11-07T15:00:00.000Z');
  });

  it('quantidade de dias negativa ou fracionária é recusada em português', () => {
    expect(() => prazo(SEXTA_17H_MANAUS, -1)).toThrow(/dias úteis/);
    expect(() => prazo(SEXTA_17H_MANAUS, 1.5)).toThrow(/dias úteis/);
  });
});
