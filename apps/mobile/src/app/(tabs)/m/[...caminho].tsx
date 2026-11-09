/**
 * Tela de módulo montada pelo shell (ponto de extensão da B2): `/m/pedidos` → tela `pedidos` registrada
 * em `modules/<m>/app` (`moduloApp.paginas`). Só abre se o módulo é efetivo, da variante, e a ação
 * exigida é permitida (ADR 0004 — promotor nunca abre tela de pedido, RN-PRO-01).
 * Transição "avançar" (T-0072): a tela nova entra pela direita em 240 ms; voltar entra pela esquerda; troca de aba e
 * "reduzir movimento" não deslocam (lib/transicao-modulo.ts).
 * Histórico por aba (T-0071): cada tela que abre entra na pilha da aba (lib/historico-telas.ts), que o voltar do Android e
 * o `BackLink` desempilham pelo roteador do Tabs ((tabs)/_layout.tsx).
 * Rótulo do voltar (T-0072, R-20261105-132419 / R-20261105-135855): a tela fica dentro do `ProvedorVoltar` do kit com o
 * valor do shell (`useVoltarDoShell`), lido já no render: na raiz de uma pilha aberta pelo Início o `BackLink` mostra
 * "‹ Início" (lido "Voltar para Início") desde o primeiro quadro; no resto (`null`) vale o rótulo do módulo.
 */
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { curvaPadrao, Empty, ProvedorVoltar, Screen, useReduzirMovimento } from '@macuxi/ui/mobile';
import { useLocalSearchParams, useRoute } from 'expo-router';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { Animated, useWindowDimensions } from 'react-native';

import { TelaDeErroDoModulo } from '@/components/tela-de-erro';
import { chaveDosParams, registrarTelaAberta, type ParamsDaRota } from '@/lib/historico-telas';
import { animacaoDeEntrada } from '@/lib/transicao-modulo';
import type { ComponenteTela } from '@/lib/modulos';
import { useVoltarDoShell } from '@/state/historico-do-shell';

/** Erro de render numa tela de módulo: troca só a tela (a barra inferior segue) e grava o erro (T-0140, relato de 08/11). */
export const ErrorBoundary = TelaDeErroDoModulo;

export default function TelaDeModulo() {
  const { caminho } = useLocalSearchParams<{ caminho: string | string[] }>();
  // parâmetros crus do estado de navegação: os mesmos que o roteador do Tabs lê no voltar
  const params = useRoute().params as ParamsDaRota | undefined;
  const visao = useVisaoShell<ComponenteTela>();
  const pagina = visao.pagina(Array.isArray(caminho) ? caminho.join('/') : (caminho ?? ''));
  const chave = chaveDosParams(params);
  if (!pagina) {
    return (
      <EntradaDaTela chave={chave} params={params} testID="tela-indisponivel-entrada">
        <Screen testID="tela-indisponivel">
          <Empty text="Esta tela não está disponível para o seu perfil ou o módulo está desativado." />
        </Screen>
      </EntradaDaTela>
    );
  }
  const Componente = pagina.componente;
  return (
    <EntradaDaTela chave={chave} params={params} testID={`pagina-${pagina.modulo}-${pagina.id}`}>
      <Componente />
    </EntradaDaTela>
  );
}

/**
 * Registra a tela na pilha da aba, anima a entrada quando a rota muda (deslocamento lateral + esmaecer, driver nativo) e
 * dá à tela o rótulo do voltar do shell (`ProvedorVoltar`).
 */
function EntradaDaTela({ chave, params, testID, children }: { chave: string; params: ParamsDaRota | undefined; testID: string; children: ReactNode }) {
  const reduzir = useReduzirMovimento();
  // previsão pura sobre o retrato do histórico: já certo antes do registro no useLayoutEffect (sem piscar "Pedidos")
  const voltar = useVoltarDoShell(params);
  const { width } = useWindowDimensions();
  // valores animados criados uma vez (useState preguiçoso: sem ler ref no render, amigo do React Compiler)
  const [x] = useState(() => new Animated.Value(0));
  const [opacidade] = useState(() => new Animated.Value(1));
  // antes de pintar: a tela nova já nasce deslocada (sem piscar na posição final)
  useLayoutEffect(() => {
    const { deslocamento, duracaoMs } = animacaoDeEntrada(registrarTelaAberta(params), width, reduzir);
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
    // só a troca de rota registra e anima; largura e "reduzir movimento" entram na próxima troca
  }, [chave]);
  return (
    <Animated.View testID={testID} style={{ flex: 1, opacity: opacidade, transform: [{ translateX: x }] }}>
      <ProvedorVoltar value={voltar}>{children}</ProvedorVoltar>
    </Animated.View>
  );
}
