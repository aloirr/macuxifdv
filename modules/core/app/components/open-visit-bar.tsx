/**
 * Faixa escura "EM ATENDIMENTO" no topo do Início, da Rota e da ficha do cliente:
 * cliente do check-in aberto, horário, tempo decorrido, "Fazer checkout" e "Ver cliente".
 */
import { colors, fonts, formatHHMM, radius } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { abrirCliente } from '../lib/navegacao';
import { useCore } from '../lib/usar-core';
import { checkoutDuration, elapsedLabel, ordersInVisit } from '../lib/visit';
import { useVisitSheets } from './visit-sheets';

export function OpenVisitBar({ from }: { from: string }) {
  const core = useCore();
  const sheets = useVisitSheets();
  const open = core.atendimentoAberto;
  if (!open) return null;
  const now = new Date();
  const since = formatHHMM(open.checkin_at, core.tz);
  const orders = ordersInVisit(open, core.pedidos);
  const name = open.customer_name || core.estado.clientes.find((c) => c.id === open.customer_id)?.trade_name || 'Cliente';
  let hint: string;
  if (orders.length > 0) {
    const first = orders[0]!;
    const what = orders.length > 1 ? `${orders.length} pedidos feitos` : `${first.number ? `Pedido ${first.number}` : 'Pedido na fila'} feito`;
    hint = `${what} nesta visita · ${checkoutDuration(open.checkin_at, now)}`;
  } else {
    hint = `Check-in às ${since} · ${elapsedLabel(open.checkin_at, now)}`;
  }
  return (
    <View style={styles.bar} accessibilityLabel="Atendimento em aberto" testID="open-visit-bar">
      <View style={styles.top}>
        <View style={styles.dot} />
        <Text style={styles.overline}>EM ATENDIMENTO</Text>
        <Text style={styles.since}>desde {since}</Text>
      </View>
      <View style={{ gap: 2 }}>
        <Text style={styles.name} numberOfLines={2} testID="open-visit-name">
          {name}
        </Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <View style={styles.actions}>
        <Pressable testID="open-visit-checkout" accessibilityRole="button" onPress={sheets.askCheckout} style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && { opacity: 0.8 }]}>
          <Text style={[styles.btnText, { color: colors.ink, fontFamily: fonts.bold }]}>Fazer checkout</Text>
        </Pressable>
        <Pressable
          testID="open-visit-view"
          accessibilityRole="button"
          onPress={() => abrirCliente(open.customer_id, from)}
          style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.8 }]}>
          <Text style={[styles.btnText, { color: '#FFFFFF' }]}>Ver cliente</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.ink, borderRadius: radius.xl, padding: 14, gap: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accentLight, borderWidth: 0, shadowColor: colors.accentLight, shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  overline: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.9, color: colors.accentLight },
  since: { marginLeft: 'auto', fontFamily: fonts.body, fontSize: 12, color: colors.darkMuted },
  name: { fontFamily: fonts.displayBold, fontSize: 17, color: '#FFFFFF' },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.darkMuted },
  actions: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: colors.accentLight },
  btnGhost: { borderWidth: 1, borderColor: colors.ink2 },
  btnText: { fontFamily: fonts.semibold, fontSize: 14 },
});
