/**
 * Tema do app (Campo e Gestão): reexporta os tokens puros (`tokens.ts`) e monta os estilos de texto do React Native.
 * Um único lugar para cor, fonte, raio, espaçamento, sombra e movimento (T-0072; guia em docs/design/componentes.md).
 */
import { StyleSheet, type TextStyle } from 'react-native';

import { colors, radius } from './tokens';

export * from './tokens';
export * from './movimento';

/**
 * Fonte do SISTEMA (R-20261115-110600, v1.0.13): saem Archivo e IBM Plex. No Android a família é a padrão do aparelho
 * (Roboto na maioria) e a hierarquia vem só do PESO (`fontWeight` 400 · 500 · 600 · 700); códigos em `monospace` com
 * algarismos tabulares. Uso: `{ ...fonte.semibold, fontSize: 14 }`, sem `fontFamily`. Os nomes de antes ficam (display,
 * body, semibold…) para a troca ser só de `fontFamily: fonts.x` por `...fonte.x`.
 */
export const fonte = {
  display: { fontWeight: '700' },
  displayBold: { fontWeight: '700' },
  displaySemi: { fontWeight: '600' },
  body: { fontWeight: '400' },
  medium: { fontWeight: '500' },
  semibold: { fontWeight: '600' },
  bold: { fontWeight: '700' },
  mono: { fontFamily: 'monospace', fontWeight: '400', fontVariant: ['tabular-nums'] },
} as const satisfies Record<string, TextStyle>;

/**
 * @deprecated Transição para as telas que ainda usam `fontFamily: fonts.x`: famílias do sistema Android por nome (só há
 * 400, 500 e 900 por nome). Troque por `...fonte.x`, que dá o peso certo (600 e 700).
 */
export const fonts = {
  display: 'sans-serif-black',
  displayBold: 'sans-serif-medium',
  displaySemi: 'sans-serif-medium',
  body: 'sans-serif',
  medium: 'sans-serif-medium',
  semibold: 'sans-serif-medium',
  bold: 'sans-serif-medium',
  mono: 'monospace',
} as const;

/** Alvo de toque mínimo (48 dp, Material; era 44 até a T-0071). */
export const TOUCH = 48;

export type Tone = 'success' | 'warning' | 'danger' | 'accent' | 'neutral';

export const toneColors: Record<Tone, { fg: string; bg: string }> = {
  success: { fg: colors.success, bg: colors.successBg },
  warning: { fg: colors.warning, bg: colors.warningBg },
  danger: { fg: colors.danger, bg: colors.dangerBg },
  accent: { fg: colors.accentInk, bg: colors.accentSoft },
  neutral: { fg: colors.neutralInk, bg: colors.neutralBg },
};

/**
 * Tipografia na fonte do sistema, escala do app 12 · 14 · 16 (base) · 18 · 22 · 28 (`ESCALA_FONTE`; nada abaixo de 12).
 * Nomes antigos mantidos (h1, h2, sub, body…); os novos (`saudacao`, `titulo`, `secao`, `numeroGrande`, `rotulo`, `botao`) seguem o guia de 03/11.
 */
export const type = StyleSheet.create({
  h1: { ...fonte.display, fontSize: 28, letterSpacing: -0.3, color: colors.ink },
  h1Small: { ...fonte.display, fontSize: 22, lineHeight: 28, color: colors.ink },
  h2: { ...fonte.displayBold, fontSize: 18, color: colors.ink },
  sub: { ...fonte.body, fontSize: 14, color: colors.ink2 },
  body: { ...fonte.body, fontSize: 16, color: colors.ink },
  bodyStrong: { ...fonte.semibold, fontSize: 16, color: colors.ink },
  title16: { ...fonte.semibold, fontSize: 16, color: colors.ink },
  small: { ...fonte.body, fontSize: 12, color: colors.ink2 },
  smallStrong: { ...fonte.semibold, fontSize: 12, color: colors.ink2 },
  label: { ...fonte.semibold, fontSize: 12, color: colors.ink2 },
  mono: { ...fonte.mono, fontSize: 12, color: colors.ink2 },
  number: { ...fonte.displayBold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  /** "Bom dia, Lucas" */
  saudacao: { ...fonte.display, fontSize: 28, letterSpacing: -0.3, color: colors.ink },
  /** título de folha e de diálogo */
  titulo: { ...fonte.display, fontSize: 18, color: colors.ink },
  /** título de seção ("Sua meta de hoje") */
  secao: { ...fonte.displayBold, fontSize: 18, color: colors.ink },
  /** valor em destaque (R$ 1.240, 2 de 6) */
  numeroGrande: { ...fonte.displayBold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  /** rótulo pequeno em maiúsculas ("RECADO DO DIA") */
  rotulo: { ...fonte.semibold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2 },
  /** texto de botão de 44 (o de 52 usa 16) */
  botao: { ...fonte.semibold, fontSize: 14 },
});

export const ui = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.cartao },
  row: { flexDirection: 'row', alignItems: 'center' },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
