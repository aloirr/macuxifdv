/**
 * Metas e RV (Metas.dc.html) a partir de GET /goals/me (cálculo no servidor com @fv/domain).
 */
import { formatBRL0, formatPct } from '@macuxi/comum';
import { Card, colors, dateTimeLabel, fonts, Icon, IconTile, monthName, ProgressBar, radius, Screen, type as t } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { KpiResult } from '../../contracts';
import { PainelMetas } from '../components/painel-metas';
import { abrirClientes } from '../lib/navegacao';
import { useCore } from '../lib/usar-core';

export function TelaMetas() {
  const core = useCore();
  const { tz } = core;
  const g = core.estado.metas;

  if (!g) {
    return (
      <Screen>
        <Text style={t.h1}>Metas</Text>
        <PainelMetas />
        <Card style={{ padding: 14 }}>
          <Text style={t.sub}>Sem metas para este perfil no mês.</Text>
        </Card>
      </Screen>
    );
  }

  const kpis = g.kpis.filter((k) => !k.is_trigger);
  const triggers = g.kpis.filter((k) => k.is_trigger);
  const gapText =
    g.gap_to_full_cents > 0 ? `Faltam ${formatBRL0(g.gap_to_full_cents)} em faturamento para 100% da meta` : `Meta de faturamento batida · ${Math.round(g.revenue_achievement_pct)}%`;

  return (
    <Screen refreshing={core.sincronizando} onRefresh={core.sincronizar} testID="goals">
      <View style={styles.header}>
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={t.h1}>Metas · {monthName(g.period)}</Text>
          <Text style={t.sub}>
            {g.frozen ? 'Mês fechado · valores congelados' : `Parcial atualizada ${dateTimeLabel(g.computed_at, new Date(), tz)}`}
          </Text>
        </View>
        <View style={styles.rank}>
          <Text style={styles.rankText}>
            {g.ranking_position}º de {g.ranking_total}
          </Text>
        </View>
      </View>

      <PainelMetas />

      <View style={styles.dark}>
        <Text style={styles.darkLabel}>RV projetada no fechamento</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <Text style={styles.darkValue} testID="rv-value">
            {formatBRL0(g.trigger_blocked ? 0 : g.incentive_cents)}
          </Text>
          <Text style={styles.darkLabel}>teto {formatBRL0(g.incentive_max_cents)}</Text>
        </View>
        {g.trigger_blocked ? (
          <Text style={[styles.darkNote, { color: '#F7A59C' }]}>RV zerada pelo gatilho · bruta seria {formatBRL0(g.gross_incentive_cents)}</Text>
        ) : (
          <Text style={styles.darkNote}>{gapText}</Text>
        )}
      </View>

      <Card>
        {kpis.map((k, i) => (
          <KpiRow key={k.kpi_code} k={k} last={i === kpis.length - 1 && triggers.length === 0} />
        ))}
        {triggers.map((k, i) => (
          <View key={k.kpi_code} style={[styles.trigger, i < triggers.length - 1 && styles.divider]}>
            <IconTile icon={k.trigger_ok ? 'check' : 'alert'} tone={k.trigger_ok ? 'success' : 'danger'} />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={styles.kpiName}>
                {k.name} <Text style={styles.weight}>· gatilho</Text>
              </Text>
              <Text style={[t.small, !k.trigger_ok && { color: colors.danger }]}>{k.detail || (k.trigger_ok ? 'RV liberada' : 'RV zerada')}</Text>
            </View>
          </View>
        ))}
      </Card>

      <Pressable
        testID="goals-idle-link"
        accessibilityRole="button"
        onPress={() => abrirClientes('not_positivated')}
        style={({ pressed }) => [styles.idle, pressed && { opacity: 0.8 }]}>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={t.bodyStrong}>
            {g.customers_without_purchase} {g.customers_without_purchase === 1 ? 'cliente ainda sem compra' : 'clientes ainda sem compra'} no mês
          </Text>
          <Text style={t.small}>
            {g.customers_without_purchase_in_route_week} {g.customers_without_purchase_in_route_week === 1 ? 'deles está' : 'deles estão'} na sua rota desta semana
          </Text>
        </View>
        <Icon name="chevron" size={18} color={colors.ink} />
      </Pressable>

      <Text style={[t.small, { textAlign: 'center' }]}>
        {g.business_days.remaining} dias úteis restantes de {g.business_days.total} · projeção linear por dia útil
      </Text>
    </Screen>
  );
}

function KpiRow({ k, last }: { k: KpiResult; last: boolean }) {
  const pct = Math.round(k.achievement_pct);
  return (
    <View style={[styles.kpi, !last && styles.divider]} testID={`kpi-${k.kpi_code}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <Text style={[styles.kpiName, { flex: 1 }]}>
          {k.name} <Text style={styles.weight}>· peso {formatPct(k.weight_pct, 0)}</Text>
        </Text>
        <Text style={styles.kpiPct}>{pct}%</Text>
      </View>
      <ProgressBar pct={k.achievement_pct} color={k.payout_pct > 0 ? colors.accent : colors.lineStrong} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={[t.small, { flex: 1 }]}>{k.detail}</Text>
        <Text style={[t.small, { color: colors.ink, fontFamily: fonts.semibold }]}>{formatBRL0(k.incentive_cents)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
  rank: { backgroundColor: colors.neutralBg, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 5 },
  rankText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.neutralInk },
  dark: { backgroundColor: colors.ink, borderRadius: radius.xxl, padding: 18, gap: 6 },
  darkLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.darkMuted },
  darkValue: { fontFamily: fonts.display, fontSize: 34, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  darkNote: { fontFamily: fonts.body, fontSize: 13, color: colors.accentLight },
  kpi: { gap: 8, padding: 14 },
  kpiName: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  weight: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2 },
  kpiPct: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  trigger: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14 },
  idle: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: colors.accentTint, borderRadius: radius.lg },
});
