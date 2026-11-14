/**
 * Aba Aprovações do Macuxi Gestão (RF-GES-04): a fila da equipe com prazo em dias úteis (RN-GES-03), motivo, desconto
 * efetivo; o crédito e o histórico do cliente ficam no detalhe do pedido (RD-0209). Decidir mora no Vendedor (ADR 0011): o toque abre o detalhe do pedido
 * dele, onde ficam Aprovar (1 toque) e Rejeitar (com motivo, RN-GES-08) — a alçada é revalidada lá (RN-VEN-10).
 * Offline: a fila vem do cache; a decisão precisa de internet (aviso do Vendedor).
 */
import { formatBRL } from '@macuxi/comum';
import { Banner, Cartao, ChipEstado, colors, EstadoVazio, Loading, Screen, type as t } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ItemFilaAprovacao } from '../../contracts';
import { SeloFaixa } from '../components/selo-faixa';
import { linhaDeMotivos, nomesDaVisao, rotuloDoPrazo, TOM_PARA_CHIP } from '../lib/apresentacao';
import { contagem, pct } from '../lib/formato';
import { irParaPedidoDoVendedor } from '../rotas';
import { useGestor } from '../state/use-gestor';

export default function AprovacoesScreen() {
  const g = useGestor();
  if (!g.carregado) return <Loading />;
  const nomes = nomesDaVisao(g.visao);
  const fila = g.fila;
  return (
    <Screen
      testID="gestor-aprovacoes"
      cabecalho={{ titulo: 'Aprovações', direita: <SeloFaixa g={g} /> }}
      refreshing={g.auto.puxando}
      onRefresh={g.auto.puxar}>
      {g.erro ? <Banner tone="danger">{g.erro}</Banner> : null}
      {fila ? (
        <Text style={t.sub} testID="gestor-fila-resumo">
          {fila.resumo.para_mim} para você · {contagem(fila.resumo.vencidos, 'vencido', 'vencidos')} · {fila.resumo.vencendo} vencendo
        </Text>
      ) : null}
      <Cartao preenchimento={0} style={{ overflow: 'hidden' }}>
        {!fila || fila.itens.length === 0 ? (
          fila ? (
            <EstadoVazio icone="check" titulo="Nada aguardando aprovação" texto="Quando um vendedor da sua equipe pedir, o pedido aparece aqui." />
          ) : (
            <EstadoVazio icone="check" titulo="Sem dados no aparelho ainda" texto="Puxe para baixo para sincronizar." />
          )
        ) : null}
        {fila?.itens.map((i, n) => <ItemFila key={i.pedido_id} i={i} nome={nomes.get(i.vendedor_id) ?? 'Vendedor'} ultimo={n === fila.itens.length - 1} />)}
      </Cartao>
    </Screen>
  );
}

function ItemFila({ i, nome, ultimo }: { i: ItemFilaAprovacao; nome: string; ultimo: boolean }) {
  const prazo = rotuloDoPrazo(i);
  return (
    <Pressable
      testID={`gestor-aprovacao-${i.pedido_id}`}
      accessibilityRole="button"
      accessibilityLabel={`Pedido de ${nome}, ${formatBRL(i.total_cents)}, ${prazo.label}`}
      onPress={() => irParaPedidoDoVendedor(i.pedido_id)}
      style={({ pressed }) => [styles.item, !ultimo && styles.divisor, pressed && { backgroundColor: colors.ground }]}>
      <View style={styles.linha}>
        <Text style={[t.bodyStrong, { flex: 1 }]} numberOfLines={1}>
          {nome}
        </Text>
        <Text style={t.bodyStrong}>{formatBRL(i.total_cents)}</Text>
      </View>
      <Text style={t.small} numberOfLines={2}>
        {linhaDeMotivos(i.motivos, i.desconto_efetivo_pct, pct)}
      </Text>
      <View style={styles.linha}>
        <ChipEstado texto={prazo.label} tom={TOM_PARA_CHIP[prazo.tom]} pequeno />
        {i.pode_decidir ? <Text style={[t.smallStrong, { color: colors.accentInk }]}>Decidir</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { gap: 4, minHeight: 56, paddingVertical: 11, paddingHorizontal: 14 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
