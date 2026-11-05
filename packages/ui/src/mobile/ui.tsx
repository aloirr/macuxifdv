/**
 * Peças de interface reutilizadas pelas telas (seguem os mockups). Visual revisto na T-0072 (guia de 03/11) com as
 * MESMAS props: `Button` segue os níveis (accent = principal; outlineDark = secundário; ghost = neutro; danger = perigo),
 * desabilitado cinza legível e toque que afunda (escala 0,97; só opacidade com "reduzir movimento").
 * Para tela nova, prefira `Botao`, `Cartao` e `ChipEstado` (base.tsx).
 */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DentroDeCartao, useDentroDeCartao } from './base';
import { layoutCarregando, rotuloDoVoltar } from './componentes';
import { Icon, type IconName } from './icon';
import { Pressionavel } from './movimento-rn';
import { formatHHMM } from './time';
import { useVoltarDaTela } from './voltar';
import { BOTAO_DESABILITADO, colors, fonts, radius, toneColors, TOUCH, type as t, type Tone } from './theme';

/** Área rolável da tela com o respiro do mockup (28 no topo, 20 nas laterais). */
export function Screen({
  children,
  gap = 14,
  top = 28,
  refreshing,
  onRefresh,
  contentStyle,
  testID,
}: {
  children: ReactNode;
  gap?: number;
  top?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      testID={testID}
      style={{ flex: 1, backgroundColor: colors.ground }}
      contentContainerStyle={[{ paddingTop: Math.max(top, insets.top + top - 12), paddingHorizontal: 20, paddingBottom: 20, gap }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.accent} /> : undefined}>
      {children}
    </ScrollView>
  );
}

/**
 * Voltar da tela ("‹ Pedidos"). O rótulo diz para onde o voltar leva: o shell pode trocá-lo pelo `ProvedorVoltar` (raiz de pilha
 * aberta pelo Início → "Início"); sem provedor, vale o `label` do módulo (§6.1 de docs/design/componentes.md).
 */
export function BackLink({ label, fallback }: { label: string; fallback: string }) {
  const rotulo = rotuloDoVoltar(label, useVoltarDaTela());
  return (
    <Pressionavel
      accessibilityRole="link"
      accessibilityLabel={rotulo.acessivel}
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback as never))}
      escala={false}
      style={styles.back}>
      <Icon name="back" size={18} color={colors.ink2} />
      <Text style={styles.backText} numberOfLines={1}>
        {rotulo.visivel}
      </Text>
    </Pressionavel>
  );
}

type ButtonVariant = 'accent' | 'dark' | 'outline' | 'outlineDark' | 'success' | 'ghost' | 'danger' | 'locked' | 'muted';

export function Button({
  label,
  onPress,
  variant = 'accent',
  icon,
  disabled,
  loading,
  height = 44,
  style,
  textStyle,
  testID,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const off = Boolean(disabled || loading);
  const v = disabled ? { ...BUTTON[variant], bg: BOTAO_DESABILITADO.fundo, fg: BOTAO_DESABILITADO.texto, border: 'transparent', borderWidth: 0 } : BUTTON[variant];
  const grande = height >= 52;
  return (
    <Pressionavel
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy: Boolean(loading) }}
      disabled={off}
      onPress={onPress}
      vibrar={variant === 'accent'}
      style={[
        styles.button,
        { height, backgroundColor: v.bg, borderColor: v.border, borderWidth: v.borderWidth, borderRadius: grande ? radius.botao : radius.botaoMedio },
        style,
      ]}>
      {loading ? <ActivityIndicator color={v.fg} size="small" /> : icon ? <Icon name={icon} size={grande ? 18 : 16} color={v.fg} /> : null}
      <Text style={[styles.buttonText, { color: v.fg, fontSize: grande ? 16 : 14 }, textStyle]} numberOfLines={1}>
        {label}
      </Text>
    </Pressionavel>
  );
}

/** Variantes antigas → níveis do guia (T-0072). */
const BUTTON: Record<ButtonVariant, { bg: string; fg: string; border: string; borderWidth: number }> = {
  /** = nível principal (um só por tela) */
  accent: { bg: colors.accent, fg: '#FFFFFF', border: 'transparent', borderWidth: 0 },
  dark: { bg: colors.ink, fg: '#FFFFFF', border: 'transparent', borderWidth: 0 },
  /** secundário claro (borda cinza) */
  outline: { bg: colors.surface, fg: colors.ink, border: colors.lineStrong, borderWidth: 1 },
  /** = nível secundário (borda grafite 1,5) */
  outlineDark: { bg: colors.surface, fg: colors.ink, border: colors.ink, borderWidth: 1.5 },
  success: { bg: colors.success, fg: '#FFFFFF', border: 'transparent', borderWidth: 0 },
  /** = nível neutro (Cancelar) */
  ghost: { bg: colors.lineSoft, fg: colors.ink, border: 'transparent', borderWidth: 0 },
  /** = nível perigo (Rejeitar, Excluir) */
  danger: { bg: colors.dangerBg, fg: colors.danger, border: 'transparent', borderWidth: 0 },
  /** check-in bloqueado por outro atendimento aberto (cinza com cadeado) */
  locked: { bg: colors.lineSoft, fg: colors.ink3, border: 'transparent', borderWidth: 0 },
  /** ação já feita (ex.: "Visitado") */
  muted: { bg: colors.lineSoft, fg: colors.ink3, border: 'transparent', borderWidth: 0 },
};

export function Badge({ label, tone, fg, bg, style }: { label: string; tone?: Tone; fg?: string; bg?: string; style?: StyleProp<ViewStyle> }) {
  const c = tone ? toneColors[tone] : { fg: fg ?? colors.neutralInk, bg: bg ?? colors.neutralBg };
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }, style]}>
      <Text style={[styles.badgeText, { color: c.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Chip de escolha (prazo, transportadora, filtro). `rotuloAcessivel` é o que o leitor de tela lê quando o rótulo visível é
 * abreviado ("28 d" → "28 dias"); sem ele, lê o `label` (T-0072, revisão de UX do novo pedido).
 */
export function Chip({ label, active, onPress, testID, rotuloAcessivel }: { label: string; active: boolean; onPress: () => void; testID?: string; rotuloAcessivel?: string }) {
  return (
    <Pressionavel
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={rotuloAcessivel ?? label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      style={[styles.chip, active ? styles.chipOn : styles.chipOff]}>
      <Text style={[styles.chipText, { color: active ? '#FFFFFF' : colors.ink }]}>{label}</Text>
    </Pressionavel>
  );
}

export function Banner({ children, icon = 'wifiOff', tone = 'warning', testID }: { children: ReactNode; icon?: IconName; tone?: 'warning' | 'success' | 'danger'; testID?: string }) {
  const c = tone === 'warning' ? { bg: colors.warningBg, fg: colors.warningInk } : tone === 'success' ? { bg: colors.successBg, fg: colors.success } : { bg: colors.dangerBg, fg: colors.danger };
  return (
    <View testID={testID} style={[styles.banner, { backgroundColor: c.bg }]}>
      <View style={{ marginTop: 1 }}>
        <Icon name={icon} size={18} color={c.fg} />
      </View>
      <Text style={[styles.bannerText, { color: c.fg }]}>{children}</Text>
    </View>
  );
}

export function Strong({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: fonts.bold }}>{children}</Text>;
}

export function ProgressBar({ pct, color = colors.accent, track = colors.lineSoft, height = 8 }: { pct: number; color?: string; track?: string; height?: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}>
      <View style={{ width: `${w}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

export function SectionHeader({ title, right, onRightPress, rightTestID }: { title: string; right?: string; onRightPress?: () => void; rightTestID?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={t.h2}>{title}</Text>
      {right ? (
        onRightPress ? (
          <Pressable testID={rightTestID} onPress={onRightPress} hitSlop={10} accessibilityRole="link">
            <Text style={styles.sectionLink}>{right}</Text>
          </Pressable>
        ) : (
          <Text style={t.small}>{right}</Text>
        )
      ) : null}
    </View>
  );
}

export function Card({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View testID={testID} style={[styles.card, style]}>
      <DentroDeCartao value>{children}</DentroDeCartao>
    </View>
  );
}

/** Quadradinho com ícone colorido (lista "Precisa de atenção", gatilho de metas). */
export function IconTile({ icon, tone, size = 32 }: { icon: IconName; tone: Tone; size?: number }) {
  const c = toneColors[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={16} color={c.fg} strokeWidth={icon === 'check' ? 2.4 : 2} />
    </View>
  );
}

export function SyncStamp({ at, offline, tz }: { at: string | null | undefined; offline: boolean; tz: string }) {
  const color = offline ? colors.warning : colors.success;
  return (
    <View style={styles.stamp} accessibilityLabel={offline ? 'Modo sem sinal' : `Última sincronização ${at ? formatTime(at, tz) : 'nunca'}`}>
      <Icon name={offline ? 'wifiOff' : 'sync'} size={14} color={color} />
      <Text style={[styles.stampText, { color }]}>{offline ? 'sem sinal' : at ? formatTime(at, tz) : '--:--'}</Text>
    </View>
  );
}

function formatTime(at: string, tz: string) {
  return formatHHMM(at, tz);
}

export function Empty({ text }: { text: string }) {
  return <Text style={[t.sub, { paddingVertical: 20, paddingHorizontal: 14 }]}>{text}</Text>;
}

/**
 * Carregando. Em tela cheia ocupa o espaço que sobra com o fundo da tela; dentro de `Cartao`/`Card` (detectado
 * sozinho) ou com `embutido`, fica compacto: altura mínima de 96, sem flex e sem fundo próprio (o do cartão).
 */
export function Loading({ embutido, testID }: { embutido?: boolean; testID?: string } = {}) {
  const dentroDeCartao = useDentroDeCartao();
  const compacto = embutido ?? dentroDeCartao;
  return (
    <View testID={testID} style={[layoutCarregando(compacto), compacto ? null : { backgroundColor: colors.ground }]}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  back: { alignSelf: 'flex-start', height: TOUCH, flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  backText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink2 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  buttonText: { fontFamily: fonts.semibold, fontSize: 14 },
  /** chip de estado pequeno do guia (24 dp, pílula); a cor sempre vem com o texto */
  badge: { borderRadius: radius.pilula, paddingHorizontal: 10, minHeight: 24, justifyContent: 'center', alignSelf: 'flex-start' },
  badgeText: { fontFamily: fonts.semibold, fontSize: 12 },
  chip: { height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipOff: { backgroundColor: colors.surface, borderColor: colors.lineStrong },
  chipText: { fontFamily: fonts.semibold, fontSize: 13 },
  banner: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: radius.cartao, paddingVertical: 12, paddingHorizontal: 14 },
  bannerText: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 17.5 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionLink: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accent },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.cartao },
  stamp: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stampText: { fontFamily: fonts.body, fontSize: 12 },
});
