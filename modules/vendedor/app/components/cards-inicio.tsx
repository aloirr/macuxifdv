/**
 * Cards "Orçamentos" e "A faturar" no Início do Campo (T-0076, slot `inicio.cards` do Core). Dois cartões lado a lado;
 * cada um abre Pedidos já filtrado. Só dados do aparelho; sem cópia ainda, nada aparece.
 */
import { Cartao, colors, fonts, type as t } from '@macuxi/ui/mobile';
import { Text, View } from 'react-native';
import { linhaAFaturar, linhaOrcamentos } from '../lib/resumo-inicio';
import { irParaPedidosFiltrados } from '../rotas';
import { useResumoInicio } from '../state/use-resumo-inicio';

function CardResumo({ testID, titulo, quantidade, linha, onPress }: { testID: string; titulo: string; quantidade: number; linha: string; onPress: () => void }) {
  return (
    <Cartao testID={testID} onPress={onPress} rotuloAcessivel={`${titulo}: ${quantidade}. ${linha}. Toque para ver a lista.`} preenchimento={14} style={{ flex: 1, minHeight: 112, gap: 4 }}>
      <Text style={[t.rotulo, { color: colors.ink3 }]}>{titulo.toUpperCase()}</Text>
      <Text style={{ fontFamily: fonts.display, fontSize: 28, color: colors.ink }}>{quantidade}</Text>
      <Text style={[t.small, { color: colors.ink2 }]}>{linha}</Text>
    </Cartao>
  );
}

export function CardsPedidosInicio() {
  const r = useResumoInicio();
  if (!r) return null;
  return (
    <View testID="inicio.cards-vendedor" style={{ flexDirection: 'row', gap: 12 }}>
      {r.orcamentos ? <CardResumo testID="inicio.card-orcamentos" titulo="Orçamentos" quantidade={r.orcamentos.quantidade} linha={linhaOrcamentos(r.orcamentos)} onPress={() => irParaPedidosFiltrados('orcamentos')} /> : null}
      <CardResumo testID="inicio.card-a-faturar" titulo="A faturar" quantidade={r.aFaturar.quantidade} linha={linhaAFaturar(r.aFaturar)} onPress={() => irParaPedidosFiltrados('a_faturar')} />
    </View>
  );
}
