/**
 * Navegação do Treinamento dentro do shell: toda tela de módulo abre em `/m/<caminho>` (ADR 0003).
 * Os caminhos precisam bater com `moduloApp.paginas` (index.ts).
 */
import { router } from 'expo-router';

export const CAMINHO_TREINAR = 'treinar';
export const CAMINHO_TRILHA = 'treinar-trilha';
export const CAMINHO_LICAO = 'treinar-licao';
export const CAMINHO_QUIZ = 'treinar-quiz';
export const CAMINHO_RANKING = 'treinar-ranking';

const rota = (caminho: string, params: Record<string, string | undefined> = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return `/m/${caminho}${qs ? `?${qs}` : ''}`;
};

export const hrefTreinar = () => rota(CAMINHO_TREINAR);
export const hrefTrilha = (id: string) => rota(CAMINHO_TRILHA, { id });
export const hrefLicao = (id: string) => rota(CAMINHO_LICAO, { id });
export const hrefQuiz = (licaoId: string, tempoSeg: number) =>
  rota(CAMINHO_QUIZ, { licao: licaoId, tempo: String(Math.max(0, Math.floor(tempoSeg))) });
export const hrefRanking = () => rota(CAMINHO_RANKING);

export const irParaTreinar = () => router.navigate(hrefTreinar() as never);
export const irParaTrilha = (id: string) => router.push(hrefTrilha(id) as never);
export const irParaLicao = (id: string) => router.push(hrefLicao(id) as never);
export const irParaQuiz = (licaoId: string, tempoSeg: number) =>
  router.replace(hrefQuiz(licaoId, tempoSeg) as never);
export const irParaRanking = () => router.push(hrefRanking() as never);
