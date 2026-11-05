/**
 * Navegação comum das telas (pedido R-20261102-174719 do modulo-catalogo, RF-CAT-04):
 * - `Trilha`: trilha clicável (breadcrumb). Itens anteriores são botões; o último é o lugar atual (não clicável, lido
 *   pelo leitor de tela como "atual"; com `atualTocavel` também vira botão). Quebra de linha quando não cabe; alvo de toque de 48 dp.
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
  compacta,
  atualTocavel,
  rotuloAcessivel,
  testID = 'trilha',
}: {
  /** Do mais geral ao atual; o último é o lugar atual. */
  itens: readonly ItemTrilha[];
  onEscolher: (id: string) => void;
  /**
   * Visual curto da referência do Novo pedido (T-0071): "Mercearia › Bebidas" em 13, anteriores em cinza e o atual em
   * laranja. O alvo de toque continua 48 dp.
   */
  compacta?: boolean;
  /**
   * O último item também é tocável (chama `onEscolher` com o id dele). Para atalhos que levam a outra tela, como a trilha do
   * catálogo no Novo pedido (T-0071, V3): ali a trilha não é "onde você está", e sim o caminho para abrir o catálogo.
   */
  atualTocavel?: boolean;
  /** Leitura de cada item no leitor de tela; sem ela, "Ir para X" / "X, você está aqui". */
  rotuloAcessivel?: (item: ItemTrilha, atual: boolean) => string;
  testID?: string;
}) {
  if (itens.length === 0) return null;
  return (
    <View style={s.trilha} testID={testID}>
      {itens.map((item, i) => {
        const atual = i === itens.length - 1;
        const desligado = atual && !atualTocavel;
        return (
          <View key={item.id} style={s.item}>
            {i > 0 ? <Icon name="chevron" size={compacta ? 12 : 14} color={colors.ink3} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={rotuloAcessivel ? rotuloAcessivel(item, atual) : desligado ? `${item.rotulo}, você está aqui` : `Ir para ${item.rotulo}`}
              accessibilityState={{ disabled: desligado, selected: atual }}
              disabled={desligado}
              onPress={() => onEscolher(item.id)}
              style={({ pressed }) => [s.passo, compacta && s.passoCompacto, pressed && { opacity: 0.6 }]}
              testID={item.testID ?? `${testID}-${item.id}`}>
              <Text style={compacta ? (atual ? s.atualCompacto : s.linkCompacto) : atual ? s.atual : s.link}>{item.rotulo}</Text>
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
  // accentInk: o laranja `accent` sobre o fundo da tela dá 4,17:1 (abaixo de 4,5:1); accentInk dá 6,7:1 (T-0071, V3)
  link: { fontFamily: fonts.medium, fontSize: 14, color: colors.accentInk },
  atual: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  // .crumb / .crumb b da referência do Novo pedido
  passoCompacto: { paddingHorizontal: 4 },
  linkCompacto: { fontFamily: fonts.body, fontSize: 13, color: colors.ink2 },
  atualCompacto: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accentInk },
});
