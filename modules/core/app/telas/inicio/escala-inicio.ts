/**
 * Escala do Início do Campo (R-20261114-153500: "no celular pequeno, grande, o app deve ser responsivo e ajustar a tela").
 * Função pura: dado o tamanho da janela, a área segura e a fonte do sistema, devolve os tamanhos de letra, os espaços e as
 * alturas do painel, dos cartões e do Sincronizar, no maior fator (<= 1) em que o Início inteiro cabe sem rolar. Letra e
 * espaço escalam juntos; a letra nunca fica abaixo de 11 dp já com a fonte do sistema (piso), e os alvos de toque seguem >= 48 dp.
 * Se nem no menor fator couber (fonte do sistema muito grande), `cabe` vem falso e o meio rola, como antes.
 *
 * A altura é estimada com 1,3 de entrelinha por linha de texto; o RN já multiplica a letra pela fonte do sistema, então aqui
 * `fontSize` é o valor base (sem `fontScale`) e `fontScale` só entra na conta da altura e no piso. Alturas e respiros do kit
 * (`ALTURA`, `ALVO_TOQUE`, `CABECALHO`) vêm de `@macuxi/ui/mobile/puro`; o respiro de cima do painel é o do `layoutCabecalho`
 * (não escala), e só ele soma a área segura.
 */
import { ALTURA, ALVO_TOQUE, CABECALHO } from '@macuxi/ui/mobile/puro';

export const FATOR_MINIMO = 0.6;
export const PISO_LETRA_DP = 11;
const ENTRELINHA = 1.3;
const MARGEM = 6;
/** Largura média de um caractere em fração do corpo da letra (IBM Plex Sans), para estimar as linhas da frase. */
const LARGURA_CARACTERE = 0.46;

export interface EntradaEscalaInicio {
  /** `useWindowDimensions().width/height/fontScale` */
  largura: number;
  altura: number;
  fontScale: number;
  /** Área segura (`useSafeAreaInsets()`). */
  topo: number;
  base: number;
  /** Texto da frase, para estimar 1 ou 2 linhas (sem ele, 1 linha). */
  frase?: string;
  /** Altura da barra de abas sem a área segura (padrão `ALTURA.barraAbas` do kit). */
  alturaAbas?: number;
}

export interface EscalaInicio {
  fator: number;
  /** Cabe sem rolar (estimativa com margem de {@link MARGEM} dp). */
  cabe: boolean;
  /** Altura estimada do Início inteiro (painel + meio + rodapé) e a disponível, em dp. */
  estimada: number;
  disponivel: number;
  fonte: { data: number; saudacao: number; frase: number; iniciais: number; h2: number; label: number; percentual: number; real: number; meta: number; sub: number; valorRodape: number; valorIndicador: number; ultima: number };
  painel: { paddingBottom: number; gap: number; avatar: number };
  meio: { paddingTop: number; paddingBottom: number; gap: number; linhaTitulo: number };
  cartao: { preenchimento: number; gap: number; barra: number; alturaMaxima: number };
  produtividade: { preenchimento: number; gapLinhas: number };
  rodape: { paddingTop: number; paddingBottom: number; botao: number };
}

const BASE = {
  fonte: { data: 14, saudacao: 24, frase: 14, iniciais: 16, h2: 17, label: 12, percentual: 14, real: 18, meta: 14, sub: 13, valorRodape: 14, valorIndicador: 18, ultima: 12 },
  painel: { paddingBottom: 16, gap: 4, avatar: 40 },
  meio: { paddingTop: 8, paddingBottom: 8, gap: 8, linhaTitulo: 32 },
  cartao: { preenchimento: 12, gap: 4, barra: 6, alturaMaxima: 132 },
  produtividade: { preenchimento: 12, gapLinhas: 8 },
  rodape: { paddingTop: 8, paddingBottom: 12, botao: ALTURA.principal },
} as const;

const arredonda = (n: number): number => Math.round(n);
const limita = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** Tamanhos para um fator; a letra respeita o piso de 11 dp com a fonte do sistema, o espaço o mínimo de 2 dp. */
export function tamanhosParaFator(fator: number, fontScale: number): Omit<EscalaInicio, 'fator' | 'cabe' | 'estimada' | 'disponivel'> {
  const fs = limita(Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1, 0.5, 3);
  const piso = Math.ceil(PISO_LETRA_DP / fs);
  const letra = (b: number): number => Math.min(b, Math.max(piso, arredonda(b * fator)));
  const esp = (b: number): number => Math.max(2, arredonda(b * fator));
  const f = BASE.fonte;
  return {
    fonte: {
      data: letra(f.data), saudacao: letra(f.saudacao), frase: letra(f.frase), iniciais: letra(f.iniciais), h2: letra(f.h2), label: letra(f.label),
      percentual: letra(f.percentual), real: letra(f.real), meta: letra(f.meta), sub: letra(f.sub), valorRodape: letra(f.valorRodape), valorIndicador: letra(f.valorIndicador),
      ultima: letra(f.ultima),
    },
    painel: { paddingBottom: esp(BASE.painel.paddingBottom), gap: esp(BASE.painel.gap), avatar: limita(esp(BASE.painel.avatar), 36, 40) },
    meio: { paddingTop: esp(BASE.meio.paddingTop), paddingBottom: esp(BASE.meio.paddingBottom), gap: esp(BASE.meio.gap), linhaTitulo: Math.max(28, esp(BASE.meio.linhaTitulo)) },
    cartao: { preenchimento: esp(BASE.cartao.preenchimento), gap: esp(BASE.cartao.gap), barra: Math.max(4, esp(BASE.cartao.barra)), alturaMaxima: BASE.cartao.alturaMaxima },
    produtividade: { preenchimento: esp(BASE.produtividade.preenchimento), gapLinhas: esp(BASE.produtividade.gapLinhas) },
    rodape: { paddingTop: esp(BASE.rodape.paddingTop), paddingBottom: esp(BASE.rodape.paddingBottom), botao: Math.max(ALVO_TOQUE, esp(BASE.rodape.botao)) },
  };
}

type Tamanhos = ReturnType<typeof tamanhosParaFator>;

/** Linhas estimadas da frase na largura útil do painel (1 ou 2; o texto tem `numberOfLines={2}`). */
export function linhasDaFrase(frase: string | undefined, corpo: number, fontScale: number, largura: number): number {
  if (!frase) return 0;
  const util = Math.max(1, largura - 40);
  return Math.min(2, Math.max(1, Math.ceil(frase.length * corpo * fontScale * LARGURA_CARACTERE / util)));
}

/** Altura estimada do Início inteiro para os tamanhos dados (dp, com a fonte do sistema). */
export function alturaEstimadaInicio(t: Tamanhos, e: Pick<EntradaEscalaInicio, 'largura' | 'fontScale' | 'topo' | 'frase'>): number {
  const fs = e.fontScale > 0 ? e.fontScale : 1;
  const linha = (corpo: number, n = 1): number => corpo * fs * ENTRELINHA * n;
  const painel =
    e.topo + CABECALHO.respiroTopo + ALVO_TOQUE + t.painel.gap + linha(t.fonte.saudacao) + (e.frase ? t.painel.gap / 2 + linha(t.fonte.frase, linhasDaFrase(e.frase, t.fonte.frase, fs, e.largura)) : 0) + t.painel.paddingBottom;
  const c = t.cartao;
  const cartao =
    2 * c.preenchimento + Math.max(linha(t.fonte.label), linha(t.fonte.percentual)) + Math.max(linha(t.fonte.real), linha(t.fonte.meta)) + c.barra + Math.max(linha(t.fonte.sub), linha(t.fonte.valorRodape)) + 3 * c.gap;
  const tituloLinha = Math.max(linha(t.fonte.h2), t.meio.linhaTitulo);
  const prod = 2 * t.produtividade.preenchimento + 2 * (linha(t.fonte.sub) + 2 + linha(t.fonte.valorIndicador)) + t.produtividade.gapLinhas;
  const meio = t.meio.paddingTop + linha(t.fonte.h2) + 2 * cartao + 4 * t.meio.gap + tituloLinha + prod + t.meio.paddingBottom;
  const rodape = t.rodape.paddingTop + t.rodape.botao + t.rodape.paddingBottom;
  return painel + meio + rodape;
}

/** O maior fator (passo de 0,02, de 1 até {@link FATOR_MINIMO}) em que o Início cabe; sem fator que sirva, o mínimo e `cabe: false`. */
export function escalaInicio(entrada: EntradaEscalaInicio): EscalaInicio {
  const abas = (entrada.alturaAbas ?? ALTURA.barraAbas) + (Number.isFinite(entrada.base) ? Math.max(0, entrada.base) : 0);
  const disponivel = entrada.altura - abas - MARGEM;
  const fs = Number.isFinite(entrada.fontScale) && entrada.fontScale > 0 ? entrada.fontScale : 1;
  const dados = { largura: entrada.largura, fontScale: fs, topo: Number.isFinite(entrada.topo) ? Math.max(0, entrada.topo) : 0, frase: entrada.frase };
  for (let passo = 0; ; passo++) {
    const fator = Math.max(FATOR_MINIMO, Math.round((1 - passo * 0.02) * 100) / 100);
    const t = tamanhosParaFator(fator, fs);
    const estimada = alturaEstimadaInicio(t, dados);
    if (estimada <= disponivel || fator === FATOR_MINIMO) return { fator, cabe: estimada <= disponivel, estimada: Math.round(estimada), disponivel: Math.round(disponivel), ...t };
  }
}
