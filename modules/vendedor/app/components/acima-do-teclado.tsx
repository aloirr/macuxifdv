/**
 * Teclado do novo pedido (T-0071, V1). O Android do Expo 57 é edge-to-edge e a janela não encolhe com o teclado: o
 * `KeyboardAvoidingView` com `padding` encolhe só a área rolável (o rodapé Total | Avançar fica fora dele e o teclado o cobre),
 * e ao abrir o teclado a rolagem leva o campo com foco para cima dele, com 8 dp de folga. Regras em `lib/teclado.ts`.
 */
import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StatusBar, TextInput, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { deslocamentoDoTeclado, rolagemParaCampo } from '../lib/teclado';

/** Envolve só a área rolável (nunca o rodapé). `padding` nas duas plataformas, com o deslocamento da barra de status do shell. */
export function AcimaDoTeclado({ children }: { children: ReactNode }) {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={deslocamentoDoTeclado(Platform.OS, StatusBar.currentHeight)}>
      {children}
    </KeyboardAvoidingView>
  );
}

/**
 * Ao abrir o teclado, rola o `ScrollView` até o campo com foco ficar inteiro acima dele. Passe `ref`, `onScroll` e `onLayout` ao
 * ScrollView. W3: a rolagem espera o evento de teclado mostrado e o layout da área encolhida (onLayout); se o layout não mudar
 * (a área já cabia), um prazo curto roda a rolagem mesmo assim.
 */
export function useCampoAcimaDoTeclado(): {
  ref: RefObject<ScrollView | null>;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout: () => void;
} {
  const ref = useRef<ScrollView | null>(null);
  const y = useRef(0);
  const pendente = useRef<{ tecladoTopo: number } | null>(null);
  const prazo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    y.current = e.nativeEvent.contentOffset.y;
  }, []);
  const rolar = useCallback(() => {
    const p = pendente.current;
    pendente.current = null;
    if (prazo.current) clearTimeout(prazo.current);
    prazo.current = null;
    if (!p) return;
    const campo = TextInput.State.currentlyFocusedInput?.();
    if (!campo) return;
    requestAnimationFrame(() => {
      campo.measureInWindow((_x, topo, _w, altura) => {
        const dy = rolagemParaCampo({ campoBaixo: topo + altura, tecladoTopo: p.tecladoTopo });
        if (dy > 0) ref.current?.scrollTo({ y: y.current + dy, animated: true });
      });
    });
  }, []);
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', (e) => {
      pendente.current = { tecladoTopo: e.endCoordinates.screenY };
      if (prazo.current) clearTimeout(prazo.current);
      prazo.current = setTimeout(rolar, 250);
    });
    return () => {
      sub.remove();
      if (prazo.current) clearTimeout(prazo.current);
    };
  }, [rolar]);
  return { ref, onScroll, onLayout: rolar };
}
