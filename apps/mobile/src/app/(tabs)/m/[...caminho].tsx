/**
 * Tela de módulo montada pelo shell (ponto de extensão da B2): `/m/pedidos` → tela `pedidos` registrada
 * em `modules/<m>/app` (`moduloApp.paginas`). Só abre se o módulo é efetivo, da variante, e a ação
 * exigida é permitida (ADR 0004 — promotor nunca abre tela de pedido, RN-PRO-01).
 * Transição "avançar" (T-0072): a tela nova entra pela direita em 240 ms; voltar entra pela esquerda; troca de aba e
 * "reduzir movimento" não deslocam (lib/transicao-modulo.ts).
 */
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { curvaPadrao, Empty, Screen, useReduzirMovimento } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { Animated, useWindowDimensions } from 'react-native';

import { animacaoDeEntrada, chaveDaRota, registrarTelaAberta } from '@/lib/transicao-modulo';
import type { ComponenteTela } from '@/lib/modulos';

export default function TelaDeModulo() {
  const params = useLocalSearchParams<{ caminho: string | string[] }>();
  const { caminho } = params;
  const visao = useVisaoShell<ComponenteTela>();
  const pagina = visao.pagina(Array.isArray(caminho) ? caminho.join('/') : (caminho ?? ''));
  const chave = chaveDaRota(caminho, params as Record<string, string | string[] | undefined>);
  if (!pagina) {
    return (
      <EntradaDaTela chave={chave} testID="tela-indisponivel-entrada">
        <Screen testID="tela-indisponivel">
          <Empty text="Esta tela não está disponível para o seu perfil ou o módulo está desativado." />
        </Screen>
      </EntradaDaTela>
    );
  }
  const Componente = pagina.componente;
  return (
    <EntradaDaTela chave={chave} testID={`pagina-${pagina.modulo}-${pagina.id}`}>
      <Componente />
    </EntradaDaTela>
  );
}

/** Anima a entrada quando a rota muda (deslocamento lateral + esmaecer, driver nativo). */
function EntradaDaTela({ chave, testID, children }: { chave: string; testID: string; children: ReactNode }) {
  const reduzir = useReduzirMovimento();
  const { width } = useWindowDimensions();
  // valores animados criados uma vez (useState preguiçoso: sem ler ref no render, amigo do React Compiler)
  const [x] = useState(() => new Animated.Value(0));
  const [opacidade] = useState(() => new Animated.Value(1));
  // antes de pintar: a tela nova já nasce deslocada (sem piscar na posição final)
  useLayoutEffect(() => {
    const { deslocamento, duracaoMs } = animacaoDeEntrada(registrarTelaAberta(chave), width, reduzir);
    x.stopAnimation();
    opacidade.stopAnimation();
    if (duracaoMs === 0) {
      x.setValue(0);
      opacidade.setValue(1);
      return;
    }
    x.setValue(deslocamento);
    opacidade.setValue(0);
    Animated.parallel([
      Animated.timing(x, { toValue: 0, duration: duracaoMs, easing: curvaPadrao, useNativeDriver: true }),
      Animated.timing(opacidade, { toValue: 1, duration: duracaoMs, easing: curvaPadrao, useNativeDriver: true }),
    ]).start();
    // só a troca de rota anima; largura e "reduzir movimento" entram na próxima troca
  }, [chave]);
  return (
    <Animated.View testID={testID} style={{ flex: 1, opacity: opacidade, transform: [{ translateX: x }] }}>
      {children}
    </Animated.View>
  );
}
