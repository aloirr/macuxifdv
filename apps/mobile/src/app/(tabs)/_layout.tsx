/**
 * Layout das abas (copiado de app/(tabs)/_layout.tsx da Fase M). Sem sessão → login; sem sincronização
 * inicial → tela de sync. As abas vêm do shell (componente TabBar); as telas de módulo são servidas por
 * `m/[...caminho]` a partir do registro `moduloApp` de cada módulo (ponto de extensão da B2).
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import type { ModuloId } from '@macuxi/platform-sdk';
import { colors } from '@macuxi/ui/mobile';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { abasDoShell, TabBar } from '@/components/tab-bar';
import { usePlataforma } from '@/state/plataforma';

export default function TabsLayout() {
  const { sessao, visao } = usePlataforma();
  const { estado } = useMotorSync();
  if (!sessao) return <Redirect href="/login" />;
  if (!estado.sincronizado_em) return <Redirect href="/sync" />;
  const badges: Partial<Record<ModuloId, number>> = {};
  for (const i of estado.fila) badges[i.modulo] = (badges[i.modulo] ?? 0) + 1;
  return (
    <Tabs
      backBehavior="history"
      tabBar={() => <TabBar abas={abasDoShell(visao.navegacao)} badges={badges} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.ground } }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} />
      <Tabs.Screen name="m/[...caminho]" options={{ title: 'Módulo' }} />
      <Tabs.Screen name="mais" options={{ title: 'Mais' }} />
    </Tabs>
  );
}
