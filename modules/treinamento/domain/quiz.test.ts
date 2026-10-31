import { describe, expect, it } from 'vitest';
import { aprovado, corrigirQuiz, ehPrimeiraTentativa, notaDoQuiz, notaQueVale, quizAprovado, validarTentativa, type QuestaoDef } from './quiz';
import { resolverParametros } from './parametros';

const questoes: QuestaoDef[] = [
  { id: 'Q1', corretas: ['A'] },
  { id: 'Q2', corretas: ['B', 'C'] },
  { id: 'Q3', corretas: ['D'] },
];

describe('RN-TRE-02: nota do quiz', () => {
  it('RN-TRE-02: nota = acertos ÷ questões × 100, 2 casas meio para cima (2 de 3 = 66,67)', () => {
    expect(notaDoQuiz(2, 3)).toBe(66.67);
    expect(notaDoQuiz(7, 10)).toBe(70);
    expect(notaDoQuiz(0, 5)).toBe(0);
    expect(notaDoQuiz(5, 5)).toBe(100);
    expect(notaDoQuiz(1, 6)).toBe(16.67);
  });

  it('RN-TRE-02: quiz sem questões ou acertos acima do total são erros', () => {
    expect(() => notaDoQuiz(0, 0)).toThrow(/questão/);
    expect(() => notaDoQuiz(4, 3)).toThrow(/acertos/);
  });

  it('RN-TRE-02: corrige por conjunto — questão de múltipla escolha só acerta com todas as alternativas certas', () => {
    const r = corrigirQuiz(questoes, [
      { questao_id: 'Q1', alternativa_ids: ['A'] },
      { questao_id: 'Q2', alternativa_ids: ['C', 'B'] },
      { questao_id: 'Q3', alternativa_ids: ['X'] },
    ]);
    expect(r).toMatchObject({ acertos: 2, total: 3, nota_pct: 66.67 });
    expect(r.por_questao).toEqual([
      { questao_id: 'Q1', correta: true },
      { questao_id: 'Q2', correta: true },
      { questao_id: 'Q3', correta: false },
    ]);
  });

  it('RN-TRE-02: resposta parcial ou questão em branco conta como erro', () => {
    const r = corrigirQuiz(questoes, [{ questao_id: 'Q1', alternativa_ids: ['A'] }, { questao_id: 'Q2', alternativa_ids: ['B'] }]);
    expect(r.acertos).toBe(1);
    expect(r.por_questao.map((q) => q.correta)).toEqual([true, false, false]);
  });

  it('RN-TRE-02: resposta a questão que não é do quiz ou repetida é erro (a API recusa)', () => {
    expect(() => corrigirQuiz(questoes, [{ questao_id: 'ZZ', alternativa_ids: ['A'] }])).toThrow(/não pertence/);
    expect(() => corrigirQuiz(questoes, [{ questao_id: 'Q1', alternativa_ids: ['A'] }, { questao_id: 'Q1', alternativa_ids: ['A'] }])).toThrow(/mais de uma vez/);
  });
});

describe('RN-TRE-02: aprovação por nota mínima', () => {
  it('RN-TRE-02: 70% aprova (limite inclusivo) e 69,99% não', () => {
    expect(aprovado(7, 10)).toBe(true);
    expect(aprovado(14, 20)).toBe(true);
    expect(aprovado(2, 3)).toBe(false); // 66,67
    expect(aprovado(699, 1000)).toBe(false);
  });

  it('RN-TRE-02: nota mínima configurável pelo tenant', () => {
    expect(aprovado(7, 10, 80)).toBe(false);
    expect(aprovado(8, 10, 80)).toBe(true);
  });

  it('RN-TRE-02: a comparação é exata — arredondar a nota para exibir nunca aprova quem ficou abaixo', () => {
    // 69.996 aparece como 70 (2 casas), mas não atingiu 70%.
    expect(notaDoQuiz(69996, 100000)).toBe(70);
    expect(aprovado(69996, 100000, 70)).toBe(false);
    expect(aprovado(6999, 10000, 69.99)).toBe(true);
  });
});

describe('RN-TRE-02: tentativas por dia e intervalo', () => {
  const p = resolverParametros();
  const em = (iso: string) => ({ realizada_em: iso });

  it('RN-TRE-02: primeira tentativa do dia é permitida e sobram 2', () => {
    expect(validarTentativa([], '2026-10-31T13:00:00Z', p)).toEqual({ permitida: true, tentativas_restantes_hoje: 2 });
  });

  it('RN-TRE-02: até 3 tentativas por dia; a 4ª é recusada com orientação em português', () => {
    const tres = [em('2026-10-31T13:00:00Z'), em('2026-10-31T14:00:00Z'), em('2026-10-31T15:00:00Z')];
    expect(validarTentativa(tres.slice(0, 2), '2026-10-31T16:00:00Z', p)).toEqual({ permitida: true, tentativas_restantes_hoje: 0 });
    const r = validarTentativa(tres, '2026-10-31T16:00:00Z', p);
    expect(r).toMatchObject({ permitida: false, motivo: 'LIMITE_DIARIO', regra: 'RN-TRE-02' });
    expect(r.permitida === false && r.mensagem).toMatch(/amanhã/i);
  });

  it('RN-TRE-02: o dia é o do fuso do tenant — 03:30Z de 01/11 ainda é 31/10 em Manaus e conta no mesmo dia', () => {
    const antes = [em('2026-10-31T23:00:00Z'), em('2026-11-01T01:00:00Z'), em('2026-11-01T02:00:00Z')];
    expect(validarTentativa(antes, '2026-11-01T03:30:00Z', p)).toMatchObject({ permitida: false, motivo: 'LIMITE_DIARIO' });
  });

  it('RN-TRE-02: virou o dia no fuso do tenant, o contador zera', () => {
    const ontem = [em('2026-11-01T01:00:00Z'), em('2026-11-01T02:00:00Z'), em('2026-11-01T03:00:00Z')];
    // 04:00Z de 01/11 = 00:00 de 01/11 em Manaus (UTC−4)
    expect(validarTentativa(ontem, '2026-11-01T04:00:00Z', p)).toEqual({ permitida: true, tentativas_restantes_hoje: 2 });
  });

  it('RN-TRE-02: o limite recusado informa quando o dia vira (proxima_em no início do dia seguinte no fuso)', () => {
    const tres = [em('2026-10-31T13:00:00Z'), em('2026-10-31T14:00:00Z'), em('2026-10-31T15:00:00Z')];
    const r = validarTentativa(tres, '2026-10-31T16:00:00Z', p);
    expect(r.permitida === false && r.proxima_em).toBe('2026-11-01T04:00:00.000Z');
  });

  it('RN-TRE-02: limite diário configurável', () => {
    const p1 = resolverParametros({ tentativas_max_dia: 1 });
    expect(validarTentativa([em('2026-10-31T13:00:00Z')], '2026-10-31T14:00:00Z', p1)).toMatchObject({ permitida: false, motivo: 'LIMITE_DIARIO' });
  });

  it('decisão 31/10: intervalo mínimo entre tentativas, contado a partir da anterior', () => {
    const p10 = resolverParametros({ intervalo_min_tentativas_min: 10 });
    const r = validarTentativa([em('2026-10-31T13:00:00Z')], '2026-10-31T13:04:00Z', p10);
    expect(r).toMatchObject({ permitida: false, motivo: 'INTERVALO_MINIMO', proxima_em: '2026-10-31T13:10:00.000Z' });
    expect(r.permitida === false && r.mensagem).toMatch(/6 min/);
    expect(validarTentativa([em('2026-10-31T13:00:00Z')], '2026-10-31T13:10:00Z', p10)).toMatchObject({ permitida: true });
  });

  it('decisão 31/10: padrão sem intervalo — tentativas seguidas são permitidas', () => {
    expect(validarTentativa([em('2026-10-31T13:00:00Z')], '2026-10-31T13:00:30Z', p)).toMatchObject({ permitida: true });
  });

  it('RN-TRE-04: tentativa feita offline é validada na ordem em que aconteceu, ignorando tentativas posteriores', () => {
    const futuras = [em('2026-10-31T15:00:00Z'), em('2026-10-31T16:00:00Z'), em('2026-10-31T17:00:00Z')];
    expect(validarTentativa(futuras, '2026-10-31T13:00:00Z', p)).toEqual({ permitida: true, tentativas_restantes_hoje: 2 });
  });

  it('RN-TRE-02: XP de acerto só na 1ª tentativa', () => {
    expect(ehPrimeiraTentativa([])).toBe(true);
    expect(ehPrimeiraTentativa([em('2026-10-31T13:00:00Z')])).toBe(false);
  });
});

describe('decisão 31/10: nota que vale', () => {
  const tent = [
    { realizada_em: '2026-10-31T13:00:00Z', nota_pct: 60, aprovada: false },
    { realizada_em: '2026-10-31T14:00:00Z', nota_pct: 90, aprovada: true },
    { realizada_em: '2026-10-31T15:00:00Z', nota_pct: 80, aprovada: true },
  ];
  it('padrão "melhor": vale a maior nota', () => {
    expect(notaQueVale(tent, 'melhor')).toBe(90);
  });
  it('"ultima": vale a última tentativa por data/hora, mesmo se vier fora de ordem', () => {
    expect(notaQueVale([...tent].reverse(), 'ultima')).toBe(80);
  });
  it('sem tentativas não há nota', () => {
    expect(notaQueVale([], 'melhor')).toBeNull();
  });
  it('RN-TRE-02: quiz aprovado uma vez continua aprovado (progresso só por inserção, nota posterior menor não revoga)', () => {
    expect(quizAprovado(tent)).toBe(true);
    expect(quizAprovado([tent[0]!])).toBe(false);
    expect(quizAprovado([])).toBe(false);
  });
});
