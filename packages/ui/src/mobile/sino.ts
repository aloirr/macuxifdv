/** Sino de notificações padrão do kit (parte pura do `SinoNotificacoes`; spec docs/design/componentes.md §5.4). */
import { ALVO_TOQUE } from './componentes';
import { radius } from './tokens';

export const SINO = {
  /** alvo de toque e caixa do botão (48 × 48 dp) */
  botao: ALVO_TOQUE,
  raio: radius.md,
  borda: 1,
  /** ícone `bell` */
  icone: 22,
  /** bolinha (sem número): 12 dp com aro de 2, no canto de cima do ícone */
  bolinha: 12,
  aroBolinha: 2,
  /** distância da bolinha à borda de cima e à direita do botão */
  recuoBolinha: 10,
} as const;

/** Cores do sino por nome de token (`colors` do kit); `transparente` = sem fundo. Parecer de marca MC-0009 (v1.0.6). */
export interface CoresDoSino {
  botaoFundo: 'surface' | 'transparente';
  botaoBorda: 'line' | 'faixaTrilho';
  icone: 'ink' | 'faixaTitulo';
  bolinhaFundo: 'grafico' | 'graficoEscuro';
  /** aro da bolinha: a cor do fundo atrás do sino, para a bolinha se destacar do ícone */
  bolinhaAro: 'ground' | 'faixa';
}

/**
 * Na faixa Azul noite (padrão de todas as telas, inclusive o Início): botão vazado com borda `faixaTrilho`, ícone branco e bolinha
 * Sol claro (`graficoEscuro`, 5,85:1 na faixa) com aro `faixa`. Fora da faixa (tela sem cabeçalho, no Pérola): botão branco e
 * bolinha laranja (`grafico`) com aro `ground`.
 */
export function coresDoSino(sobreFaixa: boolean): CoresDoSino {
  return sobreFaixa
    ? { botaoFundo: 'transparente', botaoBorda: 'faixaTrilho', icone: 'faixaTitulo', bolinhaFundo: 'graficoEscuro', bolinhaAro: 'faixa' }
    : { botaoFundo: 'surface', botaoBorda: 'line', icone: 'ink', bolinhaFundo: 'grafico', bolinhaAro: 'ground' };
}

/** Bolinha acesa quando há recado ou tarefa nova (o total vem do shell, contado uma vez; sem número, decisão de 14/11/2026). */
export function temNovoNoSino(total: number): boolean {
  return Number.isFinite(total) && total > 0;
}

/** Leitura do botão no TalkBack. */
export function leituraDoSino(total: number): string {
  return temNovoNoSino(total) ? 'Recados e tarefas, há novos' : 'Recados e tarefas';
}
