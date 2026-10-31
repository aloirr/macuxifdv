/**
 * Barra de abas inferior (copiada de components/tab-bar.tsx da Fase M). As abas deixaram de ser fixas
 * (Início · Rota · Clientes · Pedidos · Metas): "Início" é do shell e as demais vêm das telas com `navegacao`
 * dos módulos efetivos (lib/modulos.ts → `visao.navegacao`), filtradas por perfil e permissão por ação.
 * testID estável: `tab-inicio` e `tab-<modulo>-<id>` (= `nav-<modulo>-<id>` do registro). Badge = itens do
 * módulo ainda na fila do aparelho.
 */
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ItemNavegacao, ModuloId } from '@macuxi/platform-sdk';
import { colors, fonts, Icon, type IconName } from '@macuxi/ui/mobile';

export interface AbaShell {
  href: string;
  label: string;
  icon: IconName;
  testID: string;
  modulo: ModuloId | null;
}

const ICONES = new Set<string>(['home', 'pin', 'users', 'clipboard', 'target', 'sync', 'check', 'navigate', 'clock', 'alert', 'chat', 'file', 'user', 'search']);

export function abasDoShell(navegacao: readonly ItemNavegacao<unknown>[]): AbaShell[] {
  return [
    { href: '/', label: 'Início', icon: 'home', testID: 'tab-inicio', modulo: null },
    ...navegacao.map((n) => ({
      href: `/m/${n.caminho}`,
      label: n.rotulo,
      icon: (n.icone && ICONES.has(n.icone) ? n.icone : 'file') as IconName,
      testID: `tab-${n.modulo}-${n.id}`,
      modulo: n.modulo,
    })),
  ];
}

export function TabBar({ abas, badges }: { abas: AbaShell[]; badges?: Partial<Record<ModuloId, number>> }) {
  const insets = useSafeAreaInsets();
  const atual = usePathname();
  return (
    <View accessibilityRole="tablist" testID="tab-bar" style={[styles.bar, { height: 76 + insets.bottom, paddingBottom: 14 + insets.bottom }]}>
      {abas.map((tab) => {
        const active = tab.href === '/' ? atual === '/' : atual === tab.href || atual.startsWith(`${tab.href}/`);
        const color = active ? colors.accent : colors.ink3;
        const badge = tab.modulo ? badges?.[tab.modulo] : undefined;
        return (
          <Pressable
            key={tab.href}
            testID={tab.testID}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => router.navigate(tab.href as never)}
            style={styles.item}>
            <View>
              <Icon name={tab.icon} size={22} color={color} strokeWidth={active ? 2 : 1.8} />
              {badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.label, { color, fontFamily: active ? fonts.semibold : fonts.medium }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 6,
    paddingHorizontal: 8,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 44 },
  label: { fontSize: 11 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 10, color: colors.warningInk },
});
