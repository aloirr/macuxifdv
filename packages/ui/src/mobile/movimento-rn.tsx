/**
 * Primitivas de movimento do kit (T-0072), sobre o `Animated` do próprio React Native (sem dependência nova):
 * - `useReduzirMovimento()`: lê e acompanha a opção "reduzir movimento" / "remover animações" do aparelho;
 * - `useLeitorDeTela()`: TalkBack ligado (o aviso fica mais tempo);
 * - `Pressionavel`: `Pressable` que afunda (escala 0,97 em 120 ms) e, se pedido, vibra leve ao confirmar.
 *   Com "reduzir movimento", sem escala: só a opacidade cai (`opacidadeDoToque`).
 * Durações e regras moram em `movimento.ts` (puro, testado).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { CURVA_PADRAO, duracaoMovimento, escalaDoToque, opacidadeDoToque, vibrarLeve } from './movimento';

/** Curva padrão do kit para o `Animated`. */
export const curvaPadrao = Easing.bezier(CURVA_PADRAO[0], CURVA_PADRAO[1], CURVA_PADRAO[2], CURVA_PADRAO[3]);

/** `true` quando o aparelho pede menos movimento. Começa em `false` e se atualiza ao vivo. */
export function useReduzirMovimento(): boolean {
  const [reduzir, setReduzir] = useState(false);
  useEffect(() => {
    let vivo = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (vivo) setReduzir(Boolean(v));
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v: boolean) => setReduzir(Boolean(v)));
    return () => {
      vivo = false;
      sub.remove();
    };
  }, []);
  return reduzir;
}

/** `true` com leitor de tela (TalkBack) ligado. */
export function useLeitorDeTela(): boolean {
  const [ligado, setLigado] = useState(false);
  useEffect(() => {
    let vivo = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((v) => {
        if (vivo) setLigado(Boolean(v));
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (v: boolean) => setLigado(Boolean(v)));
    return () => {
      vivo = false;
      sub.remove();
    };
  }, []);
  return ligado;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressionavelProps = Omit<PressableProps, 'style' | 'children'> & {
  /** Estilo fixo (sem função `({ pressed })`: a resposta ao toque é a escala do kit). */
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Vibra leve no `onPress` (confirmação). Padrão: não. */
  vibrar?: boolean;
  /** Liga a escala (padrão). `false` = só a opacidade, para linhas largas de lista. */
  escala?: boolean;
};

/** `Pressable` com a resposta ao toque do guia: afunda 0,97 em 120 ms; com "reduzir movimento", só esmaece. */
export function Pressionavel({ style, children, vibrar, escala = true, onPressIn, onPressOut, onPress, disabled, ...resto }: PressionavelProps) {
  const reduzir = useReduzirMovimento();
  const [pressionado, setPressionado] = useState(false);
  const valor = useRef(new Animated.Value(1)).current;
  const semEscala = reduzir || !escala;

  const animar = (para: number) => {
    const duracao = duracaoMovimento('toque', semEscala);
    if (duracao === 0) {
      valor.setValue(para);
      return;
    }
    Animated.timing(valor, { toValue: para, duration: duracao, easing: curvaPadrao, useNativeDriver: true }).start();
  };

  return (
    <AnimatedPressable
      {...resto}
      disabled={disabled}
      onPressIn={(e: GestureResponderEvent) => {
        setPressionado(true);
        animar(escalaDoToque(true, semEscala));
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        setPressionado(false);
        animar(1);
        onPressOut?.(e);
      }}
      onPress={(e: GestureResponderEvent) => {
        if (vibrar) vibrarLeve();
        onPress?.(e);
      }}
      style={[style, { transform: [{ scale: valor }] }, pressionado && semEscala ? { opacity: opacidadeDoToque(true, true) } : null]}>
      {children}
    </AnimatedPressable>
  );
}
