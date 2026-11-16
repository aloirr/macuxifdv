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

/**
 * Cores da `BarraProgresso` no diálogo da sincronização completa (R-20261115-100000): sempre o tema Pérola, nos dois apps
 * (o diálogo é claro). Derivadas de `TEMAS_ENTRADA.perola`, sem repetir hex.
 */
export const CORES_BARRA_DIALOGO: { texto: string; trilho: string; preenchimento: string } = {
  texto: TEMAS_ENTRADA.perola.texto,
  trilho: TEMAS_ENTRADA.perola.trilho,
  preenchimento: TEMAS_ENTRADA.perola.preenchimento,
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
    { uso: 'Você sabia?', fg: t.texto, bg: t.fundo, tipo: 'texto' },
    { uso: 'frase da carga', fg: t.textoClaro, bg: t.fundo, tipo: 'texto' },
    { uso: 'aviso da carga', fg: t.textoClaro, bg: t.fundo, tipo: 'texto' },
    { uso: 'lâmpada do Você sabia?', fg: t.preenchimento, bg: t.fundo, tipo: 'grafico' },
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

/**
 * Medidas do título "Você sabia?", da frase sorteada e do aviso da tela de carga (estados 4 e 5; T-0181,
 * docs/design/carga-aviso-frases/spec.md §1 e §1.1, ajuste R-20261115-080500). Em dp; `fonte` é a chave de `fonte` (theme.ts, fonte do sistema: só o peso).
 * Cores do tema: título em `texto`; lâmpada (`<Icon name="lampada">`) em `preenchimento` (gráfico); frase e aviso em
 * `textoClaro`. O aviso não tem destaque: sem caixa, sem borda, sem fundo, sem negrito, 1 linha na escala 1,0, nunca cortado (sem tokens de aviso; MC-0078 caiu).
 * Bloco "Você sabia?": 86 dp com a frase em 2 linhas, 66 dp com 1. Em tela baixa, a frase cai para 1 linha (só se couber
 * inteira) ou o bloco inteiro sai; o título nunca aparece sozinho (`cabeFrase`, no shell).
 */
export const MEDIDAS_FRASE_CARGA = {
  titulo: {
    /** Do pé do "Olá" ao topo do título. */
    abaixoDoOla: 20,
    /** Lâmpada à esquerda do texto, centralizada com ele; o par fica centralizado na tela. */
    lampada: 16,
    lampadaAoTexto: 6,
    fonte: 'semibold',
    tamanho: 14,
    linha: 20,
    /** Do pé do título ao topo da frase. */
    ateFrase: 6,
  },
  frase: {
    larguraMax: 280,
    linhasMax: 2,
    /** Livre entre o pé da frase e o topo do aviso; sem isso, 1 linha ou nada (spec §1.1). */
    livreAteAviso: 24,
    fonte: 'body',
    tamanho: 14,
    linha: 20,
  },
  aviso: {
    fonte: 'body',
    tamanho: 14,
    linha: 20,
    /** Do pé do aviso à linha da barra. */
    acimaDaBarra: 10,
    /**
     * Linhas na escala de fonte 1,0. Nunca é cortado: com fonte grande pode quebrar em 2 (`linhasDoAviso`, no shell, conta as 2).
     * Não muda com a altura da tela.
     */
    linhas: 1,
  },
} as const;
