/**
 * Escala do Início do Campo (R-20261114-153500: "no celular pequeno, grande, o app deve ser responsivo e ajustar a tela").
 * Função pura: dado o tamanho da janela, a área segura e a fonte do sistema, devolve os tamanhos de letra, os espaços e as
 * alturas do painel, dos cartões e do Sincronizar, no maior fator (<= 1) em que o Início inteiro cabe sem rolar. Letra e
 * espaço escalam juntos; a letra nunca fica abaixo de 11 dp já com a fonte do sistema (piso), e os alvos de toque seguem >= 48 dp.
 * Se nem no menor fator couber (fonte do sistema muito grande), `cabe` vem falso e o meio rola, como antes.
 *
 * A altura é estimada com 1,3 de entrelinha por linha de texto; o RN já multiplica a letra pela fonte do sistema, então aqui
 * `fontSize` é o valor base (sem `fontScale`) e `fontScale` só entra na conta da altura e no piso. Alturas e respiros do kit
 * (`ALTURA`, `ALVO_TOQUE`, `CABECALHO`) vêm de `@macuxi/ui/mobile/puro`; o painel é a variação C do cabeçalho (docs/design/telas/inicio-cabecalho.md: foto de 72 dp, piso 56, à esquerda dos textos);
 * o respiro de cima do painel é o do `layoutCabecalho` (não escala), e só ele soma a área segura.
 */
import { ALTURA, ALVO_TOQUE, CABECALHO, space } from '@macuxi/ui/mobile/puro';

export const FATOR_MINIMO = 0.6;
export const PISO_LETRA_DP = 11;
const ENTRELINHA = 1.3;
const MARGEM = 6;
/** Piso da foto do painel (variação C, 72 dp na escala cheia): nunca menor que isto. */
const AVATAR_PISO = 56;
/** Texto típico da data · DU ("Sábado, 14 de novembro · DU 11 de 23"), para estimar 1 ou 2 linhas. */
const CARACTERES_DATA = 36;
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
  /** Corpos do kit (`type.h2/label/sub/small` de `@macuxi/ui/mobile`) que o Início usa como base: a tela passa os `fontSize` deles. */
  kit: FontesDoKit;
}

export interface FontesDoKit { h2: number; label: number; sub: number; ultima: number }

export interface EscalaInicio {
  fator: number;
  /** Cabe sem rolar (estimativa com margem de {@link MARGEM} dp). */
  cabe: boolean;
  /** Altura estimada do Início inteiro (painel + meio + rodapé) e a disponível, em dp. */
  estimada: number;
  disponivel: number;
  /** Altura do painel sem a área segura: respiro de cima + max(foto, textos) + respiro de baixo, em dp. */
  painelAltura: number;
  fonte: { data: number; saudacao: number; frase: number; iniciais: number; h2: number; label: number; percentual: number; real: number; meta: number; sub: number; valorRodape: number; valorIndicador: number; ultima: number };
  painel: { paddingBottom: number; gap: number; avatar: number };
  meio: { paddingTop: number; paddingBottom: number; gap: number; linhaTitulo: number };
  cartao: { preenchimento: number; gap: number; barra: number; alturaMaxima: number };
  produtividade: { preenchimento: number; gapLinhas: number };
  rodape: { paddingTop: number; paddingBottom: number; botao: number };
}

const BASE = {
  fonte: { data: 13, saudacao: 22, frase: 13, iniciais: 24, percentual: 14, real: 18, meta: 14, valorRodape: 14, valorIndicador: 18 },
  painel: { paddingBottom: space.lg, gap: space.xxs, avatar: 72 },
  meio: { paddingTop: space.sm, paddingBottom: space.sm, gap: space.sm, linhaTitulo: 32 },
  cartao: { preenchimento: space.md, gap: space.xs, barra: 6, alturaMaxima: 132 },
  produtividade: { preenchimento: space.md, gapLinhas: space.sm },
  rodape: { paddingTop: space.sm, paddingBottom: space.md, botao: ALTURA.principal },
} as const;

const arredonda = (n: number): number => Math.round(n);
const limita = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** A única validação da fonte do sistema: inválida ou <= 0 vira 1; o resto fica entre 0,5 e 3. */
export function fonteDoSistemaValida(fontScale: number): number {
  return limita(Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1, 0.5, 3);
}

/** Tamanhos para um fator; `fs` já validado por {@link fonteDoSistemaValida}. A letra respeita o piso de 11 dp com a fonte do sistema, o espaço o mínimo de 2 dp. */
export function tamanhosParaFator(fator: number, fs: number, kit: FontesDoKit): Omit<EscalaInicio, 'fator' | 'cabe' | 'estimada' | 'disponivel' | 'painelAltura'> {
  const piso = Math.ceil(PISO_LETRA_DP / fs);
  const letra = (b: number): number => Math.min(b, Math.max(piso, arredonda(b * fator)));
  const esp = (b: number): number => Math.max(2, arredonda(b * fator));
  const f = { ...BASE.fonte, ...kit };
  return {
    fonte: {
      data: letra(f.data), saudacao: letra(f.saudacao), frase: letra(f.frase), iniciais: letra(f.iniciais), h2: letra(f.h2), label: letra(f.label),
      percentual: letra(f.percentual), real: letra(f.real), meta: letra(f.meta), sub: letra(f.sub), valorRodape: letra(f.valorRodape), valorIndicador: letra(f.valorIndicador),
      ultima: letra(f.ultima),
    },
    painel: { paddingBottom: esp(BASE.painel.paddingBottom), gap: esp(BASE.painel.gap), avatar: limita(esp(BASE.painel.avatar), AVATAR_PISO, BASE.painel.avatar) },
    meio: { paddingTop: esp(BASE.meio.paddingTop), paddingBottom: esp(BASE.meio.paddingBottom), gap: esp(BASE.meio.gap), linhaTitulo: Math.max(28, esp(BASE.meio.linhaTitulo)) },
    cartao: { preenchimento: esp(BASE.cartao.preenchimento), gap: esp(BASE.cartao.gap), barra: Math.max(4, esp(BASE.cartao.barra)), alturaMaxima: BASE.cartao.alturaMaxima },
    produtividade: { preenchimento: esp(BASE.produtividade.preenchimento), gapLinhas: esp(BASE.produtividade.gapLinhas) },
    rodape: { paddingTop: esp(BASE.rodape.paddingTop), paddingBottom: esp(BASE.rodape.paddingBottom), botao: Math.max(ALVO_TOQUE, esp(BASE.rodape.botao)) },
  };
}

type Tamanhos = ReturnType<typeof tamanhosParaFator>;

/** A única conta de linhas de um texto de `caracteres` na largura útil do painel (1 ou 2; os textos têm `numberOfLines={2}`). */
export function linhasDeTexto(caracteres: number, corpo: number, fontScale: number, largura: number, reserva = 40): number {
  const util = Math.max(1, largura - reserva);
  return Math.min(2, Math.max(1, Math.ceil(caracteres * corpo * fontScale * LARGURA_CARACTERE / util)));
}

/** A única conta de altura de texto: `n` linhas de corpo `corpo`, com a fonte do sistema e a entrelinha estimada. */
export function alturaDeLinha(corpo: number, fontScale: number, n = 1): number {
  return corpo * fontScale * ENTRELINHA * n;
}

/**
 * Altura do painel sem a área segura (variação C): respiro de cima + max(foto, saudação + data + frase) + respiro de baixo.
 * Os textos ficam à direita da foto (largura útil = janela - laterais - foto - `space.md`); a saudação divide a linha com o sino, que
 * sobe e avança no respiro (não soma altura).
 */
export function alturaDoPainel(t: Tamanhos, e: Pick<EntradaEscalaInicio, 'largura' | 'fontScale' | 'frase'>): number {
  const fs = e.fontScale;
  const linha = (corpo: number, n = 1): number => alturaDeLinha(corpo, fs, n);
  const reserva = 40 + t.painel.avatar + space.md;
  const linhasData = linhasDeTexto(CARACTERES_DATA, t.fonte.data, fs, e.largura, reserva);
  const nFrase = e.frase ? linhasDeTexto(e.frase.length, t.fonte.frase, fs, e.largura, reserva) : 0;
  const textos = linha(t.fonte.saudacao) + t.painel.gap + linha(t.fonte.data, linhasData) + (e.frase ? t.painel.gap + linha(t.fonte.frase, nFrase) : 0);
  return CABECALHO.respiroTopo + Math.max(t.painel.avatar, textos) + t.painel.paddingBottom;
}

/** Altura estimada do Início inteiro para os tamanhos dados (dp); `fontScale` já validado por {@link fonteDoSistemaValida}. */
export function alturaEstimadaInicio(t: Tamanhos, e: Pick<EntradaEscalaInicio, 'largura' | 'fontScale' | 'topo' | 'frase'>): number {
  const fs = e.fontScale;
  const linha = (corpo: number, n = 1): number => alturaDeLinha(corpo, fs, n);
  const painel = e.topo + alturaDoPainel(t, e);
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
  const fs = fonteDoSistemaValida(entrada.fontScale);
  const dados = { largura: entrada.largura, fontScale: fs, topo: Number.isFinite(entrada.topo) ? Math.max(0, entrada.topo) : 0, frase: entrada.frase };
  for (let passo = 0; ; passo++) {
    const fator = Math.max(FATOR_MINIMO, Math.round((1 - passo * 0.02) * 100) / 100);
    const t = tamanhosParaFator(fator, fs, entrada.kit);
    const estimada = alturaEstimadaInicio(t, dados);
    if (estimada <= disponivel || fator === FATOR_MINIMO) return { fator, cabe: estimada <= disponivel, estimada: Math.round(estimada), disponivel: Math.round(disponivel), painelAltura: Math.round(alturaDoPainel(t, dados)), ...t };
  }
}
