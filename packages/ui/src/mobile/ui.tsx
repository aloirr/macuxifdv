/**
 * Peças de interface reutilizadas pelas telas (seguem os mockups). Visual revisto na T-0072 (guia de 03/11) com as
 * MESMAS props: `Button` segue os níveis (accent = principal; outlineDark = secundário; ghost = neutro; danger = perigo),
 * desabilitado cinza legível e toque que afunda (escala 0,97; só opacidade com "reduzir movimento").
 * Para tela nova, prefira `Botao`, `Cartao` e `ChipEstado` (base.tsx).
 */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DentroDeCartao, useDentroDeCartao } from './base';
import { CABECALHO, layoutCabecalho, respiroTopoDoConteudo } from './cabecalho';
import { formaDoBadge, layoutCarregando, type LinhasBadge, rotuloDoVoltar, tocarNoVoltar } from './componentes';
import { Icon, type IconName } from './icon';
import { Pressionavel } from './movimento-rn';
import { formatHHMM } from './time';
import { useSaidaDaTela, useSinoCabecalho, useVoltarDaTela } from './voltar';
import { BOTAO_DESABILITADO, colors, CORES_CHIP, fonte, radius, toneColors, TOUCH, type as t, type Tone } from './theme';

export interface PropsCabecalhoTela {
  titulo: string;
  /** Uma linha em `#C9CED5` (ex.: "Quinta, 12 de novembro", "12 clientes"). Sem frase sobre o que o app faz por trás. */
  subtitulo?: string;
  /** `acima`: o subtítulo vem antes do título (a data acima de "Bom dia, Lucas" no Início). Padrão: abaixo. */
  posicaoSubtitulo?: 'acima' | 'abaixo';
  /** Voltar dentro da faixa ("‹ Pedidos"), com as mesmas regras do `BackLink`. */
  voltar?: { label: string; fallback: string; aoVoltar?: () => void; testID?: string };
  /** Ação curta à direita do título (ícone de 48 dp). Nunca o botão principal da tela e nada grafite (some no Azul noite). */
  direita?: ReactNode;
  testID?: string;
}

/**
 * Cabeçalho da tela na faixa Azul noite (marca v1, T-0172; docs/design/componentes.md §5.2): começa na barra de status, título
 * branco (sistema 700, 22) e subtítulo `#C9CED5`. Fica parado em cima; o corpo rola embaixo, no Pérola. Use pelo `Screen`
 * (`cabecalho={{ titulo, subtitulo }}`) ou sozinho, acima de uma lista própria.
 */
export function CabecalhoTela({ titulo, subtitulo, posicaoSubtitulo = 'abaixo', voltar, direita, testID = 'cabecalho-tela' }: PropsCabecalhoTela) {
  const insets = useSafeAreaInsets();
  // T-0170: sino do shell (ProvedorSinoCabecalho) depois da ação da tela; sem provedor, null e nada muda
  const sino = useSinoCabecalho();
  const sub = subtitulo ? (
    <Text style={styles.cabecalhoSub} numberOfLines={1}>
      {subtitulo}
    </Text>
  ) : null;
  return (
    <View testID={testID} style={layoutCabecalho(insets.top)}>
      {voltar ? <BackLink {...voltar} sobreFaixa /> : null}
      <View style={styles.cabecalhoLinha}>
        <View style={{ flex: 1, gap: 2 }}>
          {posicaoSubtitulo === 'acima' ? sub : null}
          <Text style={styles.cabecalhoTitulo} accessibilityRole="header" numberOfLines={2}>
            {titulo}
          </Text>
          {posicaoSubtitulo === 'abaixo' ? sub : null}
        </View>
        {direita}
        {sino}
      </View>
    </View>
  );
}

/**
 * Área rolável da tela com o respiro do mockup (28 no topo, 20 nas laterais). Com `cabecalho`, a faixa Azul noite fica parada em
 * cima (T-0172) e o corpo começa 16 abaixo dela.
 */
export function Screen({
  children,
  gap = 14,
  top = 28,
  refreshing,
  onRefresh,
  contentStyle,
  cabecalho,
  testID,
}: {
  children: ReactNode;
  gap?: number;
  top?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  /** Faixa Azul noite com o título da tela (marca v1). Sem ela, a tela fica como antes. */
  cabecalho?: PropsCabecalhoTela;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const rolavel = (
    <ScrollView
      testID={testID}
      style={{ flex: 1, backgroundColor: colors.ground }}
      contentContainerStyle={[{ paddingTop: respiroTopoDoConteudo(Boolean(cabecalho), top, insets.top), paddingHorizontal: 20, paddingBottom: 20, gap }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.accent} /> : undefined}>
      {children}
    </ScrollView>
  );
  if (!cabecalho) return rolavel;
  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <CabecalhoTela {...cabecalho} />
      {rolavel}
    </View>
  );
}

/**
 * Voltar da tela ("‹ Pedidos"). O rótulo diz para onde o voltar leva: o shell pode trocá-lo pelo `ProvedorVoltar` (raiz de pilha
 * aberta pelo Início → "Início"); sem provedor, vale o `label` do módulo (§6.1 de docs/design/componentes.md).
 */
export function BackLink({
  label,
  fallback,
  aoVoltar,
  sobreFaixa,
  testID,
}: {
  label: string;
  fallback: string;
  /**
   * Troca o voltar padrão (T-0133, pedido do modulo-vendedor no R-20261108-133640): o formulário alterado abre a folha
   * "Sair do pedido?" antes de sair (RN-VEN-38). Sem a prop, volta na pilha (ou vai ao `fallback`).
   */
  aoVoltar?: () => void;
  /** Dentro da faixa Azul noite (`CabecalhoTela`): seta e rótulo em `#C9CED5`. */
  sobreFaixa?: boolean;
  testID?: string;
}) {
  const rotulo = rotuloDoVoltar(label, useVoltarDaTela());
  const cor = sobreFaixa ? CABECALHO.cores.voltar : colors.ink2;
  // T-0128: sem `aoVoltar`, o toque passa pelo bloqueio de saída do shell (`ProvedorSaidaDaTela`), se houver
  const saida = useSaidaDaTela();
  const seguir = () => (router.canGoBack() ? router.back() : router.replace(fallback as never));
  return (
    <Pressionavel
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={rotulo.acessivel}
      onPress={() => tocarNoVoltar({ aoVoltar, saida, seguir })}
      escala={false}
      style={styles.back}>
      <Icon name="back" size={18} color={cor} />
      <Text style={[styles.backText, { color: cor }]} numberOfLines={1}>
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
  onPressIn,
  onPressOut,
  desenharIcone,
  accessibilityActions,
  onAccessibilityAction,
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
  /** Segurar (R-20261115-100000, `BotaoSincronizar`): o dedo encostou / saiu. Opcionais; sem eles nada muda. */
  onPressIn?: () => void;
  onPressOut?: () => void;
  /** Troca o ícone por um desenho na cor do texto do botão (ex.: o anel do segurar). Ganha do `icon`. */
  desenharIcone?: (cor: string) => ReactNode;
  /** Ações do leitor de tela (ex.: "Sincronização completa"). */
  accessibilityActions?: readonly AccessibilityActionInfo[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
}) {
  const off = Boolean(disabled || loading);
  const v = disabled ? { ...BUTTON[variant], bg: BOTAO_DESABILITADO.fundo, fg: BOTAO_DESABILITADO.texto, border: 'transparent', borderWidth: 0 } : BUTTON[variant];
  const grande = height >= 52;
  const tamIcone = grande ? 18 : 16;
  return (
    <Pressionavel
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy: Boolean(loading) }}
      disabled={off}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      vibrar={variant === 'accent'}
      style={[
        styles.button,
        { height, backgroundColor: v.bg, borderColor: v.border, borderWidth: v.borderWidth, borderRadius: grande ? radius.botao : radius.botaoMedio },
        style,
      ]}>
      {loading ? <ActivityIndicator color={v.fg} size="small" /> : desenharIcone ? desenharIcone(v.fg) : icon ? <Icon name={icon} size={tamIcone} color={v.fg} /> : null}
      <Text style={[styles.buttonText, { color: v.fg, fontSize: grande ? 16 : 14 }, textStyle]} numberOfLines={1}>
        {label}
      </Text>
    </Pressionavel>
  );
}

/** Variantes antigas → níveis do guia (T-0072). */
const BUTTON: Record<ButtonVariant, { bg: string; fg: string; border: string; borderWidth: number }> = {
  /** = nível principal (um só por tela) */
  accent: { bg: colors.accent, fg: colors.onAccent, border: 'transparent', borderWidth: 0 },
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

/**
 * Chip de estado antigo (pílula de 24 dp). `linhas` (padrão 1) existe para a coluna estreita de tabela, ex.: Status do
 * Histórico do Cliente 360 (92 dp), onde "Devolvido parcial" não cabe numa linha (MC-1790, T-0186): com `linhas={2}` o texto
 * quebra em até 2 linhas, centralizado (lineHeight 16, paddingVertical 3), e o raio passa de pílula a `radius.sm` (8) para
 * não virar um ovo. minHeight 24 continua. Regra pura em `formaDoBadge` (componentes.ts).
 */
export function Badge({ label, tone, fg, bg, style, linhas = 1 }: { label: string; tone?: Tone; fg?: string; bg?: string; style?: StyleProp<ViewStyle>; linhas?: LinhasBadge }) {
  const c = tone ? toneColors[tone] : { fg: fg ?? colors.neutralInk, bg: bg ?? colors.neutralBg };
  const f = formaDoBadge(linhas);
  return (
    <View style={[styles.badge, { backgroundColor: c.bg, borderRadius: f.borderRadius, paddingVertical: f.paddingVertical }, style]}>
      <Text style={[styles.badgeText, { color: c.fg, lineHeight: f.lineHeight, textAlign: f.textAlign }]} numberOfLines={f.numberOfLines}>
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
      <Text style={[styles.chipText, { color: active ? CORES_CHIP.ativo.texto : CORES_CHIP.inativo.texto }]}>{label}</Text>
    </Pressionavel>
  );
}

/**
 * Aviso em faixa. `anunciar` (T-0088): o leitor de tela lê o aviso quando ele aparece ou muda (região viva educada no
 * Android); use nos avisos que surgem sozinhos (sem sinal, índice sendo organizado, falha), não nos fixos da tela.
 */
export function Banner({ children, icon = 'wifiOff', tone = 'warning', testID, anunciar = false }: { children: ReactNode; icon?: IconName; tone?: 'warning' | 'success' | 'danger'; testID?: string; anunciar?: boolean }) {
  const c = tone === 'warning' ? { bg: colors.warningBg, fg: colors.warningInk } : tone === 'success' ? { bg: colors.successBg, fg: colors.success } : { bg: colors.dangerBg, fg: colors.danger };
  return (
    <View testID={testID} style={[styles.banner, { backgroundColor: c.bg }]} {...(anunciar ? { accessible: true, accessibilityLiveRegion: 'polite' as const } : {})}>
      <View style={{ marginTop: 1 }}>
        <Icon name={icon} size={18} color={c.fg} />
      </View>
      <Text style={[styles.bannerText, { color: c.fg }]}>{children}</Text>
    </View>
  );
}

export function Strong({ children }: { children: ReactNode }) {
  return <Text style={{ ...fonte.semibold }}>{children}</Text>;
}

/**
 * Barra de progresso 0 a 100. Sem `rotulo` é decorativa (o número já aparece em texto ao lado). Com `rotulo` (T-0088)
 * vira um elemento do leitor de tela: papel "barra de progresso", o rótulo e o valor em por cento.
 */
export function ProgressBar({ pct, color = colors.grafico, track = colors.lineSoft, height = 8, rotulo }: { pct: number; color?: string; track?: string; height?: number; rotulo?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  const a11y = rotulo ? { accessible: true, accessibilityRole: 'progressbar' as const, accessibilityLabel: rotulo, accessibilityValue: { min: 0, max: 100, now: Math.round(w) } } : {};
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }} {...a11y}>
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

/**
 * Link de texto (T-0094; marca v1 na T-0172): "Esqueci a senha", "Ver todos", "Trocar". Texto de ação sobre claro é sempre
 * `accentInk`, o Azul noite (11,82:1 no fundo, 12,77:1 no branco). `sobreEscuro` usa o
 * `accentLight` (7,56:1 no grafite). Alvo de toque de 48 dp. Desligado: cinza `ink3`, sem toque.
 */
export function LinkTexto({
  rotulo,
  onPress,
  rotuloAcessivel,
  desligado,
  sobreEscuro,
  testID,
}: {
  rotulo: string;
  onPress: () => void;
  /** Leitura do TalkBack quando o rótulo visível é curto ("Ver todos" → "Ver todos os pedidos"). */
  rotuloAcessivel?: string;
  desligado?: boolean;
  sobreEscuro?: boolean;
  testID?: string;
}) {
  const cor = desligado ? colors.ink3 : sobreEscuro ? colors.accentLight : colors.accentInk;
  return (
    <Pressionavel
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={rotuloAcessivel ?? rotulo}
      accessibilityState={{ disabled: Boolean(desligado) }}
      disabled={desligado}
      escala={false}
      onPress={onPress}
      style={styles.linkTexto}>
      <Text style={[styles.linkTextoRotulo, { color: cor }]} numberOfLines={1}>
        {rotulo}
      </Text>
    </Pressionavel>
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
  backText: { ...fonte.medium, fontSize: 14, color: colors.ink2 },
  cabecalhoLinha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cabecalhoTitulo: { ...fonte.bold, fontSize: CABECALHO.tamanhoTitulo, lineHeight: CABECALHO.alturaLinhaTitulo, letterSpacing: -0.2, color: CABECALHO.cores.titulo },
  cabecalhoSub: { ...fonte.body, fontSize: CABECALHO.tamanhoSubtitulo, color: CABECALHO.cores.subtitulo },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  buttonText: { ...fonte.semibold, fontSize: 14 },
  /** chip de estado pequeno do guia (24 dp, pílula); a cor sempre vem com o texto */
  badge: { borderRadius: radius.pilula, paddingHorizontal: 10, minHeight: 24, justifyContent: 'center', alignSelf: 'flex-start' },
  badgeText: { ...fonte.semibold, fontSize: 12 },
  chip: { height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: CORES_CHIP.ativo.fundo, borderColor: CORES_CHIP.ativo.borda },
  chipOff: { backgroundColor: CORES_CHIP.inativo.fundo, borderColor: CORES_CHIP.inativo.borda },
  chipText: { ...fonte.semibold, fontSize: 14 },
  banner: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: radius.cartao, paddingVertical: 12, paddingHorizontal: 14 },
  bannerText: { flex: 1, ...fonte.body, fontSize: 14, lineHeight: 17.5 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionLink: { ...fonte.semibold, fontSize: 14, color: colors.accentInk },
  linkTexto: { minHeight: TOUCH, alignSelf: 'flex-start', justifyContent: 'center' },
  linkTextoRotulo: { ...fonte.semibold, fontSize: 14 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.cartao },
  stamp: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stampText: { ...fonte.body, fontSize: 12 },
});
