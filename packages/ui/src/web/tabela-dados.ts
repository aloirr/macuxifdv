/**
 * Regras puras da tabela de dados do BKO (revisão do BKO, docs/design/telas/bko-revisao.md §P2, R-20261114-142000).
 *
 * - Nada de rolagem lateral: a tabela ocupa a largura do quadro (`table-fixed`) e corta o texto longo com reticências.
 * - Prioridade da coluna: 1 = sempre; 2 = aparece com o quadro a partir de 672 px; 3 = a partir de 1024 px. A medida é a do
 *   quadro (consulta de contêiner `@container/tabela`), não a da janela: o mesmo componente serve na página, na gaveta e no diálogo.
 * - Ações da linha num menu "⋯" (`MenuAcoes`): a última coluna tem largura fixa e nunca corta o rótulo.
 * - Navegação do menu pelo teclado: setas para baixo/cima, Home e End (reaproveita `indiceDaTecla` das abas).
 */
import { indiceDaTecla } from './abas';

export type PrioridadeDaColuna = 1 | 2 | 3;

/** Largura do quadro (px) a partir da qual a coluna aparece. Bate com os tamanhos de contêiner do Tailwind (@2xl e @5xl). */
export const LARGURA_MINIMA_DA_PRIORIDADE: Readonly<Record<PrioridadeDaColuna, number>> = { 1: 0, 2: 672, 3: 1024 };

/** Classe da célula (cabeçalho e corpo) para a prioridade. As classes ficam escritas por inteiro para o Tailwind achar. */
export function classeDaPrioridade(prioridade: PrioridadeDaColuna = 1): string {
  if (prioridade === 2) return 'hidden @2xl/tabela:table-cell';
  if (prioridade === 3) return 'hidden @5xl/tabela:table-cell';
  return '';
}

/** Colunas que aparecem num quadro desta largura (a mesma regra das classes; para teste e para o CSV de "colunas visíveis"). */
export function colunasVisiveis<C extends { prioridade?: PrioridadeDaColuna }>(colunas: readonly C[], larguraDoQuadro: number): C[] {
  return colunas.filter((c) => larguraDoQuadro >= LARGURA_MINIMA_DA_PRIORIDADE[c.prioridade ?? 1]);
}

/** Largura fixa da coluna do menu "⋯" (o botão de 36 px e o respiro da célula). */
export const LARGURA_COLUNA_ACOES = 52;

const PARTICULAS = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'di', 'du', 'del']);

/**
 * Nome que veio TODO em maiúsculas do ERP ("JOSÉ CARLOS DA SILVA") vira nome próprio ("José Carlos da Silva"): caixa-alta
 * pesa na tabela e ocupa mais largura. Nome com alguma minúscula fica como está (a pessoa escreveu assim). Siglas curtas
 * sem vogal (LTDA, ME, EPP, S/A) ficam em maiúsculas.
 */
export function nomeLegivel(nome: string): string {
  const t = nome.trim();
  if (!t || t !== t.toLocaleUpperCase('pt-BR') || t === t.toLocaleLowerCase('pt-BR')) return nome;
  return t
    .split(/\s+/)
    .map((p, i) => {
      const min = p.toLocaleLowerCase('pt-BR');
      if (i > 0 && PARTICULAS.has(min)) return min;
      if (/^(LTDA|ME|EPP|EIRELI|S\/A|SA|S\.A\.)$/.test(p) || !/[AEIOUÁÉÍÓÚÂÊÔÃÕÀ]/.test(p)) return p;
      return min.replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, l: string) => sep + l.toLocaleUpperCase('pt-BR'));
    })
    .join(' ');
}

/** Tecla no menu "⋯": seta para baixo/cima anda (com volta nas pontas), Home e End vão às pontas; pula itens desligados. */
const TECLA_DO_MENU: Readonly<Record<string, string>> = { ArrowDown: 'ArrowRight', ArrowUp: 'ArrowLeft', Home: 'Home', End: 'End' };

export function indiceNoMenu(tecla: string, atual: number, desligadas: ReadonlyArray<boolean>): number | null {
  const equivalente = TECLA_DO_MENU[tecla];
  return equivalente ? indiceDaTecla(equivalente, atual, desligadas) : null;
}

export interface PosicaoDoMenu {
  top?: number;
  bottom?: number;
  right: number;
}

/**
 * Onde abrir o menu "⋯" (posição `fixed`, para nenhum quadro cortar): alinhado à direita do botão, abaixo dele; se não
 * cabe embaixo e cabe em cima, abre para cima.
 */
export function posicaoDoMenu(botao: { top: number; bottom: number; right: number }, janela: { largura: number; altura: number }, alturaDoMenu: number): PosicaoDoMenu {
  const right = Math.max(8, janela.largura - botao.right);
  const cabeEmbaixo = botao.bottom + 4 + alturaDoMenu <= janela.altura - 8;
  const cabeEmCima = botao.top - 4 - alturaDoMenu >= 8;
  if (!cabeEmbaixo && cabeEmCima) return { bottom: janela.altura - botao.top + 4, right };
  return { top: botao.bottom + 4, right };
}
