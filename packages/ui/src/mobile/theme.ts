/**
 * Tema do app (Campo e Gestão): reexporta os tokens puros (`tokens.ts`) e monta os estilos de texto do React Native.
 * Um único lugar para cor, fonte, raio, espaçamento, sombra e movimento (T-0072; guia em docs/design/componentes.md).
 */
import { Platform, StyleSheet, type TextStyle } from 'react-native';

import { colors, radius } from './tokens';

export * from './tokens';
export * from './movimento';

/**
 * Fonte do SISTEMA (R-20261115-110600, v1.0.13; manual da marca §5), sem fonte carregada e sem `fontFamily` (o Android usa
 * a do aparelho; o Expo web, a pilha do sistema do react-native-web). A hierarquia vem do PESO, um nome por peso:
 * `body` 400 texto · `medium` 500 rótulo e meta · `semibold` 600 ênfase, rótulo de campo, botão, valor e aba ativa ·
 * `bold` 700 títulos. Nada em 800/900. `mono` só em código (SKU, código, chave, senha provisória), com algarismos tabulares.
 * Uso: `{ ...fonte.semibold, fontSize: 14 }`.
 */
const PESO = {
  body: { fontWeight: '400' },
  medium: { fontWeight: '500' },
  semibold: { fontWeight: '600' },
  bold: { fontWeight: '700' },
} as const satisfies Record<string, TextStyle>;

export const fonte = {
  ...PESO,
  mono: { fontFamily: 'monospace', fontWeight: '400', fontVariant: ['tabular-nums'] },
  /** @deprecated Apelido de `fonte.bold` (700, título), ainda usado nos módulos e no shell; sai na v1.0.14 (RD-0942). */
  display: PESO.bold,
  /** @deprecated Apelido de `fonte.bold` (700, título), ainda usado nos módulos e no shell; sai na v1.0.14 (RD-0942). */
  displayBold: PESO.bold,
} as const satisfies Record<string, TextStyle>;

/**
 * @deprecated Transição da v1.0.13: os módulos e o shell trocam `fontFamily: fonts.x` por `...fonte.x`; sai na limpeza
 * deste lote (branch `nuvem/fonte-sistema-designer-ux-limpeza`). Android: famílias do sistema por nome, só 400
 * (`sans-serif`) e 500 (`sans-serif-medium`), nunca a família de peso 900; web e demais: a pilha do sistema, sem serifa.
 */
export const fonts = Platform.select({
  android: {
    display: 'sans-serif-medium',
    displayBold: 'sans-serif-medium',
    body: 'sans-serif',
    medium: 'sans-serif-medium',
    semibold: 'sans-serif-medium',
    bold: 'sans-serif-medium',
    mono: 'monospace',
  },
  // pilha do sistema escrita aqui de propósito: sai na limpeza deste lote
  default: {
    display: 'system-ui, "Segoe UI", Roboto, -apple-system, sans-serif',
    displayBold: 'system-ui, "Segoe UI", Roboto, -apple-system, sans-serif',
    body: 'system-ui, "Segoe UI", Roboto, -apple-system, sans-serif',
    medium: 'system-ui, "Segoe UI", Roboto, -apple-system, sans-serif',
    semibold: 'system-ui, "Segoe UI", Roboto, -apple-system, sans-serif',
    bold: 'system-ui, "Segoe UI", Roboto, -apple-system, sans-serif',
    mono: 'monospace',
  },
});

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
 * Estilos de texto por PAPEL (manual da marca §5; escala do app 12 · 14 · 16 · 18 · 22 · 28, `ESCALA_FONTE`). Um nome por papel:
 * | papel | estilo | tamanho/peso |
 * | número grande | `h1` | 28/700 |
 * | título de tela, folha e diálogo | `h1Small` | 22/700 |
 * | saudação ("Bom dia, Lucas"), no Início do Campo e do Gestão | `saudacao` | 22/700 |
 * | título de seção ("Sua meta de hoje") | `h2` | 18/700 |
 * | valor em destaque (R$ 1.240, 2 de 6) | `number` | 18/600 tabular |
 * | texto | `body` | 16/400 |
 * | ênfase no texto, título de linha | `bodyStrong` | 16/600 |
 * | secundário, apoio | `sub` | 14/400 |
 * | legenda | `small` | 12/400 |
 * | rótulo pequeno | `label` | 12/600 |
 * | rótulo em maiúsculas ("RECADO DO DIA") | `rotulo` | 12/600 |
 * `saudacao` é o mesmo estilo de `h1Small` (RD-0957: um tamanho só nas duas boas-vindas; o Início do Campo lê o `fontSize` daqui).
 * `title16` e `smallStrong` são apelidos de `bodyStrong` e `label` (o mesmo objeto), mantidos porque o shell e os módulos usam.
 */
const estilosDeTexto = StyleSheet.create({
  h1: { ...fonte.bold, fontSize: 28, letterSpacing: -0.3, color: colors.ink },
  h1Small: { ...fonte.bold, fontSize: 22, lineHeight: 28, color: colors.ink },
  h2: { ...fonte.bold, fontSize: 18, color: colors.ink },
  number: { ...fonte.semibold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  body: { ...fonte.body, fontSize: 16, color: colors.ink },
  bodyStrong: { ...fonte.semibold, fontSize: 16, color: colors.ink },
  sub: { ...fonte.body, fontSize: 14, color: colors.ink2 },
  small: { ...fonte.body, fontSize: 12, color: colors.ink2 },
  label: { ...fonte.semibold, fontSize: 12, color: colors.ink2 },
  rotulo: { ...fonte.semibold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2 },
});

export const type = {
  ...estilosDeTexto,
  /** "Bom dia, Lucas" no Início do Campo e do Gestão: 22/700, o mesmo estilo de `h1Small` (RD-0957). */
  saudacao: estilosDeTexto.h1Small,
  /** @deprecated o mesmo estilo de `bodyStrong` (RD-0942); sai na v1.0.14. */
  title16: estilosDeTexto.bodyStrong,
  /** @deprecated o mesmo estilo de `label` (RD-0942); sai na v1.0.14. */
  smallStrong: estilosDeTexto.label,
};

export const ui = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.cartao },
  row: { flexDirection: 'row', alignItems: 'center' },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
