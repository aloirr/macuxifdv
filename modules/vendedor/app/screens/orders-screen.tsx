/**
 * Pedidos (Pedidos.dc.html; T-0077): busca (fantasia, razão social ou nº), período Dia | Mês | Ano e uma linha de situações,
 * incluindo os pedidos na fila do aparelho. A busca ignora o período e procura em toda a janela de 90 dias do aparelho.
 * RN-CORE-23 (T-0054): sem consulta periódica própria. Ao abrir a tela só relê o aparelho; o pull vem do motor de sync da
 * plataforma (a cada `sync_auto_min`, ao abrir o app e ao voltar ao primeiro plano depois de 30 min); puxar = Sincronizar.
 */
import { formatBRL, formatBRL0 } from '@macuxi/comum';
import { SePode, useAmbiente, useVisaoShell } from '@macuxi/platform-sdk/react';
import { Badge, Banner, Button, Card, Chip, colors, Empty, fonts, relativeWhen, Screen, Strong, type as t } from '@macuxi/ui/mobile';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  casaComBusca,
  chipsComAtivo,
  contarPorSituacao,
  destacarTrecho,
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
import { filtrarPorVendedor, opcoesDeVendedor, TODOS_OS_VENDEDORES } from '../../domain/filtro-vendedor';
import { validadeOrcamentoDias } from '../../domain/orcamento';
import { pedidoAFaturar } from '../../domain/resumo-inicio';
import { orcamentosEmAberto } from '../lib/resumo-inicio';
import { relogioReal } from '@macuxi/comum/relogio';
import { SeletorDePeriodo } from '../components/seletor-periodo';
import { rotuloDoDocumento } from '../lib/pre-venda';
import { orderNote, statusBadge } from '../lib/order-status';
import type { PedidoDaLista } from '../lib/pedidos';
import { irParaNovoPedido, irParaPedido } from '../rotas';
import { useVendedor } from '../state/use-vendedor';

type Situacao = SituacaoDaLista | 'decide' | 'a_faturar' | 'orc_abertos';

export default function OrdersScreen() {
  const { dados, pedidos: orders, preVendaLigada, tz, offline, atualizarPedidos: refreshOrders, sincronizarAgora, sincronizando, erroSync, motor, aguardandoMinhaDecisao } = useVendedor();
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
  const [seletorAberto, setSeletorAberto] = useState(false);
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
  const [refreshing, setRefreshing] = useState(false);

  // RN-CORE-23: ao focar, só relê o aparelho (sem rede, sem timer)
  useFocusEffect(
    useCallback(() => {
      void refreshOrders();
    }, [refreshOrders]),
  );

  const agora = new Date();
  const razaoDe = useMemo(() => new Map(dados.clientes.map((c) => [c.id, c.legal_name])), [dados.clientes]);
  const opcoes = useMemo(() => (gestao ? opcoesDeVendedor(orders) : []), [gestao, orders]);
  const vendedorAtivo = gestao && opcoes.some((o) => o.id === vendedorId) ? vendedorId : TODOS_OS_VENDEDORES;
  const doVendedor = useMemo(() => (gestao ? filtrarPorVendedor(orders, vendedorAtivo) : orders), [gestao, orders, vendedorAtivo]);
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
  const buscando = normalizarTexto(busca) !== '';
  // RF-VEN-05: texto na busca ignora o período; o card do Início também (janela toda do aparelho)
  const base = useMemo(
    () => (semPeriodo && !buscando ? itens : filtrarLista(itens, { periodo, busca, tz })),
    [itens, periodo, busca, tz, semPeriodo, buscando],
  );
  const contagem = contarPorSituacao(base);
  const aFaturar = useMemo(() => itens.filter(pedidoAFaturar), [itens]);
  // V1: o card do Início conta só os orçamentos em aberto (RN-VEN-18); a lista aberta por ele usa a mesma função
  const diasValidade = validadeOrcamentoDias(ambiente.parametros('vendedor'));
  const orcAbertos = useMemo(() => {
    const ids = new Set(orcamentosEmAberto(itens.map((i) => i.pedido), { agora: new Date(), fuso: tz, diasValidade }).map((p) => p.id));
    return itens.filter((i) => ids.has(i.id));
  }, [itens, tz, diasValidade]);
  // R1: com texto a busca procura em tudo (situação Todos); ao apagar o texto volta o chip escolhido antes
  const atual: Situacao = situacaoEfetiva<Situacao>(situacao ?? (gestao && itens.some((i) => paraDecidir.has(i.id)) ? 'decide' : 'todos'), buscando);
  // Y1: o chip ativo fica na linha mesmo com 0
  const chips = chipsComAtivo(contagem.chips, atual).filter((c) => c.id !== 'orcamentos' || preVendaLigada || atual === 'orcamentos');

  const visiveis =
    atual === 'decide'
      ? base.filter((i) => paraDecidir.has(i.id))
      : atual === 'a_faturar'
        ? aFaturar
        : atual === 'orc_abertos'
          ? orcAbertos
          : base.filter((i) => itemNaSituacao(i, atual));
  const resumo = resumoDaSituacao(visiveis, atual === 'orc_abertos' ? 'orcamentos' : atual);
  const parcial = !buscando && !semPeriodo && periodoParcialNaJanela(periodo, agora, tz);
  const fora = !buscando && !semPeriodo && periodoForaDaJanela(periodo, agora, tz);
  const queued = contagem.na_fila;
  const anos = useMemo(() => {
    const ano = Number(periodoDe('ano', agora, tz).valor);
    return [ano - 3, ano - 2, ano - 1, ano].map(String);
  }, [tz, periodo]);

  const escolherPeriodo = (p: Periodo) => {
    setSemPeriodo(false);
    setPeriodo(p);
  };
  const vazio = fora
    ? offline
      ? 'Disponível com conexão'
      : 'Pedidos com mais de 90 dias ficam no servidor. A consulta chega na próxima versão.'
    : buscando
      ? 'Nenhum pedido encontrado. Confira o nome ou o número, ou limpe a busca.'
      : atual === 'orcamentos' || atual === 'orc_abertos'
        ? 'Nenhum orçamento neste período.'
        : atual === 'decide'
          ? 'Nada para aprovar agora.'
          : atual === 'todos'
            ? gestao
              ? 'Nenhum pedido da equipe neste período.'
              : 'Nenhum pedido neste período. Toque em Novo para começar.'
            : 'Nenhum pedido com esta situação neste período.';

  return (
    <Screen
      testID="orders"
      refreshing={refreshing || sync.running}
      onRefresh={() => {
        setRefreshing(true);
        // RN-CORE-23: puxar para baixo = Sincronizar (envia a fila e roda o sync do motor da plataforma)
        void sincronizarAgora().finally(() => setRefreshing(false));
      }}>
      <View style={styles.header}>
        <Text style={[t.h1, { flex: 1 }]}>{gestao ? 'Pedidos da equipe' : 'Pedidos'}</Text>
        <SePode acao="pedido.criar">
          {gestao ? null : <Button testID="pedido-novo" label="Novo" icon="plus" variant="accent" onPress={() => irParaNovoPedido()} style={{ paddingHorizontal: 16 }} />}
        </SePode>
      </View>

      <View style={styles.linhaBusca}>
      <View style={[styles.busca, { flex: 1 }, busca ? { borderColor: colors.ink } : null]}>
        <Text style={{ fontSize: 16 }}>🔍</Text>
        <TextInput
          testID="orders-busca"
          value={busca}
          onChangeText={setBusca}
          placeholder={gestao ? 'Cliente ou nº' : 'Nome fantasia, razão social ou nº'}
          placeholderTextColor={colors.ink3}
          accessibilityLabel="Buscar pedido por nome fantasia, razão social ou número"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.buscaTexto}
        />
        {busca ? (
          <Pressable testID="orders-busca-limpar" accessibilityRole="button" accessibilityLabel="Limpar a busca" onPress={() => setBusca('')} style={styles.limpar}>
            <Text style={t.bodyStrong}>✕</Text>
          </Pressable>
        ) : null}
      </View>
      {gestao ? (
        <Pressable
          testID="orders-vendedor"
          accessibilityRole="button"
          accessibilityLabel={`Filtrar por vendedor. Atual: ${opcoes.find((o) => o.id === vendedorAtivo)?.nome ?? 'Todos os vendedores'}`}
          onPress={() => setSeletorAberto((a) => !a)}
          style={[styles.vendedor, vendedorAtivo !== TODOS_OS_VENDEDORES && styles.vendedorAtivo]}>
          <Text style={t.bodyStrong} numberOfLines={1}>
            {vendedorAtivo === TODOS_OS_VENDEDORES ? 'Vendedor' : (opcoes.find((o) => o.id === vendedorAtivo)?.nome ?? 'Vendedor')} ▾
          </Text>
        </Pressable>
      ) : null}
      </View>
      {gestao && seletorAberto ? (
        <Card style={{ overflow: 'hidden' }} testID="orders-vendedor-opcoes">
          {opcoes.map((o, k) => (
            <Pressable
              key={o.id}
              testID={`orders-vendedor-${o.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected: o.id === vendedorAtivo }}
              onPress={() => {
                setVendedorId(o.id);
                setSeletorAberto(false);
              }}
              style={[styles.opcao, k < opcoes.length - 1 && styles.divider]}>
              <Text style={o.id === vendedorAtivo ? t.bodyStrong : t.body}>{o.nome}</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {buscando ? (
        <Text style={t.small} testID="orders-busca-resumo">
          {visiveis.length} {visiveis.length === 1 ? 'resultado' : 'resultados'} · últimos 90 dias
        </Text>
      ) : (
        <>
          <SeletorDePeriodo periodo={periodo} onChange={escolherPeriodo} hoje={{ agora, tz }} diasComPedido={(mes) => diasComPedido(itens, mes, tz)} anosDisponiveis={anos} />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}>
            {gestao ? <Chip testID="chip-decide" label={`Para aprovar ${base.filter((i) => paraDecidir.has(i.id)).length}`} active={atual === 'decide'} onPress={() => setSituacao('decide')} /> : null}
            {atual === 'a_faturar' ? <Chip testID="chip-a-faturar" label={`A faturar ${aFaturar.length}`} active onPress={() => setSituacao('a_faturar')} /> : null}
            {atual === 'orc_abertos' ? <Chip testID="chip-orc-abertos" label={`Em aberto ${orcAbertos.length}`} active onPress={() => setSituacao('orc_abertos')} /> : null}
            {chips.map((c) => (
              <Chip key={c.id} testID={`chip-${c.id}`} label={`${c.rotulo} ${c.quantidade}`} active={atual === c.id} onPress={() => setSituacao(c.id)} />
            ))}
          </ScrollView>

          <Text style={t.small} testID="orders-resumo">
            {resumo.quantidade} {resumo.orcamentos ? (resumo.quantidade === 1 ? 'orçamento' : 'orçamentos') : resumo.quantidade === 1 ? 'pedido' : 'pedidos'} · {formatBRL0(resumo.total_cents)}
          </Text>
          {parcial ? (
            <Text style={t.small} testID="orders-parcial">
              Só os últimos 90 dias do aparelho
            </Text>
          ) : null}
          {queued > 0 ? (
            <Banner testID="orders-queue-banner">
              <Strong>{queued === 1 ? '1 pedido na fila do aparelho.' : `${queued} pedidos na fila do aparelho.`}</Strong> {offline ? 'Envio automático quando o sinal voltar.' : 'Enviando automaticamente…'}
            </Banner>
          ) : null}
        </>
      )}

      <Card style={{ overflow: 'hidden' }}>
        {visiveis.length === 0 ? <Empty text={vazio} /> : null}
        {visiveis.map((i, k) => (
          <OrderRow key={i.id} o={itens.find((x) => x.id === i.id)!.pedido} razao={i.razao_social} busca={busca} last={k === visiveis.length - 1} tz={tz} mostrarVendedor={gestao} />
        ))}
      </Card>
      {!offline ? <Text style={[t.small, { textAlign: 'center' }]}>Puxe para sincronizar</Text> : null}
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

/** Texto com o trecho achado em destaque (sem acento e sem maiúscula). */
function Destacado({ texto, busca, style }: { texto: string; busca: string; style?: object }) {
  return (
    <Text style={style} numberOfLines={1}>
      {destacarTrecho(texto, busca).map((p, i) => (
        <Text key={i} style={p.destaque ? styles.destaque : undefined}>
          {p.texto}
        </Text>
      ))}
    </Text>
  );
}

function OrderRow({ o, razao, busca, last, tz, mostrarVendedor }: { o: PedidoDaLista; razao: string; busca: string; last: boolean; tz: string; mostrarVendedor: boolean }) {
  const b = statusBadge(o.status);
  const note = orderNote(o);
  const buscando = normalizarTexto(busca) !== '';
  // T-0053: orçamento mostra a situação (offline, pela validade; RN-VEN-32)
  const rotuloOrc = o.tipo === 'orcamento' ? rotuloDoDocumento(o, relogioReal().agora()) : null;
  return (
    <Pressable
      testID={`order-${o.number || o.id}`}
      accessibilityRole="button"
      onPress={() => irParaPedido(o.id)}
      style={({ pressed }) => [styles.row, !last && styles.divider, pressed && { backgroundColor: colors.ground }]}>
      <View style={styles.line}>
        <Destacado texto={o.customer_name || 'Pedido no aparelho'} busca={busca} style={[t.bodyStrong, { flex: 1 }]} />
        <Text style={[t.bodyStrong, { fontVariant: ['tabular-nums'] }, o.status === 'cancelled' && styles.cancelledTotal]}>{formatBRL(o.total_cents)}</Text>
      </View>
      {buscando && razao && casaComBusca({ numero: '', nome_fantasia: '', razao_social: razao }, busca) ? <Destacado texto={razao} busca={busca} style={t.small} /> : null}
      <View style={styles.line}>
        <Text style={[t.small, { flex: 1 }]} numberOfLines={1}>
          <Text style={{ fontFamily: fonts.mono }}>{o.number || 'no aparelho'}</Text> · {mostrarVendedor && o.seller_name ? `${o.seller_name} · ` : ''}{relativeWhen(o.received_at, new Date(), tz)} · {o.items_count} {o.items_count === 1 ? 'item' : 'itens'}
        </Text>
        {rotuloOrc ? <Badge label={rotuloOrc} tone="neutral" /> : <Badge label={b.label} fg={b.fg} bg={b.bg} />}
      </View>
      {note ? <Text style={[t.small, { color: b.fg }]}>{note}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  linhaBusca: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vendedor: { minHeight: 52, maxWidth: 150, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.lineSoft },
  vendedorAtivo: { borderColor: colors.accent },
  opcao: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14 },
  busca: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingHorizontal: 14, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line },
  buscaTexto: { flex: 1, minHeight: 48, fontSize: 16, color: colors.ink },
  limpar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  destaque: { backgroundColor: colors.accentSoft },
  row: { gap: 3, paddingVertical: 11, paddingHorizontal: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cancelledTotal: { color: colors.ink3, textDecorationLine: 'line-through' },
});
