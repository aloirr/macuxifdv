/**
 * Cores da tela de entrada (splash + sincronização numa tela só; T-0172, docs/design/entrada-sync.md §4). Puro.
 * Dois temas, um por app, iguais ao fundo da splash nativa de cada um (manual da marca §6), para a passagem não ter corte:
 * - `faixa` (Macuxi Campo): Azul noite com o logo negativo (proposta entrada-sync §2);
 * - `perola` (Macuxi Gestão): Pérola com o logo positivo; o laranja só na barra (gráfico).
 * Só cores da paleta da marca (nada "quase igual", manual §3). Os pares estão em `PARES_DA_ENTRADA`, medidos no teste.
 */
import { FAIXA, GRAFICO, MARCA, type ParContraste } from '../comum/contraste';
import { colors } from './tokens';

export interface TemaEntrada {
  fundo: string;
  logo: 'negativo' | 'positivo';
  /** Ícones da barra de status do Android sobre o fundo. */
  barraDeStatus: 'light' | 'dark';
  /** Nome da etapa, percentual, etapa atual e etapas feitas. */
  texto: string;
  /** "Olá, Lucas", etapas que faltam, nome do app no rodapé e "Trocar usuário". */
  textoClaro: string;
  /** Trilho da barra: só fundo; a informação está no preenchimento. */
  trilho: string;
  /** Preenchimento da barra e ponto da etapa atual (gráfico). */
  preenchimento: string;
  /** ✓ da etapa feita. */
  feita: string;
  /** Ícone e texto do erro ("Sem internet na etapa 3 de 5"). */
  erro: string;
  /** "Tentar de novo" (principal): fundo e texto. */
  botaoFundo: string;
  botaoTexto: string;
  /** "Continuar sem sincronizar" (secundário, só contorno): borda e texto. */
  contorno: string;
  contornoTexto: string;
}

export const TEMAS_ENTRADA: Record<'faixa' | 'perola', TemaEntrada> = {
  faixa: {
    fundo: FAIXA.fundo,
    logo: 'negativo',
    barraDeStatus: 'light',
    texto: FAIXA.titulo,
    textoClaro: FAIXA.subtitulo,
    trilho: FAIXA.trilho,
    preenchimento: GRAFICO.sobreEscuro,
    feita: FAIXA.feito,
    erro: FAIXA.erro,
    botaoFundo: MARCA.branco,
    botaoTexto: MARCA.azulNoite,
    contorno: FAIXA.subtitulo,
    contornoTexto: MARCA.branco,
  },
  perola: {
    fundo: MARCA.perola,
    logo: 'positivo',
    barraDeStatus: 'dark',
    texto: MARCA.azulNoite,
    textoClaro: MARCA.textoSecundario,
    trilho: MARCA.azulSuave,
    preenchimento: GRAFICO.cor,
    feita: colors.success,
    erro: colors.danger,
    botaoFundo: MARCA.azulNoite,
    botaoTexto: MARCA.branco,
    contorno: MARCA.grafite,
    contornoTexto: MARCA.grafite,
  },
};

/** Tema pela variante do app: o Gestão no Pérola (splash dele), o Campo na faixa Azul noite. */
export function temaDaEntrada(variante: 'campo' | 'gestao'): TemaEntrada {
  return variante === 'gestao' ? TEMAS_ENTRADA.perola : TEMAS_ENTRADA.faixa;
}

/** Pares de cada tema com o mínimo do tipo (texto 4,5; gráfico e contorno 3). */
export function paresDaEntrada(t: TemaEntrada): ParContraste[] {
  return [
    { uso: 'etapa e percentual', fg: t.texto, bg: t.fundo, tipo: 'texto' },
    { uso: 'Olá, etapas que faltam, Trocar usuário', fg: t.textoClaro, bg: t.fundo, tipo: 'texto' },
    { uso: 'preenchimento da barra no fundo', fg: t.preenchimento, bg: t.fundo, tipo: 'grafico' },
    { uso: 'preenchimento da barra no trilho', fg: t.preenchimento, bg: t.trilho, tipo: 'grafico' },
    { uso: '✓ da etapa feita', fg: t.feita, bg: t.fundo, tipo: 'texto' },
    { uso: 'erro', fg: t.erro, bg: t.fundo, tipo: 'texto' },
    { uso: 'Tentar de novo', fg: t.botaoTexto, bg: t.botaoFundo, tipo: 'texto' },
    { uso: 'Tentar de novo (forma) no fundo', fg: t.botaoFundo, bg: t.fundo, tipo: 'grafico' },
    { uso: 'Continuar sem sincronizar (contorno)', fg: t.contorno, bg: t.fundo, tipo: 'grafico' },
    { uso: 'Continuar sem sincronizar (texto)', fg: t.contornoTexto, bg: t.fundo, tipo: 'texto' },
  ];
}
