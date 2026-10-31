/**
 * Tela de módulo montada pelo shell (ponto de extensão da B2): `/m/pedidos` → tela `pedidos` registrada
 * em `modules/<m>/app` (`moduloApp.paginas`). Só abre se o módulo é efetivo, da variante, e a ação
 * exigida é permitida (ADR 0004 — promotor nunca abre tela de pedido, RN-PRO-01).
 */
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { Empty, Screen } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import type { ComponenteTela } from '@/lib/modulos';

export default function TelaDeModulo() {
  const { caminho } = useLocalSearchParams<{ caminho: string | string[] }>();
  const visao = useVisaoShell<ComponenteTela>();
  const pagina = visao.pagina(Array.isArray(caminho) ? caminho.join('/') : (caminho ?? ''));
  if (!pagina) {
    return (
      <Screen testID="tela-indisponivel">
        <Empty text="Esta tela não está disponível para o seu perfil ou o módulo está desativado." />
      </Screen>
    );
  }
  const Componente = pagina.componente;
  return (
    <View testID={`pagina-${pagina.modulo}-${pagina.id}`} style={{ flex: 1 }}>
      <Componente />
    </View>
  );
}
