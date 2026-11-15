/**
 * Botão "Sincronizar" com segurar 10 s e popup da sincronização completa (estoque diário, parte F; spec
 * docs/design/sincronizacao-completa.md §1 e §2). Regras e textos em `sincronizar-segurar.ts` (puro, testado).
 * O kit não depende do platform-sdk: o shell (engenheiro-apps) liga `onPress`/`onSegurar` ao `motor.sincronizar({ modo })`
 * e passa ao popup o rótulo, o percentual e o erro já prontos (`lib/entrada.ts`).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Modal, StyleSheet, Text, View } from 'react-native';

import { Botao } from './base';
import { BarraProgresso } from './barra-progresso-rn';
import { temaDaEntrada } from './entrada';
import { Icon } from './icon';
import { duracaoMovimento, vibrarLeve } from './movimento';
import { Pressionavel, useReduzirMovimento } from './movimento-rn';
import {
  ACAO_SINCRONIZACAO_COMPLETA,
  criarControleSegurar,
  DICA_SINCRONIZAR_SEGURAR,
  ESPERA_PRONTO_POPUP_MS,
  ESTADO_REPOUSO,
  LIMIAR_CONTAGEM_MS,
  popupPronto,
  rotuloDoSegurar,
  SEGURAR_COMPLETA_MS,
  TEXTO_SINCRONIZACAO_COMPLETA,
  type EstadoSegurar,
} from './sincronizar-segurar';
import { ALTURA, colors, fonts, radius } from './theme';

const CORES: Record<'dark' | 'outline' | 'accent', { fundo: string; texto: string; borda: string; larguraBorda: number }> = {
  dark: { fundo: colors.ink, texto: '#FFFFFF', borda: 'transparent', larguraBorda: 0 },
  accent: { fundo: colors.accent, texto: colors.onAccent, borda: 'transparent', larguraBorda: 0 },
  outline: { fundo: colors.surface, texto: colors.ink, borda: colors.lineStrong, larguraBorda: 1 },
};

/**
 * Botão de 52 dp com toque (= `onPress`) e segurar 10 s (= `onSegurar`). Usado pelo `BotaoSincronizar` quando ele recebe
 * `onSegurar`; o desenho em repouso é o mesmo do `Button` do kit (ícone sync, rótulo, raio do botão grande).
 */
export function BotaoSegurarSincronizar({
  rotulo,
  onPress,
  onSegurar,
  ocupado = false,
  desligado = false,
  variant = 'dark',
  rotuloAcessivel,
  testID,
}: {
  rotulo: string;
  onPress: () => void;
  onSegurar: () => void;
  /** Outra sincronização em curso: indicador no botão; o toque não faz nada, o segurar funciona. */
  ocupado?: boolean;
  /** Sem sinal: nem toque nem segurar. */
  desligado?: boolean;
  variant?: 'dark' | 'outline' | 'accent';
  rotuloAcessivel?: string;
  testID?: string;
}) {
  const reduzir = useReduzirMovimento();
  const [estado, setEstado] = useState<EstadoSegurar>(ESTADO_REPOUSO);
  const faixa = useRef(new Animated.Value(0)).current;
  const ultimos = useRef({ onPress, onSegurar, ocupado });
  ultimos.current = { onPress, onSegurar, ocupado };

  const controle = useMemo(
    () =>
      criarControleSegurar({
        onToque: () => ultimos.current.onPress(),
        onSegurar: () => ultimos.current.onSegurar(),
        onMudar: setEstado,
        vibrar: vibrarLeve,
        onAnunciar: (texto) => AccessibilityInfo.announceForAccessibility(texto),
        ocupado: () => ultimos.current.ocupado,
      }),
    [],
  );
  useEffect(() => () => controle.cancelar(), [controle]);
  useEffect(() => {
    if (desligado) controle.cancelar();
  }, [desligado, controle]);

  const contando = estado.fase === 'contando';
  const entrouNaContagem = useRef(false);
  useEffect(() => {
    if (!contando) {
      entrouNaContagem.current = false;
      faixa.stopAnimation();
      faixa.setValue(0);
      return;
    }
    // reduzir movimento: saltos de 10% por segundo (o estado chega a cada segundo), sem animar entre eles
    if (reduzir) {
      faixa.setValue(estado.pct);
      return;
    }
    if (entrouNaContagem.current) return;
    entrouNaContagem.current = true;
    faixa.setValue(estado.pct);
    Animated.timing(faixa, {
      toValue: 100,
      duration: SEGURAR_COMPLETA_MS - LIMIAR_CONTAGEM_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [contando, estado.pct, reduzir, faixa]);

  const c = CORES[variant];
  const mostrarCarregando = ocupado && estado.fase === 'repouso';
  return (
    <Pressionavel
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={rotuloAcessivel ?? rotulo}
      accessibilityHint={DICA_SINCRONIZAR_SEGURAR}
      accessibilityState={{ disabled: desligado, busy: ocupado }}
      accessibilityActions={[{ name: 'activate' }, { name: 'sincronizacaoCompleta', label: ACAO_SINCRONIZACAO_COMPLETA }]}
      onAccessibilityAction={(e) => {
        if (desligado) return;
        if (e.nativeEvent.actionName === 'sincronizacaoCompleta') onSegurar();
        else if (e.nativeEvent.actionName === 'activate' && !ocupado) onPress();
      }}
      disabled={desligado}
      onPressIn={() => controle.pressionar()}
      onPressOut={() => controle.soltar()}
      style={[s.botao, { backgroundColor: c.fundo, borderColor: c.borda, borderWidth: c.larguraBorda }]}>
      {mostrarCarregando ? <ActivityIndicator color={c.texto} size="small" /> : <Icon name="sync" size={18} color={c.texto} />}
      <Text style={[s.rotulo, { color: c.texto }]} numberOfLines={1} testID={testID ? `${testID}-rotulo` : undefined}>
        {contando ? rotuloDoSegurar(estado.segundos) : rotulo}
      </Text>
      {contando ? (
        <Animated.View
          testID={testID ? `${testID}-faixa` : undefined}
          style={[s.faixa, { width: faixa.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]}
        />
      ) : null}
    </Pressionavel>
  );
}

/**
 * Popup da sincronização completa (spec §2): centralizado, sem fechar até terminar (toque fora e Voltar ignorados, sem X).
 * - em andamento: o texto literal do Alexandre e a barra da tela de carga (`BarraProgresso`, tema claro);
 * - Pronto (`pct` 100 sem `erro`): a frase sai; ficam o rótulo ("Pronto"), 100% e a barra cheia por 600 ms, e então
 *   o popup chama `onFechar` sozinho (o shell esconde com `visivel = false`);
 * - erro (`erro` com o texto pronto, ex.: "Sem internet na etapa 3 de 5"): a frase e a barra saem; ficam o erro,
 *   "Tentar de novo" (principal) e "Fechar" (neutro). O Voltar do Android faz o mesmo que "Fechar" só neste estado.
 */
export function PopupSincronizacaoCompleta({
  visivel,
  rotulo,
  pct,
  erro,
  onTentarDeNovo,
  onFechar,
  testID = 'popup-completa',
}: {
  visivel: boolean;
  /** "Etapa 3 de 5 · Catálogo e preços" ou "Pronto" (`rotuloDaBarra` do shell). */
  rotulo: string;
  /** 0 a 100 (`percentualDaCarga`); null = sem medida. */
  pct: number | null;
  /** Texto do erro (`textoDoErro`) ou null. */
  erro: string | null;
  onTentarDeNovo: () => void;
  onFechar: () => void;
  testID?: string;
}) {
  const reduzir = useReduzirMovimento();
  const pronto = visivel && popupPronto(pct, erro);
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;
  useEffect(() => {
    if (!pronto) return;
    const t = setTimeout(() => fecharRef.current(), ESPERA_PRONTO_POPUP_MS);
    return () => clearTimeout(t);
  }, [pronto]);

  const opacidade = useRef(new Animated.Value(visivel ? 1 : 0)).current;
  const [montado, setMontado] = useState(visivel);
  useEffect(() => {
    const duracao = duracaoMovimento('dialogo', reduzir);
    if (visivel) setMontado(true);
    if (duracao === 0) {
      opacidade.setValue(visivel ? 1 : 0);
      if (!visivel) setMontado(false);
      return;
    }
    Animated.timing(opacidade, { toValue: visivel ? 1 : 0, duration: duracao, useNativeDriver: true }).start(({ finished }) => {
      if (finished && !visivel) setMontado(false);
    });
  }, [visivel, reduzir, opacidade]);

  const tema = temaDaEntrada('gestao');
  return (
    <Modal visible={montado} transparent animationType="none" statusBarTranslucent onRequestClose={() => (erro ? onFechar() : undefined)}>
      <Animated.View style={[s.fundo, { opacity: opacidade }]}>
        <View style={s.cartao} testID={testID} accessibilityViewIsModal>
          {erro ? (
            <>
              <View style={s.erro} accessible accessibilityRole="alert" accessibilityLabel={erro} testID={`${testID}-erro`}>
                <Icon name="alert" size={16} color={colors.danger} />
                <Text style={s.erroTexto}>{erro}</Text>
              </View>
              <View style={{ gap: 10 }}>
                <Botao rotulo="Tentar de novo" nivel="principal" onPress={onTentarDeNovo} testID={`${testID}-tentar`} />
                <Botao rotulo="Fechar" nivel="neutro" onPress={onFechar} testID={`${testID}-fechar`} />
              </View>
            </>
          ) : (
            <>
              {pronto ? null : (
                <Text style={s.texto} testID={`${testID}-texto`}>
                  {TEXTO_SINCRONIZACAO_COMPLETA}
                </Text>
              )}
              <BarraProgresso tema={tema} rotulo={rotulo} pct={pct} reduzir={reduzir} testID={testID} />
            </>
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  botao: {
    height: ALTURA.principal,
    borderRadius: radius.botao,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  rotulo: { fontFamily: fonts.semibold, fontSize: 16, flexShrink: 1 },
  faixa: { position: 'absolute', left: 0, bottom: 0, height: 4, backgroundColor: colors.graficoEscuro },
  fundo: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  cartao: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: radius.xxl, padding: 20, gap: 16 },
  texto: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: colors.ink },
  erro: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  erroTexto: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.danger },
});
