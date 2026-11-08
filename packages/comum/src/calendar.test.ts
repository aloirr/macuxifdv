import { describe, expect, it } from 'vitest';
import {
  businessDays,
  diasUteisEntre,
  diffDays,
  ehDiaUtilSegSex,
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
      'ehDataCivil', 'exigirDataCivil', 'ehFeriado', 'ehDiaUtilSegSex', 'somarDiasUteis', 'diasUteisEntre', 'prazoEmDiasUteis']) {
      expect(typeof (indice as Record<string, unknown>)[nome], nome).toBe('function');
      expect(typeof (calendario as Record<string, unknown>)[nome], nome).toBe('function');
    }
    expect('somarDias' in indice).toBe(false);
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

describe('ehDiaUtilSegSex', () => {
  it('sem lista = comportamento antigo (feriado nacional conta como útil)', () => {
    expect(ehDiaUtilSegSex('2026-02-16')).toBe(true);
    expect(ehDiaUtilSegSex('2026-02-14')).toBe(false); // sábado
    expect(ehDiaUtilSegSex('2026-02-15')).toBe(false); // domingo
  });
  it('com [] pula os nacionais', () => {
    expect(ehDiaUtilSegSex('2026-02-16', [])).toBe(false);
    expect(ehDiaUtilSegSex('2026-04-03', [])).toBe(false);
    expect(ehDiaUtilSegSex('2026-02-18', [])).toBe(true); // Quarta de Cinzas
  });
  it('com lista do tenant pula também os do tenant', () => {
    expect(ehDiaUtilSegSex('2027-10-25', [])).toBe(true);
    expect(ehDiaUtilSegSex('2027-10-25', ['2027-10-25'])).toBe(false);
    expect(ehDiaUtilSegSex('2027-10-25', new Set(['2027-10-25']))).toBe(false); // qualquer Iterable
  });
  it('entrada inválida na lista do tenant dá erro', () => {
    expect(() => ehDiaUtilSegSex('2027-10-26', ['2027-10-25', '25/10/2027'])).toThrow('Data inválida: 25/10/2027 (use AAAA-MM-DD).');
    expect(() => ehDiaUtilSegSex('2027-10-26', ['2027-02-29'])).toThrow(/Data inválida/);
    expect(() => ehDiaUtilSegSex('2027-10-26', '2027-10-25' as unknown as string[])).toThrow(/lista de datas/);
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
  });
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
