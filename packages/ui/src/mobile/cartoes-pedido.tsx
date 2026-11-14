/**
 * Cartão da aba Detalhes do Novo pedido (T-0089, fatia U1; referência
 * docs/produto/referencias/R-20261106-0703-alexandre-novo-pedido-itens-v2.png; spec docs/design/novo-pedido-itens.md):
 * `CartaoLeveMais`: "Leve mais e pague menos" com a próxima faixa de cada item (RN-VEN-23; textos de `textosLeveMais`) e um
 *   toque na linha para ajustar a quantidade.
 * Nenhum texto fixo e nenhum cálculo: os valores chegam formatados pelo módulo (dinheiro de centavos).
 */
import { StyleSheet, Text, View } from 'react-native';

import { Cartao } from './base';
import { ALVO_TOQUE } from './componentes';
import { Icon } from './icon';
import { Pressionavel } from './movimento-rn';
import { colors, fonts } from './theme';

export interface ItemLeveMais {
  id: string;
  /** "Água mineral 1,5 L · leve 10 FD". */
  titulo: string;
  /** "R$ 19,90/FD (hoje R$ 20,31) · faltam 7 FD". */
  apoio: string;
  /** Leitura completa da linha (`textosLeveMais().leitura`). */
  leitura?: string;
  /** O que o toque faz, para o leitor de tela ("Ajustar para 10 FD"). */
  rotuloAjustar: string;
  onAjustar: () => void;
  desligado?: boolean;
  testID?: string;
}

export function CartaoLeveMais({ titulo, itens, testID = 'leve-mais' }: { titulo: string; itens: ReadonlyArray<ItemLeveMais>; testID?: string }) {
  // sem próxima faixa em nenhum item, o cartão não aparece
  if (itens.length === 0) return null;
  return (
    <Cartao testID={testID} gap={2}>
      <Text style={s.rotulo} accessibilityRole="header">
        {titulo}
      </Text>
      {itens.map((i, n) => (
        <Pressionavel
          key={i.id}
          testID={i.testID ?? `${testID}-${i.id}`}
          accessibilityRole="button"
          accessibilityLabel={i.leitura ?? `${i.titulo}. ${i.apoio}`}
          accessibilityHint={i.rotuloAjustar}
          accessibilityState={{ disabled: Boolean(i.desligado) }}
          disabled={i.desligado}
          escala={false}
          onPress={i.onAjustar}
          style={[s.linha, n > 0 && s.linhaDivisor]}>
          <View style={s.linhaTextos}>
            <Text style={s.linhaTitulo} numberOfLines={2}>
              {i.titulo}
            </Text>
            <Text style={s.linhaApoio}>{i.apoio}</Text>
          </View>
          <View style={[s.subir, i.desligado && s.desligado]}>
            <Icon name="subir" size={18} color={colors.accent} strokeWidth={2.2} />
          </View>
        </Pressionavel>
      ))}
    </Cartao>
  );
}

const s = StyleSheet.create({
  desligado: { opacity: 0.45 },
  rotulo: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },
  linha: { minHeight: ALVO_TOQUE + 8, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  linhaDivisor: { borderTopWidth: 1, borderTopColor: colors.line },
  linhaTextos: { flex: 1, minWidth: 0, gap: 2 },
  linhaTitulo: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  linhaApoio: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink2 },
  subir: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
});
