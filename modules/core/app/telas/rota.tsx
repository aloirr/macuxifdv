/**
 * Rota do dia: "mapa" em SVG com as paradas posicionadas pela lat/lng normalizada,
 * atalho para navegar até a próxima e lista com status (feita, em atendimento, próxima, pendente).
 * Check-in único: com um atendimento aberto, o check-in das outras paradas fica bloqueado (cadeado).
 * Filtro padrão (R-20261115-072200; spec `docs/design/filtro-padrao-campo/spec.md` §2): cliente, cidade, bairro e data na folha
 * "Filtrar"; com outra data, a rota inteira daquele dia, só para ver (R-20261115-074500). Regras no domain (`filtro-padrao.ts`).
 */
import { formatBRL0 } from '@macuxi/comum';
import {
  Botao,
  BotaoFiltro,
  CampoAbrir,
  CampoBusca,
  CampoEscolha,
  Cartao,
  ChipEstado,
  colors,
  EstadoVazio,
  EtiquetaFiltro,
  FolhaPeriodo,
  fonte,
  formatHHMM,
  Icon,
  Loading,
  radius,
  Screen,
  type as t,
  type TextosFolhaPeriodo,
} from '@macuxi/ui/mobile';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Polyline, Text as SvgText } from 'react-native-svg';

import type { RouteStop } from '../../contracts';
import {
  ajustarAoDia,
  bairrosDaRota,
  cidadesDaRota,
  comCidade,
  comData,
  contarFiltrosRota,
  dataDaRota,
  dataLocal,
  etiquetasDaRota,
  FILTRO_ROTA_PADRAO,
  filtrarParadas,
  filtraParadas,
  filtroNoDia,
  paradasParaVer,
  semFiltroRota,
  subtituloDaRota,
  textoDaDataDaRota,
  textoDasFeitas,
  textoVerVisitas,
  tituloDaRota,
  type FiltroRota,
} from '../../domain';
import { FolhaFiltrar, GrupoFiltro } from '../components/folha-filtrar';
import { OpenVisitBar } from '../components/open-visit-bar';
import { useVisitSheets } from '../components/visit-sheets';
import { ROTULO_ACESSIVEL_CHIP_ETAPA_PENDENTE, ROTULO_CHIP_ETAPA_PENDENTE } from '../lib/etapa-pendente';
import { abrirCliente } from '../lib/navegacao';
import { mapsUrl, projectPoints } from '../lib/route';
import { useCore } from '../lib/usar-core';
import { useRotaDoDia } from '../lib/usar-rota-do-dia';

/** a faixa de baixo do mapa fica livre para o botão "Ir para a parada" */
const MAP_H = 220;

/** Textos da folha "Data" (a `FolhaPeriodo` do kit, aberta na aba Dia; padrão Hoje). */
const TEXTOS_DATA: TextosFolhaPeriodo = {
  titulo: 'Data',
  fechar: 'Fechar',
  escolher: 'Escolher dia',
  voltar: 'Atalhos',
  dia: 'Dia',
  mes: 'Mês',
  ano: 'Ano',
  mesAnterior: 'Mês anterior',
  proximoMes: 'Próximo mês',
  anoAnterior: 'Ano anterior',
  proximoAno: 'Próximo ano',
  limpar: 'Limpar',
};
const ATALHOS_DATA = [{ id: 'hoje', rotulo: 'Hoje', testID: 'rota-data-hoje' }];

export function TelaRota() {
  const core = useCore();
  const { tz, atendimentoAberto: openVisit } = core;
  const sheets = useVisitSheets();
  const [mapW, setMapW] = useState(350);
  // a data de hoje acompanha a virada do dia mesmo com a tela parada (filtro de amanhã vira a rota de hoje)
  const [hoje, setHoje] = useState(() => dataLocal(new Date(), tz));
  useEffect(() => {
    setHoje(dataLocal(new Date(), tz));
    // timer-permitido: relógio da tela (virada do dia), sem rede
    const h = setInterval(() => setHoje(dataLocal(new Date(), tz)), 60_000);
    return () => clearInterval(h);
  }, [tz]);
  // filtro padrão (R-20261115-072200): o aplicado e o rascunho da folha, que só vale no "Ver N visitas"
  const [filtroSalvo, setFiltro] = useState<FiltroRota>(FILTRO_ROTA_PADRAO);
  const [rascunhoSalvo, setRascunho] = useState<FiltroRota>(FILTRO_ROTA_PADRAO);
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [dataAberta, setDataAberta] = useState(false);
  // na virada do dia, a data escolhida que virou hoje volta ao padrão (check-in de novo)
  const filtro = filtroNoDia(filtroSalvo, hoje);
  const { rota: route, carregando } = useRotaDoDia(core, filtro.data);
  // RD-0508: a rota do rascunho só é lida de novo quando a folha está aberta com outra data; senão é a mesma `route`
  const rascunhoNoDia = filtroNoDia(rascunhoSalvo, hoje);
  const outraDataNoRascunho = folhaAberta && rascunhoNoDia.data !== filtro.data;
  const daOutraData = useRotaDoDia(core, outraDataNoRascunho ? rascunhoNoDia.data : null);
  const rotaDoRascunho = outraDataNoRascunho ? daOutraData.rota : route;
  const carregandoRascunho = outraDataNoRascunho ? daOutraData.carregando : carregando;
  const paradasDoRascunho = rotaDoRascunho?.stops ?? [];
  // trocar a data tira a cidade e o bairro que o novo dia não tem
  const rascunho = carregandoRascunho ? rascunhoNoDia : ajustarAoDia(rascunhoNoDia, paradasDoRascunho);
  // o ajuste ao novo dia fica guardado: voltar à data anterior não traz de volta a cidade ou o bairro que saíram
  useEffect(() => {
    if (rascunho.cidade !== rascunhoSalvo.cidade || rascunho.bairro !== rascunhoSalvo.bairro) setRascunho(rascunho);
  }, [rascunho, rascunhoSalvo]);
  const ehHoje = filtro.data === null;
  const titulo = tituloDaRota(filtro);
  const contagem = contarFiltrosRota(filtro);

  const abrirFolha = () => {
    setRascunho(filtro);
    setFolhaAberta(true);
  };
  const contagemDoRascunho = filtrarParadas(paradasDoRascunho, rascunho).length;

  const linhaDeCima = (paradas: readonly RouteStop[] | null) => (
    <>
      <View style={styles.header}>
        {paradas && paradas.length > 0 ? <ChipEstado texto={textoDasFeitas(paradas)} tom={paradas.some((p) => p.status === 'done') ? 'sucesso' : 'neutro'} /> : <View />}
        <BotaoFiltro testID="rota-filtro" contagem={contagem} rotulo="Filtrar" onPress={abrirFolha} />
      </View>
      {contagem > 0 ? (
        <View style={styles.etiquetas} testID="rota-etiquetas">
          {etiquetasDaRota(filtro).map((e) => (
            <EtiquetaFiltro key={e.campo} testID={`rota-etiqueta-${e.campo}`} texto={e.texto} rotuloRemover={`Remover filtro ${e.texto}`} onRemover={() => setFiltro(semFiltroRota(filtro, e.campo))} />
          ))}
        </View>
      ) : null}
    </>
  );

  const folhas = (
    <>
      <FolhaFiltrar
        testID="rota-folha"
        visivel={folhaAberta}
        onFechar={() => setFolhaAberta(false)}
        titulo="Filtrar"
        rotuloFechar="Fechar o filtro"
        limpar={{ rotulo: 'Limpar', onPress: () => setRascunho(FILTRO_ROTA_PADRAO), desligado: contarFiltrosRota(rascunho) === 0 }}
        ver={{
          rotulo: textoVerVisitas(contagemDoRascunho),
          ocupado: carregandoRascunho,
          onPress: () => {
            setFiltro(rascunho);
            setFolhaAberta(false);
          },
        }}>
        <GrupoFiltro rotulo="Cliente">
          <CampoBusca
            testID="rota-filtro-cliente"
            valor={rascunho.cliente}
            onChange={(cliente) => setRascunho((r) => ({ ...r, cliente }))}
            onLimpar={() => setRascunho((r) => ({ ...r, cliente: '' }))}
            rotuloLimpar="Limpar a busca"
            placeholder="Nome ou código do cliente"
          />
        </GrupoFiltro>
        <GrupoFiltro rotulo="Cidade">
          <CampoEscolha
            testID="rota-filtro-cidade"
            titulo="Cidade"
            opcoes={cidadesDaRota(paradasDoRascunho).map((c) => ({ id: c, rotulo: c }))}
            valor={rascunho.cidade}
            onEscolher={(o) => setRascunho(comCidade(rascunho, o.id, paradasDoRascunho))}
            placeholder="Todas"
            placeholderBusca="Buscar"
            rotuloFechar="Fechar"
            rotuloLimpar="Limpar a busca"
          />
        </GrupoFiltro>
        <GrupoFiltro rotulo="Bairro">
          <CampoEscolha
            testID="rota-filtro-bairro"
            titulo="Bairro"
            opcoes={bairrosDaRota(paradasDoRascunho, rascunho.cidade).map((b) => ({ id: b, rotulo: b }))}
            valor={rascunho.bairro}
            onEscolher={(o) => setRascunho((r) => ({ ...r, bairro: o.id }))}
            placeholder="Todos"
            placeholderBusca="Buscar"
            rotuloFechar="Fechar"
            rotuloLimpar="Limpar a busca"
          />
        </GrupoFiltro>
        <GrupoFiltro rotulo="Data">
          <CampoAbrir
            testID="rota-filtro-data"
            texto={rascunho.data ? textoDaDataDaRota(rascunho.data, true) : 'Hoje'}
            leitura={`Data, ${rascunho.data ? textoDaDataDaRota(rascunho.data, true) : 'Hoje'}`}
            onPress={() => setDataAberta(true)}
          />
        </GrupoFiltro>
      </FolhaFiltrar>
      <FolhaPeriodo
        testID="rota-data"
        visivel={dataAberta}
        onFechar={() => setDataAberta(false)}
        textos={TEXTOS_DATA}
        atalhos={ATALHOS_DATA}
        atalhoAtivo={rascunho.data === null ? 'hoje' : null}
        onAtalho={() => setRascunho((r) => ({ ...r, data: null }))}
        escolha={{ tipo: 'dia', valor: dataDaRota(rascunho, hoje) }}
        onEscolher={(e) => setRascunho((r) => (e.tipo === 'dia' ? comData(r, e.valor, hoje) : r))}
        onLimpar={() => setRascunho((r) => ({ ...r, data: null }))}
        limparDesligado={rascunho.data === null}
        hoje={hoje}
      />
    </>
  );

  if (!route || route.stops.length === 0) {
    return (
      <Screen refreshing={core.sincronizando} onRefresh={core.sincronizar} cabecalho={{ titulo }}>
        {linhaDeCima(null)}
        {/* RD-0506: um título só; a ação de puxar só vale para hoje (o dia vem no título da tela e na etiqueta) */}
        {carregando ? (
          <Loading embutido testID="rota-carregando" />
        ) : (
          <EstadoVazio testID="rota-vazia" icone="map" titulo="Nenhuma rota neste dia." texto={ehHoje ? 'Puxe a tela para atualizar quando tiver sinal.' : undefined} />
        )}
        {folhas}
      </Screen>
    );
  }

  // mapa e lista só com as paradas filtradas; a numeração continua a da rota
  // outro dia é só para ver: sem "próxima" parada
  const stops = paradasParaVer(filtrarParadas(route.stops, filtro), ehHoje);
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

  const openCustomer = (s: RouteStop) => abrirCliente(s.customer.id, titulo);
  const isOpenStop = (s: RouteStop) => s.status === 'in_progress' && (!openVisit || openVisit.customer_id === s.customer.id);
  const onAction = (s: RouteStop) => {
    if (s.status === 'in_progress') {
      if (openVisit && openVisit.customer_id === s.customer.id) sheets.askCheckout();
      else openCustomer(s);
    } else if (openVisit && openVisit.customer_id !== s.customer.id) sheets.showBlocked(s.customer.trade_name);
    else abrirCliente(s.customer.id, titulo, true);
  };

  return (
    <Screen
      refreshing={core.sincronizando}
      onRefresh={core.sincronizar}
      testID="route"
      cabecalho={{ titulo, subtitulo: subtituloDaRota({ filtradas: stops.length, total: route.stops.length, totalKm: route.total_km, regiao: route.region, comFiltro: filtraParadas(filtro) }) }}>
      {linhaDeCima(stops)}

      <OpenVisitBar from={titulo} />

      {stops.length === 0 ? (
        <EstadoVazio testID="rota-filtro-vazio" icone="search" titulo="Nenhuma visita com esses filtros." />
      ) : (
        <>
          <View
            style={styles.map}
            onLayout={(e) => {
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
                      <SvgText x={p.x} y={p.y + 5} fontSize={14} fontWeight="700" fill={colors.surface} textAnchor="middle">
                        {String(s.sequence)}
                      </SvgText>
                    </G>
                  );
                }
                if (s.status === 'next') {
                  return (
                    <G key={s.id}>
                      <Circle cx={p.x} cy={p.y} r={16} fill={colors.ink} stroke={colors.surface} strokeWidth={3} />
                      <SvgText x={p.x} y={p.y + 5} fontSize={14} fontWeight="700" fill={colors.surface} textAnchor="middle">
                        {String(s.sequence)}
                      </SvgText>
                    </G>
                  );
                }
                const done = s.status === 'done';
                return (
                  <G key={s.id}>
                    <Circle cx={p.x} cy={p.y} r={done ? 12 : 11} fill={done ? colors.success : colors.surface} stroke={done ? colors.success : colors.ink} strokeWidth={done ? 0 : 2} />
                    <SvgText x={p.x} y={p.y + 4} fontSize={12} fontWeight="700" fill={done ? colors.surface : colors.ink} textAnchor="middle">
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
                // a rota de outro dia é só para ver: check-in e checkout ficam na rota de hoje
                comAcao={ehHoje}
                locked={Boolean(openVisit) && !isOpenStop(s) && s.status !== 'done'}
                onPress={() => openCustomer(s)}
                onAction={() => onAction(s)}
              />
            ))}
          </Cartao>
        </>
      )}
      {folhas}
    </Screen>
  );
}

function rank(s: RouteStop) {
  return s.status === 'pending' ? 0 : s.status === 'done' ? 1 : s.status === 'next' ? 2 : 3;
}

function StopRow({ stop, last, tz, comAcao, locked, onPress, onAction }: { stop: RouteStop; last: boolean; tz: string; comAcao: boolean; locked: boolean; onPress: () => void; onAction: () => void }) {
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
          <Text style={[styles.numText, { color: colors.onAccent, ...fonte.bold, fontSize: 14 }]}>{stop.sequence}</Text>
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
      {!done && comAcao ? (
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  etiquetas: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8 },
  map: { height: MAP_H, borderRadius: radius.secao, overflow: 'hidden', backgroundColor: colors.mapBg, borderWidth: 1, borderColor: colors.mapBorder },
  goBtn: { position: 'absolute', left: 12, bottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingLeft: 14, paddingRight: 12, minHeight: 56 },
  action: { paddingHorizontal: 12 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  numText: { ...fonte.bold, fontSize: 12, color: colors.ink },
});
