import { describe, expect, it } from 'vitest';
import { aplicarAtividade, aplicarAtividades, estadoVazio, resumoDaJornada, type AtividadeDoAluno, type ConteudoDoAluno, type EstadoDoAluno } from './atividade';
import { resolverParametros } from './parametros';
import type { TrilhaDef } from './trilha';

const T = 'tenant-1';
const U = 'user-1';
const p = resolverParametros();

const trilha = (extra: Partial<TrilhaDef> = {}): TrilhaDef => ({
  id: 'TR1',
  status: 'publicada',
  obrigatoria: true,
  sequencial: true,
  prazo: '2026-11-10',
  publico_alvo: { perfis: [], equipes: [] },
  modulos: [{ id: 'M1', ordem: 1, licoes: [{ id: 'L1', ordem: 1 }, { id: 'L2', ordem: 2, quiz_id: 'Z2' }] }],
  ...extra,
});
const conteudo = (t: TrilhaDef = trilha()): ConteudoDoAluno => ({
  trilhas: [t],
  quizzes: [{ id: 'Z2', trilha_id: t.id, licao_id: 'L2', questoes: [{ id: 'Q1', corretas: ['A1'] }, { id: 'Q2', corretas: ['B1'] }] }],
});
const estado = (extra: Partial<EstadoDoAluno> = {}): EstadoDoAluno => ({ ...estadoVazio(T, U, { perfil: 'vendedor', equipe_id: 'EQ1' }), ...extra });
let seq = 0;
const opcoes = () => ({ gerarId: () => `id-${++seq}`, params: p });

const licao = (extra: Partial<Extract<AtividadeDoAluno, { tipo: 'licao' }>> = {}): AtividadeDoAluno => ({
  tipo: 'licao',
  id: 'P1',
  trilha_id: 'TR1',
  licao_id: 'L1',
  tempo_gasto_seg: 40,
  concluida_em: '2026-11-02T13:00:00Z',
  ...extra,
});
const quiz = (extra: Partial<Extract<AtividadeDoAluno, { tipo: 'quiz' }>> = {}): AtividadeDoAluno => ({
  tipo: 'quiz',
  id: 'TQ1',
  quiz_id: 'Z2',
  realizada_em: '2026-11-02T13:05:00Z',
  respostas: [
    { questao_id: 'Q1', alternativa_ids: ['A1'] },
    { questao_id: 'Q2', alternativa_ids: ['B1'] },
  ],
  ...extra,
});

describe('aplicarAtividade — lição (RN-TRE-01, RN-TRE-04, RN-TRE-05)', () => {
  it('RN-TRE-01: lição concluída rende 10 XP + 2 de streak do 1º dia e grava a conclusão', () => {
    const { estado: e, resultado } = aplicarAtividade(estado(), licao(), conteudo(), opcoes());
    expect(resultado).toMatchObject({ status: 'aceito', tipo: 'licao', xp_ganho: 12, trilha_concluida: false });
    expect(e.conclusoes).toEqual([{ id: 'P1', trilha_id: 'TR1', licao_id: 'L1', tempo_gasto_seg: 40, concluida_em: '2026-11-02T13:00:00Z' }]);
    expect(e.lancamentos.map((l) => [l.origem, l.pontos])).toEqual([
      ['licao', 10],
      ['streak', 2],
    ]);
  });

  it('RN-TRE-04: reenvio do mesmo item (mesmo id) é duplicado e não muda o estado', () => {
    const r1 = aplicarAtividade(estado(), licao(), conteudo(), opcoes());
    const r2 = aplicarAtividade(r1.estado, licao(), conteudo(), opcoes());
    expect(r2.resultado).toEqual({ status: 'duplicado' });
    expect(r2.estado).toBe(r1.estado);
  });

  it('RN-TRE-04: a mesma lição concluída em outro aparelho (outro id) também é duplicada (paga uma vez)', () => {
    const r1 = aplicarAtividade(estado(), licao(), conteudo(), opcoes());
    const r2 = aplicarAtividade(r1.estado, licao({ id: 'P9' }), conteudo(), opcoes());
    expect(r2.resultado).toEqual({ status: 'duplicado' });
  });

  it('RN-TRE-04: abaixo do tempo mínimo é rejeitada com a mensagem do domínio', () => {
    const { resultado, estado: e } = aplicarAtividade(estado(), licao({ tempo_gasto_seg: 10 }), conteudo(), opcoes());
    expect(resultado).toMatchObject({ status: 'rejeitado', codigo: 'TEMPO_MINIMO', regra: 'RN-TRE-04' });
    expect(e.conclusoes).toHaveLength(0);
  });

  it('RF-TRE-01: lição de trilha que o aparelho não conhece é rejeitada (LICAO_DESCONHECIDA)', () => {
    expect(aplicarAtividade(estado(), licao({ trilha_id: 'TRX' }), conteudo(), opcoes()).resultado).toMatchObject({ status: 'rejeitado', codigo: 'LICAO_DESCONHECIDA' });
  });

  it('RN-TRE-07: trilha fora do público do usuário é rejeitada (FORA_DO_PUBLICO)', () => {
    const t = trilha({ publico_alvo: { perfis: ['promotor'], equipes: [] } });
    expect(aplicarAtividade(estado(), licao(), conteudo(t), opcoes()).resultado).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DO_PUBLICO', regra: 'RN-TRE-07' });
  });

  it('RN-TRE-02: lição com quiz só conclui depois do quiz aprovado', () => {
    const r1 = aplicarAtividade(estado(), licao(), conteudo(), opcoes());
    const r2 = aplicarAtividade(r1.estado, licao({ id: 'P2', licao_id: 'L2', concluida_em: '2026-11-02T13:10:00Z' }), conteudo(), opcoes());
    expect(r2.resultado).toMatchObject({ status: 'rejeitado', codigo: 'QUIZ_PENDENTE' });
  });

  it('RF-TRE-03: última lição fecha a trilha (+50 XP) e concede a medalha "primeira_trilha" uma única vez', () => {
    const { estado: e, resultados } = aplicarAtividades(estado(), [licao(), quiz(), licao({ id: 'P2', licao_id: 'L2', concluida_em: '2026-11-02T13:10:00Z' })], conteudo(), opcoes());
    expect(resultados.map((r) => r.resultado.status)).toEqual(['aceito', 'aceito', 'aceito']);
    const ultima = resultados[2]!.resultado;
    expect(ultima).toMatchObject({ status: 'aceito', trilha_concluida: true });
    expect(ultima.status === 'aceito' && ultima.lancamentos.map((l) => [l.origem, l.pontos])).toEqual([
      ['licao', 10],
      ['trilha', 50],
    ]);
    expect(e.conquistas.map((c) => c.medalha_codigo).sort()).toEqual(['nota_maxima', 'primeira_trilha']);
    // reaplicar a lista inteira não concede de novo
    const de_novo = aplicarAtividades(e, [licao({ id: 'P7', licao_id: 'L1' })], conteudo(), opcoes());
    expect(de_novo.estado.conquistas).toHaveLength(2);
  });
});

describe('aplicarAtividade — quiz (RN-TRE-02, RN-TRE-05)', () => {
  it('RN-TRE-02: 1ª tentativa aprovada rende 5 por acerto e a medalha de nota máxima', () => {
    const r1 = aplicarAtividade(estado(), licao(), conteudo(), opcoes());
    const { resultado, estado: e } = aplicarAtividade(r1.estado, quiz(), conteudo(), opcoes());
    expect(resultado).toMatchObject({ status: 'aceito', tipo: 'quiz', xp_ganho: 10 });
    expect(resultado.status === 'aceito' && resultado.conquistas.map((c) => c.medalha_codigo)).toEqual(['nota_maxima']);
    expect(e.tentativas[0]).toMatchObject({ id: 'TQ1', acertos: 2, total_questoes: 2, nota_pct: 100, aprovada: true, primeira_tentativa: true, finalizada: true });
  });

  it('RN-TRE-02: 2ª tentativa não rende XP de acerto; tentativa pior não revoga a aprovação', () => {
    const r1 = aplicarAtividades(estado(), [licao(), quiz()], conteudo(), opcoes());
    const errada = quiz({ id: 'TQ2', realizada_em: '2026-11-02T13:20:00Z', respostas: [{ questao_id: 'Q1', alternativa_ids: ['A9'] }, { questao_id: 'Q2', alternativa_ids: ['B9'] }] });
    const r2 = aplicarAtividade(r1.estado, errada, conteudo(), opcoes());
    expect(r2.resultado).toMatchObject({ status: 'aceito', xp_ganho: 0 });
    const r3 = aplicarAtividade(r2.estado, licao({ id: 'P2', licao_id: 'L2', concluida_em: '2026-11-02T13:30:00Z' }), conteudo(), opcoes());
    expect(r3.resultado).toMatchObject({ status: 'aceito', trilha_concluida: true });
  });

  it('RN-TRE-02: a 4ª tentativa do dia é recusada com o próximo horário liberado', () => {
    const tentativas = [1, 2, 3].map((n) => quiz({ id: `TQ${n}`, realizada_em: `2026-11-02T13:0${n}:00Z`, respostas: [{ questao_id: 'Q1', alternativa_ids: ['A9'] }, { questao_id: 'Q2', alternativa_ids: ['B9'] }] }));
    const r = aplicarAtividades(estado(), [licao(), ...tentativas, quiz({ id: 'TQ4', realizada_em: '2026-11-02T13:09:00Z' })], conteudo(), opcoes());
    expect(r.resultados.at(-1)!.resultado).toMatchObject({ status: 'rejeitado', codigo: 'LIMITE_DIARIO', regra: 'RN-TRE-02', proxima_em: '2026-11-03T04:00:00.000Z' });
  });

  it('RN-TRE-02: resposta a questão de outro quiz ou repetida é rejeitada (RESPOSTA_INVALIDA)', () => {
    const r1 = aplicarAtividade(estado(), licao(), conteudo(), opcoes());
    const outra = quiz({ respostas: [{ questao_id: 'QX', alternativa_ids: ['A1'] }] });
    expect(aplicarAtividade(r1.estado, outra, conteudo(), opcoes()).resultado).toMatchObject({ status: 'rejeitado', codigo: 'RESPOSTA_INVALIDA', regra: 'RN-TRE-02' });
    const repetida = quiz({ respostas: [{ questao_id: 'Q1', alternativa_ids: ['A1'] }, { questao_id: 'Q1', alternativa_ids: ['A1'] }] });
    expect(aplicarAtividade(r1.estado, repetida, conteudo(), opcoes()).resultado).toMatchObject({ codigo: 'RESPOSTA_INVALIDA' });
  });

  it('RF-TRE-01: quiz de lição bloqueada é rejeitado (LICAO_BLOQUEADA); quiz desconhecido também', () => {
    expect(aplicarAtividade(estado(), quiz(), conteudo(), opcoes()).resultado).toMatchObject({ status: 'rejeitado', codigo: 'LICAO_BLOQUEADA' });
    expect(aplicarAtividade(estado(), quiz({ quiz_id: 'ZX' }), conteudo(), opcoes()).resultado).toMatchObject({ status: 'rejeitado', codigo: 'QUIZ_DESCONHECIDO' });
  });

  it('RN-TRE-05: quiz com questão em branco não conta para o streak (nem paga o streak)', () => {
    const r1 = aplicarAtividade(estado(), licao({ concluida_em: '2026-11-01T13:00:00Z' }), conteudo(), opcoes());
    const embranco = quiz({ respostas: [{ questao_id: 'Q1', alternativa_ids: ['A1'] }] });
    const { resultado, estado: e } = aplicarAtividade(r1.estado, embranco, conteudo(), opcoes());
    expect(resultado.status === 'aceito' && resultado.lancamentos.map((l) => l.origem)).toEqual(['quiz']);
    expect(e.tentativas[0]!.finalizada).toBe(false);
  });

  it('RN-TRE-02: tentativa na trilha não publicada é rejeitada', () => {
    const t = trilha({ status: 'arquivada' });
    expect(aplicarAtividade(estado(), quiz(), conteudo(t), opcoes()).resultado).toMatchObject({ status: 'rejeitado', codigo: 'TRILHA_NAO_PUBLICADA' });
  });
});

describe('aplicarAtividades — lote offline (RN-TRE-04)', () => {
  it('RN-TRE-04: aplica na ordem do instante do fato, não na ordem de chegada (quiz antes da lição que ele libera)', () => {
    const l2 = licao({ id: 'P2', licao_id: 'L2', concluida_em: '2026-11-02T13:10:00Z' });
    const { resultados } = aplicarAtividades(estado(), [l2, quiz(), licao()], conteudo(), opcoes());
    expect(resultados.map((r) => [r.id, r.resultado.status])).toEqual([
      ['P2', 'aceito'],
      ['TQ1', 'aceito'],
      ['P1', 'aceito'],
    ]);
  });

  it('RN-TRE-01: o teto diário de 200 XP vale para o lote inteiro do dia', () => {
    const muitas: TrilhaDef = trilha({ obrigatoria: false, modulos: [{ id: 'M1', ordem: 1, licoes: Array.from({ length: 25 }, (_, i) => ({ id: `L${i + 1}`, ordem: i + 1 })) }] });
    const atividades = Array.from({ length: 25 }, (_, i) => licao({ id: `P${i + 1}`, licao_id: `L${i + 1}`, concluida_em: `2026-11-02T13:${String(i + 10).padStart(2, '0')}:00Z` }));
    const { estado: e } = aplicarAtividades(estado(), atividades, { trilhas: [muitas], quizzes: [] }, opcoes());
    expect(e.lancamentos.reduce((s, l) => s + l.pontos, 0)).toBe(200);
  });
});

describe('resumoDaJornada — tela inicial do Treinar (RF-TRE-02, RF-TRE-03, RN-TRE-05, RN-TRE-06)', () => {
  it('RN-TRE-06: XP, nível, streak, medalhas e trilhas com a próxima lição', () => {
    const { estado: e } = aplicarAtividades(estado(), [licao({ concluida_em: '2026-11-01T13:00:00Z' }), quiz()], conteudo(), opcoes());
    const j = resumoDaJornada(e, conteudo(), { hoje: '2026-11-02', params: p });
    expect(j.xp_total).toBe(12 + 10 + 4);
    expect(j.nivel).toMatchObject({ nivel: 1, xp_faltante: 100 - 26 });
    expect(j.streak).toEqual({ dias: 2, ativa_hoje: true, em_risco: false, maior: 2 });
    expect(j.xp_hoje).toBe(14);
    expect(j.trilhas).toEqual([
      { trilha_id: 'TR1', obrigatoria: true, prazo: '2026-11-10', atrasada: false, dias_para_prazo: 8, progresso_pct: 50, concluida: false, licoes_total: 2, licoes_concluidas: 1, proxima_licao_id: 'L2' },
    ]);
    expect(j.medalhas.find((m) => m.codigo === 'nota_maxima')?.conquistada_em).toBe('2026-11-02T13:05:00Z');
    expect(j.medalhas.find((m) => m.codigo === 'primeira_trilha')?.conquistada_em).toBeNull();
    expect(j.obrigatorias_pendentes).toBe(1);
  });

  it('RN-TRE-05: sem atividade hoje, a sequência de ontem aparece "em risco"', () => {
    const { estado: e } = aplicarAtividade(estado(), licao({ concluida_em: '2026-11-01T13:00:00Z' }), conteudo(), opcoes());
    expect(resumoDaJornada(e, conteudo(), { hoje: '2026-11-02', params: p }).streak).toEqual({ dias: 1, ativa_hoje: false, em_risco: true, maior: 1 });
  });

  it('RN-TRE-07: só mostra trilhas publicadas do público; obrigatórias pendentes primeiro (prazo), concluídas por último', () => {
    const outra = trilha({ id: 'TR2', obrigatoria: false, prazo: null, modulos: [{ id: 'M9', ordem: 1, licoes: [{ id: 'L9', ordem: 1 }] }] });
    const restrita = trilha({ id: 'TR3', publico_alvo: { perfis: ['promotor'], equipes: [] } });
    const rascunho = trilha({ id: 'TR4', status: 'rascunho' });
    const c: ConteudoDoAluno = { trilhas: [outra, restrita, rascunho, trilha()], quizzes: conteudo().quizzes };
    const { estado: e } = aplicarAtividade(estado(), licao({ id: 'P9', trilha_id: 'TR2', licao_id: 'L9' }), c, opcoes());
    expect(resumoDaJornada(e, c, { hoje: '2026-11-02', params: p }).trilhas.map((t) => [t.trilha_id, t.concluida])).toEqual([
      ['TR1', false],
      ['TR2', true],
    ]);
  });

  it('RN-TRE-06: estado vazio = nível 1, 0 XP, sem sequência', () => {
    const j = resumoDaJornada(estado(), conteudo(), { hoje: '2026-11-02', params: p });
    expect(j).toMatchObject({ xp_total: 0, xp_hoje: 0, streak: { dias: 0, ativa_hoje: false, em_risco: false, maior: 0 } });
    expect(j.nivel.nivel).toBe(1);
  });
});
