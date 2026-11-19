/**
 * Ficha do cliente v2 (T-0186; docs/design/cliente-360-v2): três abas fixas, Resumo · Histórico · Documentação (`abasDaFicha`; o promotor
 * sem `promotor_ve_pedidos` fica sem o Histórico, P12). Faixa Azul noite no topo (nome e "código · bairro · cidade/UF"), abas paradas
 * logo abaixo e o conteúdo rolando; o rodapé ("Check-in" sem atendimento aberto neste cliente ou "Checkout" com, "Pesquisa" e ações
 * `cliente.acoes`) fica visível em todas as abas. Alertas não financeiros (visita aberta, etapa pendente, `cliente.avisos`, erro de foto)
 * ficam no topo do conteúdo; NENHUM alerta financeiro na ficha (R-20261119-0440): o atraso aparece só na tabela do Histórico.
 * Resumo e Fotos do PDV leem só do aparelho (offline-first); o Histórico e os documentos vêm do servidor ao abrir a aba e ao tocar (P15,
 * P17), sem nada guardado no aparelho. Check-in único (RN-CORE-13): o botão de check-in vive só aqui e na Rota (`?checkin=1`;
 * RN-CORE-51); com atendimento aberto em outro cliente, fica bloqueado; o pedido continua liberado. Cliente fora da rota do dia só
 * com a ação `visita.checkin_fora_de_rota` (RN-CORE-52).
 *
 * Pontos de extensão que o Core oferece aqui (contracts/extensoes.ts):
 *  - `cliente.abas`  → "pesquisas" abre numa folha pelo botão "Pesquisa" do rodapé (RN-CORE-51); as demais (loja...) ficam no Resumo,
 *    cada uma com seu cabeçalho. "ultimos-pedidos" e "mix" não têm mais lugar na ficha (P6, R-20261119-0440);
 *  - `cliente.acoes` → botões do rodapé (ex.: "Novo pedido", do Vendedor, já escondido do promotor — RN-PRO-01).
 * A tela só lê os itens; quem registra decide o conteúdo. Sem o módulo ativo, o item some (RN-CORE-03).
 */
import { useExtensoes, usePode } from '@macuxi/platform-sdk/react';
import { Abas, BackLink, Badge, Banner, Button, CabecalhoTela, Folha, Strong, useSincronizacao, colors, fonte, formatHHMM, Icon, radius, SectionHeader, type as t, type IconName } from '@macuxi/ui/mobile';
import { useLocalSearchParams, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ACAO_CHECKIN_FORA_DE_ROTA, type AbaCliente, type AcaoCliente, type AvisoCliente, type ContextoCliente } from '../../contracts';
import { acoesDoRodapeCliente, botoesDoRodapeCliente, checkinPermitido, curvasAbcDoCliente, filtrarExtensoesDePedido, isVisitOpen, itensDoPedidoVisiveis, limiteEDisponivelDoResumo, performanceDoCliente, prazoMedioDoCliente, quemVisitouPorUltimo, resumoDeVisitas, ultimosItensComprados, dataLocal, type AbaFicha } from '../../domain';
import { AbaDocumentacao } from '../components/aba-documentacao';
import { AbaHistorico } from '../components/aba-historico';
import { AbaResumo, type ItemCompradoLinha } from '../components/aba-resumo';
import { nomeDoCliente, subtituloDaFicha } from '../components/cliente360';
import { abrirDocumentoRegistrado } from '../lib/ficha-online';
import { aprovadosNaoFaturadosCents, abasDoApp, FILTRO_PADRAO, perfilDeGestao, type FiltroDaFicha } from '../lib/ficha-v2';
import { useAbrirDocumento, useDetalheDaNota, useDocumentosDoCliente, useNotasDoCliente } from '../lib/usar-ficha-online';
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
  const podeForaDeRota = usePode(ACAO_CHECKIN_FORA_DE_ROTA);
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
  const [aba, setAba] = useState<AbaFicha>('resumo');
  const [filtroNotas, setFiltroNotas] = useState<FiltroDaFicha>(FILTRO_PADRAO);
  // Histórico e Documentação: consultas online ao abrir a aba (P15, P17); nada fica guardado no aparelho
  const notas = useNotasDoCliente(id, filtroNotas, hoje, aba === 'historico');
  const detalheNota = useDetalheDaNota(id);
  const documentos = useDocumentosDoCliente(id, aba === 'documentacao');
  const abrirDoc = abrirDocumentoRegistrado();
  const aberturaDoc = useAbrirDocumento(id, abrirDoc);
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

  // RN-CORE-52: na rota do dia sempre; fora dela só com a ação no perfil
  const checkinLiberado = checkinPermitido({ clienteId: id, clientesDaRota: rota?.stops.map((s) => s.customer.id) ?? [], podeForaDeRota });
  const abaPesquisa = abas.find((a) => a.id === 'pesquisas') ?? null;
  const PesquisaComp = abaPesquisa?.payload.componente;
  // A regra do rodapé (check-in, checkout, pesquisa) fica no domain
  const botoes = botoesDoRodapeCliente({ temPesquisa: Boolean(PesquisaComp), atendimentoAqui: openHere, checkinPermitido: checkinLiberado, visitadoHoje: visited });
  const acoesRodape = acoesDoRodapeCliente(acoes);
  // "Fazer check-in" na Rota abre a ficha já registrando o check-in
  useEffect(() => {
    if (params.checkin === '1' && customer && autoStarted.current !== id) {
      autoStarted.current = id;
      router.setParams({ checkin: undefined });
      if (locked) sheets.showBlocked(customer.trade_name);
      else if (botoes.checkin) void startCheckin();
    }
  }, [params.checkin, customer, id, locked, botoes.checkin, startCheckin, sheets]);

  if (!customer && !ficha) {
    return (
      <View style={[styles.root, { paddingTop: 16, paddingHorizontal: 20 }]}>
        <BackLink label={params.from ?? 'Clientes'} fallback="/m/clientes" />
        <Text style={t.sub}>Cliente não está no aparelho. Sincronize para atualizar.</Text>
      </View>
    );
  }

  const rotuloDe = (a: AcaoCliente, ctx: ContextoCliente) => (typeof a.rotulo === 'function' ? a.rotulo(ctx) : a.rotulo);

  const nome = ficha ? nomeDoCliente(ficha.cliente) : (customer?.trade_name ?? '');
  const subtitulo = ficha ? subtituloDaFicha(ficha.cliente) : `${customer?.district ?? ''}`;
  // RN-CORE-49: curvas do mês atual contra a média dos 3 meses anteriores; só com pedidos visíveis (RN-PRO-01)
  const curvas = ficha && ficha.pedidos_visiveis ? curvasAbcDoCliente(ficha.historico, hoje, locais.faixasCurva) : [];
  // Seções de outros módulos ficam no Resumo; "pesquisas" abre na folha do botão "Pesquisa"; "ultimos-pedidos" e "mix" saíram da ficha (P6)
  const abasResumo = abas.filter((a) => !['ultimos-pedidos', 'mix', 'pesquisas'].includes(a.id));

  // RN-CORE-50: Performance só com linhas do aparelho; pedidos só se o perfil os vê (RN-PRO-01)
  const visitasDoCliente = locais.visitasSync.filter((v) => v.cliente_id === id);
  const pedidosDoCliente = locais.pedidos.filter((p) => p.cliente_id === id).map((p) => ({ ...p, data: p.criado_no_aparelho_em ?? p.created_at }));
  const itensVisiveis = itensDoPedidoVisiveis(pedidosDoCliente, locais.pedidoItens);
  const dataDoPedido = new Map(pedidosDoCliente.map((p) => [p.id, p.data]));
  // RN-CORE-50: com o resumo do servidor vale o total e a última visita dele; sem ele, o cálculo local
  const resumoServidor = locais.resumosVisita.find((r) => r.cliente_id === id) ?? null;
  const visitas = resumoDeVisitas(visitasDoCliente, tz, resumoServidor);
  const nomeDoVendedor = new Map(pedidosDoCliente.filter((p) => p.vendedor_nome).map((p) => [p.vendedor_id, p.vendedor_nome as string]));
  const quemVisitou = quemVisitouPorUltimo(visitas, core.vendedorId, nomeDoVendedor);
  const gestao = perfilDeGestao(locais.perfil);
  const itensComprados: ItemCompradoLinha[] = ficha && ficha.pedidos_visiveis
    ? ultimosItensComprados(itensVisiveis.map((i) => ({ ...i, data: dataDoPedido.get(i.pedido_id) ?? '', produto_nome: i.produto_nome ?? null, unidade: i.unidade ?? null })), 20).map((i) => ({
        produto_id: i.produto_id,
        nome: i.produto_nome ?? 'Produto',
        quantidade: i.quantidade,
        unidade: i.unidade ?? null,
        data_local: dataLocal(i.data, tz),
        total_cents: Math.round(i.quantidade * i.preco_unitario_cents),
      }))
    : [];
  // Spec §3: Performance (curvas, indicadores e visitas) e o cartão de crédito; o promotor sem `promotor_ve_pedidos` fica sem curvas, compras e cartão (P12)
  const performance = ficha ? performanceDoCliente({ historico: ficha.historico, curvas, visitas, hoje, comAcessoACompras: ficha.pedidos_visiveis, visitadaPor: quemVisitou }) : null;
  const fin = ficha?.financeiro ?? null;
  const cartao = ficha && ficha.pedidos_visiveis && fin
    ? limiteEDisponivelDoResumo(
        { limite_cents: fin.limite_cents, saldo_aberto_cents: fin.saldo_aberto_cents, credito_disponivel_erp_cents: fin.credito_disponivel_cents ?? null, bloqueado: fin.bloqueado, motivo_bloqueio: fin.motivo_bloqueio ?? null },
        aprovadosNaoFaturadosCents(pedidosDoCliente, fin.credito_disponivel_cents != null),
        prazoMedioDoCliente(pedidosDoCliente),
      )
    : null;

  const itensAbas = abasDoApp(locais.perfil, locais.verPedidos);
  const abaAtiva: AbaFicha = itensAbas.some((a) => a.id === aba) ? aba : 'resumo';

  return (
    <View style={styles.root}>
      <CabecalhoTela titulo={nome} subtitulo={subtitulo} voltar={{ label: params.from ?? 'Clientes', fallback: '/m/clientes' }} />
      <Abas abas={itensAbas} valor={abaAtiva} onChange={setAba} testID="abas-cliente" />
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

        {abaAtiva === 'resumo' ? (
          ficha && performance ? (
            <AbaResumo
              ficha={ficha}
              cartao={cartao}
              performance={performance}
              gestao={gestao}
              clienteDesde={customer?.customer_since ?? null}
              itens={itensComprados}
              atendimento={openHere && openVisit ? `Em atendimento · desde ${formatHHMM(openVisit.checkin_at, tz)}` : null}
              secoes={abasResumo.map((a) => {
                const Aba = a.payload.componente;
                return (
                  <View key={`${a.modulo}-${a.id}`} testID={a.payload.testID} style={{ gap: 8 }}>
                    <SectionHeader title={a.payload.rotulo} />
                    <Aba contexto={contexto} />
                  </View>
                );
              })}
            />
          ) : customer ? (
            <>
              {openHere && openVisit ? <Badge label={`Em atendimento · desde ${formatHHMM(openVisit.checkin_at, tz)}`} tone="accent" style={{ alignSelf: 'flex-start' }} /> : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Action icon="phone" label="Ligar" onPress={() => void Linking.openURL(telUrl(customer.phone))} />
                <Action icon="chat" label="WhatsApp" onPress={() => void Linking.openURL(whatsappUrl(customer.phone))} />
                <Action icon="navigate" label="Mapa" onPress={() => void Linking.openURL(mapsUrl(customer.lat, customer.lng, customer.address))} />
              </View>
            </>
          ) : null
        ) : !ficha ? (
          <Text style={t.sub}>Dados do cliente ainda não chegaram ao aparelho. Sincronize para atualizar.</Text>
        ) : abaAtiva === 'historico' ? (
          <AbaHistorico notas={notas} filtro={filtroNotas} onFiltro={setFiltroNotas} detalhe={detalheNota} hoje={hoje} />
        ) : (
          <AbaDocumentacao documentos={documentos} abertura={aberturaDoc} fotos={ficha.fotos_pdv} verFotoPdv={verFotoPdv} adicionarFotoPdv={adicionarFotoPdv} tirada={ficha.fotos_pdv?.fachada_foto?.tirada_em ? dataLocal(ficha.fotos_pdv.fachada_foto.tirada_em, tz) : null} />
        )}
      </ScrollView>

      {customer ? (
        <View style={styles.footer}>
          {botoes.checkin ? (
            <Button
              testID="customer-checkin"
              label="Check-in"
              variant={locked ? 'locked' : 'outlineDark'}
              icon={locked ? 'lock' : undefined}
              accessibilityLabel={locked ? `Check-in bloqueado: você está em atendimento em ${openVisit?.customer_name ?? 'outro cliente'}` : undefined}
              height={48}
              style={styles.botaoRodape}
              onPress={() => {
                if (locked) sheets.toast(`Em atendimento em ${openVisit?.customer_name ?? 'outro cliente'}`, 'warning');
                else void startCheckin();
              }}
            />
          ) : null}
          {botoes.checkout ? (
            <Button testID="customer-checkout" label="Checkout" variant="outlineDark" height={48} style={styles.botaoRodape} onPress={() => sheets.askCheckout()} />
          ) : null}
          {botoes.pesquisa ? (
            <Button testID="customer-pesquisa" label="Pesquisa" variant="outlineDark" height={48} style={styles.botaoRodape} onPress={() => setPesquisaAberta(true)} />
          ) : null}
          {acoesRodape.map((a) => (
            <Button
              key={`${a.modulo}-${a.id}`}
              testID={a.payload.testID}
              label={rotuloDe(a.payload, contexto)}
              icon={a.payload.icone as IconName | undefined}
              variant={a.payload.destaque ? 'accent' : 'outlineDark'}
              height={48}
              style={styles.botaoRodape}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  action: { flex: 1, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionText: { ...fonte.semibold, fontSize: 14, color: colors.ink },
  footer: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, backgroundColor: colors.ground },
  // Rodapé a 360 dp: cada botão ocupa o que o rótulo pede e divide a sobra; padding e espaço do ícone menores que os do kit para nada ser cortado
  botaoRodape: { flexGrow: 1, flexBasis: 'auto', paddingHorizontal: 6, gap: 6 },
});
