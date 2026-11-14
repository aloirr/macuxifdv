/**
 * "Mais": as abas de módulo que não couberam na barra inferior (limite por variante, `lib/abas.ts`, T-0034/T-0170).
 * Só lista o que o shell já montou para o usuário (módulos efetivos: manifesto + licença + perfil + ação), então
 * nunca mostra tela sem licença ou perfil. Funciona offline (a visão vem dos módulos guardados no aparelho).
 * Cada item é uma aba: volta ao topo da pilha guardada dela (lib/historico-telas.ts, T-0071).
 */
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { Card, colors, Empty, Icon, Screen, SectionHeader, type as t } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { abasDoShell, MAX_ABAS_POR_VARIANTE } from '@/lib/abas';
import { abrirAba } from '@/lib/historico-telas';
import { varianteAtual } from '@/lib/variante';

export default function Mais() {
  const visao = useVisaoShell();
  const { mais } = abasDoShell(visao.navegacao, MAX_ABAS_POR_VARIANTE[varianteAtual()]);
  return (
    <Screen testID="tela-mais" cabecalho={{ titulo: 'Mais' }}>
      <SectionHeader title="Outras telas" />
      {mais.length === 0 ? (
        <Empty text="Todas as suas telas já estão na barra de baixo." />
      ) : (
        mais.map((aba) => (
          <Pressable
            key={aba.href}
            testID={aba.testID.replace(/^tab-/, 'mais-')}
            accessibilityRole="button"
            accessibilityLabel={aba.label}
            onPress={() => router.navigate(abrirAba(aba.href, false) as never)}>
            <Card style={{ padding: 14, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon name={aba.icon} size={20} color={colors.ink2} />
              <View style={{ flex: 1 }}>
                <Text style={t.title16}>{aba.label}</Text>
              </View>
              <Icon name="chevron" size={18} color={colors.ink3} />
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
