/**
 * Tela de erro do shell (relato do dono do produto, 08/11: "Novo pedido" e a sincronização inicial fechavam o app). Sem ela,
 * um erro de render no build sem Metro encerra o processo. Exportada como `ErrorBoundary` do expo-router:
 * - `TelaDeErroDoModulo` em `(tabs)/m/[...caminho].tsx`: só a tela do módulo troca; a barra inferior continua;
 * - `TelaDeErroDaRaiz` no `app/_layout.tsx`: fora dos provedores do shell (sem kit, só React Native puro).
 * As duas gravam o último erro para o Diagnóstico do Perfil (`services/erros.ts`).
 */
import { Botao, EstadoVazio, Screen } from '@macuxi/ui/mobile';
import { router, usePathname, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';

import { gravarErro } from '@/services/erros';

export function TelaDeErroDoModulo({ error, retry }: ErrorBoundaryProps) {
  const onde = usePathname();
  useEffect(() => {
    void gravarErro(error, 'tela', onde);
  }, [error, onde]);
  return (
    <Screen testID="tela-erro">
      <EstadoVazio
        icone="alert"
        titulo="Esta tela teve um problema"
        texto="Nada do que já estava salvo no aparelho se perdeu. Tente de novo; se repetir, o detalhe fica em Perfil › Diagnóstico."
        testID="tela-erro-estado"
      />
      <Botao nivel="principal" rotulo="Tentar de novo" onPress={() => void retry()} testID="tela-erro-tentar" />
      <Botao nivel="secundario" rotulo="Ir para o Início" onPress={() => router.replace('/')} testID="tela-erro-inicio" />
    </Screen>
  );
}

export function TelaDeErroDaRaiz({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    void gravarErro(error, 'raiz');
  }, [error]);
  return (
    <View testID="tela-erro-raiz" style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: '#F3F4F1' }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: '#17202A' }}>O app teve um problema</Text>
      <Text style={{ fontSize: 15, color: '#4A5560' }}>
        Nada do que já estava salvo no aparelho se perdeu. Toque em Tentar de novo; se repetir, o detalhe fica em Perfil › Diagnóstico.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        testID="tela-erro-raiz-tentar"
        style={{ minHeight: 48, borderRadius: 12, backgroundColor: '#C2540A', alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>Tentar de novo</Text>
      </Pressable>
    </View>
  );
}
