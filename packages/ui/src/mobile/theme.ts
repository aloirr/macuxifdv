/**
 * Tema do app (Campo e Gestão): reexporta os tokens puros (`tokens.ts`) e monta os estilos de texto do React Native.
 * Um único lugar para cor, fonte, raio, espaçamento, sombra e movimento (T-0072; guia em docs/design/componentes.md).
 */
import { StyleSheet } from 'react-native';

import { colors, radius } from './tokens';

export * from './tokens';
export * from './movimento';

/**
 * Famílias carregadas em apps/mobile/src/app/_layout.tsx (`@expo-google-fonts/*`, já no shell: uma família por peso,
 * não usar fontWeight). Archivo nos títulos e números; IBM Plex Sans no texto.
 */
export const fonts = {
  display: 'Archivo_800ExtraBold',
  displayBold: 'Archivo_700Bold',
  displaySemi: 'Archivo_600SemiBold',
  body: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
  mono: 'IBMPlexMono_500Medium',
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
 * Tipografia. Títulos e números em Archivo; texto em IBM Plex Sans. Nomes antigos mantidos (h1, h2, sub, body…);
 * os novos (`saudacao`, `titulo`, `secao`, `numeroGrande`, `rotulo`, `botao`) seguem o guia de 03/11.
 */
export const type = StyleSheet.create({
  h1: { fontFamily: fonts.display, fontSize: 26, letterSpacing: -0.3, color: colors.ink },
  h1Small: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28, color: colors.ink },
  h2: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.ink2 },
  body: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  title16: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.ink2 },
  smallStrong: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },
  mono: { fontFamily: fonts.mono, fontSize: 11, color: colors.ink2 },
  number: { fontFamily: fonts.displayBold, fontSize: 19, color: colors.ink, fontVariant: ['tabular-nums'] },
  /** "Bom dia, Lucas" */
  saudacao: { fontFamily: fonts.display, fontSize: 26, letterSpacing: -0.3, color: colors.ink },
  /** título de folha e de diálogo */
  titulo: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  /** título de seção ("Sua meta de hoje") */
  secao: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink },
  /** valor em destaque (R$ 1.240, 2 de 6) */
  numeroGrande: { fontFamily: fonts.displayBold, fontSize: 19, color: colors.ink, fontVariant: ['tabular-nums'] },
  /** rótulo pequeno em maiúsculas ("RECADO DO DIA") */
  rotulo: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2 },
  /** texto de botão de 44 (o de 52 usa 16) */
  botao: { fontFamily: fonts.semibold, fontSize: 14 },
});

export const ui = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.cartao },
  row: { flexDirection: 'row', alignItems: 'center' },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
