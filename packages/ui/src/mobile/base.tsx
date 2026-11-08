/**
 * Componentes base do visual novo (T-0072; guia docs/design/referencia-2026-11-03/Componentes.dc.html e
 * especificação docs/design/componentes.md):
 * - `Botao`: níveis principal (52, um só por tela), secundário (44; `alto` = 52 ao lado do principal), neutro e perigo
 *   (44); desabilitado cinza legível; afunda ao toque e o principal vibra leve ao confirmar; `sobreEscuro` sobre o grafite;
 * - `Cartao`: superfície branca com borda (tons destaque, sucesso, escuro e suave), tocável ou não;
 * - `ChipEstado`: estado com cor E texto (Aprovado, Aguardando aprovação, Na fila…);
 * - `AvisoRodape` + `useAvisoRodape`: aviso curto no rodapé ("Pedido enviado") com Desfazer opcional, some em 2,5 s;
 * - `BarraAbas`: barra de abas inferior (o shell decide as abas; aqui só o desenho);
 * - `EstadoVazio`: tela/lista sem conteúdo, com ação opcional.
 * Nenhum texto fixo: tudo chega por props. Alvo de toque ≥ 48 dp. Movimento respeita "reduzir movimento".
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { folgaDeToque } from './componentes';
import { Icon, type IconName } from './icon';
import { duracaoMovimento, tempoDoAviso } from './movimento';
import { curvaPadrao, Pressionavel, useLeitorDeTela, useReduzirMovimento } from './movimento-rn';
import { ALTURA, colors, estiloDoNivel, fonts, layout, radius, shadow, space, TONS_ESTADO, type NivelBotao, type TomEstado } from './theme';

// ---------- Botao ----------
export function Botao({
  rotulo,
  onPress,
  nivel = 'secundario',
  icone,
  seta,
  alto,
  desligado,
  ocupado,
  vibrar,
  sobreEscuro,
  quebrarLinha,
  rotuloAcessivel,
  style,
  testID,
}: {
  rotulo: string;
  onPress?: () => void;
  /** `principal`: um só por tela. Padrão: `secundario`. */
  nivel?: NivelBotao;
  icone?: IconName;
  /** Desenha › depois do rótulo (Avançar). */
  seta?: boolean;
  /** Secundário/neutro/perigo com 52 dp, para acompanhar o principal lado a lado. */
  alto?: boolean;
  desligado?: boolean;
  /** Mostra o indicador de carregando e bloqueia o toque. */
  ocupado?: boolean;
  /** Vibra leve ao tocar. Padrão: só no principal. */
  vibrar?: boolean;
  /**
   * Botão sobre fundo grafite (faixa "Em atendimento", `Cartao tom="escuro"`): secundário em laranja-claro com texto grafite,
   * neutro só com contorno claro e texto branco. Sem a prop, nada muda.
   */
  sobreEscuro?: boolean;
  /**
   * Rótulo em até 2 linhas, centralizado (T-0133): para dois botões lado a lado, metade da largura cada, com rótulo longo
   * ("Salvar como orçamento" no Resumo do pedido). Use com `alto` (52 dp) para caber as 2 linhas. Sem a prop, 1 linha.
   */
  quebrarLinha?: boolean;
  rotuloAcessivel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const off = Boolean(desligado || ocupado);
  const v = estiloDoNivel(nivel, { alto, desabilitado: Boolean(desligado), sobreEscuro });
  return (
    <Pressionavel
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={rotuloAcessivel ?? rotulo}
      accessibilityState={{ disabled: off, busy: Boolean(ocupado) }}
      disabled={off}
      onPress={onPress}
      vibrar={vibrar ?? nivel === 'principal'}
      hitSlop={v.altura < ALTURA.toque ? { top: folgaDeToque(v.altura), bottom: folgaDeToque(v.altura) } : undefined}
      style={[
        s.botao,
        { height: v.altura, borderRadius: v.raio, backgroundColor: v.fundo, borderWidth: v.larguraBorda, borderColor: v.borda ?? 'transparent' },
        style,
      ]}>
      {ocupado ? <ActivityIndicator color={v.texto} size="small" /> : icone ? <Icon name={icone} size={v.tamanhoFonte + 2} color={v.texto} /> : null}
      <Text style={[s.botaoTexto, { color: v.texto, fontSize: v.tamanhoFonte }, quebrarLinha && s.botaoTextoQuebra]} numberOfLines={quebrarLinha ? 2 : 1}>
        {rotulo}
      </Text>
      {seta ? <Icon name="chevron" size={v.tamanhoFonte} color={v.texto} strokeWidth={2.4} /> : null}
    </Pressionavel>
  );
}

// ---------- Cartao ----------
/** Avisa os filhos de que estão dentro de um cartão (ex.: `Loading` vira compacto, sem flex nem fundo cinza). */
const DentroDeCartaoCtx = createContext(false);
export const DentroDeCartao = DentroDeCartaoCtx.Provider;
export function useDentroDeCartao(): boolean {
  return useContext(DentroDeCartaoCtx);
}

export type TomCartao = 'padrao' | 'destaque' | 'sucesso' | 'escuro' | 'suave';

const TOM_CARTAO: Record<TomCartao, { bg: string; borda: string | null; raio: number }> = {
  padrao: { bg: colors.surface, borda: colors.line, raio: radius.cartao },
  destaque: { bg: colors.accentSoft, borda: colors.accentLine, raio: radius.cartao },
  sucesso: { bg: colors.successBg, borda: colors.successLine, raio: radius.cartao },
  escuro: { bg: colors.ink, borda: null, raio: radius.secao },
  suave: { bg: colors.ground, borda: null, raio: radius.cartao },
};

export function Cartao({
  children,
  tom = 'padrao',
  onPress,
  rotuloAcessivel,
  preenchimento = layout.cartao,
  gap,
  style,
  testID,
}: {
  children: ReactNode;
  tom?: TomCartao;
  /** Cartão inteiro tocável (abre o detalhe). */
  onPress?: () => void;
  /** Leitura do cartão tocável para o leitor de tela. */
  rotuloAcessivel?: string;
  preenchimento?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = TOM_CARTAO[tom];
  const estilo = [
    { backgroundColor: t.bg, borderRadius: t.raio, borderWidth: t.borda ? 1 : 0, borderColor: t.borda ?? 'transparent', padding: preenchimento, gap },
    style,
  ];
  if (!onPress) {
    return (
      <View testID={testID} style={estilo}>
        <DentroDeCartao value>{children}</DentroDeCartao>
      </View>
    );
  }
  return (
    <Pressionavel testID={testID} accessibilityRole="button" accessibilityLabel={rotuloAcessivel} onPress={onPress} style={estilo}>
      <DentroDeCartao value>{children}</DentroDeCartao>
    </Pressionavel>
  );
}

// ---------- ChipEstado ----------
export function ChipEstado({
  texto,
  tom = 'neutro',
  pequeno,
  icone,
  rotuloAcessivel,
  style,
  testID,
}: {
  /** Obrigatório e visível: a cor nunca fala sozinha ("Aprovado", "Na fila"). */
  texto: string;
  tom?: TomEstado;
  /** 24 dp (dentro de cartão de lista); o padrão tem 28. */
  pequeno?: boolean;
  icone?: IconName;
  rotuloAcessivel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  if (texto.trim() === '') return null;
  const c = TONS_ESTADO[tom];
  const altura = pequeno ? ALTURA.chipEstadoPequeno : ALTURA.chipEstado;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={rotuloAcessivel ?? texto}
      style={[s.chip, { height: altura, paddingHorizontal: pequeno ? 10 : 12, backgroundColor: c.bg }, style]}>
      {icone ? <Icon name={icone} size={pequeno ? 12 : 14} color={c.fg} strokeWidth={2.4} /> : null}
      <Text style={[s.chipTexto, { color: c.fg, fontSize: pequeno ? 12 : 13 }]} numberOfLines={1}>
        {texto}
      </Text>
    </View>
  );
}

// ---------- AvisoRodape ----------
export type TomAviso = 'sucesso' | 'erro' | 'info';

export interface AcaoAviso {
  /** Ex.: "Desfazer". */
  rotulo: string;
  onPress: () => void;
  testID?: string;
}

const ICONE_AVISO: Record<TomAviso, { icone: IconName | null; cor: string }> = {
  sucesso: { icone: 'check', cor: colors.successOnDark },
  erro: { icone: 'alert', cor: colors.accentLight },
  info: { icone: null, cor: colors.surface },
};

export function AvisoRodape({
  visivel,
  texto,
  tom = 'sucesso',
  acao,
  onFechar,
  duracaoMs,
  respiroInferior = 0,
  chave,
  testID = 'aviso-rodape',
}: {
  visivel: boolean;
  /** Frase curta ("Pedido 000013 enviado para aprovação"). */
  texto: string;
  tom?: TomAviso;
  /** Botão de texto à direita (ex.: Desfazer). */
  acao?: AcaoAviso;
  /** Chamado ao sumir sozinho e depois da ação. */
  onFechar: () => void;
  /** Tempo na tela; padrão 2,5 s (8 s com leitor de tela). */
  duracaoMs?: number;
  /** Distância da borda de baixo (altura da barra de abas ou área segura). */
  respiroInferior?: number;
  /** Muda a cada aviso novo (o tempo recomeça mesmo com o mesmo texto); o `useAvisoRodape` preenche. */
  chave?: number;
  testID?: string;
}) {
  const reduzir = useReduzirMovimento();
  const leitor = useLeitorDeTela();
  const [montado, setMontado] = useState(visivel);
  const anim = useRef(new Animated.Value(0)).current;
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;

  useEffect(() => {
    if (visivel) setMontado(true);
    const duracao = duracaoMovimento('aviso', reduzir);
    const fim = () => {
      if (!visivel) setMontado(false);
    };
    if (duracao === 0) {
      anim.setValue(visivel ? 1 : 0);
      fim();
      return;
    }
    Animated.timing(anim, { toValue: visivel ? 1 : 0, duration: duracao, easing: curvaPadrao, useNativeDriver: true }).start(fim);
  }, [visivel, reduzir, anim]);

  useEffect(() => {
    if (!visivel) return;
    const t = setTimeout(() => fecharRef.current(), tempoDoAviso(leitor, duracaoMs));
    return () => clearTimeout(t);
  }, [visivel, texto, chave, leitor, duracaoMs]);

  if (!montado) return null;
  const ic = ICONE_AVISO[tom];
  const deslocar = reduzir ? 0 : 16;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[s.avisoCamada, { bottom: space.md + respiroInferior, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [deslocar, 0] }) }] }]}>
      <View style={s.aviso} testID={testID} accessibilityLiveRegion="polite" accessibilityRole={tom === 'erro' ? 'alert' : 'text'}>
        {ic.icone ? <Icon name={ic.icone} size={18} color={ic.cor} strokeWidth={2.2} /> : null}
        <Text style={s.avisoTexto} numberOfLines={2}>
          {texto}
        </Text>
        {acao ? (
          <Pressionavel
            testID={acao.testID ?? `${testID}-acao`}
            accessibilityRole="button"
            accessibilityLabel={acao.rotulo}
            vibrar
            hitSlop={{ top: folgaDeToque(36), bottom: folgaDeToque(36) }}
            onPress={() => {
              acao.onPress();
              fecharRef.current();
            }}
            style={s.avisoAcao}>
            <Text style={s.avisoAcaoTexto}>{acao.rotulo}</Text>
          </Pressionavel>
        ) : null}
      </View>
    </Animated.View>
  );
}

export interface EstadoAviso {
  texto: string;
  tom?: TomAviso;
  acao?: AcaoAviso;
}

/**
 * Controle do aviso: `mostrar({ texto, acao })` e `<AvisoRodape {...aviso.props} />` na raiz da tela.
 * Um aviso novo substitui o anterior (o tempo recomeça).
 */
export function useAvisoRodape() {
  const [estado, setEstado] = useState<(EstadoAviso & { visivel: boolean; chave: number }) | null>(null);
  const mostrar = useCallback((a: EstadoAviso) => setEstado((e) => ({ ...a, visivel: true, chave: (e?.chave ?? 0) + 1 })), []);
  const esconder = useCallback(() => setEstado((e) => (e ? { ...e, visivel: false } : e)), []);
  return {
    mostrar,
    esconder,
    props: { visivel: Boolean(estado?.visivel), texto: estado?.texto ?? '', tom: estado?.tom, acao: estado?.acao, chave: estado?.chave, onFechar: esconder },
  };
}

// ---------- BarraAbas ----------
export interface ItemBarraAbas {
  id: string;
  rotulo: string;
  icone: IconName;
  ativo: boolean;
  onPress: () => void;
  /** Número no canto do ícone (fila, não lidas); 0/undefined esconde. */
  contador?: number | null;
  /** Leitura do contador ("3 na fila"); sem ela, só o número. */
  rotuloContador?: string;
  testID?: string;
}

export function BarraAbas({
  itens,
  respiroInferior = 0,
  tomContador = 'destaque',
  testID = 'barra-abas',
}: {
  itens: readonly ItemBarraAbas[];
  /** Área segura de baixo (`useSafeAreaInsets().bottom`). */
  respiroInferior?: number;
  /** Cor do contador: laranja (`destaque`, não lidas) ou âmbar (`aviso`, fila). */
  tomContador?: 'destaque' | 'aviso';
  testID?: string;
}) {
  const cont = tomContador === 'aviso' ? { bg: colors.warningBg, fg: colors.warningInk } : { bg: colors.accent, fg: colors.onAccent };
  return (
    <View accessibilityRole="tablist" testID={testID} style={[s.barra, { height: ALTURA.barraAbas + respiroInferior, paddingBottom: respiroInferior }]}>
      {itens.map((item) => {
        const cor = item.ativo ? colors.accent : colors.ink2;
        const n = item.contador && item.contador > 0 ? item.contador : 0;
        return (
          <Pressionavel
            key={item.id}
            testID={item.testID ?? `${testID}-${item.id}`}
            accessibilityRole="tab"
            accessibilityLabel={n ? `${item.rotulo}, ${item.rotuloContador ?? n}` : item.rotulo}
            accessibilityState={{ selected: item.ativo }}
            onPress={item.onPress}
            style={s.aba}>
            <View>
              <Icon name={item.icone} size={22} color={cor} strokeWidth={item.ativo ? 2.2 : 1.8} />
              {n ? (
                <View style={[s.contador, { backgroundColor: cont.bg }]}>
                  <Text style={[s.contadorTexto, { color: cont.fg }]}>{n > 99 ? '99+' : n}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[s.abaTexto, item.ativo ? s.abaTextoAtiva : null]} numberOfLines={1}>
              {item.rotulo}
            </Text>
          </Pressionavel>
        );
      })}
    </View>
  );
}

// ---------- EstadoVazio ----------
export function EstadoVazio({
  titulo,
  texto,
  icone,
  acao,
  testID = 'estado-vazio',
}: {
  /** Ex.: "Nenhum pedido hoje". */
  titulo: string;
  /** O que fazer a seguir ("Os pedidos enviados aparecem aqui."). */
  texto?: string;
  icone?: IconName;
  /** Ação secundária (o principal da tela continua sendo outro). */
  acao?: { rotulo: string; onPress: () => void; testID?: string };
  testID?: string;
}) {
  return (
    <View style={s.vazio} testID={testID}>
      {icone ? (
        <View style={s.vazioIcone}>
          <Icon name={icone} size={22} color={colors.ink2} />
        </View>
      ) : null}
      <Text style={s.vazioTitulo}>{titulo}</Text>
      {texto ? <Text style={s.vazioTexto}>{texto}</Text> : null}
      {acao ? <Botao rotulo={acao.rotulo} onPress={acao.onPress} testID={acao.testID ?? `${testID}-acao`} style={s.vazioBotao} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  botao: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg },
  botaoTexto: { fontFamily: fonts.semibold },
  botaoTextoQuebra: { flexShrink: 1, textAlign: 'center', lineHeight: 18 },
  chip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: space.xs, borderRadius: radius.pilula },
  chipTexto: { fontFamily: fonts.semibold },
  avisoCamada: { position: 'absolute', left: space.lg, right: space.lg },
  aviso: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: ALTURA.aviso, backgroundColor: colors.ink, borderRadius: radius.cartao, paddingVertical: space.sm, paddingHorizontal: 14, ...shadow.aviso },
  avisoTexto: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.surface },
  avisoAcao: { height: 36, paddingHorizontal: space.md, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  avisoAcaoTexto: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accentLight },
  barra: { flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
  aba: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: ALTURA.toque },
  abaTexto: { fontFamily: fonts.semibold, fontSize: 11, color: colors.ink2 },
  abaTextoAtiva: { fontFamily: fonts.bold, color: colors.accentInk },
  contador: { position: 'absolute', top: -4, right: -10, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, borderWidth: 1, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  contadorTexto: { fontFamily: fonts.bold, fontSize: 10 },
  vazio: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  vazioIcone: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.lineSoft, alignItems: 'center', justifyContent: 'center' },
  vazioTitulo: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink, textAlign: 'center' },
  vazioTexto: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink2, textAlign: 'center' },
  vazioBotao: { alignSelf: 'stretch', marginTop: space.sm },
});
