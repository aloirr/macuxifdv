/**
 * Os 3 cartões do topo de Pedidos (T-0170, RN-VEN-43): Orçamentos, Pedidos e Total, lado a lado, de largura igual
 * (rótulo curto em cima, quantidade em destaque, valor em R$ embaixo; mesmo desenho dos cartões de metas do Início).
 * Mesmo componente no Campo e no Gestão (D6). Orçamentos e Pedidos abrem a lista filtrada (alvo >= 48 dp); Total não navega.
 * `titulo` (longo) é o rótulo acessível e o do chip da tela; `rotulo` é o texto curto do cartão.
 */
import { colors, fonte, Icon, Pressionavel, type as t } from '@macuxi/ui/mobile';
import { Text, View } from 'react-native';
import type { QuantidadeEValor, ResumoDePedidos } from '../../domain/resumo-pedidos';
import { quantidadeDoCard, textoDoCard, valorDoCard } from '../lib/cards-pedidos';

export type CardDePedidos = 'orcamentos' | 'enviados';

function Card({ testID, titulo, rotulo, q, onPress }: { testID: string; titulo: string; rotulo: string; q: QuantidadeEValor | null; onPress?: () => void }) {
  const valor = valorDoCard(q);
  const corpo = (
    <>
      <Text style={t.small} numberOfLines={1}>{rotulo}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ ...fonte.display, fontSize: 22, lineHeight: 28, fontVariant: ['tabular-nums'], color: colors.ink }}>{quantidadeDoCard(q)}</Text>
        {onPress ? <Icon name="chevron" size={16} color={colors.ink3} strokeWidth={2.4} /> : null}
      </View>
      {valor ? <Text style={[t.small, { fontVariant: ['tabular-nums'] }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{valor}</Text> : null}
    </>
  );
  const estilo = { flex: 1, minWidth: 0, minHeight: 72, justifyContent: 'center' as const, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 12 };
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
    <View testID="orders-cards" style={{ flexDirection: 'row', gap: 8 }}>
      <Card testID="orders-card-orcamentos" titulo="Orçamentos em aberto" rotulo="Orçamentos" q={resumo?.orcamentos ?? null} onPress={() => onAbrir('orcamentos')} />
      <Card testID="orders-card-enviados" titulo="Pedidos" rotulo="Pedidos" q={resumo?.enviados ?? null} onPress={() => onAbrir('enviados')} />
      <Card testID="orders-card-total" titulo="Total" rotulo="Total" q={resumo?.total ?? null} />
    </View>
  );
}
