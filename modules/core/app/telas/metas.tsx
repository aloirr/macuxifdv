/**
 * Metas e RV (Metas.dc.html) - cabeçalho de GET /goals/me; a RV do vendedor vem do cartão `CartaoMinhaRv` (GET /v1/core/rv, T-0082).
 */
import { ChipEstado, colors, dateTimeLabel, Icon, monthName, radius, Screen, type as t } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { dataDoFechamento, dataLocal, situacaoDoPeriodo } from '../../domain';
import { CartaoMinhaRv } from '../components/cartao-minha-rv';
import { PainelMetas } from '../components/painel-metas';
import { abrirClientes } from '../lib/navegacao';
import { useCore } from '../lib/usar-core';

export function TelaMetas() {
  const core = useCore();
  const { tz } = core;
  const g = core.estado.metas;

  if (!g) {
    return (
      <Screen refreshing={core.sincronizando} onRefresh={core.sincronizar} cabecalho={{ titulo: 'Metas' }}>
        <PainelMetas />
        <CartaoMinhaRv />
      </Screen>
    );
  }

  // RN-CORE-21: o mês só fecha no 2º dia útil seguinte; até lá o realizado é parcial.
  const hojeLocal = dataLocal(new Date(), tz);
  const fechado = g.frozen || situacaoDoPeriodo(g.period, hojeLocal) === 'fechado';
  const fechamento = dataDoFechamento(g.period).split('-').reverse().join('/');

  return (
    <Screen
      refreshing={core.sincronizando}
      onRefresh={core.sincronizar}
      testID="goals"
      cabecalho={{
        titulo: `Metas · ${monthName(g.period)}`,
        subtitulo: fechado ? 'Mês fechado · valores congelados' : `Parcial até o fechamento (${fechamento}) · atualizada ${dateTimeLabel(g.computed_at, new Date(), tz)}`,
      }}>
      <View style={styles.header}>
        <ChipEstado texto={`${g.ranking_position}º de ${g.ranking_total}`} tom="neutro" />
      </View>

      <PainelMetas />

      <CartaoMinhaRv />

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

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'flex-end' },
  idle: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine, borderRadius: radius.cartao, minHeight: 48 },
});
