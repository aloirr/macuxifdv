/**
 * Folha inferior, opção da folha e diálogo de confirmação (T-0071, fatia 4; medidas da referência do Novo pedido:
 * `.dim`, `.sheet`, `.opt`, `.ic`). Generaliza o `BottomSheet` do Vendedor e do Core.
 * Nenhum texto fixo: título, opções, "Voltar" e o rótulo do fundo para o leitor de tela chegam por props.
 * Alvos de toque ≥ 48 dp. O botão Voltar do Android fecha (onRequestClose).
 * Movimento (T-0072): a folha sobe de baixo em 280 ms e o fundo escurece junto; ao fechar, desce antes de sumir. Com
 * "reduzir movimento", aparece e some sem deslocamento. O diálogo só esmaece (200 ms; nada com movimento reduzido).
 * Folha alta e teclado (T-0072, opcionais; sem eles a folha é a mesma de antes):
 * - `rolavel`: a folha para na altura máxima (a camada menos a área segura do topo e uma faixa de 24 dp do fundo, para ainda
 *   dar para tocar fora) e o conteúdo rola; alça, título e rodapé ficam fixos;
 * - `evitarTeclado`: a folha sobe junto com o teclado (o Android do Expo 57 é edge-to-edge e a janela não encolhe), a altura
 *   máxima desconta o teclado e o campo com foco rola até ficar inteiro à vista. Liga a rolagem junto.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { alturaMaximaDaFolha, ALVO_TOQUE, coberturaDoTeclado, rolagemAteCampo } from './componentes';
import { Icon, type IconName } from './icon';
import { deslocamentoDaFolha, duracaoMovimento } from './movimento';
import { curvaPadrao, Pressionavel, useReduzirMovimento } from './movimento-rn';
import { colors, fonte, radius, shadow } from './theme';

/** Mantém montado durante a saída e devolve o progresso 0 → 1 da entrada (0 = fechado). */
function useEntradaSaida(visivel: boolean, duracao: number) {
  const [montado, setMontado] = useState(visivel);
  const progresso = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visivel) setMontado(true);
    const fim = () => {
      if (!visivel) setMontado(false);
    };
    if (duracao === 0) {
      progresso.setValue(visivel ? 1 : 0);
      fim();
      return;
    }
    const a = Animated.timing(progresso, { toValue: visivel ? 1 : 0, duration: duracao, easing: curvaPadrao, useNativeDriver: true });
    a.start(fim);
    return () => a.stop();
  }, [visivel, duracao, progresso]);
  return { montado: montado || visivel, progresso };
}

/**
 * Teclado sobre a camada da folha: quanto ele cobre (0 fechado) e a rolagem do campo com foco. Só escuta o teclado quando
 * `ligado`; mede a camada (View em tela cheia) em coordenadas da janela, como o `endCoordinates.screenY` do teclado.
 */
function useTecladoNaFolha(ligado: boolean) {
  const camada = useRef<View | null>(null);
  const area = useRef<ScrollView | null>(null);
  /** moldura da área rolável (View): o ScrollView não tem `measureInWindow` nos tipos do RN 0.86 */
  const moldura = useRef<View | null>(null);
  const y = useRef(0);
  const [cobertura, setCobertura] = useState(0);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    y.current = e.nativeEvent.contentOffset.y;
  }, []);
  /** Rola a área até o campo com foco ficar à vista (depois de a folha subir e encolher). */
  const levarCampo = useCallback(() => {
    const campo = TextInput.State.currentlyFocusedInput?.();
    const rolagem = area.current;
    const caixa = moldura.current;
    if (!campo || !rolagem || !caixa) return;
    requestAnimationFrame(() => {
      caixa.measureInWindow((_ax, areaTopo, _aw, areaAltura) => {
        campo.measureInWindow((_x, campoTopo, _w, campoAltura) => {
          const dy = rolagemAteCampo({ campoTopo, campoBaixo: campoTopo + campoAltura, areaTopo, areaBaixo: areaTopo + areaAltura });
          if (dy !== 0) rolagem.scrollTo({ y: Math.max(0, y.current + dy), animated: true });
        });
      });
    });
  }, []);
  useEffect(() => {
    if (!ligado) {
      setCobertura(0);
      return;
    }
    const mostrar = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const esconder = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    let prazo: ReturnType<typeof setTimeout> | null = null;
    const subMostrar = Keyboard.addListener(mostrar, (e) => {
      const topo = e.endCoordinates.screenY;
      camada.current?.measureInWindow((_x, cy, _w, ch) => {
        setCobertura(coberturaDoTeclado(cy + ch, topo));
        if (prazo) clearTimeout(prazo);
        // espera a folha subir e encolher antes de medir o campo
        prazo = setTimeout(levarCampo, 120);
      });
    });
    const subEsconder = Keyboard.addListener(esconder, () => setCobertura(0));
    return () => {
      subMostrar.remove();
      subEsconder.remove();
      if (prazo) clearTimeout(prazo);
    };
  }, [ligado, levarCampo]);
  return { camada, area, moldura, cobertura, onScroll };
}

export interface AcaoTexto {
  rotulo: string;
  onPress: () => void;
  testID?: string;
}

export function Folha({
  visivel,
  onFechar,
  rotuloFechar,
  titulo,
  fechar,
  rotuloAcessivel,
  rodape,
  rolavel,
  evitarTeclado,
  children,
  testID = 'folha',
}: {
  visivel: boolean;
  onFechar: () => void;
  /** Rótulo do fundo escurecido para o leitor de tela (toque fora fecha). */
  rotuloFechar: string;
  /** Título visível ("Salvar pedido"); opcional. */
  titulo?: string;
  /**
   * ✕ à direita do título (T-0141, pranchas do Novo pedido v3): alvo de 48 dp, chama `onFechar` (o mesmo do toque fora e do
   * Voltar do Android). Fica fixo com o título, fora da rolagem. `rotulo` é a leitura do leitor de tela ("Fechar").
   */
  fechar?: { rotulo: string; testID?: string };
  /** Nome da folha para o leitor de tela; sem ele usa o título. */
  rotuloAcessivel?: string;
  /** Ação de texto centralizada no fim (ex.: "Voltar"). */
  rodape?: AcaoTexto;
  /** Altura máxima com rolagem do conteúdo (lista longa, checkout com muitas etapas). Sem a prop, a folha cresce com o conteúdo. */
  rolavel?: boolean;
  /** Folha com campo de texto: sobe com o teclado e leva o campo com foco à vista. Liga `rolavel`. */
  evitarTeclado?: boolean;
  children?: ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const reduzir = useReduzirMovimento();
  const { montado, progresso } = useEntradaSaida(visivel, duracaoMovimento('folha', reduzir));
  const [altura, setAltura] = useState(600);
  const [alturaCamada, setAlturaCamada] = useState(0);
  const comRolagem = Boolean(rolavel || evitarTeclado);
  const teclado = useTecladoNaFolha(Boolean(evitarTeclado) && montado);
  const desloc = deslocamentoDaFolha(altura + teclado.cobertura, reduzir);
  const maxima = comRolagem && alturaCamada > 0 ? alturaMaximaDaFolha({ alturaCamada, topoSeguro: insets.top, teclado: teclado.cobertura }) : undefined;
  // com o teclado aberto, ele já cobre a área segura de baixo: o respiro volta ao mínimo
  const respiroBaixo = teclado.cobertura > 0 ? 12 : 22 + insets.bottom;
  return (
    <Modal visible={montado} transparent animationType="none" onRequestClose={onFechar} statusBarTranslucent>
      <Animated.View style={[s.fundo, { opacity: progresso }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onFechar} accessibilityRole="button" accessibilityLabel={rotuloFechar} testID={`${testID}-fundo`} />
      </Animated.View>
      {comRolagem ? (
        // camada de medida (tela cheia, sem toque): dá a altura máxima e a base para medir o teclado
        <View ref={teclado.camada} pointerEvents="none" collapsable={false} style={StyleSheet.absoluteFill} onLayout={(e: LayoutChangeEvent) => setAlturaCamada(e.nativeEvent.layout.height)} />
      ) : null}
      <Animated.View
        onLayout={(e: LayoutChangeEvent) => setAltura(e.nativeEvent.layout.height)}
        style={[
          s.folha,
          { paddingBottom: respiroBaixo, bottom: teclado.cobertura, transform: [{ translateY: progresso.interpolate({ inputRange: [0, 1], outputRange: [desloc, 0] }) }] },
          maxima !== undefined ? { maxHeight: maxima } : null,
        ]}
        testID={testID}
        accessibilityViewIsModal
        accessibilityLabel={rotuloAcessivel ?? titulo}>
        <View style={s.alca} />
        {fechar ? (
          <View style={s.cabecalho}>
            <Text style={[s.titulo, s.tituloComFechar]} accessibilityRole={titulo ? 'header' : undefined}>
              {titulo ?? ''}
            </Text>
            <Pressionavel testID={fechar.testID ?? `${testID}-fechar`} accessibilityRole="button" accessibilityLabel={fechar.rotulo} onPress={onFechar} style={s.fechar}>
              <Icon name="close" size={20} color={colors.ink} strokeWidth={2.2} />
            </Pressionavel>
          </View>
        ) : titulo ? (
          <Text style={s.titulo} accessibilityRole="header">
            {titulo}
          </Text>
        ) : null}
        {comRolagem ? (
          <View ref={teclado.moldura} collapsable={false} style={s.rolagem}>
            <ScrollView
              ref={teclado.area}
              testID={`${testID}-rolagem`}
              style={s.rolagem}
              contentContainerStyle={s.rolagemConteudo}
              keyboardShouldPersistTaps="handled"
              onScroll={teclado.onScroll}
              scrollEventThrottle={32}>
              {children}
            </ScrollView>
          </View>
        ) : (
          children
        )}
        {rodape ? (
          <Pressionavel testID={rodape.testID ?? `${testID}-rodape`} accessibilityRole="button" onPress={rodape.onPress} escala={false} style={s.rodape}>
            <Text style={s.rodapeTexto}>{rodape.rotulo}</Text>
          </Pressionavel>
        ) : null}
      </Animated.View>
    </Modal>
  );
}

export type TomOpcaoFolha = 'destaque' | 'neutro' | 'perigo';

export function OpcaoFolha({
  icone,
  titulo,
  subtitulo,
  subtituloErro,
  tom = 'destaque',
  onPress,
  desligado,
  testID,
}: {
  icone: IconName;
  titulo: string;
  /** Linha curta abaixo do título ("Vai direto ao ERP.", "Válido até 10/11."). */
  subtitulo?: string;
  /** Mostra o subtítulo na cor de erro (motivo do desligado, ex.: "Informe a transportadora do frete FOB."). */
  subtituloErro?: boolean;
  /** Cor do quadradinho do ícone: Azul noite no Azul suave (`destaque`), cinza (`neutro`) ou vermelho (`perigo`). */
  tom?: TomOpcaoFolha;
  onPress: () => void;
  desligado?: boolean;
  testID?: string;
}) {
  const c = TOM_OPCAO[tom];
  return (
    <Pressionavel
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitulo ? `${titulo}. ${subtitulo}` : titulo}
      accessibilityState={{ disabled: Boolean(desligado) }}
      disabled={desligado}
      onPress={onPress}
      style={s.opcao}>
      <View style={[s.icone, { backgroundColor: c.bg }, desligado && s.desligado]}>
        <Icon name={icone} size={18} color={c.fg} strokeWidth={2.2} />
      </View>
      <View style={s.opcaoTextos}>
        <Text style={[s.opcaoTitulo, desligado && { color: colors.ink3 }]}>{titulo}</Text>
        {subtitulo ? <Text style={[s.opcaoSub, subtituloErro && { color: colors.danger }]}>{subtitulo}</Text> : null}
      </View>
    </Pressionavel>
  );
}

const TOM_OPCAO: Record<TomOpcaoFolha, { fg: string; bg: string }> = {
  destaque: { fg: colors.accent, bg: colors.accentSoft },
  neutro: { fg: colors.ink, bg: colors.neutralBg },
  perigo: { fg: colors.danger, bg: colors.dangerBg },
};

export function Dialogo({
  visivel,
  titulo,
  mensagem,
  cancelar,
  confirmar,
  perigo,
  onFechar,
  bloqueado,
  children,
  testID = 'dialogo',
}: {
  visivel: boolean;
  /** Ex.: "Descartar este pedido?". */
  titulo: string;
  /** Linha opcional abaixo do título (use só quando o título não basta). */
  mensagem?: string;
  /** Botão da esquerda, neutro (ex.: "Voltar"); também é o que o botão Voltar do Android faz quando não há `onFechar`. */
  cancelar?: AcaoTexto;
  /** Botão da direita, principal (ex.: "Descartar"). Sem `cancelar` e sem `confirmar`, o diálogo não tem linha de botões. */
  confirmar?: AcaoTexto & { ocupado?: boolean };
  /** Confirmar em vermelho (ação destrutiva). */
  perigo?: boolean;
  onFechar?: () => void;
  /** O Voltar do Android não faz nada (ex.: progresso da sincronização completa, R-20261115-100000). O toque fora nunca fecha. */
  bloqueado?: boolean;
  /** Conteúdo entre a mensagem e os botões (ex.: `BarraProgresso`). */
  children?: ReactNode;
  testID?: string;
}) {
  const fechar = bloqueado ? semAcao : (onFechar ?? cancelar?.onPress ?? semAcao);
  const reduzir = useReduzirMovimento();
  const { montado, progresso } = useEntradaSaida(visivel, duracaoMovimento('dialogo', reduzir));
  return (
    <Modal visible={montado} transparent animationType="none" onRequestClose={fechar} statusBarTranslucent>
      <Animated.View style={[s.dialogoFundo, { opacity: progresso }]}>
        <View style={s.dialogo} testID={testID} accessibilityViewIsModal accessibilityRole="alert">
          <Text style={s.dialogoTitulo} accessibilityRole="header">
            {titulo}
          </Text>
          {mensagem ? <Text style={s.dialogoMsg}>{mensagem}</Text> : null}
          {children ? <View style={s.dialogoConteudo}>{children}</View> : null}
          {cancelar || confirmar ? (
            <View style={s.dialogoBotoes}>
              {cancelar ? (
                <Pressionavel testID={cancelar.testID ?? `${testID}-cancelar`} accessibilityRole="button" onPress={cancelar.onPress} style={[s.dialogoBotao, s.dialogoBotaoFora]}>
                  <Text style={[s.dialogoBotaoTexto, { color: colors.ink }]} numberOfLines={1}>
                    {cancelar.rotulo}
                  </Text>
                </Pressionavel>
              ) : null}
              {confirmar ? (
                <Pressionavel
                  testID={confirmar.testID ?? `${testID}-confirmar`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: Boolean(confirmar.ocupado), busy: Boolean(confirmar.ocupado) }}
                  disabled={confirmar.ocupado}
                  onPress={confirmar.onPress}
                  vibrar
                  style={[s.dialogoBotao, { backgroundColor: perigo ? colors.danger : colors.accent }, confirmar.ocupado && s.desligado]}>
                  <Text style={[s.dialogoBotaoTexto, { color: perigo ? colors.surface : colors.onAccent }]} numberOfLines={1}>
                    {confirmar.rotulo}
                  </Text>
                </Pressionavel>
              ) : null}
            </View>
          ) : null}
        </View>
      </Animated.View>
    </Modal>
  );
}

/** Voltar do Android sem efeito (diálogo `bloqueado` ou sem botão de saída). */
function semAcao(): void {}

const FUNDO = colors.scrim;

const s = StyleSheet.create({
  pressionado: { opacity: 0.7 },
  desligado: { opacity: 0.45 },
  // .dim / .sheet
  fundo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: FUNDO },
  folha: { position: 'absolute', left: 0, right: 0, bottom: 0, alignSelf: 'center', width: '100%', maxWidth: 560, backgroundColor: colors.surface, borderTopLeftRadius: radius.folha, borderTopRightRadius: radius.folha, paddingTop: 8, paddingHorizontal: 16, gap: 9, ...shadow.folha },
  /** alça visual no topo (indica que a folha desce) */
  alca: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: 6 },
  titulo: { ...fonte.bold, fontSize: 22, color: colors.ink, marginBottom: 0 },
  /** título + ✕ (T-0141): o ✕ ocupa o alvo inteiro de 48 dp, com o ícone de 20 alinhado à direita do conteúdo */
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: ALVO_TOQUE },
  tituloComFechar: { flex: 1, minWidth: 0 },
  fechar: { width: ALVO_TOQUE, height: ALVO_TOQUE, alignItems: 'flex-end', justifyContent: 'center' },
  /** área rolável da folha alta: encolhe até caber na altura máxima; entre os filhos, o mesmo gap da folha (9) */
  rolagem: { flexGrow: 0, flexShrink: 1 },
  rolagemConteudo: { gap: 9 },
  rodape: { minHeight: ALVO_TOQUE, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  rodapeTexto: { ...fonte.semibold, fontSize: 14, color: colors.ink2 },
  // .opt / .ic
  opcao: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 56, paddingVertical: 11, paddingHorizontal: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  icone: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  opcaoTextos: { flex: 1, minWidth: 0, gap: 2 },
  opcaoTitulo: { ...fonte.semibold, fontSize: 14, color: colors.ink },
  opcaoSub: { ...fonte.body, fontSize: 12, color: colors.ink2 },
  // diálogo central
  dialogoFundo: { flex: 1, backgroundColor: FUNDO, alignItems: 'center', justifyContent: 'center', padding: 24 },
  // padrão único de diálogo (simulação aprovada: docs/design/sync-completa/sync.css)
  dialogo: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: radius.dialogo, padding: 20, paddingTop: 22, paddingBottom: 24, gap: 10 },
  dialogoTitulo: { ...fonte.bold, fontSize: 22, color: colors.ink },
  dialogoMsg: { ...fonte.body, fontSize: 16, lineHeight: 22, color: colors.ink2 },
  dialogoConteudo: { marginTop: 10 },
  dialogoBotoes: { flexDirection: 'row', gap: 9, marginTop: 8 },
  dialogoBotao: { flex: 1, minHeight: ALVO_TOQUE, borderRadius: radius.botaoMedio, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  /** nível neutro do guia (Cancelar) */
  dialogoBotaoFora: { backgroundColor: colors.lineSoft },
  dialogoBotaoTexto: { ...fonte.semibold, fontSize: 14 },
});
