/**
 * Rota do dia: "mapa" em SVG com as paradas posicionadas pela lat/lng normalizada,
 * atalho para navegar até a próxima e lista com status (feita, em atendimento, próxima, pendente).
 * Check-in único: com um atendimento aberto, o check-in das outras paradas fica bloqueado (cadeado).
 */
import { formatBRL0 } from '@macuxi/comum';
import { Botao, Cartao, ChipEstado, colors, EstadoVazio, fonts, formatHHMM, Icon, radius, Screen, type as t } from '@macuxi/ui/mobile';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Polyline, Text as SvgText } from 'react-native-svg';

import type { RouteStop } from '../../contracts';
import { OpenVisitBar } from '../components/open-visit-bar';
import { useVisitSheets } from '../components/visit-sheets';
import { ROTULO_ACESSIVEL_CHIP_ETAPA_PENDENTE, ROTULO_CHIP_ETAPA_PENDENTE } from '../lib/etapa-pendente';
import { abrirCliente } from '../lib/navegacao';
import { mapsUrl, projectPoints } from '../lib/route';
import { useCore } from '../lib/usar-core';

/** a faixa de baixo do mapa fica livre para o botão "Ir para a parada" */
const MAP_H = 220;

export function TelaRota() {
  const core = useCore();
  const { rota: route, tz, atendimentoAberto: openVisit } = core;
  const sheets = useVisitSheets();
  const [mapW, setMapW] = useState(350);

  if (!route || route.stops.length === 0) {
    return (
      <Screen refreshing={core.sincronizando} onRefresh={core.sincronizar} cabecalho={{ titulo: 'Rota de hoje' }}>
        <EstadoVazio testID="rota-vazia" icone="map" titulo="Nenhuma rota para hoje" texto="O escritório define a rota do dia. Puxe a tela para atualizar quando tiver sinal" />
      </Screen>
    );
  }

  const stops = route.stops;
  const next = stops.find((s) => s.status === 'next') ?? null;
  const points = projectPoints(
    stops.map((s) => ({ lat: s.customer.lat, lng: s.customer.lng })),
    mapW,
    MAP_H - 58,
    24,
    { minDist: 30 },
  );
  const current = stops.find((s) => s.status === 'in_progress') ?? next;
  const nextIdx = current ? stops.indexOf(current) : stops.length - 1;
  const solid = points.slice(0, nextIdx + 1);
  const dashed = points.slice(nextIdx);
  const order = stops.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s));

  const openCustomer = (s: RouteStop) => abrirCliente(s.customer.id, 'Rota de hoje');
  const isOpenStop = (s: RouteStop) => s.status === 'in_progress' && (!openVisit || openVisit.customer_id === s.customer.id);
  const onAction = (s: RouteStop) => {
    if (s.status === 'in_progress') {
      if (openVisit && openVisit.customer_id === s.customer.id) sheets.askCheckout();
      else openCustomer(s);
    } else if (openVisit && openVisit.customer_id !== s.customer.id) sheets.showBlocked(s.customer.trade_name);
    else abrirCliente(s.customer.id, 'Rota de hoje', true);
  };

  return (
    <Screen
      refreshing={core.sincronizando}
      onRefresh={core.sincronizar}
      testID="route"
      cabecalho={{ titulo: 'Rota de hoje', subtitulo: `${stops.length} visitas · ${Math.round(route.total_km).toLocaleString('pt-BR')} km · ${route.region}` }}>
      <View style={styles.header}>
        <ChipEstado texto={route.done_count === 1 ? '1 feita' : `${route.done_count} feitas`} tom={route.done_count === 0 ? 'neutro' : 'sucesso'} />
      </View>

      <OpenVisitBar from="Rota de hoje" />

      <View style={styles.map} onLayout={(e) => {
          const w = Math.round(e.nativeEvent.layout.width) - 2;
          if (w > 50) setMapW(w);
        }}>
        <Svg width={mapW} height={MAP_H} viewBox="0 0 350 220" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
          <Path d="M-10 60 C80 40 140 90 220 70 S330 30 370 50" stroke={colors.surface} strokeWidth={10} fill="none" />
          <Path d="M40 -10 C60 70 30 140 70 230" stroke={colors.surface} strokeWidth={8} fill="none" />
          <Path d="M-10 170 C90 150 180 190 260 160 S340 140 370 150" stroke={colors.surface} strokeWidth={8} fill="none" />
          <Path d="M250 -10 C240 60 280 120 250 230" stroke={colors.surface} strokeWidth={6} fill="none" />
          <Path d="M150 -10 L170 230" stroke={colors.surface} strokeWidth={5} fill="none" />
        </Svg>
        <Svg width={mapW} height={MAP_H} style={StyleSheet.absoluteFill}>
          {solid.length > 1 ? <Polyline points={solid.map((p) => `${p.x},${p.y}`).join(' ')} stroke={colors.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
          {dashed.length > 1 ? <Polyline points={dashed.map((p) => `${p.x},${p.y}`).join(' ')} stroke={colors.accent} strokeWidth={3} strokeDasharray="6 6" strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
          {order.map(({ s, i }) => {
            const p = points[i]!;
            if (s.status === 'in_progress') {
              return (
                <G key={s.id}>
                  <Circle cx={p.x} cy={p.y} r={16} fill={colors.accent} stroke={colors.surface} strokeWidth={3} />
                  <SvgText x={p.x} y={p.y + 5} fontSize={14} fontFamily={fonts.display} fill={colors.surface} textAnchor="middle">
                    {String(s.sequence)}
                  </SvgText>
                </G>
              );
            }
            if (s.status === 'next') {
              return (
                <G key={s.id}>
                  <Circle cx={p.x} cy={p.y} r={16} fill={colors.ink} stroke={colors.surface} strokeWidth={3} />
                  <SvgText x={p.x} y={p.y + 5} fontSize={14} fontFamily={fonts.display} fill={colors.surface} textAnchor="middle">
                    {String(s.sequence)}
                  </SvgText>
                </G>
              );
            }
            const done = s.status === 'done';
            return (
              <G key={s.id}>
                <Circle cx={p.x} cy={p.y} r={done ? 12 : 11} fill={done ? colors.success : colors.surface} stroke={done ? colors.success : colors.ink} strokeWidth={done ? 0 : 2} />
                <SvgText x={p.x} y={p.y + 4} fontSize={12} fontFamily={fonts.bold} fill={done ? colors.surface : colors.ink} textAnchor="middle">
                  {String(s.sequence)}
                </SvgText>
              </G>
            );
          })}
        </Svg>
        {next ? (
          <Botao
            testID="go-next"
            nivel="secundario"
            icone="navigate"
            rotulo={`Ir para a parada ${next.sequence}`}
            onPress={() => void Linking.openURL(mapsUrl(next.customer.lat, next.customer.lng, next.customer.address))}
            style={styles.goBtn}
          />
        ) : null}
      </View>

      <Cartao preenchimento={0} style={{ overflow: 'hidden' }}>
        {stops.map((s, i) => (
          <StopRow
            key={s.id}
            stop={s}
            last={i === stops.length - 1}
            tz={tz}
            locked={Boolean(openVisit) && !isOpenStop(s) && s.status !== 'done'}
            onPress={() => openCustomer(s)}
            onAction={() => onAction(s)}
          />
        ))}
      </Cartao>
    </Screen>
  );
}

function rank(s: RouteStop) {
  return s.status === 'pending' ? 0 : s.status === 'done' ? 1 : s.status === 'next' ? 2 : 3;
}

function StopRow({ stop, last, tz, locked, onPress, onAction }: { stop: RouteStop; last: boolean; tz: string; locked: boolean; onPress: () => void; onAction: () => void }) {
  const c = stop.customer;
  const done = stop.status === 'done';
  const inProgress = stop.status === 'in_progress';
  const isNext = stop.status === 'next';
  let subtitle: string;
  if (done) {
    const v = stop.visit;
    const at = v ? formatHHMM(v.checkin_at, tz) : '';
    if (v?.outcome === 'order') subtitle = `Pedido ${stop.order_total_cents !== null ? formatBRL0(stop.order_total_cents) : ''}`.trim();
    else if (v?.outcome === 'no_order') subtitle = `Sem pedido: ${v.no_order_reason}`;
    else if (v?.closed_by === 'auto') subtitle = 'Fechada na virada do dia';
    else subtitle = `Check-in ${at}`;
  } else if (inProgress) {
    subtitle = `Check-in ${stop.visit ? formatHHMM(stop.visit.checkin_at, tz) : '--:--'}`;
  } else {
    subtitle = stop.window_start;
  }
  const actionLabel = inProgress ? 'Checkout' : 'Check-in';
  return (
    <View testID={`stop-${stop.sequence}`} style={[styles.row, !last && styles.divider, inProgress && { backgroundColor: colors.accentTint }]}>
      {done ? (
        <View style={[styles.num, { backgroundColor: colors.successBg }]}>
          <Icon name="check" size={14} color={colors.success} strokeWidth={2.4} />
        </View>
      ) : inProgress || isNext ? (
        <View style={[styles.num, { backgroundColor: inProgress ? colors.accent : colors.ink }]}>
          <Text style={[styles.numText, { color: colors.onAccent, fontFamily: fonts.display, fontSize: 13 }]}>{stop.sequence}</Text>
        </View>
      ) : (
        <View style={[styles.num, { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.ink }]}>
          <Text style={styles.numText}>{stop.sequence}</Text>
        </View>
      )}
      <Pressable testID={`stop-open-${stop.sequence}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [{ flex: 1, gap: 1, justifyContent: 'center', minHeight: 44 }, pressed && { opacity: 0.7 }]}>
        <Text style={[t.bodyStrong, done && { color: colors.ink2 }]} numberOfLines={1}>
          {c.trade_name}
        </Text>
        <Text style={[t.small, inProgress && { color: colors.accentInk }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </Pressable>
      {!done ? (
        <Botao
          testID={`stop-action-${stop.sequence}`}
          rotulo={actionLabel}
          rotuloAcessivel={inProgress ? `Fazer checkout em ${c.trade_name}` : locked ? `Check-in bloqueado em ${c.trade_name}` : `Fazer check-in em ${c.trade_name}`}
          nivel={locked && !inProgress ? 'neutro' : 'secundario'}
          icone={locked && !inProgress ? 'lock' : undefined}
          onPress={onAction}
          style={styles.action}
        />
      ) : (stop.visit?.etapas_pendentes ?? 0) > 0 ? (
        <ChipEstado
          testID={`stop-etapa-pendente-${stop.sequence}`}
          pequeno
          tom="aviso"
          icone="clock"
          texto={ROTULO_CHIP_ETAPA_PENDENTE}
          rotuloAcessivel={ROTULO_ACESSIVEL_CHIP_ETAPA_PENDENTE}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'flex-end' },
  map: { height: MAP_H, borderRadius: radius.secao, overflow: 'hidden', backgroundColor: colors.mapBg, borderWidth: 1, borderColor: colors.mapBorder },
  goBtn: { position: 'absolute', left: 12, bottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingLeft: 14, paddingRight: 12, minHeight: 56 },
  action: { paddingHorizontal: 12 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  numText: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink },
});
