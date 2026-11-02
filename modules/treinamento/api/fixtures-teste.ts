/** Conteúdo de exemplo para os testes da API (não é importado pelo código de produção). */
import type { TrilhaEdicaoEntrada } from '../contracts/conteudo';
import type { AtividadeEnvio } from '../contracts/sync';
import { uuid } from './apoio-teste';

export const IDS = {
  trilha: uuid(1, '1a000000'),
  modulo: uuid(2, '1a000000'),
  l1: uuid(3, '1a000000'),
  l2: uuid(4, '1a000000'),
  quiz: uuid(5, '1a000000'),
  q1: uuid(6, '1a000000'),
  a1: uuid(7, '1a000000'),
  a2: uuid(8, '1a000000'),
  q2: uuid(9, '1a000000'),
  b1: uuid(10, '1a000000'),
  b2: uuid(11, '1a000000'),
};

/** Trilha de 2 lições; a 2ª tem quiz de 2 questões (A1 e B1 corretas). */
export function trilhaEdicao(extra: Partial<TrilhaEdicaoEntrada> = {}): TrilhaEdicaoEntrada {
  return {
    id: IDS.trilha,
    titulo: 'Boas-vindas ao time',
    obrigatoria: true,
    modulos: [
      {
        id: IDS.modulo,
        ordem: 1,
        titulo: 'Começo',
        licoes: [
          { id: IDS.l1, ordem: 1, titulo: 'Quem somos', tipo: 'texto', texto: 'Nossa história.' },
          {
            id: IDS.l2,
            ordem: 2,
            titulo: 'Nossos produtos',
            tipo: 'texto',
            texto: 'Linha de produtos.',
            quiz: {
              id: IDS.quiz,
              questoes: [
                { id: IDS.q1, ordem: 1, enunciado: 'Qual é a marca?', alternativas: [{ id: IDS.a1, texto: 'Macuxi', correta: true }, { id: IDS.a2, texto: 'Outra', correta: false }] },
                { id: IDS.q2, ordem: 2, enunciado: 'Qual é a cidade?', alternativas: [{ id: IDS.b1, texto: 'Boa Vista', correta: true }, { id: IDS.b2, texto: 'Outra', correta: false }] },
              ],
            },
          },
        ],
      },
    ],
    ...extra,
  };
}

export const licaoEnvio = (id: string, licaoId: string, concluida_em: string, tempo = 45): AtividadeEnvio => ({ tipo: 'licao', id, trilha_id: IDS.trilha, licao_id: licaoId, concluida_em, tempo_gasto_seg: tempo });

export const quizEnvio = (id: string, realizada_em: string, certas = true): AtividadeEnvio => ({
  tipo: 'quiz',
  id,
  quiz_id: IDS.quiz,
  realizada_em,
  respostas: [
    { questao_id: IDS.q1, alternativa_ids: [certas ? IDS.a1 : IDS.a2] },
    { questao_id: IDS.q2, alternativa_ids: [certas ? IDS.b1 : IDS.b2] },
  ],
});
