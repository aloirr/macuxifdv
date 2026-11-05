/**
 * Layout das abas (copiado de app/(tabs)/_layout.tsx da Fase M). Sem sessão → login; sem sincronização
 * inicial → tela de sync. As abas vêm do shell (componente TabBar); as telas de módulo são servidas por
 * `m/[...caminho]` a partir do registro `moduloApp` de cada módulo (ponto de extensão da B2).
 * Histórico das telas de módulo por aba (T-0071, lib/historico-telas.ts): o roteador do Tabs desempilha no GO_BACK (voltar
 * do Android e `router.back()` do `BackLink`) e o `replace` entre telas de módulo não apaga o histórico das abas (e marca a
 * tela que abre para substituir o topo da pilha); o foco da
 * rota `m/[...caminho]` diz quando a próxima tela vem de fora (Início, Mais, Perfil) e recomeça a pilha da aba dela; o
 * foco do Início e do "Mais" diz de onde ela veio (o voltar na raiz devolve para lá, e a barra acende essa aba).
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import type { ModuloId } from '@macuxi/platform-sdk';
import { colors } from '@macuxi/ui/mobile';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { abasDoShell, TabBar } from '@/components/tab-bar';
import { comHistoricoDoShell, marcarOrigemFora, marcarSaidaDoModulo, marcarVoltaAoModulo, ROTA_MODULO } from '@/lib/historico-telas';
import { usePlataforma } from '@/state/plataforma';

export default function TabsLayout() {
  const { sessao, visao } = usePlataforma();
  const { estado } = useMotorSync();
  // o `router.replace` de uma tela de módulo para outra substitui o topo da pilha da aba (o editor sai da pilha): o
  // roteador do shell marca a tela que abre (`PARAM_SUBSTITUIR`, ADR 0026), sem evento interno nem janela de tempo
  if (!sessao) return <Redirect href="/login" />;
  if (!estado.sincronizado_em) return <Redirect href="/sync" />;
  const badges: Partial<Record<ModuloId, number>> = {};
  for (const i of estado.fila) badges[i.modulo] = (badges[i.modulo] ?? 0) + 1;
  return (
    <Tabs
      backBehavior="history"
      UNSTABLE_router={(original) => comHistoricoDoShell(original)}
      tabBar={() => <TabBar abas={abasDoShell(visao.navegacao)} badges={badges} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.ground } }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} listeners={{ focus: () => marcarOrigemFora('inicio') }} />
      <Tabs.Screen name={ROTA_MODULO} options={{ title: 'Módulo' }} listeners={{ focus: marcarVoltaAoModulo, blur: marcarSaidaDoModulo }} />
      <Tabs.Screen name="mais" options={{ title: 'Mais' }} listeners={{ focus: () => marcarOrigemFora('mais') }} />
    </Tabs>
  );
}
