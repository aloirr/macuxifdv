import { describe, expect, it } from 'vitest';
import { resolverParametros } from './parametros';
import { concluirLicao, registrarTentativaQuiz, tempoMinimoDaLicao, validarConclusaoLicao, type ConclusaoLicaoEntrada } from './progresso';
import type { TrilhaDef } from './trilha';
import type { LancamentoXp } from './xp';

const T = 'tenant-1';
const U = 'user-1';
const p = resolverParametros();

const trilha = (extra: Partial<TrilhaDef> = {}): TrilhaDef => ({
  id: 'TR1',
  status: 'publicada',
  obrigatoria: true,
  sequencial: true,
  prazo: null,
  publico_alvo: { perfis: [], equipes: [] },
  modulos: [{ id: 'M1', ordem: 1, licoes: [{ id: 'L1', ordem: 1 }, { id: 'L2', ordem: 2, quiz_id: 'Z2' }] }],
  ...extra,
});
const entrada = (extra: Partial<ConclusaoLicaoEntrada> = {}): ConclusaoLicaoEntrada => ({ licao_id: 'L1', tempo_gasto_seg: 45, concluida_em: '2026-10-31T13:00:00Z', ...extra });
const ctx = (extra: Record<string, unknown> = {}) => ({ trilha: trilha(), concluidas: [] as string[], quiz_aprovado: false, ...extra });

describe('RN-TRE-04: validação do progresso feito offline', () => {
  it('RN-TRE-04: lição com 30 s ou mais conta (limite inclusivo)', () => {
    expect(validarConclusaoLicao(entrada({ tempo_gasto_seg: 30 }), ctx(), p)).toEqual({ resultado: 'aceito' });
  });

  it('RN-TRE-04: menos de 30 s não conta, com mensagem em português e a ação seguinte', () => {
    const r = validarConclusaoLicao(entrada({ tempo_gasto_seg: 29 }), ctx(), p);
    expect(r).toMatchObject({ resultado: 'rejeitado', codigo: 'TEMPO_MINIMO', regra: 'RN-TRE-04' });
    expect(r.resultado === 'rejeitado' && r.mensagem).toMatch(/30 s.*leia|assista/i);
  });

  it('RN-TRE-04: tempo mínimo configurável pelo tenant', () => {
    expect(validarConclusaoLicao(entrada({ tempo_gasto_seg: 45 }), ctx(), resolverParametros({ segundos_minimos_licao: 60 }))).toMatchObject({ codigo: 'TEMPO_MINIMO' });
  });

  it('RN-TRE-04: lição já concluída (reenvio do aparelho) é duplicada — idempotente, sem erro', () => {
    expect(validarConclusaoLicao(entrada(), ctx({ concluidas: ['L1'] }), p)).toEqual({ resultado: 'duplicado' });
  });

  it('RF-TRE-01: lição bloqueada pelo pré-requisito é rejeitada, mesmo com tempo suficiente', () => {
    const r = validarConclusaoLicao(entrada({ licao_id: 'L2' }), ctx({ quiz_aprovado: true }), p);
    expect(r).toMatchObject({ resultado: 'rejeitado', codigo: 'LICAO_BLOQUEADA' });
  });

  it('RN-TRE-02: lição com quiz só conclui com o quiz aprovado', () => {
    const base = ctx({ concluidas: ['L1'] });
    expect(validarConclusaoLicao(entrada({ licao_id: 'L2' }), base, p)).toMatchObject({ resultado: 'rejeitado', codigo: 'QUIZ_PENDENTE', regra: 'RN-TRE-02' });
    expect(validarConclusaoLicao(entrada({ licao_id: 'L2' }), { ...base, quiz_aprovado: true }, p)).toEqual({ resultado: 'aceito' });
  });

  it('RF-TRE-01: lição que não existe na trilha e trilha não publicada são rejeitadas', () => {
    expect(validarConclusaoLicao(entrada({ licao_id: 'XX' }), ctx(), p)).toMatchObject({ codigo: 'LICAO_DESCONHECIDA' });
    expect(validarConclusaoLicao(entrada(), ctx({ trilha: trilha({ status: 'arquivada' }) }), p)).toMatchObject({ codigo: 'TRILHA_NAO_PUBLICADA' });
  });
});

describe('RN-TRE-01: concluir lição gera XP, streak e trilha concluída', () => {
  let n = 0;
  const gerarId = () => `id-${++n}`;
  const base = { tenant_id: T, usuario_id: U, trilha: trilha(), tempo_gasto_seg: 60, quiz_aprovado: false, atividades: [] as string[], lancamentos: [] as LancamentoXp[], gerarId, params: p };

  it('RN-TRE-01: lição concluída = 10 XP + streak do 1º dia (2 XP); trilha ainda não concluída', () => {
    const r = concluirLicao({ ...base, licao_id: 'L1', concluidas: [], concluida_em: '2026-10-31T13:00:00Z' });
    if (r.resultado !== 'aceito') throw new Error('esperava aceito');
    expect(r.trilha_concluida).toBe(false);
    expect(r.streak_dias).toBe(1);
    expect(r.lancamentos.map((l) => [l.origem, l.pontos])).toEqual([['licao', 10], ['streak', 2]]);
    expect(r.xp_ganho).toBe(12);
  });

  it('RN-TRE-01: última lição conclui a trilha (+50 XP) e o streak do 3º dia vale 6', () => {
    const r = concluirLicao({
      ...base,
      licao_id: 'L2',
      concluidas: ['L1'],
      quiz_aprovado: true,
      concluida_em: '2026-10-31T13:00:00Z',
      atividades: ['2026-10-29T13:00:00Z', '2026-10-30T13:00:00Z'],
    });
    if (r.resultado !== 'aceito') throw new Error('esperava aceito');
    expect(r.trilha_concluida).toBe(true);
    expect(r.streak_dias).toBe(3);
    expect(r.lancamentos.map((l) => [l.origem, l.referencia_id, l.pontos])).toEqual([
      ['licao', 'L2', 10],
      ['trilha', 'TR1', 50],
      ['streak', '2026-10-31', 6],
    ]);
    expect(r.xp_ganho).toBe(66);
  });

  it('RN-TRE-01: streak só paga uma vez por dia — segunda lição no mesmo dia não repete', () => {
    const primeira = concluirLicao({ ...base, licao_id: 'L1', concluidas: [], concluida_em: '2026-10-31T13:00:00Z' });
    if (primeira.resultado !== 'aceito') throw new Error('esperava aceito');
    const segunda = concluirLicao({
      ...base,
      licao_id: 'L2',
      concluidas: ['L1'],
      quiz_aprovado: true,
      concluida_em: '2026-10-31T14:00:00Z',
      atividades: ['2026-10-31T13:00:00Z'],
      lancamentos: primeira.lancamentos,
    });
    if (segunda.resultado !== 'aceito') throw new Error('esperava aceito');
    expect(segunda.lancamentos.map((l) => l.origem)).toEqual(['licao', 'trilha']);
  });

  it('RN-TRE-04: rejeição não gera nenhum lançamento; reenvio devolve duplicado sem XP novo', () => {
    expect(concluirLicao({ ...base, licao_id: 'L1', concluidas: [], tempo_gasto_seg: 5, concluida_em: '2026-10-31T13:00:00Z' })).toMatchObject({ resultado: 'rejeitado', codigo: 'TEMPO_MINIMO' });
    expect(concluirLicao({ ...base, licao_id: 'L1', concluidas: ['L1'], concluida_em: '2026-10-31T13:00:00Z' })).toEqual({ resultado: 'duplicado' });
  });

  it('decisão 31/10: o teto diário também corta o XP da conclusão', () => {
    const r = concluirLicao({ ...base, licao_id: 'L1', concluidas: [], concluida_em: '2026-10-31T13:00:00Z', params: resolverParametros({ xp_teto_diario: 11 }) });
    if (r.resultado !== 'aceito') throw new Error('esperava aceito');
    expect(r.lancamentos.map((l) => [l.origem, l.pontos, l.limitado_pelo_teto])).toEqual([['licao', 10, false], ['streak', 1, true]]);
  });
});

describe('RN-TRE-02: registrar tentativa de quiz', () => {
  let n = 0;
  const gerarId = () => `q-${++n}`;
  const questoes = [
    { id: 'Q1', corretas: ['A'] },
    { id: 'Q2', corretas: ['B'] },
    { id: 'Q3', corretas: ['C'] },
    { id: 'Q4', corretas: ['D'] },
    { id: 'Q5', corretas: ['E'] },
  ];
  const certas = (k: number) => questoes.map((q, i) => ({ questao_id: q.id, alternativa_ids: [i < k ? q.corretas[0]! : 'Z'] }));
  const base = { tenant_id: T, usuario_id: U, quiz_id: 'Z2', questoes, anteriores: [] as { realizada_em: string; nota_pct: number; aprovada: boolean }[], atividades: [] as string[], lancamentos: [] as LancamentoXp[], gerarId, params: p };

  it('RN-TRE-02: 4 de 5 (80%) na 1ª tentativa aprova e paga 20 XP de acerto + 2 do streak', () => {
    const r = registrarTentativaQuiz({ ...base, respostas: certas(4), realizada_em: '2026-10-31T13:00:00Z' });
    if (r.resultado !== 'aceita') throw new Error('esperava aceita');
    expect(r).toMatchObject({ aprovada: true, primeira_tentativa: true });
    expect(r.correcao).toMatchObject({ acertos: 4, nota_pct: 80 });
    expect(r.lancamentos.map((l) => [l.origem, l.referencia_id, l.pontos])).toEqual([['quiz', 'Z2', 20], ['streak', '2026-10-31', 2]]);
  });

  it('RN-TRE-02: 3 de 5 (60%) reprova, mas os 15 XP de acerto da 1ª tentativa já valem', () => {
    const r = registrarTentativaQuiz({ ...base, respostas: certas(3), realizada_em: '2026-10-31T13:00:00Z' });
    if (r.resultado !== 'aceita') throw new Error('esperava aceita');
    expect(r.aprovada).toBe(false);
    expect(r.lancamentos[0]).toMatchObject({ origem: 'quiz', pontos: 15 });
  });

  it('RN-TRE-02: na 2ª tentativa não há XP de acerto, só o streak se for o 1º do dia', () => {
    const r = registrarTentativaQuiz({
      ...base,
      respostas: certas(5),
      realizada_em: '2026-11-01T13:00:00Z',
      anteriores: [{ realizada_em: '2026-10-31T13:00:00Z', nota_pct: 60, aprovada: false }],
      atividades: ['2026-10-31T13:00:00Z'],
      lancamentos: [{ id: 'x', tenant_id: T, usuario_id: U, origem: 'quiz', referencia_id: 'Z2', pontos: 15, pontos_base: 15, limitado_pelo_teto: false, ocorrido_em: '2026-10-31T13:00:00Z', dia: '2026-10-31' }],
    });
    if (r.resultado !== 'aceita') throw new Error('esperava aceita');
    expect(r).toMatchObject({ aprovada: true, primeira_tentativa: false });
    expect(r.lancamentos.map((l) => [l.origem, l.pontos])).toEqual([['streak', 4]]);
  });

  it('RN-TRE-02: 4ª tentativa no mesmo dia é recusada e não gera nada', () => {
    const anteriores = ['13', '14', '15'].map((h) => ({ realizada_em: `2026-10-31T${h}:00:00Z`, nota_pct: 20, aprovada: false }));
    const r = registrarTentativaQuiz({ ...base, respostas: certas(5), realizada_em: '2026-10-31T16:00:00Z', anteriores });
    expect(r).toMatchObject({ resultado: 'recusada', motivo: 'LIMITE_DIARIO', regra: 'RN-TRE-02' });
  });

  it('RN-TRE-02: resposta a questão de outro quiz é erro (API devolve 422)', () => {
    expect(() => registrarTentativaQuiz({ ...base, respostas: [{ questao_id: 'ZZ', alternativa_ids: ['A'] }], realizada_em: '2026-10-31T13:00:00Z' })).toThrow(/não pertence/);
  });
});

describe('Ajuste D: tempo mínimo da lição = o maior entre 30 s e 50% da duração estimada', () => {
  const comDuracao = (seg: number | null | undefined) => trilha({ modulos: [{ id: 'M1', ordem: 1, licoes: [{ id: 'L1', ordem: 1, duracao_estimada_seg: seg }] }] });

  it('RN-TRE-04: padrões do tenant — 50% da duração e 30 s', () => {
    expect(p).toMatchObject({ pct_minimo_duracao_licao: 50, segundos_minimos_licao: 30 });
  });

  it('RN-TRE-04: lição sem duração informada exige 30 s (29 s não conta, 30 s conta)', () => {
    expect(tempoMinimoDaLicao(undefined, p)).toBe(30);
    expect(tempoMinimoDaLicao(null, p)).toBe(30);
    expect(validarConclusaoLicao(entrada({ tempo_gasto_seg: 29 }), ctx({ trilha: comDuracao(undefined) }), p)).toMatchObject({ codigo: 'TEMPO_MINIMO' });
    expect(validarConclusaoLicao(entrada({ tempo_gasto_seg: 30 }), ctx({ trilha: comDuracao(undefined) }), p)).toEqual({ resultado: 'aceito' });
  });

  it('RN-TRE-04: lição de 10 min (600 s) exige 5 min (300 s); 299 s não conta', () => {
    expect(tempoMinimoDaLicao(600, p)).toBe(300);
    expect(validarConclusaoLicao(entrada({ tempo_gasto_seg: 299 }), ctx({ trilha: comDuracao(600) }), p)).toMatchObject({ resultado: 'rejeitado', codigo: 'TEMPO_MINIMO', regra: 'RN-TRE-04' });
    expect(validarConclusaoLicao(entrada({ tempo_gasto_seg: 300 }), ctx({ trilha: comDuracao(600) }), p)).toEqual({ resultado: 'aceito' });
  });

  it('RN-TRE-04: lição curta (40 s → 20 s) cai no piso de 30 s', () => {
    expect(tempoMinimoDaLicao(40, p)).toBe(30);
  });

  it('RN-TRE-04: o percentual arredonda para cima em segundos inteiros (61 s → 31 s) e sem erro de ponto flutuante (100 s a 70% → 70 s)', () => {
    expect(tempoMinimoDaLicao(61, p)).toBe(31);
    expect(tempoMinimoDaLicao(100, resolverParametros({ pct_minimo_duracao_licao: 70 }))).toBe(70);
  });

  it('RN-TRE-04: percentual 0 desliga a regra proporcional (vale só o piso); 100 exige a duração inteira', () => {
    expect(tempoMinimoDaLicao(600, resolverParametros({ pct_minimo_duracao_licao: 0 }))).toBe(30);
    expect(tempoMinimoDaLicao(600, resolverParametros({ pct_minimo_duracao_licao: 100 }))).toBe(600);
  });

  it('RN-TRE-04: a mensagem diz o tempo exigido e a ação seguinte', () => {
    const r = validarConclusaoLicao(entrada({ tempo_gasto_seg: 100 }), ctx({ trilha: comDuracao(600) }), p);
    expect(r.resultado === 'rejeitado' && r.mensagem).toMatch(/300 s.*(leia|assista)/i);
  });

  it('RN-TRE-04: concluirLicao aplica a mesma regra (lição de 10 min com 4 min é rejeitada, sem lançamentos)', () => {
    const r = concluirLicao({ tenant_id: T, usuario_id: U, trilha: comDuracao(600), licao_id: 'L1', concluidas: [], quiz_aprovado: false, tempo_gasto_seg: 240, concluida_em: '2026-10-31T13:00:00Z', atividades: [], lancamentos: [], gerarId: () => 'x', params: p });
    expect(r).toMatchObject({ resultado: 'rejeitado', codigo: 'TEMPO_MINIMO' });
  });
});

describe('Ajuste B: quiz abandonado não conta para a sequência de dias', () => {
  let n = 0;
  const gerarId = () => `s-${++n}`;
  const questoes = [{ id: 'Q1', corretas: ['A'] }, { id: 'Q2', corretas: ['B'] }];
  const base = { tenant_id: T, usuario_id: U, quiz_id: 'Z2', questoes, anteriores: [] as { realizada_em: string; nota_pct: number; aprovada: boolean }[], atividades: [] as string[], lancamentos: [] as LancamentoXp[], gerarId, params: p };

  it('RN-TRE-01: quiz respondido até o fim (todas as questões) paga o streak do dia', () => {
    const r = registrarTentativaQuiz({ ...base, respostas: [{ questao_id: 'Q1', alternativa_ids: ['A'] }, { questao_id: 'Q2', alternativa_ids: ['X'] }], realizada_em: '2026-10-31T13:00:00Z' });
    if (r.resultado !== 'aceita') throw new Error('esperava aceita');
    expect(r.quiz_finalizado).toBe(true);
    expect(r.lancamentos.map((l) => l.origem)).toEqual(['quiz', 'streak']);
  });

  it('RN-TRE-01: quiz enviado com questão sem resposta (abandonado no meio) não paga streak', () => {
    const r = registrarTentativaQuiz({ ...base, respostas: [{ questao_id: 'Q1', alternativa_ids: ['A'] }], realizada_em: '2026-10-31T13:00:00Z' });
    if (r.resultado !== 'aceita') throw new Error('esperava aceita');
    expect(r.quiz_finalizado).toBe(false);
    expect(r.lancamentos.map((l) => l.origem)).toEqual(['quiz']);
  });

  it('RN-TRE-01: questão com alternativas vazias também é "não respondida"', () => {
    const r = registrarTentativaQuiz({ ...base, respostas: [{ questao_id: 'Q1', alternativa_ids: ['A'] }, { questao_id: 'Q2', alternativa_ids: [] }], realizada_em: '2026-10-31T13:00:00Z' });
    if (r.resultado !== 'aceita') throw new Error('esperava aceita');
    expect(r.lancamentos.some((l) => l.origem === 'streak')).toBe(false);
  });
});
