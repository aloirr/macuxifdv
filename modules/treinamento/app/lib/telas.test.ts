import { describe, expect, it } from 'vitest';
import type { TrilhaSyncLinha } from '../../contracts';
import { resolverParametros, type EstadoDoAluno } from '../../domain';
import { licaoNaTela, mapaDaTrilha, marcarAlternativa, mostraHoraDaSincronizacao, questoesDaTela, trilhasComTitulo } from './telas';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MARCO = '2026-11-01T12:00:00Z';
const [TR, M1, M2, L1, L2, L3, QUIZ, Q1, Q2] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const licao = (lid: string, ordem: number, extra: Record<string, unknown> = {}) => ({
  id: lid,
  ordem,
  titulo: `Lição ${ordem}`,
  tipo: 'texto' as const,
  texto: 'x',
  midia_url: null,
  duracao_estimada_seg: null,
  pre_requisitos: [],
  quiz: null,
  ...extra,
});
const trilha: TrilhaSyncLinha = {
  id: TR,
  tenant_id: id(900),
  titulo: 'Boas-vindas',
  descricao: null,
  obrigatoria: true,
  sequencial: true,
  prazo: null,
  publico_alvo: { perfis: [], equipes: [] },
  status: 'publicada',
  publicada_em: MARCO,
  arquivada_em: null,
  created_at: MARCO,
  updated_at: MARCO,
  deleted_at: null,
  modulos: [
    { id: M2, ordem: 2, titulo: 'Depois', pre_requisitos: [], licoes: [licao(L3, 1)] },
    {
      id: M1,
      ordem: 1,
      titulo: 'Começo',
      pre_requisitos: [],
      licoes: [
        licao(L2, 2, {
          duracao_estimada_seg: 600,
          quiz: {
            id: QUIZ,
            questoes: [
              {
                id: Q2,
                ordem: 2,
                enunciado: 'Quais?',
                alternativas: [
                  { id: id(20), texto: 'a', correta: true },
                  { id: id(21), texto: 'b', correta: true },
                  { id: id(22), texto: 'c', correta: false },
                ],
              },
              {
                id: Q1,
                ordem: 1,
                enunciado: 'Qual?',
                alternativas: [
                  { id: id(10), texto: 'a', correta: true },
                  { id: id(11), texto: 'b', correta: false },
                ],
              },
            ],
          },
        }),
        licao(L1, 1),
      ],
    },
  ],
};
const estado = (
  concluidas: string[] = [],
  aprovado = false,
): Pick<EstadoDoAluno, 'conclusoes' | 'tentativas'> => ({
  conclusoes: concluidas.map((l, i) => ({
    id: id(50 + i),
    trilha_id: TR,
    licao_id: l,
    tempo_gasto_seg: 40,
    concluida_em: MARCO,
  })),
  tentativas: aprovado
    ? [
        {
          id: id(60),
          quiz_id: QUIZ,
          realizada_em: MARCO,
          respostas: [],
          acertos: 2,
          total_questoes: 2,
          nota_pct: 100,
          aprovada: true,
          primeira_tentativa: true,
          finalizada: true,
        },
      ]
    : [],
});
const p = resolverParametros();

describe('mapa da trilha (RF-TRE-01, RF-TRE-02)', () => {
  it('RF-TRE-01: módulos e lições em ordem, com o status do domain (sequencial)', () => {
    const mapa = mapaDaTrilha(trilha, estado([L1]));
    expect(mapa.map((m) => [m.titulo, m.status])).toEqual([
      ['Começo', 'liberado'],
      ['Depois', 'bloqueado'],
    ]);
    expect(mapa[0]!.licoes.map((l) => [l.id, l.status, l.tem_quiz])).toEqual([
      [L1, 'concluida', false],
      [L2, 'liberada', true],
    ]);
    expect(mapa[1]!.licoes[0]!.status).toBe('bloqueada');
  });
});

describe('lição na tela (RN-TRE-02, RN-TRE-04)', () => {
  it('RN-TRE-04: tempo mínimo = maior entre 30 s e 50% da duração; lição com quiz pendente pede o quiz', () => {
    const l = licaoNaTela([trilha], L2, estado([L1]), p)!;
    expect(l).toMatchObject({
      modulo_titulo: 'Começo',
      status: 'liberada',
      tempo_minimo_seg: 300,
      precisa_quiz: true,
    });
    expect(licaoNaTela([trilha], L1, estado(), p)).toMatchObject({
      tempo_minimo_seg: 30,
      precisa_quiz: false,
    });
  });

  it('RN-TRE-02: quiz já aprovado — a lição conclui direto', () => {
    expect(licaoNaTela([trilha], L2, estado([L1], true), p)!.precisa_quiz).toBe(false);
  });

  it('lição inexistente = null', () => {
    expect(licaoNaTela([trilha], id(99), estado(), p)).toBeNull();
  });
});

describe('quiz na tela (RN-TRE-02)', () => {
  const l = trilha.modulos[1]!.licoes[0]!;

  it('RN-TRE-02: questões em ordem; múltipla escolha quando há mais de uma correta; a tela não recebe a resposta certa', () => {
    const qs = questoesDaTela(l);
    expect(qs.map((q) => [q.id, q.multipla])).toEqual([
      [Q1, false],
      [Q2, true],
    ]);
    expect(JSON.stringify(qs)).not.toContain('correta');
  });

  it('RN-TRE-02: escolha simples troca a marcada; múltipla alterna', () => {
    const [simples, multipla] = questoesDaTela(l) as [
      ReturnType<typeof questoesDaTela>[number],
      ReturnType<typeof questoesDaTela>[number],
    ];
    let m = marcarAlternativa({}, simples, id(10));
    m = marcarAlternativa(m, simples, id(11));
    expect(m[Q1]).toEqual([id(11)]);
    m = marcarAlternativa(m, multipla, id(20));
    m = marcarAlternativa(m, multipla, id(21));
    m = marcarAlternativa(m, multipla, id(20));
    expect(m[Q2]).toEqual([id(21)]);
  });
});

describe('trilhas da jornada com título', () => {
  it('RF-TRE-02: junta o título da linha e mantém a ordem do domain', () => {
    const j = {
      trilhas: [
        {
          trilha_id: TR,
          obrigatoria: true,
          prazo: null,
          atrasada: false,
          dias_para_prazo: null,
          progresso_pct: 0,
          concluida: false,
          licoes_total: 3,
          licoes_concluidas: 0,
          proxima_licao_id: L1,
        },
      ],
    };
    expect(trilhasComTitulo(j, [trilha])[0]!.titulo).toBe('Boas-vindas');
  });
});

describe('mostraHoraDaSincronizacao (R-20261120-055304 item 6)', () => {
  it('no Campo (vendedor e promotor) a hora fica só no Início; no Gestão (supervisor e gerente) fica no Treinar', () => {
    expect(mostraHoraDaSincronizacao('vendedor')).toBe(false);
    expect(mostraHoraDaSincronizacao('promotor')).toBe(false);
    expect(mostraHoraDaSincronizacao('supervisor')).toBe(true);
    expect(mostraHoraDaSincronizacao('gerente')).toBe(true);
  });
});
