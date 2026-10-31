/**
 * Novo pedido (Pedido.dc.html), em tela cheia sem abas.
 * Preço da tabela do cliente e estoque vêm do cache local (funciona sem sinal).
 * Alçada, crédito e totais calculados no aparelho com @fv/domain (validateOrder/computeOrderTotals).
 * Modo edição (`editId`): "Editar pedido 10xxx", mesmo cliente; rascunho em `edit:<id>` (preenchido pelo detalhe).
 * Duplicar chega aqui como novo pedido com o rascunho do cliente já preenchido.
 */
import { formatBRL, formatBRL0, formatPct } from '@macuxi/comum';
import { usePode } from '@macuxi/platform-sdk/react';
import { BackLink, Badge, Banner, Button, Card, colors, Empty, fonts, formatHHMM, Icon, radius, Strong, type as t } from '@macuxi/ui/mobile';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { OrderDetail, Product } from '../../contracts';
import { AvisoRapido, useAviso } from '../components/aviso';
import { validateOrder } from '../../domain/order';
import { CREDIT_OPEN_STATUSES, creditInput, filterCustomers, parsePct, PAYMENT_TERMS, searchProducts, stockInfo, toDomainPolicy } from '../lib/catalog';
import { errorMessage } from '../lib/erros';
import { statusBadge } from '../lib/order-status';
import { draftKeyFor, rascunhoVazio, type Rascunho as Draft } from '../lib/pedidos';
import { hrefPedido, hrefPedidos, irParaPedidos } from '../rotas';
import { useVendedor } from '../state/use-vendedor';

export default function NewOrderScreen() {
  const { customerId, editId } = useLocalSearchParams<{ customerId?: string; editId?: string }>();
  const { carregado, dados } = useVendedor();
  if (!carregado) return <Empty text="Carregando os dados do aparelho…" />;
  if (!dados.me || !dados.politica) return <Empty text="Faltam dados no aparelho. Abra a tela Sincronizar, com sinal, e tente de novo." />;
  if (!customerId) return <CustomerPicker />;
  return <OrderEditor key={`${customerId}:${editId ?? ''}`} customerId={customerId} editId={editId || null} />;
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
                Curva {c.abc_curve} · {c.district} · limite {formatBRL0(c.available_credit_cents)}
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
  lines: Array<{ product: Product; qty: number }>;
  discount_pct: number;
  payment_terms: string;
}

function OrderEditor({ customerId, editId }: { customerId: string; editId: string | null }) {
  const app = useVendedor();
  const insets = useSafeAreaInsets();
  const sheets = useAviso();
  const podeEditar = usePode('pedido.editar');
  const { dados, tz, offline, garantirProdutos: ensureProducts, enviarPedido: submitOrder, salvarEdicao: saveOrderEdit } = app;
  const draftKey = draftKeyFor(customerId, editId);
  const updateDraft = (_customerId: string, fn: (d: Draft) => Draft) => void app.atualizarRascunho(draftKey, customerId, fn);
  /** pedido em edição (servidor ou fila do aparelho) */
  const editTarget = editId ? (app.pedidos.find((o) => o.id === editId) ?? null) : null;
  const editingServer = Boolean(editTarget && !editTarget.local);
  const customer = dados.clientes.find((c) => c.id === customerId) ?? null;
  const tableKey = customer?.price_table_id ?? 'default';
  const catalog = useMemo(() => dados.produtos[tableKey]?.items ?? [], [dados.produtos, tableKey]);
  const productsAt = dados.produtos[tableKey]?.synced_at ?? dados.sincronizado_em ?? '';
  const [query, setQuery] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft: Draft = dados.rascunhos[draftKey] ?? rascunhoVazio(customerId);
  const [discountText, setDiscountText] = useState(fmtPctInput(draft.discount_pct));

  useEffect(() => {
    if (customer && catalog.length === 0) void ensureProducts(customer);
  }, [customer, catalog.length, ensureProducts]);

  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  const snapshotLines = sent ? sent.snapshot.lines : null;
  const lines = snapshotLines ?? Object.entries(draft.lines).flatMap(([pid, qty]) => {
    const product = byId.get(pid);
    return product ? [{ product, qty }] : [];
  });
  const discountPct = sent ? sent.snapshot.discount_pct : draft.discount_pct;
  const terms = sent ? sent.snapshot.payment_terms : draft.payment_terms;

  const politica = dados.politica;
  const queuedCents = app.fila
    .filter((o) => o.payload.customer_id === customerId && o.payload.id !== editId)
    .reduce((s, o) => s + (o.display?.total_cents ?? 0), 0);
  // edição de pedido já no servidor: o valor antigo dele deixa de consumir o limite do cliente
  const releaseCents = editTarget && editingServer && CREDIT_OPEN_STATUSES.has(editTarget.status) ? editTarget.total_cents : 0;
  const v = customer && politica && dados.me?.seller
    ? validarSemLancar({
        sellerId: dados.me.seller.id,
        discountPct,
        lines: lines.map((l) => ({ product_id: l.product.id, quantity: l.qty, unit_price_cents: l.product.price_cents })),
        politica,
        cliente: customer,
        fila: sent ? 0 : queuedCents,
        liberar: releaseCents,
      })
    : null;

  if (editId && (!dados.rascunhos[draftKey] || !editTarget)) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 16, paddingHorizontal: 20, gap: 8 }]}>
        <BackLink label="Pedido" fallback={hrefPedido(editId)} />
        <Text style={t.sub}>{editTarget ? 'Edição não iniciada. Volte ao pedido e toque em Editar.' : 'Pedido não encontrado no aparelho.'}</Text>
      </View>
    );
  }

  if (!customer || !v) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 16, paddingHorizontal: 20 }]}>
        <BackLink label="Voltar" fallback="/" />
        <Text style={t.sub}>Cliente não encontrado na carteira sincronizada.</Text>
      </View>
    );
  }

  const setQty = (p: Product, qty: number) => {
    const max = Math.max(0, p.stock_total);
    const q = Math.max(0, Math.min(max, Math.trunc(qty)));
    setError(null);
    updateDraft(customerId, (d) => ({ ...d, lines: { ...d.lines, [p.id]: q } }));
  };
  const setDiscount = (pct: number) => {
    const clean = Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
    setDiscountText(fmtPctInput(clean));
    updateDraft(customerId, (d) => ({ ...d, discount_pct: clean }));
  };

  const results = query.trim() ? searchProducts(catalog, query, 40) : [];
  const noSignal = offline;
  const d = v.discount;
  const blocking = v.issues.filter((i) => i.blocking && i.code !== 'empty_order');
  const creditIssue = v.issues.find((i) => i.code === 'credit_exceeded' || i.code === 'overdue_receivables');
  // edição de pedido já enviado com "modo sem sinal" ligado: precisa de conexão (não enfileira)
  const editBlockedOffline = editingServer && offline;
  const canSend = !sent && v.totals.lines.length > 0 && v.outcome !== 'rejected' && !editBlockedOffline && (!editId || podeEditar);

  const discountLine =
    discountPct <= 0
      ? { text: 'Sem desconto', color: colors.ink2 }
      : d.level === 'within'
        ? { text: `Desconto ${formatPct(discountPct)} · dentro da sua alçada`, color: colors.success }
        : d.level === 'needs_approval'
          ? { text: `Desconto ${formatPct(discountPct)} · acima da sua alçada (${formatPct(d.limit_pct)}) · vai para aprovação do gestor`, color: colors.accentInk }
          : { text: `Desconto ${formatPct(discountPct)} · acima da alçada máxima (${formatPct(politica?.manager_pct ?? 0)}) · reduza para enviar`, color: colors.danger };

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
    const snapshot: Snapshot = { lines: lines.filter((l) => l.qty > 0), discount_pct: draft.discount_pct, payment_terms: draft.payment_terms };
    try {
      const res = await submitOrder(draft, customer, catalog);
      setSent(res.kind === 'sent' ? { kind: 'sent', order: res.order, snapshot } : { kind: 'queued', message: res.message, snapshot });
      setQuery('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  let buttonLabel = v.outcome === 'pending_approval' ? 'Enviar para aprovação' : 'Enviar pedido';
  let buttonVariant: 'accent' | 'success' = 'accent';
  if (sent?.kind === 'queued') {
    buttonLabel = 'Salvo · aguardando sinal';
    buttonVariant = 'success';
  } else if (sent?.kind === 'sent') {
    buttonLabel = `Enviado · pedido ${sent.order.number}`;
    buttonVariant = 'success';
  } else if (noSignal && v.totals.lines.length > 0) {
    buttonLabel = 'Salvar no aparelho';
  }
  if (editId) {
    buttonLabel = editBlockedOffline
      ? 'Sem sinal · edição precisa de conexão'
      : !editingServer
        ? 'Salvar alterações no aparelho'
        : v.outcome === 'pending_approval'
          ? 'Salvar e enviar para aprovação'
          : 'Salvar alterações';
  }
  const editTitle = editTarget?.number ? `Editar pedido ${editTarget.number}` : 'Editar pedido no aparelho';

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingTop: Math.max(16, insets.top + 4), paddingHorizontal: 20, paddingBottom: 16, gap: 12 }} keyboardShouldPersistTaps="handled" testID="new-order">
        <AvisoRapido mensagem={sheets.aviso} />
        {editId ? <BackLink label="Pedido" fallback={hrefPedido(editId)} /> : <BackLink label={customer.trade_name} fallback={`/customer/${customer.id}`} />}
        <View style={{ gap: 2 }}>
          <Text style={t.h1Small} testID="order-editor-title">
            {editId ? editTitle : 'Novo pedido'}
          </Text>
          {editId ? <Text style={t.sub}>{customer.trade_name} · cliente não pode ser trocado</Text> : null}
        </View>

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

        {!sent ? (
          <View style={{ gap: 4 }}>
            <Text style={t.label}>Buscar produto</Text>
            <SearchBox value={query} onChange={setQuery} placeholder="Código, descrição ou veículo" testID="product-search" />
          </View>
        ) : null}

        {query.trim() ? (
          <View style={{ gap: 6 }}>
            <Text style={t.small}>
              {results.length === 0 ? 'Nenhum produto encontrado.' : `${results.length}${results.length === 40 ? '+' : ''} produto${results.length === 1 ? '' : 's'} · preço da tabela do cliente`}
            </Text>
            {results.length > 0 ? (
              <Card>
                {results.map((p, i) => (
                  <ProductRow key={p.id} p={p} qty={draft.lines[p.id] ?? 0} last={i === results.length - 1} onQty={(q) => setQty(p, q)} />
                ))}
              </Card>
            ) : null}
          </View>
        ) : (
          <>
            {lines.length > 0 ? (
              <Card testID="order-lines">
                {lines.map((l, i) => (
                  <ProductRow key={l.product.id} p={l.product} qty={l.qty} last={i === lines.length - 1} onQty={(q) => setQty(l.product, q)} readOnly={Boolean(sent)} />
                ))}
              </Card>
            ) : (
              <Card style={{ padding: 16, gap: 4 }}>
                <Text style={t.bodyStrong}>Nenhum item ainda</Text>
                <Text style={t.small}>{catalog.length > 0 ? `Busque entre ${catalog.length} produtos da tabela do cliente.` : 'Sincronize com sinal para baixar a tabela de preços.'}</Text>
              </Card>
            )}

            {!sent ? (
              <Card style={{ padding: 14, gap: 14 }} testID="order-conditions">
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Text style={t.label}>Desconto</Text>
                    <Text style={t.small}>Sua alçada: {formatPct(d.limit_pct)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <StepButton icon="minus" label="Diminuir desconto" onPress={() => setDiscount(draft.discount_pct - 0.5)} />
                    <View style={styles.pctBox}>
                      <TextInput
                        testID="discount-input"
                        value={discountText}
                        onChangeText={setDiscountText}
                        onBlur={() => setDiscount(parsePct(discountText))}
                        onSubmitEditing={() => setDiscount(parsePct(discountText))}
                        keyboardType="decimal-pad"
                        accessibilityLabel="Desconto em porcentagem"
                        style={styles.pctInput}
                        selectTextOnFocus
                      />
                      <Text style={styles.pctSuffix}>%</Text>
                    </View>
                    <StepButton icon="plus" label="Aumentar desconto" onPress={() => setDiscount(draft.discount_pct + 0.5)} />
                  </View>
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={t.label}>Prazo</Text>
                  <View style={styles.segment}>
                    {PAYMENT_TERMS.map((term) => {
                      const on = draft.payment_terms === term;
                      return (
                        <Pressable
                          key={term}
                          testID={`terms-${term}`}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on }}
                          onPress={() => updateDraft(customerId, (dr) => ({ ...dr, payment_terms: term }))}
                          style={[styles.segItem, on && styles.segOn]}>
                          <Text style={[styles.segText, on && { color: '#FFFFFF' }]}>{term}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Text style={t.label}>Crédito disponível</Text>
                  <Text style={[t.bodyStrong, { color: v.available_credit_cents <= 0 ? colors.danger : colors.ink }]}>{formatBRL(v.available_credit_cents)}</Text>
                </View>
                {creditIssue ? <Text style={[t.small, { color: colors.accentInk }]}>{creditIssue.message}</Text> : null}
                {blocking.map((i) => (
                  <Text key={i.code} style={[t.small, { color: colors.danger }]}>
                    {i.message}
                  </Text>
                ))}
              </Card>
            ) : null}
          </>
        )}

        {error ? (
          <Banner icon="alert" tone="danger" testID="order-error">
            {error}
          </Banner>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 22 + insets.bottom }]}>
        <View style={{ gap: 4 }}>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Subtotal · {v.totals.units} un.</Text>
            <Text style={styles.sumValue}>{formatBRL(v.totals.subtotal_cents)}</Text>
          </View>
          <View style={styles.sumRow}>
            <Text style={[styles.sumLabel, { color: discountLine.color, fontFamily: fonts.semibold, flex: 1 }]} testID="discount-line">
              {discountLine.text}
            </Text>
            <Text style={[styles.sumValue, { color: discountLine.color }]}>− {formatBRL(v.totals.discount_cents)}</Text>
          </View>
          <View style={[styles.sumRow, { alignItems: 'baseline', marginTop: 2 }]}>
            <Text style={[styles.sumLabel, { color: colors.ink, fontFamily: fonts.semibold }]}>Total · prazo {terms}</Text>
            <Text style={styles.total} testID="order-total">
              {formatBRL(v.totals.total_cents)}
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
  const note = order.status === 'pending_approval' ? order.pending_reason : order.status === 'rejected' ? order.rejection_reason : 'Seguiu direto para o ERP.';
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
        <Button label="Voltar ao cliente" variant="outline" style={{ flex: 1 }} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
    </View>
  );
}

function ProductRow({ p, qty, last, onQty, readOnly }: { p: Product; qty: number; last: boolean; onQty: (q: number) => void; readOnly?: boolean }) {
  const s = stockInfo(p);
  const [text, setText] = useState(String(qty));
  useEffect(() => setText(String(qty)), [qty]);
  const stockColor = s.tone === 'ok' ? colors.success : s.tone === 'low' ? colors.accentInk : colors.danger;
  const noPrice = p.price_cents === null;
  return (
    <View style={[styles.prod, !last && styles.divider]} testID={`product-${p.erp_code}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text style={t.mono}>{p.erp_code}</Text>
          <Text style={t.bodyStrong}>{p.description}</Text>
          <Text style={t.small}>{p.applications}</Text>
        </View>
        <Text style={[t.bodyStrong, { fontVariant: ['tabular-nums'] }]}>{noPrice ? 'Sem preço' : formatBRL(p.price_cents ?? 0)}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={[t.smallStrong, { color: stockColor }]}>{s.text}</Text>
          {p.is_campaign ? <Badge label="Campanha" tone="accent" /> : null}
        </View>
        {readOnly ? (
          <Text style={[t.bodyStrong, { fontFamily: fonts.bold }]}>{qty} un.</Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <QtyButton icon="minus" label={`Diminuir ${p.description}`} disabled={qty <= 0} onPress={() => onQty(qty - 1)} testID={`dec-${p.erp_code}`} />
            <TextInput
              testID={`qty-${p.erp_code}`}
              value={text}
              onChangeText={(v) => setText(v.replace(/\D/g, ''))}
              onBlur={() => onQty(Number(text || 0))}
              onSubmitEditing={() => onQty(Number(text || 0))}
              keyboardType="number-pad"
              selectTextOnFocus
              accessibilityLabel={`Quantidade de ${p.description}`}
              style={styles.qty}
            />
            <QtyButton icon="plus" label={`Aumentar ${p.description}`} disabled={noPrice || qty >= p.stock_total} onPress={() => onQty(qty + 1)} testID={`inc-${p.erp_code}`} />
          </View>
        )}
      </View>
    </View>
  );
}

function QtyButton({ icon, label, onPress, disabled, testID }: { icon: 'plus' | 'minus'; label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.qtyBtn, disabled && { opacity: 0.4 }, pressed && { opacity: 0.6 }]} hitSlop={{ top: 4, bottom: 4 }}>
      <Icon name={icon} size={16} color={colors.ink} strokeWidth={2.2} />
    </Pressable>
  );
}

function StepButton({ icon, label, onPress }: { icon: 'plus' | 'minus'; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.step, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={16} color={colors.ink} strokeWidth={2.2} />
    </Pressable>
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

function fmtPctInput(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, minHeight: 56 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md },
  searchInput: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 15, color: colors.ink, height: 44 },
  prod: { gap: 6, paddingVertical: 12, paddingHorizontal: 14 },
  qtyBtn: { width: 44, height: 36, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  qty: { width: 40, height: 36, textAlign: 'center', fontFamily: fonts.bold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'], padding: 0 },
  step: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pctBox: { flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  pctInput: { flex: 1, minWidth: 0, height: 42, textAlign: 'right', fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, padding: 0 },
  pctSuffix: { flex: 1, fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink2, marginLeft: 2 },
  segment: { flexDirection: 'row', gap: 6 },
  segItem: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  sent: { backgroundColor: colors.successBg, borderRadius: radius.lg, padding: 12, gap: 8 },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14, paddingHorizontal: 20, gap: 10 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  sumLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.ink2 },
  sumValue: { fontFamily: fonts.body, fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] },
  total: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, fontVariant: ['tabular-nums'] },
});

/** Mesma validação do servidor, sem lançar: a tela mostra os avisos e bloqueia o envio quando recusado. */
function validarSemLancar(a: {
  sellerId: string;
  discountPct: number;
  lines: Array<{ product_id: string; quantity: number; unit_price_cents: number | null }>;
  politica: import('../../contracts').DiscountPolicy;
  cliente: import('@macuxi/core/contracts').CustomerSummary;
  fila: number;
  liberar: number;
}) {
  return validateOrder({
    seller_id: a.sellerId,
    discount_pct: a.discountPct,
    lines: a.lines,
    policy: toDomainPolicy(a.politica),
    credit: creditInput(a.cliente, a.fila, a.liberar),
  });
}
