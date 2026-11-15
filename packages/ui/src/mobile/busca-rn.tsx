/**
 * T-0167 (RF-CAT-01; pedido-v4.md §5.3 e §6.6): o fim da lista de resultados da busca, no Catálogo e na aba Itens.
 * - `MostrarMais`: "Mostrando 20 de 87" (13 `ink2`, centrado) e o botão secundário 44 "+ Mostrar mais", largura toda. Com tudo
 *   à vista, os dois somem;
 * - `NadaEncontrado`: cartão com "Nenhum produto com “agau”." (14 `ink`) e, quando o módulo tem um termo parecido,
 *   "Você quis dizer “água”?" (14/600 `accentInk`, alvo 48; o toque busca o termo). Sem termo, só a frase.
 * Sem regra de negócio: total, página e sugestão vêm do módulo.
 */
import { StyleSheet, Text, View } from 'react-native';

import { Botao } from './base';
import { leituraDoMostrarMais, ROTULO_MOSTRAR_MAIS, textoDaContagemDaBusca, textoNadaEncontrado, textoVoceQuisDizer } from './busca';
import { ALVO_TOQUE } from './componentes';
import { Pressionavel } from './movimento-rn';
import { colors, fonte, radius } from './theme';

export function MostrarMais({
  mostrando,
  total,
  onPress,
  objeto = 'produtos',
  contagem: comContagem = true,
  testID = 'mostrar-mais',
}: {
  mostrando: number;
  total: number;
  /** O módulo mostra os próximos 20 (`proximaPaginaDaBusca`) da lista já ranqueada, sem nova consulta. */
  onPress: () => void;
  /** Para o TalkBack ("Mostrar mais 20 produtos…"). */
  objeto?: string;
  /** `false` quando a contagem já está no cabeçalho (Catálogo em grade, T-0173): fica só o botão; o TalkBack lê a contagem. */
  contagem?: boolean;
  testID?: string;
}) {
  const contagem = textoDaContagemDaBusca(mostrando, total);
  if (!contagem) return null;
  return (
    <View style={s.mais} testID={testID}>
      {comContagem ? (
        <Text style={s.contagem} testID={`${testID}-contagem`} accessibilityLiveRegion="polite">
          {contagem}
        </Text>
      ) : null}
      <Botao rotulo={ROTULO_MOSTRAR_MAIS} icone="plus" nivel="secundario" onPress={onPress} rotuloAcessivel={leituraDoMostrarMais(mostrando, total, objeto)} testID={`${testID}-botao`} />
    </View>
  );
}

export function NadaEncontrado({
  termo,
  sugestao,
  onSugestao,
  objeto = 'produto',
  testID = 'nada-encontrado',
}: {
  /** O que a pessoa digitou. */
  termo: string;
  /** Termo parecido do vocabulário do índice; null = sem sugestão. */
  sugestao?: string | null;
  /** Toque na sugestão: busca o termo sugerido. */
  onSugestao?: (termo: string) => void;
  objeto?: string;
  testID?: string;
}) {
  const voce = textoVoceQuisDizer(sugestao, termo);
  return (
    <View style={s.cartao} testID={testID}>
      <Text style={s.frase} accessibilityLiveRegion="polite">
        {textoNadaEncontrado(termo, objeto)}
      </Text>
      {voce && sugestao && onSugestao ? (
        <Pressionavel testID={`${testID}-sugestao`} accessibilityRole="button" accessibilityLabel={voce} onPress={() => onSugestao(sugestao.trim())} escala={false} style={s.sugestao}>
          <Text style={s.sugestaoTexto}>{voce}</Text>
        </Pressionavel>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  mais: { gap: 8, paddingTop: 4 },
  contagem: { textAlign: 'center', ...fonte.body, fontSize: 14, lineHeight: 18, color: colors.ink2, fontVariant: ['tabular-nums'] },
  cartao: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.cartao, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  frase: { ...fonte.body, fontSize: 14, lineHeight: 20, color: colors.ink, paddingBottom: 8 },
  sugestao: { minHeight: ALVO_TOQUE, justifyContent: 'center' },
  sugestaoTexto: { ...fonte.semibold, fontSize: 14, lineHeight: 20, color: colors.accentInk },
});
