import { describe, expect, it } from 'vitest';
import { podeEditarTrilha, problemasParaPublicar, transicaoDaTrilha, type TrilhaParaPublicar } from './bko';

const trilha = (extra: Partial<TrilhaParaPublicar> = {}): TrilhaParaPublicar => ({
  id: 'TR1',
  status: 'rascunho',
  obrigatoria: false,
  sequencial: true,
  prazo: null,
  publico_alvo: { perfis: [], equipes: [] },
  modulos: [{ id: 'M1', ordem: 1, licoes: [{ id: 'L1', ordem: 1, quiz_id: 'Z1' }] }],
  quizzes: [{ id: 'Z1', licao_id: 'L1', questoes: [{ id: 'Q1', alternativas: [{ id: 'A1', correta: true }, { id: 'A2', correta: false }] }] }],
  ...extra,
});

describe('BKO de trilhas — edição e publicação (RF-TRE-01, RN-AUD-01)', () => {
  it('RF-TRE-01: só trilha em rascunho é editada; publicada ou arquivada não', () => {
    expect(podeEditarTrilha('rascunho')).toEqual({ ok: true });
    expect(podeEditarTrilha('publicada')).toMatchObject({ ok: false, codigo: 'TRILHA_NAO_EDITAVEL' });
    expect(podeEditarTrilha('arquivada')).toMatchObject({ ok: false, codigo: 'TRILHA_NAO_EDITAVEL' });
  });

  it('RF-TRE-01: trilha completa e válida publica', () => {
    expect(problemasParaPublicar(trilha())).toEqual([]);
  });

  it('RF-TRE-01: trilha sem lição não publica', () => {
    expect(problemasParaPublicar(trilha({ modulos: [], quizzes: [] }))).toContain('A trilha precisa de ao menos uma lição para ser publicada.');
  });

  it('RF-TRE-01: herda os problemas de estrutura (pré-requisito inexistente)', () => {
    const t = trilha({ modulos: [{ id: 'M1', ordem: 1, licoes: [{ id: 'L1', ordem: 1, pre_requisitos: ['LX'] }] }], quizzes: [] });
    expect(problemasParaPublicar(t).join(' ')).toMatch(/LX/);
  });

  it('RN-TRE-02: quiz sem questão, questão sem alternativa correta ou com menos de 2 alternativas não publica', () => {
    expect(problemasParaPublicar(trilha({ quizzes: [{ id: 'Z1', licao_id: 'L1', questoes: [] }] })).join(' ')).toMatch(/ao menos uma questão/);
    expect(problemasParaPublicar(trilha({ quizzes: [{ id: 'Z1', licao_id: 'L1', questoes: [{ id: 'Q1', alternativas: [{ id: 'A1', correta: false }, { id: 'A2', correta: false }] }] }] })).join(' ')).toMatch(/alternativa correta/);
    expect(problemasParaPublicar(trilha({ quizzes: [{ id: 'Z1', licao_id: 'L1', questoes: [{ id: 'Q1', alternativas: [{ id: 'A1', correta: true }] }] }] })).join(' ')).toMatch(/2 alternativas/);
  });

  it('RN-TRE-02: lição que aponta para quiz inexistente, ou quiz de outra lição, não publica', () => {
    expect(problemasParaPublicar(trilha({ quizzes: [] })).join(' ')).toMatch(/quiz Z1/);
    expect(problemasParaPublicar(trilha({ quizzes: [{ ...trilha().quizzes[0]!, licao_id: 'LX' }] })).join(' ')).toMatch(/quiz Z1/);
  });

  it('RF-TRE-01: rascunho → publicada → arquivada; arquivada não volta; republicar é idempotente', () => {
    expect(transicaoDaTrilha('rascunho', 'publicar')).toEqual({ ok: true, status: 'publicada', mudou: true });
    expect(transicaoDaTrilha('publicada', 'publicar')).toEqual({ ok: true, status: 'publicada', mudou: false });
    expect(transicaoDaTrilha('publicada', 'arquivar')).toEqual({ ok: true, status: 'arquivada', mudou: true });
    expect(transicaoDaTrilha('rascunho', 'arquivar')).toEqual({ ok: true, status: 'arquivada', mudou: true });
    expect(transicaoDaTrilha('arquivada', 'arquivar')).toEqual({ ok: true, status: 'arquivada', mudou: false });
    expect(transicaoDaTrilha('arquivada', 'publicar')).toMatchObject({ ok: false, codigo: 'TRILHA_ARQUIVADA' });
  });
});
