/**
 * Navegação pela árvore do catálogo (RF-CAT-04): trilha clicável + níveis filhos do ERP, com a quantidade de produtos
 * de cada um. Componente LOCAL simples (a trilha e os chips comuns ficam para o `packages/ui`; pedido ao engenheiro-apps).
 * Alvos de toque de 48 dp; funciona offline (as linhas vêm do aparelho).
 */
import { colors, fonts, Icon } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NoCatalogo } from '../../domain/arvore';

export interface NoComContagem {
  no: NoCatalogo;
  produtos: number;
}

export function TrilhaArvore({ trilha, onEscolher }: { trilha: readonly NoCatalogo[]; onEscolher: (noId: string | null) => void }) {
  if (trilha.length === 0) return null;
  return (
    <View style={s.trilha} testID="catalogo-trilha" accessibilityRole="header">
      <Pressable accessibilityRole="button" accessibilityLabel="Voltar ao início do catálogo" onPress={() => onEscolher(null)} style={s.passo} testID="catalogo-trilha-inicio">
        <Text style={s.link}>Início</Text>
      </Pressable>
      {trilha.map((n, i) => {
        const ultimo = i === trilha.length - 1;
        return (
          <View key={n.id} style={s.item}>
            <Icon name="chevron" size={14} color={colors.ink3} />
            <Pressable accessibilityRole="button" accessibilityLabel={`Ir para ${n.nome}`} disabled={ultimo} onPress={() => onEscolher(n.id)} style={s.passo} testID={`catalogo-trilha-${n.codigo}`}>
              <Text style={ultimo ? s.atual : s.link}>{n.nome}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
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
  trilha: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'center' },
  passo: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 6 },
  link: { fontFamily: fonts.medium, fontSize: 14, color: colors.accent },
  atual: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.ink },
  lista: { gap: 8 },
  no: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 12 },
  nome: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  contagem: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },
});
