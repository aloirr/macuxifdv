/**
 * Ficha do cliente (Cliente.dc.html): ligar, WhatsApp, navegar, indicadores, títulos vencidos e
 * check-in/checkout. Lê só do aparelho (offline-first, linhas do sync: sem carga REST da Fase M desde a T-0018).
 * Check-in único: com atendimento aberto em outro cliente o check-in fica bloqueado; o pedido continua liberado.
 *
 * Pontos de extensão que o Core oferece aqui (contracts/extensoes.ts):
 *  - `cliente.abas`  → seções extras (ex.: sugestão de mix e últimos pedidos, do Vendedor; loja, do Promotor);
 *  - `cliente.acoes` → botões do rodapé (ex.: "Novo pedido", do Vendedor, já escondido do promotor — RN-PRO-01).
 * A tela só lê os itens; quem registra decide o conteúdo. Sem o módulo ativo, o item some (RN-CORE-03).
 */
import { formatBRL0 } from '@macuxi/comum';
import { useExtensoes } from '@macuxi/platform-sdk/react';
import { BackLink, Badge, Banner, Button, Strong, useSincronizacao, colors, daysAgoLabel, fonts, formatHHMM, Icon, MONTHS_SHORT, radius, SectionHeader, type as t, type IconName } from '@macuxi/ui/mobile';
import { useLocalSearchParams, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { AbaCliente, AcaoCliente, AvisoCliente, ContextoCliente } from '../../contracts';
import { acoesDoRodapeCliente, filtrarExtensoesDePedido, isVisitOpen, resumoSemCompras } from '../../domain';
import { AcoesContato, BlocoFotosPdv, CabecalhoCliente, SecoesCliente360, ultimaCompraDaFicha } from '../components/cliente360';
import { montarFichaLocal, useClientesLocais } from '../lib/usar-clientes-locais';
import { CheckinSheet, type CheckinPhase } from '../components/checkin-sheet';
import { OpenVisitBar } from '../components/open-visit-bar';
import { useVisitSheets } from '../components/visit-sheets';
import { enviarFotoPdv } from '../lib/enviar-foto-pdv';
import { abrirFotoPdvRegistrado, capturaFotoPdvRegistrada, pedidoDaFachada } from '../lib/foto-fachada';
import { tentarCheckin } from '../lib/acoes-visita';
import { avisoDeEtapaPendente, visitaComEtapaPendente } from '../lib/etapa-pendente';
import type { PosicaoGps } from '../lib/visita-payload';
import { mapsUrl, telUrl, whatsappUrl } from '../lib/route';
import { useCore } from '../lib/usar-core';
import { latestVisitFor } from '../lib/visit';

export function TelaCliente() {
  const params = useLocalSearchParams<{ id?: string; from?: string; checkin?: string }>();
  const id = String(params.id ?? '');
  const core = useCore();
  const sheets = useVisitSheets();
  const abasTodas = useExtensoes<AbaCliente<ComponentType<{ contexto: ContextoCliente }>>>('cliente.abas');
  const acoesTodas = useExtensoes<AcaoCliente>('cliente.acoes');
  const avisosExt = useExtensoes<AvisoCliente<ComponentType<{ contexto: ContextoCliente }>>>('cliente.avisos');
  const { estado, rota, tz, atendimentoAberto: openVisit, motor, armazem } = core;
  const { dados: locais, hoje } = useClientesLocais();
  // RN-PRO-01 / RN-CORE-01: promotor com `promotor_ve_pedidos` desligado não vê pedidos (offline, pelo parâmetro sincronizado):
  // o Core tira do ponto de montagem as abas e ações de extensão que mostram pedido. Os demais perfis não mudam.
  const abas = filtrarExtensoesDePedido(abasTodas, locais.verPedidos);
  const acoes = filtrarExtensoesDePedido(acoesTodas, locais.verPedidos);
  // Cliente 360 e resumo do check-in montados só com as linhas do aparelho (offline)
  const ficha = montarFichaLocal(locais, id, hoje);
  // T-0147: "Foto do PDV" abre pelo visualizador do shell; sem ele ou sem fachada enviada, o botão fica desligado
  const abrirFoto = abrirFotoPdvRegistrado();
  const pedidoFoto = ficha ? pedidoDaFachada(ficha.cliente.nome_fantasia ?? ficha.cliente.razao_social, ficha.fotos_pdv?.fachada_foto, tz) : null;
  const verFotoPdv = abrirFoto && pedidoFoto ? () => abrirFoto(pedidoFoto) : undefined;
  // T-0147: "Adicionar" no tipo que falta: o shell abre a folha (câmera ou galeria); o envio é offline (fila de itens + de arquivos)
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null);
  const adicionarFotoPdv = capturaFotoPdvRegistrada() && ficha && motor
    ? (tipoId: string) => {
        const tipo = locais.fotoTipos.find((x) => x.id === tipoId);
        if (!tipo) return;
        setAvisoFoto(null);
        void enviarFotoPdv({ motor }, { clienteId: id, nomeCliente: ficha.cliente.nome_fantasia ?? ficha.cliente.razao_social, tipo }).then((r) => {
          if (r.kind === 'erro') setAvisoFoto(r.mensagem);
        });
      }
    : undefined;
  const customer = estado.clientes.find((c) => c.id === id) ?? null;
  const stop = rota?.stops.find((s) => s.customer.id === id) ?? null;
  const localVisit = latestVisitFor(estado.visitas, id);
  const visit = localVisit ?? stop?.visit ?? null;
  const openHere = Boolean(openVisit && openVisit.customer_id === id);
  const locked = Boolean(openVisit && openVisit.customer_id !== id);
  const visited = Boolean(visit && !openHere && !isVisitOpen(visit, new Date(), tz));
  const [phase, setPhase] = useState<CheckinPhase | null>(null);
  const autoStarted = useRef<string | null>(null);

  // T-0039 (checkout-pendencia.md §1.2): etapa obrigatória da visita ainda não chegou ao Macuxi; vem do pull, lida do aparelho
  const sync = useSincronizacao();
  const pendente = visitaComEtapaPendente(estado.visitas, id);
  const avisoPendente = pendente
    ? avisoDeEtapaPendente({ ...pendente, agora: new Date(), fuso: tz, naFila: sync?.naFila ?? 0 })
    : null;

  const contexto: ContextoCliente = { clienteId: id, nomeCliente: customer?.trade_name ?? '', visitaId: openHere && openVisit ? openVisit.id : null, paradaId: stop?.id ?? null };

  const posicaoDoToque = useRef<PosicaoGps | null | undefined>(undefined);
  const startCheckin = useCallback(async (justificativa?: string) => {
    if (!customer || !motor || !armazem) return;
    setPhase({ kind: 'locating' });
    // RN-CORE-13: o GPS é lido uma vez; ao pedir a justificativa reaproveita a posição do 1º toque
    const res = await tentarCheckin({ motor, armazem, tz, vendedorId: core.vendedorId }, customer, stop?.id ?? null, justificativa === undefined ? {} : { justificativa, posicao: posicaoDoToque.current });
    if (res.kind === 'erro') {
      setPhase(null);
      sheets.toast(res.mensagem, 'warning');
    } else if (res.kind === 'justificar') {
      posicaoDoToque.current = res.posicao;
      setPhase({ kind: 'justificar', distancia_m: res.distancia_m, raio_m: res.raio_m });
    } else if (res.kind === 'blocked') {
      setPhase(null);
      sheets.showBlocked(customer.trade_name);
    } else if (res.kind === 'existing') {
      setPhase(null);
    } else {
      posicaoDoToque.current = undefined;
      setPhase({ kind: 'done', visitId: res.visit.id, at: formatHHMM(res.visit.checkin_at, tz), gps: res.gps, foraDoRaio: res.foraDoRaio, sugereCoordenada: res.sugereCoordenada });
    }
  }, [customer, stop, motor, armazem, tz, core.vendedorId, sheets]);

  // check-in recusado pelo servidor (visita some do aparelho): a folha fecha (o aviso vem do VisitSheetsProvider)
  useEffect(() => {
    if (phase?.kind === 'done' && !estado.visitas.some((v) => v.id === phase.visitId)) setPhase(null);
  }, [phase, estado.visitas]);

  // "Fazer check-in" no Início/Rota abre a ficha já registrando o check-in
  useEffect(() => {
    if (params.checkin === '1' && customer && autoStarted.current !== id) {
      autoStarted.current = id;
      router.setParams({ checkin: undefined });
      if (locked) sheets.showBlocked(customer.trade_name);
      else if (!openHere && !visited) void startCheckin();
    }
  }, [params.checkin, customer, id, locked, openHere, visited, startCheckin, sheets]);

  if (!customer && ficha) {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: 24, gap: 14 }}>
          <BackLink label={params.from ?? 'Clientes'} fallback="/m/clientes" />
          <OpenVisitBar from={ficha.cliente.nome_fantasia ?? ficha.cliente.razao_social} clienteAtual={id} />
          <CabecalhoCliente ficha={ficha} />
          <AcoesContato ficha={ficha} onVerFotoPdv={verFotoPdv} />
          <BlocoFotosPdv ficha={ficha} onAdicionar={adicionarFotoPdv} />
          {avisoFoto ? <Banner tone="danger" icon="alert" testID="cliente-foto-erro" anunciar>{avisoFoto}</Banner> : null}
          {avisosExt.map((a) => {
            const Aviso = a.payload.componente;
            return <Aviso key={`${a.modulo}-${a.id}`} contexto={{ clienteId: id, nomeCliente: ficha.cliente.nome_fantasia ?? ficha.cliente.razao_social, visitaId: null, paradaId: null }} />;
          })}
          <SecoesCliente360 ficha={ficha} />
          {abas.map((a) => {
            const Aba = a.payload.componente;
            return (
              <View key={`${a.modulo}-${a.id}`} testID={a.payload.testID} style={{ gap: 8 }}>
                <SectionHeader title={a.payload.rotulo} />
                <Aba contexto={{ clienteId: id, nomeCliente: ficha.cliente.nome_fantasia ?? ficha.cliente.razao_social, visitaId: null, paradaId: null }} />
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  if (!customer) {
    return (
      <View style={[styles.root, { paddingTop: 16, paddingHorizontal: 20 }]}>
        <BackLink label={params.from ?? 'Clientes'} fallback="/m/clientes" />
        <Text style={t.sub}>Cliente não está no aparelho. Sincronize para atualizar.</Text>
      </View>
    );
  }

  const monthShort = MONTHS_SHORT[Number((estado.me?.today ?? new Date().toISOString()).slice(5, 7)) - 1] ?? '';
  const since = customer.customer_since.slice(0, 4);
  const visitLabel = openHere ? 'Checkout' : visited ? 'Visitado' : 'Check-in';
  // ação de destaque (ex.: "Novo pedido") também aparece na folha do check-in
  const acaoDestaque = acoes.find((a) => a.payload.destaque) ?? acoes[0] ?? null;
  const rotuloDe = (a: AcaoCliente, ctx: ContextoCliente) => (typeof a.rotulo === 'function' ? a.rotulo(ctx) : a.rotulo);

  const diasUltimaCompra = ficha ? ficha.resumo_compras.dias_sem_compra : customer.days_since_purchase;
  // RN-CORE-40: sem compra na janela de 12 meses a ficha mostra uma linha só ("Sem compras em 12 meses"), sem Compra média nem Última compra
  const indicadoresDoCliente = ficha && resumoSemCompras(ficha.resumo_compras) ? null : (
    <>
      {locais.verPedidos ? <Stat label="Compra média/mês" value={formatBRL0(customer.avg_monthly_cents)} /> : null}
      {locais.verPedidos ? (
        <Stat
          label="Última compra"
          value={ficha ? ultimaCompraDaFicha(diasUltimaCompra) : daysAgoLabel(diasUltimaCompra)}
          color={diasUltimaCompra !== null && diasUltimaCompra >= 45 ? colors.warning : undefined}
        />
      ) : null}
    </>
  );

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: 16, gap: 14 }}>
        <BackLink label={params.from ?? 'Clientes'} fallback="/m/clientes" />
        <OpenVisitBar from={customer.trade_name} clienteAtual={id} />
        <View style={{ gap: 6 }}>
          <Text style={t.h1Small} testID="customer-name">
            {customer.trade_name}
          </Text>
          <Text style={t.sub}>
            {customer.address}, {customer.district} · cliente desde {since}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge label={`Curva ${customer.abc_curve}`} tone={customer.abc_curve === 'A' ? 'accent' : 'neutral'} />
            <Badge label={customer.segment} tone="neutral" />
            {customer.positivated_this_month ? <Badge label={`Positivado em ${monthShort}`} tone="success" /> : <Badge label={`Não positivado em ${monthShort}`} tone="warning" />}
          </View>
          {openHere && openVisit ? <Badge label={`Em atendimento · desde ${formatHHMM(openVisit.checkin_at, tz)}`} tone="accent" style={{ marginTop: 2 }} /> : null}
        </View>

        {avisoPendente ? (
          <Banner tone="warning" icon="clock" testID="cliente-etapa-pendente">
            <Strong>{avisoPendente.linha1}</Strong>
            {'\n'}
            {avisoPendente.linha2}
          </Banner>
        ) : null}

        {avisosExt.map((a) => {
          const Aviso = a.payload.componente;
          return <Aviso key={`${a.modulo}-${a.id}`} contexto={contexto} />;
        })}

        {ficha ? (
          <>
            <AcoesContato ficha={ficha} onVerFotoPdv={verFotoPdv} />
            <BlocoFotosPdv ficha={ficha} onAdicionar={adicionarFotoPdv} />
          {avisoFoto ? <Banner tone="danger" icon="alert" testID="cliente-foto-erro" anunciar>{avisoFoto}</Banner> : null}
          </>
        ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Action icon="phone" label="Ligar" onPress={() => void Linking.openURL(telUrl(customer.phone))} />
          <Action icon="chat" label="WhatsApp" onPress={() => void Linking.openURL(whatsappUrl(customer.phone))} />
          <Action icon="navigate" label="Navegar" onPress={() => void Linking.openURL(mapsUrl(customer.lat, customer.lng, customer.address))} />
        </View>
        )}

        {/* T-0076: uma grade só, na ordem da referência (Compra média · Última compra · Ticket · Frequência · 12 meses); limite e vencidos ficam só no Financeiro (T-0146) */}
        {ficha ? (
          <SecoesCliente360 ficha={ficha} indicadoresIniciais={indicadoresDoCliente} />
        ) : (
          <View style={styles.grid}>{indicadoresDoCliente}</View>
        )}

        {abas.map((a) => {
          const Aba = a.payload.componente;
          return (
            <View key={`${a.modulo}-${a.id}`} testID={a.payload.testID} style={{ gap: 8 }}>
              <SectionHeader title={a.payload.rotulo} />
              <Aba contexto={contexto} />
            </View>
          );
        })}

      </ScrollView>

      <View style={styles.footer}>
        <Button
          testID="customer-checkin"
          label={visitLabel}
          icon={locked ? 'lock' : undefined}
          variant={openHere ? 'dark' : locked ? 'locked' : visited ? 'muted' : 'outlineDark'}
          accessibilityLabel={locked ? `Check-in bloqueado: você está em atendimento em ${openVisit?.customer_name ?? 'outro cliente'}` : undefined}
          height={52}
          style={{ flex: 1 }}
          textStyle={{ fontSize: 15 }}
          onPress={() => {
            if (openHere) sheets.askCheckout();
            else if (locked) sheets.toast(`Em atendimento em ${openVisit?.customer_name ?? 'outro cliente'}`, 'warning');
            else if (!visited) void startCheckin();
          }}
        />
        {acoesDoRodapeCliente(acoes).map((a) => (
          <Button
            key={`${a.modulo}-${a.id}`}
            testID={a.payload.testID}
            label={rotuloDe(a.payload, contexto)}
            icon={a.payload.icone as IconName | undefined}
            variant={a.payload.destaque ? 'accent' : 'outlineDark'}
            height={52}
            style={{ flex: a.payload.destaque ? 2 : 1 }}
            onPress={() => a.payload.abrir(contexto)}
          />
        ))}
      </View>

      <CheckinSheet
        phase={phase}
        customerName={customer.trade_name}
        onClose={() => setPhase(null)}
        onJustificar={(texto) => void startCheckin(texto)}
        acao={
          acaoDestaque
            ? {
                rotulo: rotuloDe(acaoDestaque.payload, { ...contexto, visitaId: phase?.kind === 'done' ? phase.visitId : contexto.visitaId }),
                testID: 'checkin-new-order',
                onPress: () => {
                  const visitaId = phase?.kind === 'done' ? phase.visitId : contexto.visitaId;
                  setPhase(null);
                  acaoDestaque.payload.abrir({ ...contexto, visitaId });
                },
              }
            : undefined
        }
      />
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}>
      <Icon name={icon} size={16} color={colors.ink} strokeWidth={1.9} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={t.small}>{label}</Text>
      <Text style={[t.number, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  action: { flex: 1, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexBasis: '48%', flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 12, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingRight: 10, paddingLeft: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, backgroundColor: colors.ground },
});
