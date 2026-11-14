/**
 * Os 3 cards do topo de Pedidos (T-0170, RN-VEN-43): Orçamentos em aberto, Pedidos enviados e Total, cada um com quantidade e valor.
 * Mesmo componente no Campo e no Gestão (D6). Orçamentos e Enviados abrem a lista filtrada (alvo >= 48 dp); Total não navega.
 */
import { colors, fonts, Icon, Pressionavel, type as t } from '@macuxi/ui/mobile';
import { Text, View } from 'react-native';
import type { QuantidadeEValor, ResumoDePedidos } from '../../domain/resumo-pedidos';
import { textoDoCard } from '../lib/cards-pedidos';

export type CardDePedidos = 'orcamentos' | 'enviados';

function Card({ testID, titulo, q, onPress }: { testID: string; titulo: string; q: QuantidadeEValor | null; onPress?: () => void }) {
  const corpo = (
    <>
      <View style={{ flex: 1 }}>
        <Text style={t.small}>{titulo}</Text>
        <Text style={[t.bodyStrong, { fontFamily: fonts.displayBold, fontVariant: ['tabular-nums'], color: colors.ink }]}>{textoDoCard(q)}</Text>
      </View>
      {onPress ? <Icon name="chevron" size={18} color={colors.ink3} strokeWidth={2.4} /> : null}
    </>
  );
  const estilo = { minHeight: 56, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 12 };
  return onPress ? (
    <Pressionavel testID={testID} accessibilityRole="button" accessibilityLabel={`${titulo}: ${textoDoCard(q)}. Toque para ver a lista.`} escala={false} onPress={onPress} style={estilo}>
      {corpo}
    </Pressionavel>
  ) : (
    <View testID={testID} accessibilityLabel={`${titulo}: ${textoDoCard(q)}`} style={estilo}>
      {corpo}
    </View>
  );
}

/** `resumo` nulo = sem resposta do servidor: os valores ficam "—". */
export function CardsDePedidos({ resumo, onAbrir }: { resumo: ResumoDePedidos | null; onAbrir: (card: CardDePedidos) => void }) {
  return (
    <View testID="orders-cards" style={{ gap: 8 }}>
      <Card testID="orders-card-orcamentos" titulo="Orçamentos em aberto" q={resumo?.orcamentos ?? null} onPress={() => onAbrir('orcamentos')} />
      <Card testID="orders-card-enviados" titulo="Pedidos enviados" q={resumo?.enviados ?? null} onPress={() => onAbrir('enviados')} />
      <Card testID="orders-card-total" titulo="Total" q={resumo?.total ?? null} />
    </View>
  );
}
