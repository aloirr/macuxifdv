/**
 * Níveis filhos da árvore do catálogo (RF-CAT-04), com a quantidade de produtos de cada um. A trilha clicável é o
 * componente comum `Trilha` de `@macuxi/ui/mobile` (montada em catalogo.tsx); estes níveis são específicos do Catálogo.
 * Alvos de toque de 48 dp; funciona offline (as linhas vêm do aparelho).
 */
import { colors, fonts, Icon } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NoCatalogo } from '../../domain/arvore';

export interface NoComContagem {
  no: NoCatalogo;
  produtos: number;
}

export function NiveisArvore({ filhos, onEscolher }: { filhos: readonly NoComContagem[]; onEscolher: (noId: string) => void }) {
  if (filhos.length === 0) return null;
  return (
    <View style={s.lista} testID="catalogo-niveis">
      {filhos.map(({ no, produtos }) => (
        <Pressable
          key={no.id}
          accessibilityRole="button"
          accessibilityLabel={`${no.nome}, ${produtos === 1 ? '1 produto' : `${produtos} produtos`}`}
          onPress={() => onEscolher(no.id)}
          style={({ pressed }) => [s.no, pressed && { opacity: 0.7 }]}
          testID={`catalogo-no-${no.codigo}`}
        >
          <Text style={s.nome} numberOfLines={2}>
            {no.nome}
          </Text>
          <Text style={s.contagem}>{produtos}</Text>
          <Icon name="chevron" size={16} color={colors.ink3} />
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  lista: { gap: 8 },
  no: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 12 },
  nome: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  contagem: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },
});
