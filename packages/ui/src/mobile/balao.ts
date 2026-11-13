/**
 * T-0165 (pedido-v4.md §5.3 e §5.4): parte PURA do `Balao`, o balão escuro que abre logo abaixo de um texto tocável (o nome
 * do produto na aba Itens mostra a descrição 2; o código no Resumo mostra "nome - marca"), com a seta apontando para ele.
 * Sem espaço embaixo, abre acima com a seta para baixo. Nunca sai da janela. Sem react-native: roda em Node (Vitest).
 */
import type { Retangulo } from './selecao';

/** Medidas: largura até 300 dp, 8 dp das bordas da janela, seta de 8 dp, 4 dp entre o alvo e a ponta da seta. */
export const BALAO = { larguraMaxima: 300, margem: 8, seta: 8, folga: 4, raio: 10, linhas: 4 } as const;

export interface PosicaoBalao {
  left: number;
  top: number;
  /** centro da seta, medido da borda esquerda do balão */
  setaX: number;
  /** true = balão acima do alvo (seta embaixo, apontando para baixo) */
  acima: boolean;
}

/** Largura máxima do balão nesta janela. */
export function larguraMaximaDoBalao(larguraJanela: number): number {
  return Math.max(0, Math.min(BALAO.larguraMaxima, larguraJanela - 2 * BALAO.margem));
}

/**
 * Onde desenhar o balão já medido (`balao`), em coordenadas da camada: alinhado à esquerda do alvo (como o texto), empurrado
 * para dentro quando passaria da borda direita; embaixo do alvo, ou acima se não couber embaixo e couber em cima. A seta fica
 * sobre o centro do alvo, sem encostar nos cantos arredondados.
 */
export function posicaoDoBalao({ alvo, janela, balao }: { alvo: Retangulo; janela: { largura: number; altura: number }; balao: { largura: number; altura: number } }): PosicaoBalao {
  const m = BALAO.margem;
  const left = Math.round(Math.min(Math.max(alvo.x, m), Math.max(m, janela.largura - m - balao.largura)));
  const ocupa = balao.altura + BALAO.seta + BALAO.folga;
  const embaixo = alvo.y + alvo.altura + ocupa <= janela.altura - m;
  const emCima = alvo.y - ocupa >= m;
  const acima = !embaixo && emCima;
  const top = Math.round(acima ? alvo.y - ocupa : alvo.y + alvo.altura + BALAO.seta + BALAO.folga);
  const centro = alvo.x + Math.min(alvo.largura, balao.largura) / 2;
  const minSeta = BALAO.raio + BALAO.seta;
  const setaX = Math.round(Math.min(Math.max(centro - left, minSeta), Math.max(minSeta, balao.largura - minSeta)));
  return { left, top, setaX, acima };
}
