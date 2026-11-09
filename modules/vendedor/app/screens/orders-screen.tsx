/**
 * Pedidos (Pedidos.dc.html; T-0077; V9 da T-0071: lista virtualizada): busca (fantasia, razão social ou nº) e o botão de filtro na
 * mesma linha (T-0090, modelo A: selo com o número de filtros, etiqueta removível e folha Período; Gestão: vendedor na mesma folha),
 * depois uma linha de situações, incluindo os pedidos na fila do aparelho. A busca ignora o período e procura em toda a janela
 * de 90 dias do aparelho. O período fora dessa janela (inteiro ou em parte) consulta o servidor, com sinal.
 * RN-CORE-23 (T-0054): sem consulta periódica própria. Ao abrir a tela só relê o aparelho; o pull vem do motor de sync da
 * plataforma (a cada `sync_auto_min`, ao abrir o app e ao voltar ao primeiro plano depois de 30 min); puxar = Sincronizar.
 */
import { formatBRL, formatBRL0 } from '@macuxi/comum';
import { SePode, useAmbiente, useVisaoShell } from '@macuxi/platform-sdk/react';
import { Badge, Banner, BotaoFiltro, Button, CampoBusca, Card, Chip, colors, Empty, EtiquetaFiltro, fonts, FolhaPeriodo, LinhaAtalho, ListaSuspensa, radius, relativeWhen, rotuloComContador, Selo, Strong, type as t, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  casaComBusca,
  chipsComAtivo,
  contarPorSituacao,
  destacarTrecho,
  type TrechoDoTexto,
  deslocarPeriodo,
  diasComPedido,
  filtrarLista,
  itemNaSituacao,
  normalizarTexto,
  periodoDe,
  periodoForaDaJanela,
  periodoParcialNaJanela,
  resumoDaSituacao,
  situacaoEfetiva,
  type ItemDaBusca,
  type Periodo,
  type SituacaoDaLista,
} from '../../domain/busca-periodo';
import { ajudaDaJanela, ATALHO_PADRAO, ATALHOS_DE_PERIODO, atalhoEmVigor, contarFiltros, ehAtalhoDePeriodo, escolhaEmVigor, periodoDaEscolha, periodoDoAtalho, textoDaEtiquetaDoPeriodo } from '../../domain/filtro-periodo';
import { filtrarPorVendedor, opcoesDeVendedor, TODOS_OS_VENDEDORES } from '../../domain/filtro-vendedor';
import { ROTULO_A_FATURAR } from '../../domain/resumo-inicio';
import { validadeOrcamentoDias } from '../../domain/orcamento';
import { pedidoAFaturar } from '../../domain/resumo-inicio';
import { orcamentosEmAberto } from '../lib/resumo-inicio';
import { relogioReal } from '@macuxi/comum/relogio';
import { caminhoDaConsultaPorPeriodo, estadoDaConsulta, juntarServidorComAparelho, pedidosDaConsulta, resumoDaBusca, rotuloRemoverVendedor, situacaoAoEscolherPeriodo, textoDoVazio, PAGINAS_MAXIMAS_DA_CONSULTA } from '../lib/consulta-periodo';
import { trechosDoNumero } from '../lib/destaque-numero';
import { seloDaLinha } from '../lib/selo-lista';
import { orderNote, statusBadgeDaLinha } from '../lib/order-status';
import { TEXTOS_RASCUNHOS } from '../lib/rascunhos-lista';
import type { PedidoDaLista } from '../lib/pedidos';
import { PedidosPage, type Order } from '../../contracts';
import { irParaNovoPedido, irParaPedido, irParaRascunhos } from '../rotas';
import { useVendedor } from '../state/use-vendedor';

type Situacao = SituacaoDaLista | 'decide' | 'a_faturar' | 'orc_abertos';

export default function OrdersScreen() {
  const { dados, rascunhosDaLista, pedidos: orders, preVendaLigada, tz, offline, atualizarPedidos: refreshOrders, sincronizando, erroSync, motor, aguardandoMinhaDecisao } = useVendedor();
  // Gestão (supervisor/gerente): lista da equipe com a aba "Para aprovar" primeiro (T-0029 §8); o Campo é do vendedor
  const gestao = useVisaoShell().app === 'gestao';
  const paraDecidir = useMemo(() => new Set(aguardandoMinhaDecisao.map((p) => p.id)), [aguardandoMinhaDecisao]);
  const ambiente = useAmbiente();
  const sync = { running: sincronizando, error: erroSync };
  const syncAll = () => motor?.sincronizar();
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [busca, setBusca] = useState('');
  // T-0077: seletor de vendedor só no Gestão; o filtro vale antes da busca, do período, dos chips e do resumo
  const [vendedorId, setVendedorId] = useState(TODOS_OS_VENDEDORES);
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('mes', new Date(), tz));
  // T-0076: os cards do Início abrem a lista já filtrada (`?filtro=orcamentos|a_faturar`), sem período, na janela toda do aparelho
  const { filtro: filtroDoInicio } = useLocalSearchParams<{ filtro?: string }>();
  const [semPeriodo, setSemPeriodo] = useState(false);
  useEffect(() => {
    if (filtroDoInicio === 'orcamentos') setSituacao('orc_abertos');
    else if (filtroDoInicio === 'a_faturar') setSituacao('a_faturar');
    else return;
    setSemPeriodo(true);
  }, [filtroDoInicio]);
  // RN-CORE-23: puxar para baixo = Sincronizar; o spinner é só do puxar (o sync do agendador não gira a lista); depois de cada sync relê o aparelho
  const auto = useAtualizacaoAutomatica({ tz });
  // T-0077 item 6: período fora dos 90 dias do aparelho = consulta ao servidor (com sinal); sem sinal, 'Disponível com conexão'
  const [consulta, setConsulta] = useState<{ chave: string; itens: PedidoDaLista[]; estado: 'carregando' | 'ok' | 'erro'; cortada?: boolean } | null>(null);
  const [tentativa, setTentativa] = useState(0);

  // RN-CORE-23: ao focar, só relê o aparelho (sem rede, sem timer)
  useFocusEffect(
    useCallback(() => {
      void refreshOrders();
    }, [refreshOrders]),
  );

  const agora = new Date();
  // T-0141 (RN-VEN-39, spec F.1): a linha "Rascunhos (n)" só aparece com 1 ou mais; Gestão e Campo (pedido em nome) iguais
  const totalRascunhos = useMemo(() => rascunhosDaLista(new Date()).length, [rascunhosDaLista, dados.rascunhos]);
  const razaoDe = useMemo(() => new Map(dados.clientes.map((c) => [c.id, c.legal_name])), [dados.clientes]);
  const opcoes = useMemo(() => (gestao ? opcoesDeVendedor(orders) : []), [gestao, orders]);
  const vendedorAtivo = gestao && opcoes.some((o) => o.id === vendedorId) ? vendedorId : TODOS_OS_VENDEDORES;
  const nomeDoVendedor = vendedorAtivo !== TODOS_OS_VENDEDORES ? (opcoes.find((o) => o.id === vendedorAtivo)?.nome ?? 'Vendedor') : null;
  const buscando = normalizarTexto(busca) !== '';
  const fora = !buscando && !semPeriodo && periodoForaDaJanela(periodo, agora, tz);
  const semSinal = offline || !ambiente.online();
  // T-0090: período que sai da janela do aparelho (inteiro ou em parte) consulta o servidor, com sinal; sem sinal, a parte parcial mostra o que o aparelho tem
  const parcial = !buscando && !semPeriodo && periodoParcialNaJanela(periodo, agora, tz);
  const modoConsulta = parcial && !semSinal ? 'consultar' : estadoDaConsulta({ fora, offline: semSinal });
  const chaveConsulta = `${periodo.tipo}:${periodo.valor}`;
  useEffect(() => {
    if (modoConsulta !== 'consultar') return;
    let cancelado = false;
    setConsulta({ chave: chaveConsulta, itens: [], estado: 'carregando' });
    void (async () => {
      try {
        const todos: Order[] = [];
        let cortada = false;
        let cursor: string | null = null;
        for (let pagina = 0; pagina < PAGINAS_MAXIMAS_DA_CONSULTA; pagina++) {
          const r = PedidosPage.parse(await ambiente.http.requisitar('GET', caminhoDaConsultaPorPeriodo(periodo, cursor)));
          todos.push(...r.itens);
          cursor = r.proximo_cursor;
          if (!cursor) break;
          if (pagina === PAGINAS_MAXIMAS_DA_CONSULTA - 1) cortada = true;
        }
        if (!cancelado) setConsulta({ chave: chaveConsulta, itens: pedidosDaConsulta(todos), estado: 'ok', cortada });
      } catch {
        if (!cancelado) setConsulta({ chave: chaveConsulta, itens: [], estado: 'erro' });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [modoConsulta, chaveConsulta, tentativa]);
  const doServidor = modoConsulta === 'consultar' && consulta?.chave === chaveConsulta ? consulta : null;
  // T-0090: fora inteiro = só o servidor; em parte = servidor + aparelho (a fila e as edições locais têm prioridade, sem duplicar por id)
  const fonte = useMemo(
    () => (doServidor?.estado === 'ok' ? (fora ? doServidor.itens : juntarServidorComAparelho(doServidor.itens, orders)) : orders),
    [doServidor, fora, orders],
  );
  const doVendedor = useMemo(() => (gestao ? filtrarPorVendedor(fonte, vendedorAtivo) : fonte), [gestao, fonte, vendedorAtivo]);
  const itens = useMemo(
    () =>
      doVendedor.map(
        (o): ItemDaBusca & { pedido: PedidoDaLista } => ({
          id: o.id,
          numero: o.number,
          nome_fantasia: o.customer_name,
          razao_social: razaoDe.get(o.customer_id) ?? '',
          tipo: o.tipo,
          status: o.status,
          local: o.local,
          total_cents: o.total_cents,
          emitido_em: o.received_at,
          status_alterado_em: o.status_changed_at !== undefined ? o.status_changed_at : o.updated_at || null,
          pedido: o,
        }),
      ),
    [doVendedor, razaoDe],
  );
  // RF-VEN-05: texto na busca ignora o período; o card do Início também (janela toda do aparelho)
  const base = useMemo(
    () => (semPeriodo && !buscando ? itens : filtrarLista(itens, { periodo, busca, tz })),
    [itens, periodo, busca, tz, semPeriodo, buscando],
  );
  const contagem = useMemo(() => contarPorSituacao(base), [base]);
  // V9: busca por id em Map (era um find dentro do map de cada linha, O(n²))
  const pedidoPorId = useMemo(() => new Map(itens.map((i) => [i.id, i.pedido])), [itens]);
  const aFaturar = useMemo(() => itens.filter(pedidoAFaturar), [itens]);
  // V1: o card do Início conta só os orçamentos em aberto (RN-VEN-18); a lista aberta por ele usa a mesma função
  const diasValidade = validadeOrcamentoDias(ambiente.parametros('vendedor'));
  const numeroDoPedido = useCallback((id: string) => pedidoPorId.get(id)?.number ?? null, [pedidoPorId]);
  const insets = useSafeAreaInsets();
  const orcAbertos = useMemo(() => {
    const ids = new Set(orcamentosEmAberto(itens.map((i) => i.pedido)).map((p) => p.id));
    return itens.filter((i) => ids.has(i.id));
  }, [itens]);
  // R1: com texto a busca procura em tudo (situação Todos); ao apagar o texto volta o chip escolhido antes
  const atual: Situacao = situacaoEfetiva<Situacao>(situacao ?? (gestao && itens.some((i) => paraDecidir.has(i.id)) ? 'decide' : 'todos'), buscando);
  // Y1: o chip ativo fica na linha mesmo com 0
  const chips = chipsComAtivo(contagem.chips, atual).filter((c) => c.id !== 'orcamentos' || preVendaLigada || atual === 'orcamentos');

  // trocar período ou situação só refaz este filtro sobre o que já está na memória (sem reler o SQLite nem sincronizar)
  const visiveis = useMemo(
    () => (atual === 'decide' ? base.filter((i) => paraDecidir.has(i.id)) : atual === 'a_faturar' ? aFaturar : atual === 'orc_abertos' ? orcAbertos : base.filter((i) => itemNaSituacao(i, atual))),
    [atual, base, paraDecidir, aFaturar, orcAbertos],
  );
  const resumo = useMemo(() => resumoDaSituacao(visiveis, atual === 'orc_abertos' ? 'orcamentos' : atual), [visiveis, atual]);
  const queued = contagem.na_fila;
  // T-0090: a folha Período e a etiqueta; tudo derivado do período em vigor (cálculo barato, refeito só quando ele muda)
  const hojeDia = periodoDe('dia', new Date(), tz).valor;
  const filtro = useMemo(() => {
    const em = new Date();
    return {
      hoje: hojeDia,
      atalho: atalhoEmVigor(periodo, em, tz),
      escolha: escolhaEmVigor(periodo, em, tz),
      etiqueta: textoDaEtiquetaDoPeriodo(periodo, em, tz),
      ajuda: ajudaDaJanela(periodo, em, tz),
      contagem: contarFiltros({ periodo, agora: em, tz, vendedorEscolhido: vendedorAtivo !== TODOS_OS_VENDEDORES }),
      periodoPadrao: contarFiltros({ periodo, agora: em, tz, vendedorEscolhido: false }) === 0,
    };
  }, [periodo, tz, vendedorAtivo, hojeDia]);
  // pontos do calendário: só calculados com a folha aberta (a janela do aparelho tem 3 meses)
  const diasMarcados = useMemo(() => {
    if (!folhaAberta) return [];
    let mes = filtro.hoje.slice(0, 7);
    const dias: string[] = [];
    for (let k = 0; k < 4; k++) {
      dias.push(...diasComPedido(itens, mes, tz));
      mes = deslocarPeriodo({ tipo: 'mes', valor: mes }, -1).valor;
    }
    return dias;
  }, [folhaAberta, itens, tz, filtro.hoje]);

  const escolherPeriodo = (p: Periodo) => {
    setSemPeriodo(false);
    setSituacao((s) => situacaoAoEscolherPeriodo(s));
    setPeriodo(p);
  };
  const aplicarAtalho = (id: string) => escolherPeriodo(periodoDoAtalho(ehAtalhoDePeriodo(id) ? id : ATALHO_PADRAO, new Date(), tz));
  const removerPeriodo = () => aplicarAtalho(ATALHO_PADRAO);
  const limparFiltros = () => {
    removerPeriodo();
    setVendedorId(TODOS_OS_VENDEDORES);
  };
  // Y12: fora dos 90 dias sem resposta do servidor, "0 pedidos" seria falso; o cartão mostra o estado
  const semResposta = fora && doServidor?.estado !== 'ok';
  const vazio = textoDoVazio({ fora, modoConsulta, estadoDoServidor: doServidor?.estado, buscando, situacao: atual, gestao });

  return (
    <FlatList
      testID="orders"
      style={styles.root}
      contentContainerStyle={{ paddingTop: Math.max(28, insets.top + 16), paddingHorizontal: 20, paddingBottom: 20 }}
      keyboardShouldPersistTaps="handled"
      data={visiveis}
      keyExtractor={(i) => i.id}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      removeClippedSubviews
      refreshing={auto.puxando}
      onRefresh={() => {
        setTentativa((n) => n + 1);
        auto.puxar();
      }}
      renderItem={({ item: i, index: k }) => {
        const pedido = pedidoPorId.get(i.id);
        return pedido ? <OrderRow o={pedido} razao={i.razao_social} busca={busca} primeiro={k === 0} last={k === visiveis.length - 1} tz={tz} mostrarVendedor={gestao} diasValidade={diasValidade} numeroDoPedido={numeroDoPedido} /> : null;
      }}
      ListEmptyComponent={
        <Card>
          <Empty text={vazio} />
        </Card>
      }
      ListHeaderComponent={
    <View style={styles.cabecalho}>
      <View style={styles.header}>
        <Text style={[t.h1, { flex: 1 }]}>{gestao ? 'Pedidos da equipe' : 'Pedidos'}</Text>
        <SePode acao="pedido.criar">
          {gestao ? null : <Button testID="pedido-novo" label="Novo" icon="plus" variant="accent" onPress={() => irParaNovoPedido()} style={{ paddingHorizontal: 16 }} />}
        </SePode>
      </View>

      {totalRascunhos > 0 ? (
        <LinhaAtalho testID="orders-rascunhos" icone="edit" rotulo={rotuloComContador(TEXTOS_RASCUNHOS.titulo, totalRascunhos)} apoio={TEXTOS_RASCUNHOS.atalhoApoio} onPress={irParaRascunhos} />
      ) : null}

      <View style={styles.linhaBusca}>
        <View style={{ flex: 1 }}>
          <CampoBusca
            testID="orders-busca"
            valor={busca}
            onChange={setBusca}
            placeholder={gestao ? 'Cliente ou nº' : 'Nome fantasia, razão social ou nº'}
            rotuloAcessivel="Buscar pedido por nome fantasia, razão social ou número"
            onLimpar={() => setBusca('')}
            rotuloLimpar="Limpar a busca"
          />
        </View>
        <BotaoFiltro testID="orders-filtro" contagem={filtro.contagem} rotulo="Filtrar" onPress={() => setFolhaAberta(true)} />
      </View>
      <FolhaPeriodo
        testID="periodo"
        visivel={folhaAberta}
        onFechar={() => setFolhaAberta(false)}
        textos={TEXTOS_DA_FOLHA}
        atalhos={ATALHOS_DE_PERIODO}
        atalhoAtivo={semPeriodo ? null : filtro.atalho}
        onAtalho={aplicarAtalho}
        escolha={semPeriodo ? null : filtro.escolha}
        onEscolher={(e) => escolherPeriodo(periodoDaEscolha(e))}
        onLimpar={limparFiltros}
        limparDesligado={filtro.contagem === 0 && !semPeriodo}
        hoje={filtro.hoje}
        diasMarcados={diasMarcados}
        ajuda={filtro.ajuda}
        extra={
          gestao ? (
            <ListaSuspensa
              testID="orders-vendedor"
              rotulo="Vendedor"
              rotuloAcessivel="Filtrar por vendedor"
              opcoes={opcoes.map((o) => ({ id: o.id, rotulo: o.nome }))}
              valor={vendedorAtivo}
              onChange={setVendedorId}
              placeholder="Todos os vendedores"
              rotuloFechar="Fechar a lista"
            />
          ) : null
        }
      />

      {buscando ? (
        <>
          <Text style={t.small} testID="orders-busca-resumo">
            {resumoDaBusca(visiveis.length, nomeDoVendedor)}
          </Text>
          {nomeDoVendedor ? (
            <View style={styles.etiquetas} testID="orders-etiquetas">
              <EtiquetaFiltro testID="orders-etiqueta-vendedor" texto={nomeDoVendedor} rotuloRemover={rotuloRemoverVendedor(nomeDoVendedor)} onRemover={() => setVendedorId(TODOS_OS_VENDEDORES)} />
            </View>
          ) : null}
        </>
      ) : (
        <>
          {(filtro.contagem > 0 && !semPeriodo) || vendedorAtivo !== TODOS_OS_VENDEDORES ? (
            <View style={styles.etiquetas} testID="orders-etiquetas">
              {filtro.periodoPadrao || semPeriodo ? null : <EtiquetaFiltro testID="orders-etiqueta-periodo" texto={filtro.etiqueta} rotuloRemover={`Remover filtro ${filtro.etiqueta}`} onRemover={removerPeriodo} />}
              {vendedorAtivo !== TODOS_OS_VENDEDORES ? (
                <EtiquetaFiltro testID="orders-etiqueta-vendedor" texto={nomeDoVendedor ?? 'Vendedor'} rotuloRemover={rotuloRemoverVendedor(nomeDoVendedor ?? 'Vendedor')} onRemover={() => setVendedorId(TODOS_OS_VENDEDORES)} />
              ) : null}
            </View>
          ) : null}

          {semResposta ? null : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}>
            {gestao ? <Chip testID="chip-decide" label={`Para aprovar ${base.filter((i) => paraDecidir.has(i.id)).length}`} active={atual === 'decide'} onPress={() => setSituacao('decide')} /> : null}
            {atual === 'a_faturar' ? <Chip testID="chip-a-faturar" label={`${ROTULO_A_FATURAR} ${aFaturar.length}`} active onPress={() => setSituacao('a_faturar')} /> : null}
            {atual === 'orc_abertos' ? <Chip testID="chip-orc-abertos" label={`Em aberto ${orcAbertos.length}`} active onPress={() => setSituacao('orc_abertos')} /> : null}
            {chips.map((c) => (
              <Chip key={c.id} testID={`chip-${c.id}`} label={`${c.rotulo} ${c.quantidade}`} active={atual === c.id} onPress={() => setSituacao(c.id)} />
            ))}
          </ScrollView>
          )}

          {semResposta ? null : (
          <Text style={t.small} testID="orders-resumo">
            {resumo.quantidade} {resumo.orcamentos ? (resumo.quantidade === 1 ? 'orçamento' : 'orçamentos') : resumo.quantidade === 1 ? 'pedido' : 'pedidos'} · {formatBRL0(resumo.total_cents)}
          </Text>
          )}
          {parcial && semSinal ? (
            <Banner testID="orders-parcial" anunciar>Sem sinal: mostrando só o que o aparelho tem deste período.</Banner>
          ) : null}
          {parcial && !semSinal && doServidor?.estado === 'erro' ? (
            <Banner testID="orders-parcial-erro" icon="alert" anunciar>Não foi possível consultar o servidor: mostrando só o que o aparelho tem deste período. Puxe para baixo para tentar de novo.</Banner>
          ) : null}
          {parcial && !semSinal && modoConsulta === 'consultar' && doServidor?.estado !== 'ok' && doServidor?.estado !== 'erro' ? (
            <Text style={t.small} testID="orders-parcial-buscando">
              Buscando o restante no servidor…
            </Text>
          ) : null}
          {doServidor?.estado === 'ok' && doServidor.cortada ? (
            <Text style={t.small} testID="orders-cortada">
              Mostrando os 1.000 mais recentes. Use um período menor para ver os demais.
            </Text>
          ) : null}
          {queued > 0 ? (
            <Banner testID="orders-queue-banner">
              <Strong>{queued === 1 ? '1 pedido na fila do aparelho.' : `${queued} pedidos na fila do aparelho.`}</Strong> {offline ? 'Envio automático quando o sinal voltar.' : 'Enviando automaticamente…'}
            </Banner>
          ) : null}
        </>
      )}

    </View>
      }
      ListFooterComponent={
    <View style={styles.rodape}>
      <Text style={[t.small, { textAlign: 'center' }]} testID="orders-sync-rodape">{auto.rodape}</Text>
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
    </View>
      }
    />
  );
}

/** Texto com o trecho achado em destaque (sem acento e sem maiúscula); fundo e tinta do kit, legíveis ao sol (Y11). */
function Destacado({ texto, busca, style, mono, trechos, testID, testIDDestaque, linhaUnica = true }: { texto: string; busca: string; style?: object; mono?: boolean; trechos?: TrechoDoTexto[]; testID?: string; testIDDestaque?: string; linhaUnica?: boolean }) {
  return (
    <Text style={[style, mono && { fontFamily: fonts.mono }]} numberOfLines={linhaUnica ? 1 : undefined} testID={testID}>
      {(trechos ?? destacarTrecho(texto, busca)).map((p, i) => (
        <Text key={i} style={p.destaque ? styles.destaque : undefined} testID={p.destaque ? testIDDestaque : undefined}>
          {p.texto}
        </Text>
      ))}
    </Text>
  );
}

const TEXTOS_DA_FOLHA = {
  titulo: 'Período',
  fechar: 'Fechar o filtro',
  escolher: 'Escolher dia, mês ou ano',
  voltar: 'Atalhos',
  dia: 'Dia',
  mes: 'Mês',
  ano: 'Ano',
  mesAnterior: 'Mês anterior',
  proximoMes: 'Próximo mês',
  anoAnterior: 'Ano anterior',
  proximoAno: 'Próximo ano',
  limpar: 'Limpar',
  diaComPedido: 'tem pedido',
};

const OrderRow = memo(function OrderRow({ o, razao, busca, primeiro, last, tz, mostrarVendedor, diasValidade, numeroDoPedido }: { o: PedidoDaLista; razao: string; busca: string; primeiro: boolean; last: boolean; tz: string; mostrarVendedor: boolean; diasValidade: number; numeroDoPedido: (id: string) => string | null }) {
  const b = statusBadgeDaLinha(o);
  const note = orderNote(o);
  const buscando = normalizarTexto(busca) !== '';
  // T-0053: orçamento mostra a situação (offline, pela validade; RN-VEN-32); V7: o mesmo selo do detalhe
  const seloOrc = o.tipo === 'orcamento' ? seloDaLinha(o, { agora: relogioReal().agora(), fuso: tz, dias: diasValidade, numeroDoPedido }) : null;
  return (
    <View style={[styles.linhaCartao, primeiro && styles.linhaPrimeira, last && styles.linhaUltima]}>
    <Pressable
      testID={`order-${o.number || o.id}`}
      accessibilityRole="button"
      onPress={() => {
        irParaPedido(o.id);
      }}
      style={({ pressed }) => [styles.row, !last && styles.divider, pressed && { backgroundColor: colors.ground }]}>
      <View style={styles.line}>
        <Destacado texto={o.customer_name || 'Pedido no aparelho'} busca={busca} style={[t.bodyStrong, { flex: 1 }]} />
        <Text style={[t.bodyStrong, { fontVariant: ['tabular-nums'] }, o.status === 'cancelled' && styles.cancelledTotal]}>{formatBRL(o.total_cents)}</Text>
      </View>
      {buscando && razao && casaComBusca({ numero: '', nome_fantasia: '', razao_social: razao }, busca) ? <Destacado texto={razao} busca={busca} style={t.small} /> : null}
      <View style={styles.line}>
        <Text style={[t.small, { flex: 1 }]} numberOfLines={1}>
          {o.number ? (
            <Destacado texto={o.number} busca={busca} trechos={trechosDoNumero(o.number, busca)} mono linhaUnica={false} testID={`order-numero-${o.number}`} testIDDestaque="order-numero-destaque" />
          ) : (
            <Text style={{ fontFamily: fonts.mono }}>no aparelho</Text>
          )}{' '}
          · {mostrarVendedor && o.seller_name ? `${o.seller_name} · ` : ''}{relativeWhen(o.received_at, new Date(), tz)} · {o.items_count} {o.items_count === 1 ? 'item' : 'itens'}
        </Text>
        {seloOrc ? <Selo texto={seloOrc.texto} tom={seloOrc.tom} tamanho="p" pilula /> : <Badge label={b.label} fg={b.fg} bg={b.bg} />}
      </View>
      {note ? <Text style={[t.small, { color: b.fg }]}>{note}</Text> : null}
    </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  cabecalho: { gap: 14, marginBottom: 14 },
  rodape: { gap: 14, marginTop: 14 },
  // a lista virtualizada desenha o Card linha a linha: borda dos lados em todas, em cima na primeira e embaixo na última
  linhaCartao: { backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line },
  linhaPrimeira: { borderTopWidth: 1, borderTopLeftRadius: radius.cartao, borderTopRightRadius: radius.cartao, overflow: 'hidden' },
  linhaUltima: { borderBottomWidth: 1, borderBottomLeftRadius: radius.cartao, borderBottomRightRadius: radius.cartao, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  linhaBusca: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  etiquetas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: -6 },
  destaque: { backgroundColor: colors.accentSoft, color: colors.accentInk },
  row: { gap: 3, paddingVertical: 11, paddingHorizontal: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cancelledTotal: { color: colors.ink3, textDecorationLine: 'line-through' },
});
