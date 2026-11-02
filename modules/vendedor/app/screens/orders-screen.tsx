/**
 * Pedidos do mês (Pedidos.dc.html), incluindo os que estão na fila do aparelho.
 * Atualiza ao abrir e ao puxar a tela; na Gestão também a cada 60 s (pedidos novos para decidir).
 */
import { formatBRL, formatBRL0 } from '@macuxi/comum';
import { quantidadeNaoCancelada, totalDoPeriodo } from '../../domain/totais';
import { SePode, useVisaoShell } from '@macuxi/platform-sdk/react';
import { Badge, Banner, Button, capitalize, Card, Chip, colors, Empty, fonts, localIsoDate, monthName, relativeWhen, Screen, Strong, type as t } from '@macuxi/ui/mobile';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { pedidosDaLista, rotuloDaAba, subtituloDaLista } from '../lib/lista-pedidos';
import { filterCounts, matchesFilter, ORDER_FILTERS, orderNote, statusBadge, type OrderFilter } from '../lib/order-status';
import type { PedidoDaLista } from '../lib/pedidos';
import { irParaNovoPedido, irParaPedido } from '../rotas';
import { useVendedor } from '../state/use-vendedor';

/** Só a Gestão repete a busca com a tela aberta (custo de bateria e dados no 4G do Campo). */
const POLL_GESTAO_MS = 60_000;

export default function OrdersScreen() {
  const { pedidos: orders, tz, offline, atualizarPedidos: refreshOrders, reenviarFila: flushOutbox, sincronizando, erroSync, motor, aguardandoMinhaDecisao } = useVendedor();
  // Gestão (supervisor/gerente): lista da equipe com a aba "Para aprovar" primeiro (T-0029 §8); o Campo é do vendedor
  const gestao = useVisaoShell().app === 'gestao';
  const paraDecidir = useMemo(() => new Set(aguardandoMinhaDecisao.map((p) => p.id)), [aguardandoMinhaDecisao]);
  const sync = { running: sincronizando, error: erroSync };
  const syncAll = () => motor?.sincronizar();
  const [filtro, setFiltro] = useState<OrderFilter | 'decide' | 'approved' | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refreshOrders();
      if (!gestao) return undefined;
      const h = setInterval(() => void refreshOrders(), POLL_GESTAO_MS);
      return () => clearInterval(h);
    }, [refreshOrders, gestao]),
  );

  const month = localIsoDate(new Date(), tz).slice(0, 7);
  const monthOrders = useMemo(() => pedidosDaLista(orders, { gestao, mes: month, tz }), [orders, tz, month, gestao]);
  const counts = filterCounts(monthOrders);
  const filter = filtro ?? (gestao && paraDecidir.size > 0 ? 'decide' : 'all');
  const aprovados = monthOrders.filter((o) => o.status === 'approved').length;
  const visible =
    filter === 'decide'
      ? monthOrders.filter((o) => paraDecidir.has(o.id))
      : filter === 'approved'
        ? monthOrders.filter((o) => o.status === 'approved')
        : monthOrders.filter((o) => matchesFilter(o.status, filter));
  const total = totalDoPeriodo(monthOrders);
  const activeCount = quantidadeNaoCancelada(monthOrders);
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
          <Text style={t.h1}>{gestao ? 'Pedidos da equipe' : 'Pedidos'}</Text>
          <Text style={t.sub}>
            {subtituloDaLista({ gestao, mesNome: capitalize(monthName(month)), quantidade: activeCount, totalTexto: formatBRL0(total) })}
          </Text>
        </View>
        <SePode acao="pedido.criar">
          {gestao ? null : <Button testID="pedido-novo" label="Novo" icon="plus" variant="accent" onPress={() => irParaNovoPedido()} style={{ paddingHorizontal: 16 }} />}
        </SePode>
      </View>

      {queued > 0 ? (
        <Banner testID="orders-queue-banner">
          <Strong>{queued === 1 ? '1 pedido na fila do aparelho.' : `${queued} pedidos na fila do aparelho.`}</Strong> {offline ? 'Envio automático quando o sinal voltar.' : 'Enviando automaticamente…'}
        </Banner>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}>
        {gestao ? <Chip testID="chip-decide" label={`Para aprovar ${paraDecidir.size}`} active={filter === 'decide'} onPress={() => setFiltro('decide')} /> : null}
        <Chip testID="chip-approved" label={`Aprovados ${aprovados}`} active={filter === 'approved'} onPress={() => setFiltro('approved')} />
        {ORDER_FILTERS.filter((f) => rotuloDaAba(f.id, gestao)).map((f) => (
          <Chip key={f.id} testID={`chip-${f.id}`} label={`${f.label} ${counts[f.id]}`} active={filter === f.id} onPress={() => setFiltro(f.id)} />
        ))}
      </ScrollView>

      <Card style={{ overflow: 'hidden' }}>
        {visible.length === 0 ? <Empty text={filter === 'decide' ? 'Nada para aprovar agora.' : filter === 'all' ? (gestao ? 'Nenhum pedido da equipe ainda.' : 'Nenhum pedido neste mês. Toque em Novo para começar.') : 'Nenhum pedido com este status.'} /> : null}
        {visible.map((o, i) => (
          <OrderRow key={o.id} o={o} last={i === visible.length - 1} tz={tz} mostrarVendedor={gestao} />
        ))}
      </Card>
      {!offline ? <Text style={[t.small, { textAlign: 'center' }]}>{gestao ? 'Atualiza a cada 1 min · puxe para atualizar' : 'Puxe para atualizar'}</Text> : null}
      {offline ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/profile' as never)}>
          <Text style={[t.small, { textAlign: 'center', color: colors.warning }]}>Modo sem sinal ligado · desligue no Perfil</Text>
        </Pressable>
      ) : null}
      {!sync.running && sync.error ? (
        <Pressable accessibilityRole="button" onPress={() => void syncAll()}>
          <Text style={[t.small, { textAlign: 'center', color: colors.danger }]}>{sync.error}</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function OrderRow({ o, last, tz, mostrarVendedor }: { o: PedidoDaLista; last: boolean; tz: string; mostrarVendedor: boolean }) {
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
          <Text style={{ fontFamily: fonts.mono }}>{o.number || 'no aparelho'}</Text> · {mostrarVendedor && o.seller_name ? `${o.seller_name} · ` : ''}{relativeWhen(o.received_at, new Date(), tz)} · {o.items_count} {o.items_count === 1 ? 'item' : 'itens'}
        </Text>
        <Badge label={b.label} fg={b.fg} bg={b.bg} />
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
  cancelledTotal: { color: colors.ink3, textDecorationLine: 'line-through' },
});
