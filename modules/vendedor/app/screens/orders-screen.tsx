/**
 * Pedidos do mês (Pedidos.dc.html), incluindo os que estão na fila do aparelho.
 * Com sinal, atualiza sozinho a cada ~10 s (aprovação/recusa na web aparece aqui).
 */
import { formatBRL, formatBRL0 } from '@macuxi/comum';
import { SePode } from '@macuxi/platform-sdk/react';
import { Banner, Button, capitalize, Card, Chip, colors, Empty, fonts, localIsoDate, monthName, relativeWhen, Screen, Strong, type as t } from '@macuxi/ui/mobile';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { filterCounts, matchesFilter, ORDER_FILTERS, orderNote, statusBadge, type OrderFilter } from '../lib/order-status';
import type { PedidoDaLista } from '../lib/pedidos';
import { irParaNovoPedido, irParaPedido } from '../rotas';
import { useVendedor } from '../state/use-vendedor';

const POLL_MS = 10_000;

export default function OrdersScreen() {
  const { pedidos: orders, tz, offline, atualizarPedidos: refreshOrders, reenviarFila: flushOutbox, sincronizando, erroSync, motor } = useVendedor();
  const sync = { running: sincronizando, error: erroSync };
  const syncAll = () => motor?.sincronizar();
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refreshOrders();
      const h = setInterval(() => void refreshOrders(), POLL_MS);
      return () => clearInterval(h);
    }, [refreshOrders]),
  );

  const month = localIsoDate(new Date(), tz).slice(0, 7);
  const monthOrders = useMemo(() => orders.filter((o) => localIsoDate(o.received_at, tz).slice(0, 7) === month || o.local), [orders, tz, month]);
  const counts = filterCounts(monthOrders);
  const visible = monthOrders.filter((o) => matchesFilter(o.status, filter));
  const total = monthOrders.filter((o) => o.status !== 'cancelled' && o.status !== 'rejected').reduce((s, o) => s + o.total_cents, 0);
  const activeCount = monthOrders.filter((o) => o.status !== 'cancelled').length;
  const queued = counts.queued;

  return (
    <Screen
      testID="orders"
      refreshing={refreshing || sync.running}
      onRefresh={() => {
        setRefreshing(true);
        void Promise.all([flushOutbox(), refreshOrders()]).finally(() => setRefreshing(false));
      }}>
      <View style={styles.header}>
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={t.h1}>Pedidos</Text>
          <Text style={t.sub}>
            {capitalize(monthName(month))} · {activeCount} pedidos · {formatBRL0(total)}
          </Text>
        </View>
        <SePode acao="pedido.criar">
          <Button testID="pedido-novo" label="Novo" icon="plus" variant="accent" onPress={() => irParaNovoPedido()} style={{ paddingHorizontal: 16 }} />
        </SePode>
      </View>

      {queued > 0 ? (
        <Banner testID="orders-queue-banner">
          <Strong>{queued === 1 ? '1 pedido na fila do aparelho.' : `${queued} pedidos na fila do aparelho.`}</Strong> {offline ? 'Envio automático quando o sinal voltar.' : 'Enviando automaticamente…'}
        </Banner>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}>
        {ORDER_FILTERS.map((f) => (
          <Chip key={f.id} testID={`chip-${f.id}`} label={`${f.label} ${counts[f.id]}`} active={filter === f.id} onPress={() => setFilter(f.id)} />
        ))}
      </ScrollView>

      <Card style={{ overflow: 'hidden' }}>
        {visible.length === 0 ? <Empty text="Nenhum pedido com este status." /> : null}
        {visible.map((o, i) => (
          <OrderRow key={o.id} o={o} last={i === visible.length - 1} tz={tz} />
        ))}
      </Card>
      {!offline ? <Text style={[t.small, { textAlign: 'center' }]}>Atualiza sozinho a cada 10 s · puxe para atualizar</Text> : null}
      {offline ? (
        <Pressable onPress={() => router.push('/profile' as never)}>
          <Text style={[t.small, { textAlign: 'center', color: colors.warning }]}>Modo sem sinal ligado · desligue no Perfil</Text>
        </Pressable>
      ) : null}
      {!sync.running && sync.error ? (
        <Pressable onPress={() => void syncAll()}>
          <Text style={[t.small, { textAlign: 'center', color: colors.danger }]}>{sync.error}</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function OrderRow({ o, last, tz }: { o: PedidoDaLista; last: boolean; tz: string }) {
  const b = statusBadge(o.status);
  const note = orderNote(o);
  return (
    <Pressable
      testID={`order-${o.number || o.id}`}
      accessibilityRole="button"
      onPress={() => irParaPedido(o.id)}
      style={({ pressed }) => [styles.row, !last && styles.divider, pressed && { backgroundColor: colors.ground }]}>
      <View style={styles.line}>
        <Text style={[t.bodyStrong, { flex: 1 }]} numberOfLines={1}>
          {o.customer_name || 'Pedido no aparelho'}
        </Text>
        <Text style={[t.bodyStrong, { fontVariant: ['tabular-nums'] }, o.status === 'cancelled' && styles.cancelledTotal]}>{formatBRL(o.total_cents)}</Text>
      </View>
      <View style={styles.line}>
        <Text style={[t.small, { flex: 1 }]} numberOfLines={1}>
          <Text style={{ fontFamily: fonts.mono }}>{o.number || 'no aparelho'}</Text> · {relativeWhen(o.received_at, new Date(), tz)} · {o.items_count} {o.items_count === 1 ? 'item' : 'itens'}
        </Text>
        <View style={[styles.badge, { backgroundColor: b.bg }]}>
          <Text style={[styles.badgeText, { color: b.fg }]}>{b.label}</Text>
        </View>
      </View>
      {note ? <Text style={[t.small, { color: b.fg }]}>{note}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
  row: { gap: 3, paddingVertical: 11, paddingHorizontal: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontFamily: fonts.bold, fontSize: 11 },
  cancelledTotal: { color: colors.ink3, textDecorationLine: 'line-through' },
});
