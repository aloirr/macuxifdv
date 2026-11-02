import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { ENTIDADES_TREINAMENTO } from '../contracts/sync';
import { manifest } from '../manifest';
import { CAMINHO_LICAO, CAMINHO_QUIZ, CAMINHO_RANKING, CAMINHO_TREINAR, CAMINHO_TRILHA } from './rotas';
import LicaoScreen from './screens/licao-screen';
import QuizScreen from './screens/quiz-screen';
import RankingScreen from './screens/ranking-screen';
import TreinarScreen from './screens/treinar-screen';
import TrilhaScreen from './screens/trilha-screen';

/**
 * Telas do Treinamento no app Android (ADR 0003; T-0058): aba Treinar (jornada), mapa da trilha, lição, quiz e ranking,
 * nas variantes Campo e Gestão (todo perfil-aluno treina). Offline-first: as telas leem as linhas do pull e a fila do
 * motor; concluir lição e responder quiz entram no push `progresso` (o servidor revalida, RN-TRE-04). Só o ranking
 * (calculado no servidor) pede conexão, com o último guardado no aparelho.
 */
export const moduloApp = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    {
      id: 'treinar',
      caminho: CAMINHO_TREINAR,
      titulo: 'Treinar',
      navegacao: 'Treinar',
      icone: 'target',
      ordem: 70,
      acao: 'licao.concluir',
      apps: ['campo', 'gestao'],
      componente: TreinarScreen,
    },
    {
      id: 'trilha',
      caminho: CAMINHO_TRILHA,
      titulo: 'Trilha',
      acao: 'licao.concluir',
      apps: ['campo', 'gestao'],
      componente: TrilhaScreen,
    },
    {
      id: 'licao',
      caminho: CAMINHO_LICAO,
      titulo: 'Lição',
      acao: 'licao.concluir',
      apps: ['campo', 'gestao'],
      componente: LicaoScreen,
    },
    {
      id: 'quiz',
      caminho: CAMINHO_QUIZ,
      titulo: 'Quiz',
      acao: 'quiz.responder',
      apps: ['campo', 'gestao'],
      componente: QuizScreen,
    },
    {
      id: 'ranking',
      caminho: CAMINHO_RANKING,
      titulo: 'Ranking',
      acao: 'ranking.ver',
      apps: ['campo', 'gestao'],
      componente: RankingScreen,
    },
  ],
  entidadesSync: ENTIDADES_TREINAMENTO,
});
