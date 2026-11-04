/**
 * Barra de abas inferior do shell. As abas deixaram de ser fixas (Início · Rota · Clientes · Pedidos · Metas):
 * "Início" é do shell e as demais vêm das telas com `navegacao` dos módulos efetivos (lib/modulos.ts →
 * `visao.navegacao`), filtradas por perfil e permissão por ação. Montagem e limite de 5 posições (com "Mais") em
 * `lib/abas.ts`, puro e testado (T-0034). O desenho é a `BarraAbas` do kit (T-0072, docs/design/componentes.md §5).
 * testID estável: `tab-bar`, `tab-inicio`, `tab-<modulo>-<id>` (= `nav-<modulo>-<id>` do registro) e `tab-mais`.
 * Contador = itens do módulo ainda na fila do aparelho, em âmbar ("Mais" soma os módulos que estão dentro dele).
 */
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ModuloId } from '@macuxi/platform-sdk';
import { BarraAbas } from '@macuxi/ui/mobile';

import { abaAtiva, type AbasDoShell } from '@/lib/abas';
import { marcarTrocaDeAba } from '@/lib/transicao-modulo';

export { abasDoShell, type AbaShell, type AbasDoShell } from '@/lib/abas';

export function TabBar({ abas, badges }: { abas: AbasDoShell; badges?: Partial<Record<ModuloId, number>> }) {
  const insets = useSafeAreaInsets();
  const atual = usePathname();
  const itens = abas.barra.map((tab) => {
    // "Mais" soma a fila dos módulos que estão dentro dele
    const contador = tab.modulo ? badges?.[tab.modulo] : tab.href === '/' ? undefined : somaBadges(abas.mais, badges);
    return {
      id: tab.testID,
      rotulo: tab.label,
      icone: tab.icon,
      ativo: abaAtiva(tab, atual, abas.mais),
      contador,
      rotuloContador: contador ? `${contador} na fila` : undefined,
      testID: tab.testID,
      onPress: () => {
        // troca de aba não desliza (T-0072): só a navegação dentro do módulo anima
        if (tab.href.startsWith('/m/')) marcarTrocaDeAba();
        router.navigate(tab.href as never);
      },
    };
  });
  return <BarraAbas itens={itens} respiroInferior={insets.bottom} tomContador="aviso" testID="tab-bar" />;
}

function somaBadges(abas: AbasDoShell['mais'], badges?: Partial<Record<ModuloId, number>>): number | undefined {
  const vistos = new Set<ModuloId>();
  let total = 0;
  for (const a of abas) {
    if (!a.modulo || vistos.has(a.modulo)) continue;
    vistos.add(a.modulo);
    total += badges?.[a.modulo] ?? 0;
  }
  return total || undefined;
}
