/**
 * Barra de abas inferior (copiada de components/tab-bar.tsx da Fase M). As abas deixaram de ser fixas
 * (Início · Rota · Clientes · Pedidos · Metas): "Início" é do shell e as demais vêm das telas com `navegacao`
 * dos módulos efetivos (lib/modulos.ts → `visao.navegacao`), filtradas por perfil e permissão por ação.
 * Montagem e limite de 5 posições (com "Mais") em `lib/abas.ts`, puro e testado (T-0034).
 * testID estável: `tab-inicio`, `tab-<modulo>-<id>` (= `nav-<modulo>-<id>` do registro) e `tab-mais`. Badge = itens
 * do módulo ainda na fila do aparelho ("Mais" soma os módulos que estão dentro dele).
 */
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ModuloId } from '@macuxi/platform-sdk';
import { colors, fonts, Icon } from '@macuxi/ui/mobile';

import { abaAtiva, type AbasDoShell } from '@/lib/abas';

export { abasDoShell, type AbaShell, type AbasDoShell } from '@/lib/abas';

export function TabBar({ abas, badges }: { abas: AbasDoShell; badges?: Partial<Record<ModuloId, number>> }) {
  const insets = useSafeAreaInsets();
  const atual = usePathname();
  return (
    <View accessibilityRole="tablist" testID="tab-bar" style={[styles.bar, { height: 76 + insets.bottom, paddingBottom: 14 + insets.bottom }]}>
      {abas.barra.map((tab) => {
        const active = abaAtiva(tab, atual, abas.mais);
        const color = active ? colors.accent : colors.ink3;
        // "Mais" soma a fila dos módulos que estão dentro dele
        const badge = tab.modulo ? badges?.[tab.modulo] : tab.href === '/' ? undefined : somaBadges(abas.mais, badges);
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
