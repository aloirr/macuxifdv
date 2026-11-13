/**
 * Cabeçalho na faixa Azul noite (marca v1, T-0172; manual docs/marca/manual.md §4; guia docs/design/componentes.md §5.2).
 * Parte PURA: medidas e cores da faixa, testadas em Node. O componente é `CabecalhoTela` (cabecalho-rn.tsx), e o `Screen`
 * o monta com a prop `cabecalho`.
 *
 * A faixa começa na barra de status (o respiro de cima soma a área segura), leva o título em branco e o subtítulo em
 * `#C9CED5`; o corpo da tela fica no Pérola, com os cartões brancos. Sem logo (o Início também não leva logo).
 */
import { colors, layout } from './tokens';

export const CABECALHO = {
  /** respiro abaixo da barra de status */
  respiroTopo: 12,
  /** respiro abaixo do título (ou do subtítulo de baixo) */
  respiroBaixo: 16,
  lateral: layout.telaLateral,
  /** título: Archivo 800, 24/28 (o h1Small de hoje) */
  tamanhoTitulo: 24,
  alturaLinhaTitulo: 28,
  /** subtítulo: IBM Plex Sans 13 */
  tamanhoSubtitulo: 13,
  /** respiro entre a faixa e o primeiro bloco do corpo (no lugar dos 28 do `Screen` sem faixa) */
  respiroCorpo: 16,
  cores: {
    fundo: colors.faixa,
    titulo: colors.faixaTitulo,
    subtitulo: colors.faixaSub,
    /** "‹ Pedidos" dentro da faixa: o mesmo claro do subtítulo (8,07:1) */
    voltar: colors.faixaSub,
  },
} as const;

/** Respiros da faixa para a área segura de cima do aparelho (`useSafeAreaInsets().top`). */
export function layoutCabecalho(areaSeguraTopo: number): { paddingTop: number; paddingBottom: number; paddingHorizontal: number; backgroundColor: string } {
  const topo = Number.isFinite(areaSeguraTopo) && areaSeguraTopo > 0 ? areaSeguraTopo : 0;
  return { paddingTop: topo + CABECALHO.respiroTopo, paddingBottom: CABECALHO.respiroBaixo, paddingHorizontal: CABECALHO.lateral, backgroundColor: CABECALHO.cores.fundo };
}

/**
 * Respiro de cima do conteúdo rolável. Sem faixa, o de hoje (`top`, somando a área segura); com a faixa, a área segura já ficou
 * nela e o corpo começa a `respiroCorpo` dela.
 */
export function respiroTopoDoConteudo(comCabecalho: boolean, top: number, areaSeguraTopo: number): number {
  if (comCabecalho) return CABECALHO.respiroCorpo;
  return Math.max(top, areaSeguraTopo + top - 12);
}

/** Ícones da barra de status: claros sobre a faixa Azul noite, escuros sobre o Pérola (o shell aplica; T-0172). */
export function estiloBarraDeStatus(comCabecalho: boolean): 'light' | 'dark' {
  return comCabecalho ? 'light' : 'dark';
}
