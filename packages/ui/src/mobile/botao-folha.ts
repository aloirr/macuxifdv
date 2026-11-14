/**
 * RD-0039: parte PURA do `BotaoFolha` e da `LinhaOpcaoFolha`, os botões das folhas de ação do pedido (excluir pedido, gerar PDF).
 * Diferem do `Button`/`Botao` do kit de propósito: o perigo é vermelho sólido com texto branco (o `danger` do kit é claro), o raio
 * é `radius.lg`, o toque é por opacidade 0,8 (sem escala) e o desligado mantém a cor. Sem react-native: roda em Node.
 */
import { colors, radius } from './tokens';

export const BOTAO_FOLHA = {
  altura: { confirmar: 50, voltar: 46 },
  raio: radius.lg,
  opacidadeAoTocar: 0.8,
  tons: {
    /** Texto branco (`onAccent`) sobre `danger`: confirmar o que não tem volta (Excluir pedido). */
    perigo: { fundo: colors.danger, texto: colors.onAccent, borda: null, larguraBorda: 0 },
    /** Voltar / cancelar da mesma folha. */
    contorno: { fundo: colors.surface, texto: colors.ink, borda: colors.lineStrong, larguraBorda: 1 },
  },
} as const;

export type TomBotaoFolha = keyof typeof BOTAO_FOLHA.tons;

/** Altura explícita ou, por padrão, 50 dp no perigo (confirmar) e 46 dp no contorno (voltar). */
export function alturaDoBotaoFolha(tom: TomBotaoFolha, altura?: number): number {
  return altura ?? (tom === 'perigo' ? BOTAO_FOLHA.altura.confirmar : BOTAO_FOLHA.altura.voltar);
}

/** Fonte 15 nos botões de 50 dp ou mais; 14 nos menores. */
export function fonteDoBotaoFolha(altura: number): number {
  return altura >= 50 ? 15 : 14;
}

/** Linha de opção da folha (ex.: "PDF para o cliente"): ícone num quadrado, título, texto e seta. */
export const LINHA_OPCAO_FOLHA = {
  alturaMinima: 64,
  raio: radius.lg,
  borda: colors.lineStrong,
  fundo: colors.surface,
  fundoAoTocar: colors.ground,
  opacidadeDesligada: 0.6,
  icone: { lado: 38, tamanho: 18, fundo: colors.accentSoft, cor: colors.accentInk },
  seta: { tamanho: 16, cor: colors.ink3 },
  tamanhoTitulo: 15,
} as const;
