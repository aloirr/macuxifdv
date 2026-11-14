/**
 * Ficha do cliente (Cliente.dc.html) em seis abas: Resumo · Cadastro (Dados cadastrais) · Financeiro · Compras · Performance · Anexos.
 * Faixa Azul noite no topo (nome, endereço e "cliente desde"), abas paradas logo abaixo e o conteúdo rolando; o rodapé
 * ("Checkout" só com atendimento aberto neste cliente, "Pesquisa" e ações `cliente.acoes`) fica visível em todas as abas. Alertas (visita aberta, etapa pendente, `cliente.avisos`,
 * erro de foto) ficam no topo do conteúdo em todas as abas. Lê só do aparelho (offline-first, linhas do sync).
 * Check-in único (RN-CORE-13): o botão de check-in saiu do rodapé (RN-CORE-51); o check-in vem do Início/Rota (`?checkin=1`) e,
 * com atendimento aberto em outro cliente, fica bloqueado; o pedido continua liberado.
 *
 * Pontos de extensão que o Core oferece aqui (contracts/extensoes.ts):
 *  - `cliente.abas`  → "ultimos-pedidos" (Vendedor) entra em Compras, dentro de "Histórico de Pedidos"; "mix" entra na Performance;
 *    "pesquisas" abre numa folha pelo botão "Pesquisa" do rodapé (RN-CORE-51); as demais (loja...) ficam no Resumo, cada uma com seu cabeçalho;
 *  - `cliente.acoes` → botões do rodapé (ex.: "Novo pedido", do Vendedor, já escondido do promotor — RN-PRO-01).
 * A tela só lê os itens; quem registra decide o conteúdo. Sem o módulo ativo, o item some (RN-CORE-03).
 * Curvas ABC (RN-CORE-49), visitas, prazo médio e últimos itens (RN-CORE-50) ficam só na Performance.
 */
import { useExtensoes } from '@macuxi/platform-sdk/react';
import { Abas, BackLink, Badge, Banner, Button, CabecalhoTela, Folha, Strong, useSincronizacao, colors, daysAgoLabel, fonts, formatHHMM, Icon, radius, SectionHeader, type as t, type IconName } from '@macuxi/ui/mobile';
import { useLocalSearchParams, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { AbaCliente, AcaoCliente, AvisoCliente, ContextoCliente } from '../../contracts';
import { acoesDoRodapeCliente, botoesDoRodapeCliente, curvasAbcDoCliente, filtrarExtensoesDePedido, isVisitOpen, itensDoPedidoVisiveis, prazoMedioDias, quemVisitouPorUltimo, resumoDeVisitas, ultimosItensComprados, dataLocal } from '../../domain';
import { AbaPerformance } from '../components/aba-performance';
import { AbaCompras, AbaDadosCadastrais, AbaFinanceiro, AcoesContato, BlocoFotosPdv, BotaoFotoPdv, enderecoDoCliente, IndicadoresResumo, nomeDoCliente, TagsCliente } from '../components/cliente360';
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
  const [aba, setAba] = useState<'resumo' | 'cadastro' | 'financeiro' | 'compras' | 'performance' | 'anexos'>('resumo');
  const [pesquisaAberta, setPesquisaAberta] = useState(false);

  // T-0039 (checkout-pendencia.md §1.2): etapa obrigatória da visita ainda não chegou ao Macuxi; vem do pull, lida do aparelho
  const sync = useSincronizacao();
  const pendente = visitaComEtapaPendente(estado.visitas, id);
  const avisoPendente = pendente
    ? avisoDeEtapaPendente({ ...pendente, agora: new Date(), fuso: tz, naFila: sync?.naFila ?? 0 })
    : null;

  const contexto: ContextoCliente = { clienteId: id, nomeCliente: ficha ? nomeDoCliente(ficha.cliente) : (customer?.trade_name ?? ''), visitaId: openHere && openVisit ? openVisit.id : null, paradaId: stop?.id ?? null };

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

  if (!customer && !ficha) {
    return (
      <View style={[styles.root, { paddingTop: 16, paddingHorizontal: 20 }]}>
        <BackLink label={params.from ?? 'Clientes'} fallback="/m/clientes" />
        <Text style={t.sub}>Cliente não está no aparelho. Sincronize para atualizar.</Text>
      </View>
    );
  }

  // ação de destaque (ex.: "Novo pedido") também aparece na folha do check-in
  const acaoDestaque = acoes.find((a) => a.payload.destaque) ?? acoes[0] ?? null;
  const rotuloDe = (a: AcaoCliente, ctx: ContextoCliente) => (typeof a.rotulo === 'function' ? a.rotulo(ctx) : a.rotulo);

  const nome = ficha ? nomeDoCliente(ficha.cliente) : (customer?.trade_name ?? '');
  const endereco = ficha ? enderecoDoCliente(ficha.cliente) || 'Endereço não informado' : `${customer?.address ?? ''}, ${customer?.district ?? ''}`;
  const desde = customer?.customer_since ? ` · cliente desde ${customer.customer_since.slice(0, 4)}` : '';
  // RN-CORE-49: curvas do mês atual contra a média dos 3 meses anteriores; só com pedidos visíveis (RN-PRO-01)
  const curvas = ficha && ficha.pedidos_visiveis ? curvasAbcDoCliente(ficha.historico, hoje, locais.faixasCurva) : [];
  // A extensão `ultimos-pedidos` (Vendedor) entra em Compras; `mix` na Performance; `pesquisas` na folha do botão "Pesquisa"; as demais ficam no Resumo
  const abaPedidos = abas.find((a) => a.id === 'ultimos-pedidos') ?? null;
  const abaMix = abas.find((a) => a.id === 'mix') ?? null;
  const abaPesquisa = abas.find((a) => a.id === 'pesquisas') ?? null;
  const abasResumo = abas.filter((a) => !['ultimos-pedidos', 'mix', 'pesquisas'].includes(a.id));
  const PedidosComp = abaPedidos?.payload.componente;
  const MixComp = abaMix?.payload.componente;
  const PesquisaComp = abaPesquisa?.payload.componente;
  const botoes = botoesDoRodapeCliente({ temPesquisa: Boolean(PesquisaComp), atendimentoAqui: openHere });

  // RN-CORE-50: Performance só com linhas do aparelho; pedidos só se o perfil os vê (RN-PRO-01)
  const visitasDoCliente = locais.visitasSync.filter((v) => v.cliente_id === id);
  const pedidosDoCliente = locais.pedidos.filter((p) => p.cliente_id === id).map((p) => ({ ...p, data: p.criado_no_aparelho_em ?? p.created_at }));
  const itensVisiveis = itensDoPedidoVisiveis(pedidosDoCliente, locais.pedidoItens);
  const dataDoPedido = new Map(pedidosDoCliente.map((p) => [p.id, p.data]));
  const itensComprados = ultimosItensComprados(itensVisiveis.map((i) => ({ ...i, data: dataDoPedido.get(i.pedido_id) ?? '', produto_nome: i.produto_nome ?? null, unidade: i.unidade ?? null })), 20).map((i) => ({ ...i, data_local: dataLocal(i.data, tz) }));
  const ultimaDoSync = locais.ultimasVisitas.filter((u) => u.cliente_id === id).map((u) => u.ultima_visita_data).sort().pop() ?? null;
  // RN-CORE-50: com o resumo do servidor vale o total e a última visita dele; sem ele, o cálculo local
  const resumoServidor = locais.resumosVisita.find((r) => r.cliente_id === id) ?? null;
  const visitas = resumoDeVisitas(visitasDoCliente, tz, ultimaDoSync, resumoServidor);
  const nomeDoVendedor = new Map(pedidosDoCliente.filter((p) => p.vendedor_nome).map((p) => [p.vendedor_id, p.vendedor_nome as string]));
  const quemVisitou = quemVisitouPorUltimo(visitas, core.vendedorId, nomeDoVendedor);

  const itensAbas = [
    { id: 'resumo', rotulo: 'Resumo' },
    { id: 'cadastro', rotulo: 'Cadastro' },
    { id: 'financeiro', rotulo: 'Finanças' },
    { id: 'compras', rotulo: 'Compras' },
    { id: 'performance', rotulo: 'Perform.' },
    { id: 'anexos', rotulo: 'Anexos' },
  ] as const;

  return (
    <View style={styles.root}>
      <CabecalhoTela titulo={nome} subtitulo={`${endereco}${desde}`} voltar={{ label: params.from ?? 'Clientes', fallback: '/m/clientes' }} />
      <Abas abas={itensAbas} valor={aba} onChange={setAba} testID="abas-cliente" />
      <ScrollView contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 20, paddingBottom: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        {/* alertas ficam no topo do conteúdo em todas as abas */}
        <OpenVisitBar from={nome} clienteAtual={id} />
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
        {avisoFoto ? <Banner tone="danger" icon="alert" testID="cliente-foto-erro" anunciar>{avisoFoto}</Banner> : null}

        {aba === 'resumo' ? (
          <>
            {ficha ? (
              <>
                <TagsCliente ficha={ficha} atendimento={openHere && openVisit ? `Em atendimento · desde ${formatHHMM(openVisit.checkin_at, tz)}` : null} />
                <AcoesContato ficha={ficha} />
                <IndicadoresResumo ficha={ficha} hoje={hoje} />
              </>
            ) : customer ? (
              <>
                {openHere && openVisit ? <Badge label={`Em atendimento · desde ${formatHHMM(openVisit.checkin_at, tz)}`} tone="accent" style={{ alignSelf: 'flex-start' }} /> : null}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Action icon="phone" label="Ligar" onPress={() => void Linking.openURL(telUrl(customer.phone))} />
                  <Action icon="chat" label="WhatsApp" onPress={() => void Linking.openURL(whatsappUrl(customer.phone))} />
                  <Action icon="navigate" label="Mapa" onPress={() => void Linking.openURL(mapsUrl(customer.lat, customer.lng, customer.address))} />
                </View>
                {locais.verPedidos ? (
                  <View style={styles.grid}>
                    <Stat label="Última compra" value={daysAgoLabel(customer.days_since_purchase)} color={customer.days_since_purchase !== null && customer.days_since_purchase >= 45 ? colors.warning : undefined} />
                  </View>
                ) : null}
              </>
            ) : null}
            {abasResumo.map((a) => {
              const Aba = a.payload.componente;
              return (
                <View key={`${a.modulo}-${a.id}`} testID={a.payload.testID} style={{ gap: 8 }}>
                  <SectionHeader title={a.payload.rotulo} />
                  <Aba contexto={contexto} />
                </View>
              );
            })}
          </>
        ) : !ficha ? (
          <Text style={t.sub}>Dados do cliente ainda não chegaram ao aparelho. Sincronize para atualizar.</Text>
        ) : aba === 'cadastro' ? (
          <AbaDadosCadastrais ficha={ficha} />
        ) : aba === 'financeiro' ? (
          <AbaFinanceiro ficha={ficha} />
        ) : aba === 'compras' ? (
          <AbaCompras ficha={ficha} hoje={hoje} pedidos={PedidosComp && abaPedidos ? <View testID={abaPedidos.payload.testID}><PedidosComp contexto={contexto} /></View> : undefined} />
        ) : aba === 'performance' ? (
          <AbaPerformance
            dados={{ visitas, quemVisitou, prazoMedio: ficha.pedidos_visiveis ? prazoMedioDias(pedidosDoCliente) : null, curvas, itens: ficha.pedidos_visiveis ? itensComprados : [] }}
            mix={MixComp && abaMix ? (
              <View testID={abaMix.payload.testID} style={{ gap: 8 }}>
                <SectionHeader title={abaMix.payload.rotulo} />
                <MixComp contexto={contexto} />
              </View>
            ) : undefined}
          />
        ) : (
          <>
            <BotaoFotoPdv ficha={ficha} onVerFotoPdv={verFotoPdv} />
            <BlocoFotosPdv ficha={ficha} onAdicionar={adicionarFotoPdv} />
          </>
        )}
      </ScrollView>

      {customer ? (
        <View style={styles.footer}>
          {botoes.checkout ? (
            <Button testID="customer-checkout" label="Checkout" variant="dark" height={52} style={{ flex: 1 }} textStyle={{ fontSize: 15 }} onPress={() => sheets.askCheckout()} />
          ) : null}
          {botoes.pesquisa ? (
            <Button testID="customer-pesquisa" label="Pesquisa" variant="outlineDark" height={52} style={{ flex: 1 }} textStyle={{ fontSize: 15 }} onPress={() => setPesquisaAberta(true)} />
          ) : null}
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
      ) : null}

      {PesquisaComp ? (
        <Folha visivel={pesquisaAberta} onFechar={() => setPesquisaAberta(false)} rotuloFechar="Fechar pesquisa" titulo="Pesquisa" fechar={{ rotulo: 'Fechar pesquisa' }} rolavel testID="folha-pesquisa-cliente">
          <PesquisaComp contexto={contexto} />
        </Folha>
      ) : null}

      {customer ? (
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
      ) : null}
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
