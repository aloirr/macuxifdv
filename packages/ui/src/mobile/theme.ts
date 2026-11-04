/**
 * Tokens visuais do app do vendedor (docs/05-app-mobile.md e mockups em /mockups).
 * Um único lugar para cor, fonte, raio e espaçamento.
 */
import { StyleSheet } from 'react-native';

export const colors = {
  ground: '#F3F4F1',
  surface: '#FFFFFF',
  ink: '#16202A',
  ink2: '#4A5562',
  ink3: '#5B6673',
  line: '#E1E4DE',
  lineSoft: '#ECEEE9',
  lineStrong: '#C9CEC6',
  accent: '#C2540A',
  accentLight: '#F59A52',
  accentSoft: '#FBE9DC',
  accentInk: '#8F3D06',
  accentTint: '#FDF4EC',
  success: '#1D6B4F',
  successBg: '#E2F1EA',
  warning: '#7A4F00',
  warningInk: '#5C3B00',
  warningBg: '#FFF1D6',
  danger: '#A8261B',
  dangerBg: '#FDE8E6',
  neutralBg: '#E6E9E2',
  neutralInk: '#34404D',
  /** roxo da referência do Novo pedido (selo de orçamento, T-0071): contraste 7,9:1 sobre o fundo */
  violet: '#4B2FA3',
  violetBg: '#ECE7FB',
  darkMuted: '#C9D0D8',
  darkTrack: '#34404D',
  mapBg: '#E6E9E2',
  mapBorder: '#D6DAD1',
} as const;

/** Famílias carregadas em app/_layout.tsx (uma família por peso: não usar fontWeight). */
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

export const radius = { sm: 8, md: 12, lg: 14, xl: 16, xxl: 18 } as const;

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

export const type = StyleSheet.create({
  h1: { fontFamily: fonts.display, fontSize: 26, letterSpacing: -0.26, color: colors.ink },
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
});

export const ui = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl },
  row: { flexDirection: 'row', alignItems: 'center' },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
