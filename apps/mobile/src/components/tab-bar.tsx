/**
 * Barra de abas inferior do shell. As abas deixaram de ser fixas (Início · Rota · Clientes · Pedidos · Metas):
 * "Início" é do shell e as demais vêm das telas com `navegacao` dos módulos efetivos (lib/modulos.ts →
 * `visao.navegacao`), filtradas por perfil e permissão por ação. Montagem e posições por variante em
 * `lib/abas.ts`, puro e testado (T-0034). O desenho é a `BarraAbas` do kit (T-0072, docs/design/componentes.md §5).
 * testID estável: `tab-bar`, `tab-inicio`, `tab-<modulo>-<id>` (= `nav-<modulo>-<id>` do registro) e `tab-mais`.
 * Sem contador nas abas (RD-0078, R-20261110-112315): a fila do aparelho já aparece no selo "Na fila" de cada linha e
 * no "n na fila" do Início ("uma informação, um lugar", RN-VEN-42).
 * Aba de módulo (T-0071): volta ao topo da pilha guardada da aba; tocada de novo numa tela de módulo, volta à raiz da aba
 * (lib/historico-telas.ts). Troca de aba não desliza (T-0072).
 * Aba acesa (T-0072, R-20261105-125027): a dona da pilha da tela de módulo em uso, não o caminho (`abaAcesa`).
 * Formulário alterado (RN-VEN-38, T-0128): todo toque passa por `bloqueioDoShell.tentarSair` (state/bloqueio-do-shell.ts).
 */
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarraAbas } from '@macuxi/ui/mobile';

import { abaAcesa, type AbasDoShell } from '@/lib/abas';
import { abrirAba } from '@/lib/historico-telas';
import { bloqueioDoShell } from '@/state/bloqueio-do-shell';
import { useDonoDaPilha } from '@/state/historico-do-shell';

export function TabBar({ abas }: { abas: AbasDoShell }) {
  const insets = useSafeAreaInsets();
  const atual = usePathname();
  // aba acesa = dona da pilha (o detalhe e o editor acendem a aba de onde vieram), relida a cada mudança do histórico
  const acesa = abaAcesa(abas, atual, useDonoDaPilha());
  const itens = abas.barra.map((tab) => ({
      id: tab.testID,
      rotulo: tab.label,
      icone: tab.icon,
      ativo: tab === acesa,
      testID: tab.testID,
      // RN-VEN-38 (T-0128): com formulário alterado em foco, a tela pergunta antes ("Sair do pedido?"); a aba só abre no
      // `prosseguir`, e a pilha guardada é lida nessa hora
      onPress: () => {
        bloqueioDoShell.tentarSair(() => {
          const destino = tab.href.startsWith('/m/') ? abrirAba(tab.href, atual.startsWith('/m/')) : tab.href;
          router.navigate(destino as never);
        });
      },
  }));
  return <BarraAbas itens={itens} respiroInferior={insets.bottom} testID="tab-bar" />;
}
