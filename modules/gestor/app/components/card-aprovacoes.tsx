/**
 * Card "Pedidos para aprovar" no Início da Gestão (slot `inicio.cards` do Core, T-0073; docs/design/inicio.md §5.1).
 * É a chamada da tela: cartão em destaque tocável, sem botão de 52. O toque leva à lista de aprovações (aprovar segue em
 * 1 toque no pedido, RN-GES-08). Lê só o cache do aparelho; sem cópia da fila, não aparece.
 */
import { Cartao, colors, fonte, Icon, type as t } from '@macuxi/ui/mobile';
import { Text, View } from 'react-native';
import { nomesDaVisao } from '../lib/apresentacao';
import { resumoDoCardAprovacao } from '../lib/card-inicio';
import { irParaAprovacoes } from '../rotas';
import { useCartaoInicio } from '../state/use-cartao-inicio';

export function CardAprovacoes() {
  const { fila, visao } = useCartaoInicio();
  const r = resumoDoCardAprovacao(fila, nomesDaVisao(visao));
  if (!r) return null;
  if (r.vazio) {
    return (
      <Cartao testID="inicio.card-aprovacoes" tom="suave" rotuloAcessivel={r.rotuloAcessivel} preenchimento={14} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="check" size={18} color={colors.success} />
        <Text style={[t.body, { flex: 1 }]}>{r.titulo}</Text>
      </Cartao>
    );
  }
  return (
    <Cartao
      testID="inicio.card-aprovacoes"
      tom="destaque"
      onPress={irParaAprovacoes}
      rotuloAcessivel={r.rotuloAcessivel}
      preenchimento={14}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ ...fonte.bold, fontSize: 18, color: colors.surface }}>{r.total}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[t.bodyStrong, { fontSize: 16 }]}>{r.titulo}</Text>
        <Text style={{ ...fonte.body, fontSize: 12, color: colors.accentInk }} numberOfLines={1}>
          {r.linha}
        </Text>
      </View>
      <Icon name="chevron" size={16} color={colors.accentInk} />
    </Cartao>
  );
}
