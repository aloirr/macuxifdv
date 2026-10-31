import { describe, expect, it } from 'vitest';
import { resolverParametros } from './parametros';
import {
  processarLote,
  proporLancamento,
  saldoXp,
  xpDaLicao,
  xpDaTrilha,
  xpDoDia,
  xpDoQuiz,
  xpDoStreak,
  xpNoPeriodo,
  type CandidatoXp,
  type LancamentoXp,
} from './xp';

const T = 'tenant-1';
const U = 'user-1';
const p = resolverParametros();

const cand = (parcial: Partial<CandidatoXp> = {}): CandidatoXp => ({
  id: 'id-1',
  tenant_id: T,
  usuario_id: U,
  origem: 'licao',
  referencia_id: 'L1',
  pontos_base: 10,
  ocorrido_em: '2026-10-31T13:00:00Z',
  ...parcial,
});

const aceito = (r: ReturnType<typeof proporLancamento>): LancamentoXp => {
  if (r.resultado !== 'aceito') throw new Error(`esperava aceito, veio ${r.resultado}`);
  return r.lancamento;
};

describe('RN-TRE-01: XP por evento', () => {
  it('RN-TRE-01: lição concluída = 10 XP', () => {
    expect(xpDaLicao(p)).toBe(10);
  });
  it('RN-TRE-01: trilha concluída = 50 XP', () => {
    expect(xpDaTrilha(p)).toBe(50);
  });
  it('RN-TRE-01: acerto no quiz = 5 XP por questão (4 acertos = 20)', () => {
    expect(xpDoQuiz(4, true, p)).toBe(20);
  });
  it('RN-TRE-02: XP de acerto só na 1ª tentativa — nas seguintes é 0', () => {
    expect(xpDoQuiz(4, false, p)).toBe(0);
  });
  it('RN-TRE-01: streak diário = 2 × dias, até 20 (1→2, 3→6, 10→20, 15→20)', () => {
    expect(xpDoStreak(1, p)).toBe(2);
    expect(xpDoStreak(3, p)).toBe(6);
    expect(xpDoStreak(10, p)).toBe(20);
    expect(xpDoStreak(15, p)).toBe(20);
    expect(xpDoStreak(0, p)).toBe(0);
  });
  it('RN-TRE-01: valores do tenant substituem os padrões', () => {
    const p2 = resolverParametros({ xp_licao: 20, xp_acerto_questao: 10, xp_streak_por_dia: 5, xp_streak_teto: 30 });
    expect(xpDaLicao(p2)).toBe(20);
    expect(xpDoQuiz(3, true, p2)).toBe(30);
    expect(xpDoStreak(4, p2)).toBe(20);
    expect(xpDoStreak(9, p2)).toBe(30);
  });
});

describe('RN-TRE-04: lançamento de XP — append-only e idempotente', () => {
  it('RN-TRE-01: aceita o lançamento, guarda o dia no fuso do tenant e não altera o histórico recebido', () => {
    const existentes: LancamentoXp[] = [];
    const l = aceito(proporLancamento(existentes, cand({ ocorrido_em: '2026-11-01T02:00:00Z' }), p));
    expect(l).toMatchObject({ id: 'id-1', pontos: 10, pontos_base: 10, limitado_pelo_teto: false, dia: '2026-10-31' });
    expect(existentes).toEqual([]);
  });

  it('RN-TRE-04: reenvio com o mesmo UUID do aparelho não duplica XP (idempotência por id)', () => {
    const l1 = aceito(proporLancamento([], cand(), p));
    expect(proporLancamento([l1], cand(), p)).toEqual({ resultado: 'duplicado', motivo: 'ID' });
  });

  it('RN-TRE-04: mesma lição concluída em dois aparelhos (ids diferentes) paga XP uma vez só', () => {
    const l1 = aceito(proporLancamento([], cand(), p));
    expect(proporLancamento([l1], cand({ id: 'id-2' }), p)).toEqual({ resultado: 'duplicado', motivo: 'EVENTO' });
  });

  it('RN-TRE-01: lições diferentes pagam cada uma; origens diferentes com a mesma referência também', () => {
    const l1 = aceito(proporLancamento([], cand(), p));
    expect(proporLancamento([l1], cand({ id: 'id-2', referencia_id: 'L2' }), p).resultado).toBe('aceito');
    expect(proporLancamento([l1], cand({ id: 'id-3', origem: 'quiz' }), p).resultado).toBe('aceito');
  });

  it('RN-TRE-01: o mesmo evento de outro usuário não conta como duplicado', () => {
    const l1 = aceito(proporLancamento([], cand(), p));
    expect(proporLancamento([l1], cand({ id: 'id-9', usuario_id: 'user-2' }), p).resultado).toBe('aceito');
  });

  it('RN-TRE-01: evento sem pontos (ex.: quiz fora da 1ª tentativa) não gera lançamento', () => {
    expect(proporLancamento([], cand({ origem: 'quiz', pontos_base: 0 }), p)).toEqual({ resultado: 'sem_pontos' });
  });

  it('RN-TRE-04: pontos negativos ou fracionados são recusados (lançamento só soma)', () => {
    expect(() => proporLancamento([], cand({ pontos_base: -5 }), p)).toThrow(/inteiro/);
    expect(() => proporLancamento([], cand({ pontos_base: 2.5 }), p)).toThrow(/inteiro/);
  });

  it('RN-TRE-04: o saldo é a soma dos lançamentos do usuário', () => {
    const ls = processarLote([], [cand(), cand({ id: 'id-2', referencia_id: 'L2' }), cand({ id: 'id-3', usuario_id: 'user-2', referencia_id: 'L1' })], p).lancamentos;
    expect(saldoXp(ls, U)).toBe(20);
    expect(saldoXp(ls, 'user-2')).toBe(10);
    expect(saldoXp(ls, 'ninguem')).toBe(0);
  });
});

describe('premissa T-0011: teto diário de XP (dia no fuso do tenant)', () => {
  const pTeto = resolverParametros({ xp_teto_diario: 25 });

  it('premissa T-0011: lançamentos até o teto passam inteiros', () => {
    const l1 = aceito(proporLancamento([], cand({ pontos_base: 20 }), pTeto));
    expect(l1).toMatchObject({ pontos: 20, limitado_pelo_teto: false });
  });

  it('premissa T-0011: o que passa do teto é cortado e marcado (20 + 10 → 5 de 10)', () => {
    const l1 = aceito(proporLancamento([], cand({ pontos_base: 20 }), pTeto));
    const l2 = aceito(proporLancamento([l1], cand({ id: 'id-2', referencia_id: 'L2' }), pTeto));
    expect(l2).toMatchObject({ pontos: 5, pontos_base: 10, limitado_pelo_teto: true });
  });

  it('premissa T-0011: teto já esgotado grava lançamento de 0 ponto (mantém a idempotência e a auditoria)', () => {
    const l1 = aceito(proporLancamento([], cand({ pontos_base: 25 }), pTeto));
    const l2 = aceito(proporLancamento([l1], cand({ id: 'id-2', referencia_id: 'L2' }), pTeto));
    expect(l2).toMatchObject({ pontos: 0, pontos_base: 10, limitado_pelo_teto: true });
    expect(proporLancamento([l1, l2], cand({ id: 'id-2', referencia_id: 'L2' }), pTeto)).toEqual({ resultado: 'duplicado', motivo: 'ID' });
  });

  it('premissa T-0011: o teto zera à meia-noite do fuso do tenant, não do UTC', () => {
    // 01/11 03:00Z = 31/10 23:00 Manaus (mesmo dia do l1); 01/11 04:00Z = 01/11 00:00 Manaus (dia novo).
    const l1 = aceito(proporLancamento([], cand({ pontos_base: 25, ocorrido_em: '2026-10-31T15:00:00Z' }), pTeto));
    const mesmoDia = aceito(proporLancamento([l1], cand({ id: 'id-2', referencia_id: 'L2', ocorrido_em: '2026-11-01T03:00:00Z' }), pTeto));
    expect(mesmoDia.pontos).toBe(0);
    const diaNovo = aceito(proporLancamento([l1, mesmoDia], cand({ id: 'id-3', referencia_id: 'L3', ocorrido_em: '2026-11-01T04:00:00Z' }), pTeto));
    expect(diaNovo).toMatchObject({ pontos: 10, dia: '2026-11-01' });
  });

  it('premissa T-0011: teto 0 = sem teto', () => {
    const livre = resolverParametros({ xp_teto_diario: 0 });
    expect(aceito(proporLancamento([], cand({ pontos_base: 5000 }), livre)).pontos).toBe(5000);
  });

  it('RF-TRE-06: XP de desafio de vendas não consome nem sofre o teto diário', () => {
    const l1 = aceito(proporLancamento([], cand({ pontos_base: 25 }), pTeto));
    const d = aceito(proporLancamento([l1], cand({ id: 'id-d', origem: 'desafio_vendas', referencia_id: 'D1:P1', pontos_base: 40 }), pTeto));
    expect(d).toMatchObject({ pontos: 40, limitado_pelo_teto: false });
    const l2 = aceito(proporLancamento([l1, d], cand({ id: 'id-2', referencia_id: 'L2' }), pTeto));
    expect(l2.pontos).toBe(0);
  });
});

describe('RN-TRE-04: processamento de lote (sincronização offline)', () => {
  it('RN-TRE-04: processa por data/hora do evento, não pela ordem de chegada (o teto vale para o que ocorreu primeiro)', () => {
    const pTeto = resolverParametros({ xp_teto_diario: 15 });
    const chegouPrimeiro = cand({ id: 'b', referencia_id: 'L2', ocorrido_em: '2026-10-31T14:00:00Z' });
    const ocorreuPrimeiro = cand({ id: 'a', referencia_id: 'L1', ocorrido_em: '2026-10-31T13:00:00Z' });
    const r = processarLote([], [chegouPrimeiro, ocorreuPrimeiro], pTeto);
    expect(r.lancamentos.map((l) => [l.id, l.pontos])).toEqual([['a', 10], ['b', 5]]);
  });

  it('RN-TRE-04: o lote descarta repetidos e informa o motivo', () => {
    const r = processarLote([], [cand(), cand(), cand({ id: 'id-2' }), cand({ id: 'id-3', referencia_id: 'L3' })], p);
    expect(r.lancamentos.map((l) => l.id)).toEqual(['id-1', 'id-3']);
    expect(r.duplicados).toEqual([
      { id: 'id-1', motivo: 'ID' },
      { id: 'id-2', motivo: 'EVENTO' },
    ]);
  });

  it('RN-TRE-04: lote reenviado depois de aceito não muda o saldo (idempotente)', () => {
    const lote = [cand(), cand({ id: 'id-2', referencia_id: 'L2' })];
    const um = processarLote([], lote, p);
    const dois = processarLote(um.lancamentos, lote, p);
    expect(dois.lancamentos).toEqual([]);
    expect(saldoXp([...um.lancamentos, ...dois.lancamentos], U)).toBe(20);
  });
});

describe('RF-TRE-04: XP por dia e por período', () => {
  const ls = processarLote(
    [],
    [
      cand({ id: 'a', referencia_id: 'L1', ocorrido_em: '2026-10-30T15:00:00Z' }),
      cand({ id: 'b', referencia_id: 'L2', ocorrido_em: '2026-10-31T15:00:00Z' }),
      cand({ id: 'c', referencia_id: 'L3', ocorrido_em: '2026-11-01T15:00:00Z' }),
    ],
    p,
  ).lancamentos;

  it('RF-TRE-04: XP do dia no fuso do tenant', () => {
    expect(xpDoDia(ls, U, '2026-10-31')).toBe(10);
  });
  it('RF-TRE-04: XP no período inclui as duas pontas (data civil)', () => {
    expect(xpNoPeriodo(ls, U, '2026-10-31', '2026-11-01')).toBe(20);
    expect(xpNoPeriodo(ls, U, null, null)).toBe(30);
    expect(xpNoPeriodo(ls, U, '2026-11-02', null)).toBe(0);
  });
});
