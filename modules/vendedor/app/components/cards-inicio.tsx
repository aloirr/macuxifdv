/**
 * Cartão "Orçamentos" e "Pedidos a faturar" no Início do Campo (T-0076, slot `inicio.cards` do Core; RD-0010/RD-0011 da T-0124).
 * Um cartão só com duas linhas tocáveis (>= 48 dp), cada uma abre Pedidos já filtrado. Só dados do aparelho; sem cópia ainda,
 * nada aparece.
 */
import { Cartao, colors, fonts, Icon, Pressionavel, type as t } from '@macuxi/ui/mobile';
import { Text } from 'react-native';
import { ROTULO_A_FATURAR } from '../../domain/resumo-inicio';
import { textoCartaoAFaturar, textoCartaoOrcamentos } from '../lib/resumo-inicio';
import { irParaPedidosFiltrados } from '../rotas';
import { RetomadaDoPedido } from './retomada-do-pedido';
import { useResumoInicio } from '../state/use-resumo-inicio';

function LinhaResumo({ testID, titulo, texto, divisor, onPress }: { testID: string; titulo: string; texto: string; divisor: boolean; onPress: () => void }) {
  return (
    <Pressionavel
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${titulo}: ${texto}. Toque para ver a lista.`}
      escala={false}
      onPress={onPress}
      style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: divisor ? 1 : 0, borderTopColor: colors.line }}>
      <Text style={[t.bodyStrong, { color: colors.ink }]}>{titulo}</Text>
      <Text style={[t.small, { flex: 1, textAlign: 'right', color: colors.ink2, fontFamily: fonts.medium }]}>{texto}</Text>
      <Icon name="chevron" size={18} color={colors.ink3} strokeWidth={2.4} />
    </Pressionavel>
  );
}

export function CardsPedidosInicio() {
  const r = useResumoInicio();
  // RN-VEN-38: a retomada do pedido não terminado sobe aqui, na primeira tela depois de reabrir o app
  return (
    <>
      <RetomadaDoPedido />
      {r ? (
      <Cartao testID="inicio.cards-vendedor" preenchimento={14} gap={0}>
        {r.orcamentos ? <LinhaResumo testID="inicio.card-orcamentos" titulo="Orçamentos" texto={textoCartaoOrcamentos(r.orcamentos)} divisor={false} onPress={() => irParaPedidosFiltrados('orcamentos')} /> : null}
        <LinhaResumo testID="inicio.card-a-faturar" titulo={ROTULO_A_FATURAR} texto={textoCartaoAFaturar(r.aFaturar)} divisor={Boolean(r.orcamentos)} onPress={() => irParaPedidosFiltrados('a_faturar')} />
      </Cartao>
      ) : null}
    </>
  );
}
