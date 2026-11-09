import { describe, expect, it } from 'vitest';
import {
  DIAS_UTEIS_PADRAO,
  businessDays,
  diasUteisDoPeriodo,
  diasUteisEntre,
  diffDays,
  ehDiaUtilDoTenant,
  ehFeriado,
  isBusinessDay,
  localDate,
  prazoEmDiasUteis,
  somarDiasUteis,
} from './calendar';

describe('businessDays', () => {
  it('outubro/2026 com feriado de 12/10: 21 úteis, 14 restantes no dia 12', () => {
    expect(businessDays('2026-10', '2026-10-12', ['2026-10-12'])).toEqual({ total: 21, elapsed: 7, remaining: 14 });
  });
  it('sem feriados: 22 úteis', () => {
    expect(businessDays('2026-10', '2026-10-01').total).toBe(22);
    expect(businessDays('2026-10', '2026-10-01').elapsed).toBe(0);
  });
  it('mês encerrado: nada restante', () => {
    expect(businessDays('2026-09', '2026-10-05').remaining).toBe(0);
  });
});

describe('datas', () => {
  it('localDate em Manaus (UTC-4)', () => {
    expect(localDate(new Date('2026-10-13T02:30:00Z'))).toBe('2026-10-12');
  });
  it('diffDays', () => {
    expect(diffDays('2026-10-01', '2026-10-12')).toBe(11);
    expect(diffDays('2026-10-12T09:00:00', '2026-10-01')).toBe(-11);
  });
});

// ===== T-0105 / RN-GES-03 — feriados no calendário (valores esperados escritos à mão) =====
// 2026-02-13 sexta (véspera de Carnaval: 16 e 17/02); 2026-04-03 Sexta-feira Santa; 2026-06-04 Corpus Christi (quinta);
// 2027-01-01 sexta; 2028-01-01 sábado; 2027-10-25 segunda (usada como feriado municipal do tenant).

describe('API pública de @macuxi/comum (T-0105)', () => {
  it('expõe os feriados pelo índice e por /calendar; somarDias fica interno', async () => {
    const indice = await import('./index');
    const calendario = await import('./calendar');
    for (const nome of ['pascoa', 'feriadosNacionais', 'feriadosNacionaisDoAno', 'ehFeriadoNacional', 'nomeDoFeriadoNacional',
      'ehDataCivil', 'exigirDataCivil', 'ehFeriado', 'ehDiaUtilDoTenant', 'somarDiasUteis', 'diasUteisEntre', 'diasUteisDoPeriodo', 'prazoEmDiasUteis']) {
      expect(typeof (indice as Record<string, unknown>)[nome], nome).toBe('function');
      expect(typeof (calendario as Record<string, unknown>)[nome], nome).toBe('function');
    }
    expect('somarDias' in indice).toBe(false);
    expect(indice.DIAS_UTEIS_PADRAO).toBe(calendario.DIAS_UTEIS_PADRAO);
  });
});

describe('isBusinessDay / businessDays não mudam (lista só da empresa)', () => {
  it('feriado nacional fora da lista continua útil', () => {
    expect(isBusinessDay('2026-02-16', new Set())).toBe(true);
    expect(businessDays('2026-02', '2026-02-01').total).toBe(20);
  });
});

describe('ehFeriado', () => {
  it('nacional ou do tenant, em qualquer dia da semana', () => {
    expect(ehFeriado('2026-02-16')).toBe(true);
    expect(ehFeriado('2027-10-25')).toBe(false);
    expect(ehFeriado('2027-10-25', ['2027-10-25'])).toBe(true);
    expect(ehFeriado('2026-10-24', ['2026-10-24'])).toBe(true); // sábado
    expect(() => ehFeriado('2026-02-30')).toThrow(/Data inválida/);
  });
});

describe('ehDiaUtilDoTenant', () => {
  it('sem lista = comportamento antigo (feriado nacional conta como útil)', () => {
    expect(ehDiaUtilDoTenant('2026-02-16')).toBe(true);
    expect(ehDiaUtilDoTenant('2026-02-14')).toBe(false); // sábado
    expect(ehDiaUtilDoTenant('2026-02-15')).toBe(false); // domingo
  });
  it('com [] pula os nacionais', () => {
    expect(ehDiaUtilDoTenant('2026-02-16', [])).toBe(false);
    expect(ehDiaUtilDoTenant('2026-04-03', [])).toBe(false);
    expect(ehDiaUtilDoTenant('2026-02-18', [])).toBe(true); // Quarta de Cinzas
  });
  it('com lista do tenant pula também os do tenant', () => {
    expect(ehDiaUtilDoTenant('2027-10-25', [])).toBe(true);
    expect(ehDiaUtilDoTenant('2027-10-25', ['2027-10-25'])).toBe(false);
    expect(ehDiaUtilDoTenant('2027-10-25', new Set(['2027-10-25']))).toBe(false); // qualquer Iterable
  });
  it('entrada inválida na lista do tenant dá erro', () => {
    expect(() => ehDiaUtilDoTenant('2027-10-26', ['2027-10-25', '25/10/2027'])).toThrow('Data inválida: 25/10/2027 (use AAAA-MM-DD).');
    expect(() => ehDiaUtilDoTenant('2027-10-26', ['2027-02-29'])).toThrow(/Data inválida/);
    expect(() => ehDiaUtilDoTenant('2027-10-26', '2027-10-25' as unknown as string[])).toThrow(/lista de datas/);
  });
});

describe('somarDiasUteis (RN-GES-03)', () => {
  it('sexta + 1 = segunda', () => {
    expect(somarDiasUteis('2026-11-06', 1, [])).toBe('2026-11-09');
    expect(somarDiasUteis('2026-11-06', 1)).toBe('2026-11-09');
  });
  it('véspera de Carnaval: com lista pula 16 e 17/02; sem lista, não', () => {
    expect(somarDiasUteis('2026-02-13', 1, [])).toBe('2026-02-18');
    expect(somarDiasUteis('2026-02-13', 1)).toBe('2026-02-16');
    expect(somarDiasUteis('2026-02-13', 3, [])).toBe('2026-02-20');
  });
  it('Carnaval em ano bissexto (28 e 29/02/2028)', () => {
    expect(somarDiasUteis('2028-02-25', 1, [])).toBe('2028-03-01');
  });
  it('Sexta-feira Santa e Corpus Christi', () => {
    expect(somarDiasUteis('2026-04-02', 1, [])).toBe('2026-04-06');
    expect(somarDiasUteis('2026-04-02', 1)).toBe('2026-04-03');
    expect(somarDiasUteis('2026-06-03', 1, [])).toBe('2026-06-05');
  });
  it('feriado do tenant em dia de semana', () => {
    expect(somarDiasUteis('2027-10-22', 1, [])).toBe('2027-10-25');
    expect(somarDiasUteis('2027-10-22', 1, ['2027-10-25'])).toBe('2027-10-26');
  });
  it('virada de ano', () => {
    expect(somarDiasUteis('2026-12-31', 1, [])).toBe('2027-01-04');
    expect(somarDiasUteis('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDiasUteis('2027-12-31', 1, [])).toBe('2028-01-03');
  });
  it('dias = 0 devolve a própria data, mesmo sendo feriado', () => {
    expect(somarDiasUteis('2026-02-16', 0, [])).toBe('2026-02-16');
  });
  it('dias negativo, fracionário ou grande demais dá erro', () => {
    expect(() => somarDiasUteis('2026-02-13', -1, [])).toThrow('Informe uma quantidade inteira e não negativa de dias úteis.');
    expect(() => somarDiasUteis('2026-02-13', 1.5, [])).toThrow(/inteira e não negativa/);
    expect(() => somarDiasUteis('2026-02-13', Number.NaN)).toThrow(/inteira e não negativa/);
    expect(() => somarDiasUteis('2026-02-13', 2_601)).toThrow(/Prazo grande demais/);
    expect(() => somarDiasUteis('13/02/2026', 1)).toThrow(/Data inválida/);
  });
});

describe('diasUteisEntre', () => {
  it('conta (a, b]', () => {
    expect(diasUteisEntre('2026-02-13', '2026-02-18', [])).toBe(1);
    expect(diasUteisEntre('2026-02-13', '2026-02-18')).toBe(3);
    expect(diasUteisEntre('2026-02-18', '2026-02-13', [])).toBe(-1);
    expect(diasUteisEntre('2026-02-13', '2026-02-13', [])).toBe(0);
    expect(diasUteisEntre('2026-12-31', '2027-01-04', [])).toBe(1);
    expect(Object.is(diasUteisEntre('2026-02-15', '2026-02-14'), 0)).toBe(true); // domingo → sábado: 0, não -0
  });
  it('é o inverso de somarDiasUteis (e negativo invertido)', () => {
    for (const lista of [undefined, [], ['2027-10-25', '2026-10-24']]) {
      for (const a of ['2026-02-13', '2026-12-31', '2027-10-22', '2028-02-26']) {
        for (let n = 0; n <= 40; n++) {
          const b = somarDiasUteis(a, n, lista);
          expect(diasUteisEntre(a, b, lista)).toBe(n);
          expect(diasUteisEntre(b, a, lista)).toBe(n === 0 ? 0 : -n);
        }
      }
    }
  }, 30_000); // varredura longa: 5 s estoura com a máquina carregada (7 agentes)
  it('intervalo grande demais ou data inválida dá erro', () => {
    expect(() => diasUteisEntre('2000-01-01', '2030-01-01')).toThrow(/Intervalo grande demais/);
    expect(() => diasUteisEntre('2026-01-01', '2026-02-30')).toThrow(/Data inválida/);
  });
});

describe('prazoEmDiasUteis (fuso do tenant)', () => {
  it('31/12 23:30 em Manaus (= 01/01 03:30Z) + 1 dia útil = segunda 04/01/2027', () => {
    expect(prazoEmDiasUteis('2027-01-01T03:30:00Z', 1, { feriados: [] })).toBe('2027-01-04');
    // em UTC começa em 01/01 (feriado) e também vence 04/01
    expect(prazoEmDiasUteis('2027-01-01T03:30:00Z', 1, { feriados: [], fuso: 'UTC' })).toBe('2027-01-04');
  });
  it('mesmo instante, fusos diferentes, vencimentos diferentes', () => {
    // 2026-02-13T03:30Z = quinta 12/02 23:30 em Manaus → +1 = sexta 13/02; em UTC é sexta 13/02 → +1 = quarta 18/02
    expect(prazoEmDiasUteis('2026-02-13T03:30:00Z', 1, { feriados: [] })).toBe('2026-02-13');
    expect(prazoEmDiasUteis('2026-02-13T03:30:00Z', 1, { feriados: [], fuso: 'UTC' })).toBe('2026-02-18');
    expect(prazoEmDiasUteis('2026-02-12T23:30:00-04:00', 1, { feriados: [], fuso: 'America/Manaus' })).toBe('2026-02-13');
  });
  it('aceita Date e epoch; sem lista só pula fim de semana', () => {
    expect(prazoEmDiasUteis(new Date('2026-11-06T21:00:00Z'), 1, { feriados: [] })).toBe('2026-11-09'); // sexta 17:00
    expect(prazoEmDiasUteis(Date.parse('2026-02-13T15:00:00Z'), 1)).toBe('2026-02-16');
    expect(prazoEmDiasUteis('2026-02-13T15:00:00Z', 1, { feriados: ['2026-02-18'] })).toBe('2026-02-19');
  });
  it('instante ou fuso inválido dá erro', () => {
    expect(() => prazoEmDiasUteis('ontem', 1)).toThrow(/Instante inválido: ontem/);
    expect(() => prazoEmDiasUteis('2026-02-13T10:00:00', 1)).toThrow(/Instante inválido/); // sem fuso
    expect(() => prazoEmDiasUteis('2026-02-13', 1)).toThrow(/Instante inválido/); // data civil: use somarDiasUteis
    expect(() => prazoEmDiasUteis(new Date('x'), 1)).toThrow(/Instante inválido/);
    expect(() => prazoEmDiasUteis(Number.NaN, 1)).toThrow(/Instante inválido/);
    expect(() => prazoEmDiasUteis('2026-02-13T15:00:00Z', 1, { fuso: 'Marte/Base' })).toThrow(/Fuso inválido: Marte\/Base/);
    expect(() => prazoEmDiasUteis('2026-02-13T15:00:00Z', -1)).toThrow(/inteira e não negativa/);
  });
});

// ===== Semana útil do tenant (decisão do dono do produto: padrão seg–sex, alterável no BKO) =====
// 0 = domingo … 6 = sábado. 2026-11-06 sexta, 2026-11-07 sábado, 2026-11-09 segunda; 2027-04-30 sexta,
// 2027-05-01 sábado (Dia do Trabalho), 2027-05-03 segunda.
const SEG_SAB = [1, 2, 3, 4, 5, 6] as const;

describe('semana útil do tenant', () => {
  it('padrão = segunda a sexta, congelado', () => {
    expect(DIAS_UTEIS_PADRAO).toEqual([1, 2, 3, 4, 5]);
    expect(Object.isFrozen(DIAS_UTEIS_PADRAO)).toBe(true);
    expect(ehDiaUtilDoTenant('2026-11-07')).toBe(false); // sábado
    expect(ehDiaUtilDoTenant('2026-11-07', [], DIAS_UTEIS_PADRAO)).toBe(false);
    expect(somarDiasUteis('2026-11-06', 1, [], DIAS_UTEIS_PADRAO)).toBe('2026-11-09');
  });
  it('segunda a sábado: sexta + 1 = sábado; sábado + 1 = segunda', () => {
    expect(ehDiaUtilDoTenant('2026-11-07', [], SEG_SAB)).toBe(true);
    expect(ehDiaUtilDoTenant('2026-11-08', [], SEG_SAB)).toBe(false); // domingo
    expect(somarDiasUteis('2026-11-06', 1, [], SEG_SAB)).toBe('2026-11-07');
    expect(somarDiasUteis('2026-11-07', 1, [], SEG_SAB)).toBe('2026-11-09');
    expect(somarDiasUteis('2026-11-06', 1, undefined, SEG_SAB)).toBe('2026-11-07');
  });
  it('feriado nacional num sábado útil só é pulado com a lista informada', () => {
    expect(ehDiaUtilDoTenant('2027-05-01', undefined, SEG_SAB)).toBe(true);
    expect(ehDiaUtilDoTenant('2027-05-01', [], SEG_SAB)).toBe(false);
    expect(somarDiasUteis('2027-04-30', 1, undefined, SEG_SAB)).toBe('2027-05-01');
    expect(somarDiasUteis('2027-04-30', 1, [], SEG_SAB)).toBe('2027-05-03');
    // feriado do tenant num sábado útil
    expect(somarDiasUteis('2026-11-06', 1, ['2026-11-07'], SEG_SAB)).toBe('2026-11-09');
  });
  it('semana sem segunda (ter–sáb) e semana de um dia só', () => {
    expect(somarDiasUteis('2026-11-07', 1, [], [2, 3, 4, 5, 6])).toBe('2026-11-10'); // sábado → terça
    // só domingo: 08, 15 (Proclamação da República, feriado nacional), 22 e 29/11
    expect(somarDiasUteis('2026-11-06', 2, undefined, [0])).toBe('2026-11-15');
    expect(somarDiasUteis('2026-11-06', 2, [], [0])).toBe('2026-11-22');
    expect(diasUteisEntre('2026-11-01', '2026-11-30', undefined, [0])).toBe(4);
    expect(diasUteisEntre('2026-11-01', '2026-11-30', [], [0])).toBe(3);
  });
  it('prazoEmDiasUteis respeita a semana do tenant', () => {
    // sexta 06/11 17:00 em Manaus
    expect(prazoEmDiasUteis('2026-11-06T21:00:00Z', 1, { feriados: [], diasUteisSemana: SEG_SAB })).toBe('2026-11-07');
    expect(prazoEmDiasUteis('2026-11-06T21:00:00Z', 1, { feriados: [] })).toBe('2026-11-09');
    expect(prazoEmDiasUteis('2027-04-30T21:00:00Z', 1, { feriados: [], diasUteisSemana: SEG_SAB })).toBe('2027-05-03');
  });
  it('diasUteisEntre é coerente com somarDiasUteis numa semana custom', () => {
    for (const semana of [SEG_SAB, [0, 3], [6]]) {
      for (const lista of [undefined, [], ['2026-11-07', '2027-10-25']]) {
        for (const a of ['2026-11-06', '2027-04-30', '2026-12-31']) {
          for (let n = 0; n <= 30; n++) {
            const b = somarDiasUteis(a, n, lista, semana);
            expect(diasUteisEntre(a, b, lista, semana)).toBe(n);
            expect(diasUteisEntre(b, a, lista, semana)).toBe(n === 0 ? 0 : -n);
          }
        }
      }
    }
  }, 30_000); // varredura longa: 5 s estoura com a máquina carregada (7 agentes)
  it('semana inválida dá erro (sem laço infinito)', () => {
    expect(() => somarDiasUteis('2026-11-06', 1, [], [])).toThrow('Semana útil vazia: informe ao menos um dia de 0 (domingo) a 6 (sábado).');
    expect(() => somarDiasUteis('2026-11-06', 1, [], [1, 7])).toThrow('Dia da semana inválido: 7 (use inteiros de 0 = domingo a 6 = sábado).');
    expect(() => somarDiasUteis('2026-11-06', 1, [], [-1])).toThrow(/Dia da semana inválido: -1/);
    expect(() => somarDiasUteis('2026-11-06', 1, [], [1, 1.5])).toThrow(/Dia da semana inválido: 1.5/);
    expect(() => somarDiasUteis('2026-11-06', 1, [], [1, Number.NaN])).toThrow(/Dia da semana inválido: NaN/);
    expect(() => somarDiasUteis('2026-11-06', 1, [], [1, 2, 1])).toThrow('Dia da semana repetido na semana útil: 1.');
    expect(() => ehDiaUtilDoTenant('2026-11-06', [], [])).toThrow(/Semana útil vazia/);
    expect(() => diasUteisEntre('2026-11-06', '2026-11-09', [], [8])).toThrow(/Dia da semana inválido/);
    expect(() => prazoEmDiasUteis('2026-11-06T21:00:00Z', 1, { diasUteisSemana: [] })).toThrow(/Semana útil vazia/);
    expect(() => somarDiasUteis('2026-11-06', 1, [], '12345' as unknown as number[])).toThrow(/lista de dias/);
    // semana inválida dá erro mesmo com 0 dias (a entrada é validada antes)
    expect(() => somarDiasUteis('2026-11-06', 0, [], [])).toThrow(/Semana útil vazia/);
  });
});

// ===== T-0124 / RN-CORE-22/26 — dias úteis do mês, fonte única de Core e Gestor (valores escritos à mão) =====
// Novembro/2026: domingos 01, 08, 15 (Proclamação), 22, 29; sábados 07, 14, 21, 28; feriados nacionais em dia de semana:
// 02 (Finados, segunda) e 20 (Consciência Negra, sexta).
describe('diasUteisDoPeriodo (RN-CORE-22/26)', () => {
  it('segunda a sábado, sem cadastro de feriados: 25 no mês, 18 restantes em 10/11 (hoje conta)', () => {
    expect(diasUteisDoPeriodo('2026-11', '2026-11-10', undefined, SEG_SAB)).toEqual({ total: 25, elapsed: 7, remaining: 18 });
  });
  it('segunda a sexta (metas.dias_uteis_semana = [1..5]): 15 restantes em 10/11', () => {
    expect(diasUteisDoPeriodo('2026-11', '2026-11-10', undefined, [1, 2, 3, 4, 5])).toEqual({ total: 21, elapsed: 6, remaining: 15 });
  });
  it('lista de feriados informada: tira os nacionais (02 e 20/11) e os do tenant', () => {
    expect(diasUteisDoPeriodo('2026-11', '2026-11-10', [], SEG_SAB)).toEqual({ total: 23, elapsed: 6, remaining: 17 });
    expect(diasUteisDoPeriodo('2026-11', '2026-11-10', ['2026-11-24'], SEG_SAB)).toEqual({ total: 22, elapsed: 6, remaining: 16 });
  });
  it('domingo (dia não útil) e virada: hoje antes do mês = todos; depois = nenhum', () => {
    expect(diasUteisDoPeriodo('2026-11', '2026-11-08', undefined, SEG_SAB)).toEqual({ total: 25, elapsed: 6, remaining: 19 });
    expect(diasUteisDoPeriodo('2026-12', '2026-11-30', undefined, SEG_SAB).elapsed).toBe(0);
    expect(diasUteisDoPeriodo('2026-10', '2026-11-05', undefined, SEG_SAB).remaining).toBe(0);
  });
  it('é a mesma conta de ehDiaUtilDoTenant dia a dia', () => {
    for (const lista of [undefined, [], ['2026-11-24']]) {
      for (const semana of [SEG_SAB, [1, 2, 3, 4, 5], [0, 6]]) {
        const total = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`).filter((d) => ehDiaUtilDoTenant(d, lista, semana)).length;
        expect(diasUteisDoPeriodo('2026-11', '2026-11-01', lista, semana)).toEqual({ total, elapsed: 0, remaining: total });
      }
    }
  });
  it('entrada inválida dá erro', () => {
    expect(() => diasUteisDoPeriodo('2026-11', '10/11/2026', undefined, SEG_SAB)).toThrow(/Data inválida/);
    expect(() => diasUteisDoPeriodo('2026-13x', '2026-11-10', undefined, SEG_SAB)).toThrow(/Período inválido/);
    expect(() => diasUteisDoPeriodo('2026-11', '2026-11-10', undefined, [])).toThrow(/Semana útil vazia/);
  });
});
