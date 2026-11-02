import { describe, expect, it } from 'vitest';
import { acharLicao, AtividadeEnvio, conteudoParaDominio, entidadeProgresso, ENTIDADES_TREINAMENTO, quizzesDaTrilha, RankingQuery, TrilhaEdicao, trilhaParaPublicar } from './index';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const edicao = TrilhaEdicao.parse({
  id: id(1),
  titulo: 'Boas-vindas',
  obrigatoria: true,
  modulos: [
    {
      id: id(2),
      ordem: 1,
      titulo: 'Começo',
      licoes: [
        { id: id(3), ordem: 1, titulo: 'Quem somos', tipo: 'texto', texto: 'Olá' },
        {
          id: id(4),
          ordem: 2,
          titulo: 'Produtos',
          tipo: 'video',
          midia_url: 'https://exemplo.com.br/v.mp4',
          duracao_estimada_seg: 120,
          quiz: { id: id(5), questoes: [{ id: id(6), ordem: 1, enunciado: '2 + 2?', alternativas: [{ id: id(7), texto: '4', correta: true }, { id: id(8), texto: '5', correta: false }] }] },
        },
      ],
    },
  ],
});

describe('contratos de conteúdo (RF-TRE-01)', () => {
  it('RF-TRE-01: aplica os padrões do cadastro (sequencial, público vazio = todo o tenant, sem prazo)', () => {
    expect(edicao).toMatchObject({ sequencial: true, prazo: null, descricao: null, publico_alvo: { perfis: [], equipes: [] } });
    expect(edicao.modulos[0]!.licoes[0]).toMatchObject({ pre_requisitos: [], quiz: null, midia_url: null, duracao_estimada_seg: null });
  });

  it('RF-TRE-01: recusa campo desconhecido, título vazio e perfil inexistente no público', () => {
    expect(TrilhaEdicao.safeParse({ ...edicao, extra: 1 }).success).toBe(false);
    expect(TrilhaEdicao.safeParse({ ...edicao, titulo: ' ' }).success).toBe(false);
    expect(TrilhaEdicao.safeParse({ ...edicao, publico_alvo: { perfis: ['astronauta'], equipes: [] } }).success).toBe(false);
  });

  it('RN-TRE-04: converte para o domain com o quiz de cada lição e a duração estimada', () => {
    const c = conteudoParaDominio([{ ...edicao, status: 'publicada' }]);
    expect(c.trilhas[0]!.modulos[0]!.licoes[1]).toEqual({ id: id(4), ordem: 2, pre_requisitos: [], quiz_id: id(5), duracao_estimada_seg: 120 });
    expect(quizzesDaTrilha(edicao)).toEqual([{ id: id(5), trilha_id: id(1), licao_id: id(4), questoes: [{ id: id(6), corretas: [id(7)] }] }]);
    expect(trilhaParaPublicar({ ...edicao, status: 'rascunho' }).quizzes[0]!.questoes[0]!.alternativas).toHaveLength(2);
    expect(acharLicao(edicao, id(4))?.licao.titulo).toBe('Produtos');
    expect(acharLicao(edicao, id(99))).toBeNull();
  });
});

describe('contratos de sync (RN-TRE-04)', () => {
  it('RN-TRE-04: o push `progresso` aceita lição e quiz, e recusa o que não é de nenhum dos dois', () => {
    expect(AtividadeEnvio.parse({ tipo: 'licao', id: id(10), trilha_id: id(1), licao_id: id(3), concluida_em: '2026-11-02T13:00:00Z', tempo_gasto_seg: 40 }).tipo).toBe('licao');
    expect(AtividadeEnvio.parse({ tipo: 'quiz', id: id(11), quiz_id: id(5), realizada_em: '2026-11-02T13:00:00Z', respostas: [{ questao_id: id(6), alternativa_ids: [id(7)] }] }).tipo).toBe('quiz');
    expect(AtividadeEnvio.safeParse({ tipo: 'pedido', id: id(12) }).success).toBe(false);
    expect(AtividadeEnvio.safeParse({ tipo: 'licao', id: id(10), trilha_id: id(1), licao_id: id(3), concluida_em: '2026-11-02T13:00:00Z', tempo_gasto_seg: 40, usuario_id: id(9) }).success).toBe(false);
  });

  it('ADR 0009: só `progresso` aceita push; o resto é só pull', () => {
    expect(entidadeProgresso.direcao).toBe('ambos');
    expect(ENTIDADES_TREINAMENTO.filter((e) => e.direcao !== 'pull').map((e) => e.nome)).toEqual(['progresso']);
  });

  it('RN-TRE-03: ranking padrão = semanal e geral', () => {
    expect(RankingQuery.parse({})).toEqual({ periodo: 'semanal', escopo: 'geral' });
  });
});
