/**
 * Layout das abas (copiado de app/(tabs)/_layout.tsx da Fase M). Sem sessão → login; sem sincronização
 * inicial → tela de sync. As abas vêm do shell (componente TabBar); as telas de módulo são servidas por
 * `m/[...caminho]` a partir do registro `moduloApp` de cada módulo (ponto de extensão da B2).
 * Histórico das telas de módulo por aba (T-0071, lib/historico-telas.ts): o roteador do Tabs desempilha no GO_BACK (voltar
 * do Android e `router.back()` do `BackLink`) e o `replace` entre telas de módulo não apaga o histórico das abas (e marca a
 * tela que abre para substituir o topo da pilha); o foco da
 * rota `m/[...caminho]` diz quando a próxima tela vem de fora (Início, Mais, Perfil) e recomeça a pilha da aba dela; o
 * foco do Início e do "Mais" diz de onde ela veio (o voltar na raiz devolve para lá, e a barra acende essa aba).
 * ADR 0054 (solução 5): a entrada libera com a carga completa ou com os essenciais feitos (`liberado_em`); o resto da carga
 * segue com o indicador discreto colado em cima da barra de abas (`CargaEmFundo`).
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import * as kit from '@macuxi/ui/mobile';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { Provider, ReactNode } from 'react';

import { CargaEmFundo } from '@/components/carga-fundo';
import { ProvedorContagemSino, Sino } from '@/components/sino';
import { abasDoShell, TabBar } from '@/components/tab-bar';
import { MAX_ABAS_POR_VARIANTE } from '@/lib/abas';
import { entradaLiberadaPeloMotor } from '@/lib/carga-fundo';
import { comHistoricoDoShell, marcarOrigemFora, marcarSaidaDoModulo, marcarVoltaAoModulo, ROTA_MODULO } from '@/lib/historico-telas';
import { varianteAtual } from '@/lib/variante';
import { usePlataforma } from '@/state/plataforma';

/**
 * Sino no cabeçalho de todas as telas (T-0170): o `CabecalhoTela` do kit mostra o que vier pelo `ProvedorSinoCabecalho`
 * (pedido ao designer-ux, R-20261113-173653). Lido de forma opcional até o kit exportar: sem ele, o sino fica só no Início.
 */
const ProvedorSinoCabecalho = (kit as unknown as { ProvedorSinoCabecalho?: Provider<ReactNode> }).ProvedorSinoCabecalho;

export default function TabsLayout() {
  const { sessao, visao } = usePlataforma();
  const { estado } = useMotorSync();
  // o `router.replace` de uma tela de módulo para outra substitui o topo da pilha da aba (o editor sai da pilha): o
  // roteador do shell marca a tela que abre (`PARAM_SUBSTITUIR`, ADR 0026), sem evento interno nem janela de tempo
  if (!sessao) return <Redirect href="/login" />;
  if (!entradaLiberadaPeloMotor(estado)) return <Redirect href="/sync" />;
  const abas = (
    <Tabs
      backBehavior="history"
      UNSTABLE_router={(original) => comHistoricoDoShell(original)}
      tabBar={() => (
        <>
          <CargaEmFundo />
          <TabBar abas={abasDoShell(visao.navegacao, MAX_ABAS_POR_VARIANTE[varianteAtual()])} />
        </>
      )}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: kit.colors.ground } }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} listeners={{ focus: () => marcarOrigemFora('inicio') }} />
      <Tabs.Screen name={ROTA_MODULO} options={{ title: 'Módulo' }} listeners={{ focus: marcarVoltaAoModulo, blur: marcarSaidaDoModulo }} />
      <Tabs.Screen name="mais" options={{ title: 'Mais' }} listeners={{ focus: () => marcarOrigemFora('mais') }} />
    </Tabs>
  );
  return (
    <ProvedorContagemSino>
      {ProvedorSinoCabecalho ? <ProvedorSinoCabecalho value={<Sino sobreFaixa />}>{abas}</ProvedorSinoCabecalho> : abas}
    </ProvedorContagemSino>
  );
}
