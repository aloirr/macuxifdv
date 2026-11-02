/**
 * Navegação comum das telas (pedido R-20261102-174719 do modulo-catalogo, RF-CAT-04):
 * - `Trilha`: trilha clicável (breadcrumb). Itens anteriores são botões; o último é o lugar atual (não clicável, lido
 *   pelo leitor de tela como "atual"). Quebra de linha quando não cabe; alvo de toque de 48 dp.
 * - `LinhaChips`: uma linha de chips com rolagem horizontal (não empurra a lista para baixo quando há muitos filtros).
 * Só apresentação: quem decide o que entra na trilha ou nos chips é a tela/domain do módulo.
 */
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from './icon';
import { colors, fonts } from './theme';

/** Alvo de toque mínimo destas peças (48 dp, Material). */
const ALVO = 48;

export interface ItemTrilha {
  /** Chave estável (id do nó). */
  id: string;
  rotulo: string;
  testID?: string;
}

export function Trilha({
  itens,
  onEscolher,
  testID = 'trilha',
}: {
  /** Do mais geral ao atual; o último é o lugar atual. */
  itens: readonly ItemTrilha[];
  onEscolher: (id: string) => void;
  testID?: string;
}) {
  if (itens.length === 0) return null;
  return (
    <View style={s.trilha} testID={testID}>
      {itens.map((item, i) => {
        const atual = i === itens.length - 1;
        return (
          <View key={item.id} style={s.item}>
            {i > 0 ? <Icon name="chevron" size={14} color={colors.ink3} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={atual ? `${item.rotulo}, você está aqui` : `Ir para ${item.rotulo}`}
              accessibilityState={{ disabled: atual, selected: atual }}
              disabled={atual}
              onPress={() => onEscolher(item.id)}
              style={({ pressed }) => [s.passo, pressed && { opacity: 0.6 }]}
              testID={item.testID ?? `${testID}-${item.id}`}>
              <Text style={atual ? s.atual : s.link}>{item.rotulo}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Linha de chips com rolagem horizontal. Encosta nas bordas da tela (`sangria` = respiro lateral do `Screen`, 20) para o
 * último chip não ficar cortado no meio do respiro.
 */
export function LinhaChips({ children, sangria = 20, testID }: { children: ReactNode; sangria?: number; testID?: string }) {
  return (
    <ScrollView
      horizontal
      testID={testID}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={{ marginHorizontal: -sangria, flexGrow: 0 }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: sangria, alignItems: 'center', minHeight: ALVO }}>
      {children}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  trilha: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'center' },
  passo: { minHeight: ALVO, justifyContent: 'center', paddingHorizontal: 6 },
  link: { fontFamily: fonts.medium, fontSize: 14, color: colors.accent },
  atual: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
});
