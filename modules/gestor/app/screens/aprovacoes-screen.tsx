/**
 * Aba Aprovações do Macuxi Gestão (RF-GES-04): a fila da equipe com prazo em dias úteis (RN-GES-03), motivo, desconto
 * efetivo, crédito e histórico na mesma lista. Decidir mora no Vendedor (ADR 0011): o toque abre o detalhe do pedido
 * dele, onde ficam Aprovar (1 toque) e Rejeitar (com motivo, RN-GES-08) — a alçada é revalidada lá (RN-VEN-10).
 * Offline: a fila vem do cache; a decisão precisa de internet (aviso do Vendedor).
 */
import { formatBRL, formatBRL0 } from '@macuxi/comum';
import { Badge, Banner, Card, colors, Empty, Loading, Screen, SyncStamp, type as t } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ItemFilaAprovacao } from '../../contracts';
import { MOTIVO_ROTULO, nomesDaVisao, rotuloDoPrazo } from '../lib/apresentacao';
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
      refreshing={g.auto.puxando}
      onRefresh={g.auto.puxar}>
      <View style={{ gap: 2 }}>
        <Text style={t.h1}>Aprovações</Text>
        <SyncStamp at={g.sincronizado_em} offline={g.offline} tz={g.tz} />
      </View>
      {g.erro ? <Banner tone="danger">{g.erro}</Banner> : null}
      {fila ? (
        <Text style={t.sub} testID="gestor-fila-resumo">
          {fila.resumo.para_mim} para você · {contagem(fila.resumo.vencidos, 'vencido', 'vencidos')} · {fila.resumo.vencendo} vencendo
        </Text>
      ) : null}
      {g.offline && fila && fila.itens.length > 0 ? <Banner>Sem conexão: aprovar ou rejeitar precisa de internet.</Banner> : null}
      <Card style={{ overflow: 'hidden' }}>
        {!fila || fila.itens.length === 0 ? <Empty text={fila ? 'Nada aguardando aprovação na sua equipe.' : 'Sem dados no aparelho ainda. Puxe para baixo para sincronizar.'} /> : null}
        {fila?.itens.map((i, n) => <ItemFila key={i.pedido_id} i={i} nome={nomes.get(i.vendedor_id) ?? 'Vendedor'} ultimo={n === fila.itens.length - 1} />)}
      </Card>
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
        {i.motivos.map((m) => MOTIVO_ROTULO[m]).join(' · ')} · desconto {pct(i.desconto_efetivo_pct)}
        {i.credito ? ` · crédito disponível ${formatBRL0(i.credito.disponivel_cents)}` : ''}
        {i.historico ? ` · ${contagem(i.historico.pedidos_90d, 'pedido', 'pedidos')} em 90 dias` : ''}
      </Text>
      <View style={styles.linha}>
        <Badge label={prazo.label} tone={prazo.tom} />
        {i.pode_decidir ? <Text style={[t.smallStrong, { color: colors.accent }]}>{i.acima_do_nivel ? 'Decidir (nível do supervisor)' : 'Decidir'}</Text> : <Text style={t.small}>Acompanhar</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { gap: 4, minHeight: 56, paddingVertical: 11, paddingHorizontal: 14 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
