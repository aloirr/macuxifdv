/**
 * Novo pedido de distribuidora (T-0061), em 3 abas: Itens, Condições e Entrega e resumo, com o total fixo no rodapé.
 * Preço da tabela do cliente, medidas (UN/CX), endereços e transportadoras vêm das linhas locais (funciona sem sinal).
 * Preço, desconto e acréscimo por item e por pedido, desconto efetivo e alçada: domain de preço (`lib/novo-pedido`), a mesma
 * regra que a API revalida. Frete CIF/FOB sem valor (RN-VEN-16); endereço de entrega do cadastro (RN-VEN-17).
 * Modo edição (`editId`): "Editar pedido 10xxx", mesmo cliente; rascunho em `edit:<id>` (preenchido pelo detalhe).
 * Duplicar chega aqui como novo pedido com o rascunho do cliente já preenchido.
 */
import { formatBRL } from '@macuxi/comum';
import { useAmbiente, usePode } from '@macuxi/platform-sdk/react';
import { BackLink, Badge, Banner, Button, Card, colors, Empty, fonts, formatHHMM, Icon, radius, Screen, Strong, type as t } from '@macuxi/ui/mobile';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { OrderDetail } from '../../contracts';
import { AvisoRapido, useAviso } from '../components/aviso';
import { podeEnviarPedido } from '../../domain/quantidade';
import { modalidadePadraoDosParametros } from '../../domain/preco-pedido';
import { AbaCondicoes, AbaEntrega, BarraDeAbas, ListaDeItens, PendenciasDoPedido, type AbaDoPedido } from '../components/novo-pedido';
import { calcularPedido, freteValido, lerChaveDaLinha, limiteDoVendedor, textoDaAlcada, type Ajuste, type CalculoPedido } from '../lib/novo-pedido';
import { filterCustomers, PAYMENT_TERMS, searchProducts } from '../lib/catalog';
import { errorMessage } from '../lib/erros';
import { statusBadge } from '../lib/order-status';
import { draftKeyFor, ligarRascunho, rascunhoVazio, type Rascunho as Draft } from '../lib/pedidos';
import { hrefPedido, hrefPedidos, irParaPedidos } from '../rotas';
import { useVendedor } from '../state/use-vendedor';

export default function NewOrderScreen() {
  const { customerId, editId, visitId, stopId } = useLocalSearchParams<{ customerId?: string; editId?: string; visitId?: string; stopId?: string }>();
  const { carregado, dados } = useVendedor();
  if (!carregado) return <AvisoDaTela texto="Carregando os dados do aparelho…" />;
  if (!dados.me || !dados.politica) return <AvisoDaTela texto="Faltam dados no aparelho. Abra a tela Sincronizar, com sinal, e tente de novo." />;
  if (!customerId) return <CustomerPicker />;
  return <OrderEditor key={`${customerId}:${editId ?? ''}`} customerId={customerId} editId={editId || null} visitId={visitId || null} stopId={stopId || null} />;
}

/** Mensagem dentro de Screen (área segura) e com caminho de volta para Pedidos. */
function AvisoDaTela({ texto }: { texto: string }) {
  return (
    <Screen testID="new-order-aviso">
      <BackLink label="Pedidos" fallback={hrefPedidos()} />
      <Empty text={texto} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------

function CustomerPicker() {
  const { dados } = useVendedor();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const list = useMemo(() => filterCustomers(dados.clientes, q, []).slice(0, 60), [dados.clientes, q]);
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: Math.max(16, insets.top + 4), paddingHorizontal: 20, paddingBottom: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
      <BackLink label="Pedidos" fallback={hrefPedidos()} />
      <Text style={t.h1Small}>Novo pedido</Text>
      <Text style={t.sub}>Para qual cliente?</Text>
      <SearchBox value={q} onChange={setQ} placeholder="Nome, código ou bairro" testID="picker-search" />
      <Card>
        {list.map((c, i) => (
          <Pressable
            key={c.id}
            testID={`pick-${c.trade_name}`}
            accessibilityRole="button"
            onPress={() => router.setParams({ customerId: c.id })}
            style={({ pressed }) => [styles.pickRow, i < list.length - 1 && styles.divider, pressed && { backgroundColor: colors.ground }]}>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={t.bodyStrong} numberOfLines={1}>
                {c.trade_name}
              </Text>
              <Text style={t.small}>
                {[c.city, c.district].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Icon name="chevron" size={16} color={colors.ink3} />
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------

type Sent = { kind: 'sent'; order: OrderDetail; snapshot: Snapshot } | { kind: 'queued'; message: string; snapshot: Snapshot };
interface Snapshot {
  calculo: CalculoPedido;
  nomes: Array<[string, string]>;
  payment_terms: string;
  /** rascunho no momento do envio (o do aparelho é apagado depois de enviar): frete e endereço do resumo */
  rascunho: Draft;
}

function OrderEditor({ customerId, editId, visitId, stopId }: { customerId: string; editId: string | null; visitId: string | null; stopId: string | null }) {
  const app = useVendedor();
  const insets = useSafeAreaInsets();
  const sheets = useAviso();
  const podeEditar = usePode('pedido.editar');
  const { dados, tz, offline, garantirProdutos: ensureProducts, enviarPedido: submitOrder, salvarEdicao: saveOrderEdit, condicoesDe, v1 } = app;
  const draftKey = draftKeyFor(customerId, editId);
  const updateDraft = (_customerId: string, fn: (d: Draft) => Draft) => void app.atualizarRascunho(draftKey, customerId, fn);
  /** pedido em edição (servidor ou fila do aparelho) */
  const editTarget = editId ? (app.pedidos.find((o) => o.id === editId) ?? null) : null;
  const editingServer = Boolean(editTarget && !editTarget.local);
  const condicoes = condicoesDe(customerId);
  const customer = dados.clientes.find((c) => c.id === customerId) ?? null;
  const tableKey = customer?.price_table_id ?? 'default';
  const catalog = useMemo(() => dados.produtos[tableKey]?.items ?? [], [dados.produtos, tableKey]);
  const productsAt = dados.produtos[tableKey]?.synced_at ?? dados.sincronizado_em ?? '';
  const [query, setQuery] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft: Draft = dados.rascunhos[draftKey] ?? rascunhoVazio(customerId);

  // pedido aberto pela ficha do cliente: liga o rascunho à visita e à parada da rota
  useEffect(() => {
    if (!editId && (visitId || stopId)) updateDraft(customerId, (d) => ligarRascunho(d, visitId, stopId));
  }, [visitId, stopId, editId, customerId]);

  useEffect(() => {
    if (customer && catalog.length === 0) void ensureProducts(customer);
  }, [customer, catalog.length, ensureProducts]);

  // RN-VEN-14: prazo entre as condições permitidas ao cliente (API v1); a demonstração usa a lista fixa da Fase M
  const opcoesDePrazo = useMemo(
    () => (v1 ? condicoes.map((c) => ({ id: c.id as string | null, rotulo: c.descricao })) : PAYMENT_TERMS.map((p) => ({ id: null as string | null, rotulo: p as string }))),
    [v1, condicoes],
  );
  useEffect(() => {
    // sem condição escolhida (ou escolhida fora da lista do cliente): usa a padrão, a primeira da lista
    if (!v1 || sent || editId || condicoes.length === 0) return;
    if (draft.condicao_pagamento_id && condicoes.some((c) => c.id === draft.condicao_pagamento_id)) return;
    const padrao = condicoes[0]!;
    updateDraft(customerId, (d) => ({ ...d, payment_terms: padrao.descricao, condicao_pagamento_id: padrao.id }));
  }, [v1, condicoes, draft.condicao_pagamento_id, sent, editId]);

  const ambiente = useAmbiente();
  const fretePadrao = modalidadePadraoDosParametros(ambiente.parametros('vendedor'));
  const [aba, setAba] = useState<AbaDoPedido>('itens');
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  const politica = dados.politica;
  const vendedorId = dados.me?.seller?.id ?? '';
  const calculoAtual = useMemo(
    () =>
      politica
        ? calcularPedido({ lines: draft.lines, ajustes: draft.ajustes ?? {}, desconto_pct: draft.discount_pct, acrescimo_pct: draft.acrescimo_pct ?? 0, catalogo: catalog, unidades: app.unidades, politica, vendedor_id: vendedorId })
        : null,
    [draft.lines, draft.ajustes, draft.discount_pct, draft.acrescimo_pct, catalog, app.unidades, politica, vendedorId],
  );
  const calculo = sent ? sent.snapshot.calculo : calculoAtual;
  const terms = sent ? sent.snapshot.payment_terms : draft.payment_terms;
  const nomes = useMemo(() => new Map<string, string>(sent ? sent.snapshot.nomes : catalog.map((p) => [p.id, p.description] as [string, string])), [sent, catalog]);
  const frete = draft.frete ?? { modalidade: fretePadrao };
  const freteAviso = freteValido(frete);

  if (editId && (!dados.rascunhos[draftKey] || !editTarget)) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 16, paddingHorizontal: 20, gap: 8 }]}>
        <BackLink label="Pedido" fallback={hrefPedido(editId)} />
        <Text style={t.sub}>{editTarget ? 'Edição não iniciada. Volte ao pedido e toque em Editar.' : 'Pedido não encontrado no aparelho.'}</Text>
      </View>
    );
  }

  if (!customer || !calculo || !politica) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 16, paddingHorizontal: 20 }]}>
        <BackLink label="Voltar" fallback="/" />
        <Text style={t.sub}>Cliente não encontrado na carteira sincronizada.</Text>
      </View>
    );
  }

  const setLinhas = (lines: Record<string, number>, ajustes: Record<string, Ajuste>) => {
    setError(null);
    updateDraft(customerId, (d) => ({ ...d, lines, ajustes }));
  };

  const results = query.trim() ? searchProducts(catalog, query, 40) : [];
  const noSignal = offline;
  const limiteVendedor = limiteDoVendedor(politica, vendedorId);
  // edição de pedido já enviado com "modo sem sinal" ligado: precisa de conexão (não enfileira)
  const editBlockedOffline = editingServer && offline;
  const bloqueado = calculo.erros.length > 0 || Boolean(freteAviso);
  const canSend = podeEnviarPedido({ jaEnviado: Boolean(sent), itens: calculo.linhas.length, recusado: bloqueado, edicaoSemSinal: editBlockedOffline, edicao: Boolean(editId), podeEditar });
  const alcada = textoDaAlcada(calculo, limiteVendedor);
  const alcadaCor = alcada.tom === 'erro' ? colors.danger : alcada.tom === 'aviso' ? colors.accentInk : alcada.tom === 'ok' ? colors.success : colors.ink2;
  const vaiParaAprovacao = calculo.nivel !== null;
  const produtosDoRascunho = [...new Set(Object.keys(draft.lines).filter((k) => (draft.lines[k] ?? 0) > 0).map((k) => lerChaveDaLinha(k).product_id))].flatMap((id) => {
    const p = byId.get(id);
    return p ? [p] : [];
  });

  const saveEdit = async () => {
    if (!editId || !podeEditar) return;
    setSending(true);
    setError(null);
    try {
      const res = await saveOrderEdit(editId, draft, customer, catalog);
      if (res.kind === 'server') {
        const b = statusBadge(res.order.status);
        sheets.mostrar(`Pedido ${res.order.number} atualizado · ${b.label}.`);
      } else {
        sheets.mostrar(offline ? 'Pedido da fila atualizado no aparelho. Será enviado quando o sinal voltar.' : 'Pedido da fila atualizado.');
      }
      if (router.canGoBack()) router.back();
      else router.replace(hrefPedido(editId) as never);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    setSending(true);
    setError(null);
    const snapshot: Snapshot = { calculo, nomes: [...nomes.entries()], payment_terms: draft.payment_terms, rascunho: draft };
    try {
      const res = await submitOrder(draft, customer, catalog);
      setSent(res.kind === 'sent' ? { kind: 'sent', order: res.order, snapshot } : { kind: 'queued', message: res.message, snapshot });
      setQuery('');
      setAba('entrega');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const orcamento = draft.tipo === 'orcamento';
  let buttonLabel = orcamento ? 'Salvar orçamento' : vaiParaAprovacao ? 'Enviar para aprovação' : 'Enviar pedido';
  let buttonVariant: 'accent' | 'success' = 'accent';
  if (sent?.kind === 'queued') {
    buttonLabel = 'Salvo · aguardando sinal';
    buttonVariant = 'success';
  } else if (sent?.kind === 'sent') {
    buttonLabel = `Enviado · pedido ${sent.order.number}`;
    buttonVariant = 'success';
  } else if (noSignal && calculo.linhas.length > 0) {
    buttonLabel = 'Salvar no aparelho';
  }
  if (editId) {
    buttonLabel = editBlockedOffline
      ? 'Sem sinal · edição precisa de conexão'
      : !editingServer
        ? 'Salvar alterações no aparelho'
        : vaiParaAprovacao
          ? 'Salvar e enviar para aprovação'
          : 'Salvar alterações';
  }
  const editTitle = editTarget?.number ? `Editar pedido ${editTarget.number}` : 'Editar pedido no aparelho';
  const emRascunho = (fn: (r: Draft) => Draft) => updateDraft(customerId, fn);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: Math.max(16, insets.top + 4), paddingHorizontal: 20, paddingBottom: 8, gap: 2, backgroundColor: colors.surface }}>
        <AvisoRapido mensagem={sheets.aviso} />
        {editId ? <BackLink label="Pedido" fallback={hrefPedido(editId)} /> : <BackLink label={customer.trade_name} fallback={hrefPedidos()} />}
        <Text style={t.h1Small} testID="order-editor-title">
          {editId ? editTitle : 'Novo pedido'}
        </Text>
        <Text style={t.sub} numberOfLines={1}>
          {customer.trade_name}
          {editId ? ' · cliente não pode ser trocado' : ''}
        </Text>
      </View>
      {!sent ? <BarraDeAbas aba={aba} onAba={setAba} itens={calculo.linhas.length} pendencias={{ condicoes: Boolean(freteAviso) }} /> : null}

      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 20, paddingBottom: 16, gap: 12 }} keyboardShouldPersistTaps="handled" testID="new-order">
        {draft.notice && !sent ? (
          <Banner icon="alert" testID="order-prefill-notice">
            {draft.notice}
          </Banner>
        ) : null}
        {editBlockedOffline ? (
          <Banner tone="danger" testID="banner-edit-offline">
            <Strong>Modo sem sinal.</Strong> A edição de pedido já enviado precisa de conexão. Desligue o modo sem sinal no Perfil para salvar.
          </Banner>
        ) : null}

        {sent?.kind === 'queued' ? (
          <Banner testID="banner-saved">
            <Strong>Pedido salvo no aparelho.</Strong> Será enviado ao ERP assim que o sinal voltar.
          </Banner>
        ) : sent?.kind === 'sent' ? (
          <SentCard order={sent.order} />
        ) : noSignal && !editBlockedOffline ? (
          <Banner testID="banner-offline">
            <Strong>Sem conexão.</Strong> Preço e estoque da sincronização das {formatHHMM(productsAt, tz)}. Você pode fechar o pedido normalmente.
          </Banner>
        ) : null}

        {!sent && aba === 'itens' ? (
          <>
            <View style={{ gap: 4 }}>
              <Text style={t.label}>Buscar produto</Text>
              <SearchBox value={query} onChange={setQuery} placeholder="Código, descrição ou veículo" testID="product-search" />
            </View>
            {query.trim() ? (
              <View style={{ gap: 6 }}>
                <Text style={t.small}>
                  {results.length === 0 ? 'Nenhum produto encontrado.' : `${results.length}${results.length === 40 ? '+' : ''} produto${results.length === 1 ? '' : 's'} · preço da tabela do cliente`}
                </Text>
                {results.length > 0 ? <ListaDeItens produtos={results} rascunho={draft} unidades={app.unidades} calculo={calculo} onLinhas={setLinhas} /> : null}
              </View>
            ) : produtosDoRascunho.length > 0 ? (
              <View testID="order-lines">
                <ListaDeItens produtos={produtosDoRascunho} rascunho={draft} unidades={app.unidades} calculo={calculo} onLinhas={setLinhas} />
              </View>
            ) : (
              <Card style={{ padding: 16, gap: 4 }}>
                <Text style={t.bodyStrong}>Nenhum item ainda</Text>
                <Text style={t.small}>{catalog.length > 0 ? `Busque entre ${catalog.length} produtos da tabela do cliente.` : 'Sincronize com sinal para baixar a tabela de preços.'}</Text>
              </Card>
            )}
          </>
        ) : null}

        {!sent && aba === 'condicoes' ? (
          <AbaCondicoes
            rascunho={draft}
            prazos={opcoesDePrazo}
            transportadoras={app.transportadoras}
            calculo={calculo}
            limiteVendedor={limiteVendedor}
            preVendaLigada={app.preVendaLigada}
            edicao={Boolean(editId)}
            onRascunho={emRascunho}
            fretePadrao={fretePadrao}
          />
        ) : null}

        {(sent || aba === 'entrega') ? (
          <AbaEntrega rascunho={sent ? sent.snapshot.rascunho : draft} clienteId={customerId} enderecos={app.enderecos} transportadoras={app.transportadoras} calculo={calculo} limiteVendedor={limiteVendedor} fretePadrao={fretePadrao} prazo={terms} onRascunho={emRascunho} somenteLeitura={Boolean(sent)} nomes={nomes} />
        ) : null}

        {!sent ? <PendenciasDoPedido erros={calculo.erros} freteAviso={freteAviso} onIrPara={setAba} /> : null}
        {error ? (
          <Banner icon="alert" tone="danger" testID="order-error">
            {error}
          </Banner>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 22 + insets.bottom }]} testID="rodape-pedido">
        <View style={{ gap: 4 }}>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Subtotal · {calculo.unidades_base} un.</Text>
            <Text style={styles.sumValue}>{formatBRL(calculo.total_tabela_cents)}</Text>
          </View>
          {calculo.desconto_efetivo_pct !== 0 ? (
            <View style={styles.sumRow}>
              <Text style={[styles.sumLabel, { color: alcadaCor, fontFamily: fonts.semibold, flex: 1 }]} testID="alcada-line">
                {alcada.texto}
              </Text>
              <Text style={[styles.sumValue, { color: alcadaCor }]}>{calculo.total_cents <= calculo.total_tabela_cents ? `− ${formatBRL(calculo.total_tabela_cents - calculo.total_cents)}` : `+ ${formatBRL(calculo.total_cents - calculo.total_tabela_cents)}`}</Text>
            </View>
          ) : null}
          <View style={[styles.sumRow, { alignItems: 'baseline', marginTop: 2 }]}>
            <Text style={[styles.sumLabel, { color: colors.ink, fontFamily: fonts.semibold }]}>Total · prazo {terms}</Text>
            <Text style={styles.total} testID="order-total">
              {formatBRL(calculo.total_cents)}
            </Text>
          </View>
        </View>
        <Button
          testID="send-order"
          label={buttonLabel}
          variant={buttonVariant}
          height={52}
          textStyle={{ fontSize: 16 }}
          loading={sending}
          disabled={!sent && !canSend}
          onPress={() => {
            if (sent) irParaPedidos();
            else if (editId) void saveEdit();
            else void send();
          }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function SentCard({ order }: { order: OrderDetail }) {
  const b = statusBadge(order.status);
  const note = order.status === 'pending_approval' ? order.pending_reason : order.status === 'rejected' ? order.rejection_reason : order.status === 'approved' ? 'Dentro da alçada: aprovado na hora.' : 'Recebido pelo servidor.';
  return (
    <View style={styles.sent} testID="sent-card">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Icon name="check" size={18} color={colors.success} strokeWidth={2.4} />
        <Text style={[t.bodyStrong, { color: colors.success }]}>Pedido {order.number} recebido</Text>
        <Badge label={b.label} fg={b.fg} bg={b.bg} />
      </View>
      {note ? <Text style={[t.small, { color: colors.ink }]}>{note}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="Ver pedido" variant="outline" style={{ flex: 1 }} onPress={() => router.navigate(hrefPedido(order.id) as never)} />
        <Button label="Voltar" variant="outline" style={{ flex: 1 }} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
    </View>
  );
}

function SearchBox({ value, onChange, placeholder, testID }: { value: string; onChange: (v: string) => void; placeholder: string; testID?: string }) {
  return (
    <View style={styles.search}>
      <Icon name="search" size={18} color={colors.ink2} />
      <TextInput testID={testID} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.ink3} style={styles.searchInput} autoCorrect={false} returnKeyType="search" accessibilityLabel={placeholder} />
      {value ? (
        <Pressable accessibilityLabel="Limpar busca" onPress={() => onChange('')} hitSlop={12}>
          <Icon name="close" size={16} color={colors.ink2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, minHeight: 56 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md },
  searchInput: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 15, color: colors.ink, height: 44 },
  prod: { gap: 6, paddingVertical: 12, paddingHorizontal: 14 },
  qtyBtn: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  qty: { width: 44, height: 48, textAlign: 'center', fontFamily: fonts.bold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'], padding: 0 },
  step: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pctBox: { flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  pctInput: { flex: 1, minWidth: 0, height: 42, textAlign: 'right', fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, padding: 0 },
  pctSuffix: { flex: 1, fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink2, marginLeft: 2 },
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segItem: { flexGrow: 1, minWidth: 72, paddingHorizontal: 10, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  sent: { backgroundColor: colors.successBg, borderRadius: radius.lg, padding: 12, gap: 8 },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14, paddingHorizontal: 20, gap: 10 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  sumLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.ink2 },
  sumValue: { fontFamily: fonts.body, fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] },
  total: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, fontVariant: ['tabular-nums'] },
});
