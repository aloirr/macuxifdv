/**
 * Detalhe do pedido: itens, histórico de status e ações (duplicar, editar, excluir, exportar PDF).
 * Pedido da fila mostra o que está no aparelho. Editar/excluir seguem orderActions (domain do Vendedor):
 * só enquanto o pedido não está no ERP, e só com a permissão por ação do manifesto (ADR 0004).
 */
import { formatBRL, formatPct, formatarDocumento } from '@macuxi/comum';
import { useAmbiente, usePode } from '@macuxi/platform-sdk/react';
import { BackLink, Badge, Banner, Button, Card, colors, dateTimeLabel, fonts, Icon, SectionHeader, type as t } from '@macuxi/ui/mobile';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { OrderEvent } from '../../contracts';
import { sellerDiscountLimit } from '../../domain/order';
import { textoItemFaturado } from '../../domain/retorno-erp';
import { AvisoRapido, useAviso } from '../components/aviso';
import { DecisionSheet, DeleteOrderSheet, PdfSheet } from '../components/order-sheets';
import { estadoDasAcoes, rotuloDoNivel, TEXTO_SEM_ITENS } from '../lib/acoes-pedido';
import { toDomainPolicy } from '../lib/catalog';
import { buildOrderPdfHtml, nomeDaDistribuidora, orderPdfFileName, pdfDoPedido, textoFrete, type OrderPdfOrder, type OrderPdfView } from '../lib/order-pdf';
import { errorMessage } from '../lib/erros';
import { rotuloDoFrete, textoDoEndereco } from '../lib/novo-pedido';
import { pedidoSomenteLeitura } from '../lib/somente-leitura';
import { orderNote, statusBadge } from '../lib/order-status';
import { exportPdf } from '../lib/pdf-export';
import { relogioReal } from '@macuxi/comum/relogio';
import { acoesNaTela, rotuloDoDocumento } from '../lib/pre-venda';
import { hrefPedidos, irParaNovoPedido, irParaPedido, irParaPedidos } from '../rotas';
import { useVendedor } from '../state/use-vendedor';

interface Line {
  key: string;
  erp_code: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  /** T-0054: unidades faturadas pelo ERP, na unidade base (ausente = sem retorno de faturamento) */
  quantity_invoiced?: number;
  /** quantidade na unidade base (0013), para comparar com o faturado */
  quantity_base?: number;
  /** T-0061: medida vendida ("UN", "CX c/ 12") e desconto/acréscimo do item */
  unit_label?: string;
  discount_pct?: number;
  surcharge_pct?: number;
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useVendedor();
  const ambiente = useAmbiente();
  const { dados, pedidos: orders, fila, tz, offline, carregarPedido: loadOrder, reenviarFila, enviando: flushing, perfil, v1 } = app;
  const podeAprovar = usePode('pedido.aprovar');
  const sheets = useAviso();
  const podeEditar = usePode('pedido.editar');
  const podeCancelar = usePode('pedido.cancelar');
  const podeCriar = usePode('pedido.criar');
  const somenteLeitura = pedidoSomenteLeitura({ criar: podeCriar, editar: podeEditar, cancelar: podeCancelar });
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<'duplicate' | 'edit' | 'convert' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'delete' | 'pdf' | 'approve' | 'reject' | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<OrderPdfView | null>(null);
  const detail = app.detalhe(id ?? '');
  const summary = orders.find((o) => o.id === id) ?? null;
  const queued = fila.find((o) => o.payload.id === id) ?? null;
  const qd = queued?.display ?? null;

  const isQueued = Boolean(queued);
  // RN-CORE-23 (T-0054): ao focar, só relê o aparelho; sem consulta periódica (o pull é do motor de sync da plataforma)
  useFocusEffect(
    useCallback(() => {
      if (isQueued || !id) return;
      void loadOrder(id);
    }, [id, loadOrder, isQueued]),
  );
  const [sincronizandoTela, setSincronizandoTela] = useState(false);
  /** RN-CORE-23: puxar para baixo = Sincronizar. */
  const puxarParaSincronizar = useCallback(() => {
    setSincronizandoTela(true);
    void app.sincronizarAgora().finally(() => setSincronizandoTela(false));
  }, [app]);

  const base = detail ?? summary;
  if (!base && !queued) {
    return (
      <View style={[styles.root, { paddingTop: Math.max(16, insets.top + 4), paddingHorizontal: 20 }]}>
        <BackLink label="Pedidos" fallback={hrefPedidos()} />
        <Text style={t.sub}>{offline ? 'Pedido fora do cache do aparelho.' : 'Carregando…'}</Text>
      </View>
    );
  }

  const status = queued ? 'queued' : (detail?.status ?? summary?.status ?? 'received');
  const b = statusBadge(status);
  const sellerNameHeader = queued ? (ambiente.usuario()?.nome ?? '') : (base?.seller_name ?? '');
  const customerName = queued ? (qd?.customer_name ?? '') : base!.customer_name;
  const number = queued ? null : base!.number;
  const lines: Line[] = queued
    ? (qd?.lines ?? []).map((l) => ({ key: l.product_id + (l.unit_label ?? ''), ...l }))
    : (detail?.items ?? []).map((it) => ({ key: it.id, erp_code: it.erp_code, description: it.description, quantity: it.quantity, unit_price_cents: it.unit_price_cents, total_cents: it.total_cents, quantity_invoiced: it.quantity_invoiced, quantity_base: it.quantity_base, unit_label: it.unit_label, discount_pct: it.discount_pct, surcharge_pct: it.surcharge_pct }));
  // T-0054 (RF-VEN-05): resumo do retorno do ERP (pull local, vale offline) e notas do detalhe online, quando vierem
  const situacaoFaturamento = queued ? [] : (base?.situacao_faturamento ?? []);
  const notasFaturamento = queued ? [] : (detail?.faturamento?.notas ?? []);
  const devolucoes = queued ? [] : (detail?.faturamento?.devolucoes ?? []);
  const subtotal = queued ? (qd?.subtotal_cents ?? 0) : base!.subtotal_cents;
  const discount = queued ? (qd?.discount_cents ?? 0) : base!.discount_cents;
  const total = queued ? (qd?.total_cents ?? 0) : base!.total_cents;
  const discountPct = queued ? queued.payload.discount_pct : base!.discount_pct;
  // T-0061 (RN-VEN-02/03/16/17): acréscimo, desconto efetivo, frete e endereço de entrega do pedido
  const surchargePct = queued ? (queued.payload.acrescimo_pct ?? 0) : (base!.surcharge_pct ?? 0);
  const effectivePct = queued ? null : (base!.effective_discount_pct ?? null);
  const freteTexto = (() => {
    if (queued) {
      const f = queued.payload.frete;
      return f ? rotuloDoFrete({ modalidade: f.modalidade, transportadora_id: f.modalidade === 'FOB' ? f.transportadora_id : null, transportadora_digitada: f.modalidade === 'FOB' ? f.transportadora_digitada : null }, app.transportadoras) : null;
    }
    const f = base!.freight;
    if (!f) return null;
    return f.modality === 'CIF' ? 'CIF · por conta da empresa' : `FOB · por conta do cliente${f.carrier_name ? ` · ${f.carrier_name}${f.carrier_document ? ` (CNPJ ${formatarDocumento(f.carrier_document)})` : ''}${f.carrier_typed ? ' · digitada' : ''}` : ''}`;
  })();
  const enderecoTexto = (() => {
    if (queued) {
      const e = queued.payload.endereco_entrega_id ? app.enderecos.find((x) => x.id === queued.payload.endereco_entrega_id) : null;
      return e ? textoDoEndereco(e) : null;
    }
    return base!.delivery_address ? textoDoEndereco({ ...base!.delivery_address, numero: base!.delivery_address.numero ?? null, complemento: base!.delivery_address.complemento ?? null, bairro: base!.delivery_address.bairro ?? null }) : null;
  })();
  const terms = queued ? queued.payload.payment_terms : base!.payment_terms;
  const note = queued ? queued.ultimo_erro : base ? orderNote(base) : '';
  const history: OrderEvent[] = queued
    ? [{ at: queued.criado_em, status: 'queued', by: 'aparelho', note: queued.payload.created_offline_at ? 'Criado no aparelho sem sinal' : 'Aguardando envio' }]
    : (detail?.history ?? []);

  // ---------- ações ----------
  const acts = app.acoesDe(status);
  // T-0053 (RF-VEN-03, RN-VEN-32): orçamento mostra a situação (offline, pela validade) e a ação de converter
  const agoraTela = relogioReal().agora();
  const doc = queued ? { status, tipo: queued.payload.tipo } : { ...base!, status };
  const acoesOrc = acoesNaTela(doc, agoraTela, !v1 || perfil === 'vendedor');
  const ehOrc = acoesOrc !== null;
  const title = number ? `${ehOrc ? 'Orçamento' : 'Pedido'} ${number}` : ehOrc ? 'Orçamento no aparelho' : 'Pedido no aparelho';
  const hasLines = lines.length > 0;
  const ehVendedor = !v1 || perfil === 'vendedor';
  const { podeEditar: canEdit, podeExcluir: canDelete, motivoBloqueio: lockedReason } = estadoDasAcoes({
    status,
    naFila: Boolean(queued),
    offline,
    v1,
    ehVendedor,
    temItens: hasLines,
    pode: { editar: podeEditar, cancelar: podeCancelar },
    acoes: acts,
  });

  const converter = async () => {
    setBusy('convert');
    setActionError(null);
    try {
      const r = await app.converterOrcamento(id ?? '');
      if (r.kind === 'sent') irParaPedido(r.order.id);
      else irParaPedidos();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const startDraft = async (mode: 'duplicate' | 'edit') => {
    setBusy(mode);
    setActionError(null);
    try {
      const r = await app.prepararRascunhoDoPedido(id ?? '', mode);
      irParaNovoPedido(mode === 'edit' ? { customerId: r.customerId, editId: id } : { customerId: r.customerId });
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const decidir = async (decisao: 'aprovar' | 'rejeitar', texto: string) => {
    setDeciding(true);
    setSheetError(null);
    try {
      const r = await app.decidirPedido(id ?? '', decisao, texto);
      setSheet(null);
      sheets.mostrar(decisao === 'aprovar' ? `Pedido ${r.number} aprovado.` : `Pedido ${r.number} rejeitado. O vendedor vê o motivo.`);
    } catch (e) {
      setSheetError(errorMessage(e));
    } finally {
      setDeciding(false);
    }
  };

  const confirmDelete = async (reason: string) => {
    setDeleting(true);
    setSheetError(null);
    try {
      const r = await app.excluirPedido(id ?? '', reason);
      setSheet(null);
      if (r.kind === 'local') {
        sheets.mostrar('Pedido removido da fila do aparelho.');
        irParaPedidos();
      } else {
        sheets.mostrar(`Pedido ${r.order.number} excluído.`);
      }
    } catch (e) {
      setSheetError(errorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  const pdfOrder = (): OrderPdfOrder => {
    if (detail && !queued) {
      // o retrato do pedido pode vir sem documento: completa com o cadastro do cliente no aparelho (CNPJ sempre impresso)
      const doc = detail.cliente?.documento?.trim() ? null : dados.clientes.find((x) => x.id === detail.customer_id)?.cnpj;
      const pdf = pdfDoPedido(detail);
      return doc ? { ...pdf, customer: { ...pdf.customer, cnpj: doc } } : pdf;
    }
    const c = dados.me ? { me: dados.me, customers: dados.clientes, policy: dados.politica } : null;
    const customerId = queued ? queued.payload.customer_id : base!.customer_id;
    const cu = c?.customers.find((x) => x.id === customerId);
    const sellerId = queued ? (c?.me.seller?.id ?? '') : base!.seller_id;
    const mine = c?.me.seller && c.me.seller.id === sellerId ? c.me.seller : null;
    return {
      number,
      status,
      created_at: queued ? queued.criado_em : (base!.created_offline_at ?? base!.received_at),
      customer: {
        legal_name: cu?.legal_name ?? customerName,
        trade_name: cu?.trade_name ?? customerName,
        cnpj: cu?.cnpj ?? '',
        address: cu?.address ?? '',
        district: cu?.district ?? '',
        city: cu?.city ?? '',
        erp_code: cu?.erp_code ?? '',
      },
      seller_name: mine?.name ?? (queued ? (ambiente.usuario()?.nome ?? '') : base!.seller_name),
      payment_terms: terms,
      discount_pct: discountPct,
      items: lines.map((l) => ({ erp_code: l.erp_code, description: l.description, quantity: l.quantity, unit_price_cents: l.unit_price_cents, total_cents: l.total_cents, ...(l.unit_label ? { unit_label: l.unit_label } : {}), ...(l.discount_pct !== undefined && (queued || effectivePct !== null) ? { discount_pct: l.discount_pct } : {}), ...(l.surcharge_pct ? { surcharge_pct: l.surcharge_pct } : {}) })),
      subtotal_cents: subtotal,
      discount_cents: discount,
      total_cents: total,
      pending_reason: queued ? (qd?.notes ?? []).join(' ') : base!.pending_reason,
      rejection_reason: queued ? '' : base!.rejection_reason,
      price_table: (queued ? cu?.price_table_id : (base!.price_table_id ?? cu?.price_table_id)) ?? '',
      branch_name: queued ? '' : base!.branch_name ?? '',
      erp_order_code: queued ? '' : base!.erp_order_code,
      seller_limit_pct: c?.policy && sellerId ? sellerDiscountLimit(toDomainPolicy(c.policy), sellerId) : null,
      history,
      price_table_name: queued ? null : (base!.price_table_name ?? null),
      ...(!queued && base!.freight ? { freight: base!.freight } : {}),
      ...(enderecoTexto ? { delivery_address: enderecoTexto } : {}),
    };
  };

  const exportPdfFor = async (view: OrderPdfView) => {
    setPdfBusy(view);
    setSheetError(null);
    try {
      const me = dados.me;
      const html = buildOrderPdfHtml(pdfOrder(), view, {
        tenant_name: nomeDaDistribuidora(me?.tenant.name, ambiente.parametros('core')),
        product_name: me?.tenant.product_name ?? 'Macuxi FDV',
        tz,
        generated_at: new Date().toISOString(),
      });
      await exportPdf(html, orderPdfFileName(number, view));
      setSheet(null);
    } catch (e) {
      setSheetError(errorMessage(e));
    } finally {
      setPdfBusy(null);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: Math.max(16, insets.top + 4), paddingHorizontal: 20, paddingBottom: 24, gap: 14 }}
      refreshControl={<RefreshControl refreshing={sincronizandoTela} onRefresh={puxarParaSincronizar} />}>
      <AvisoRapido mensagem={sheets.aviso} />
      <BackLink label="Pedidos" fallback={hrefPedidos()} />
      <View style={{ gap: 6 }}>
        <Text style={t.h1Small} testID="order-title">
          {title}
        </Text>
        <Text style={t.sub}>{sellerNameHeader ? `${customerName} · ${sellerNameHeader}` : customerName}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {ehOrc ? <Badge label={rotuloDoDocumento(doc, agoraTela)} tone="neutral" /> : null}
          {ehOrc && !queued ? null : <Badge label={b.label} fg={b.fg} bg={b.bg} />}
          {base && !queued && base.erp_order_code ? <Badge label={`ERP ${base.erp_order_code}`} tone="neutral" /> : null}
        </View>
        {note ? <Text style={[t.small, { color: b.fg }]}>{note}</Text> : null}
      </View>

      {queued ? (
        <View style={{ gap: 8 }}>
          <Banner>
            {queued.failed ? `Recusado pelo servidor: ${queued.ultimo_erro}` : offline ? 'Na fila do aparelho. Envio automático quando o sinal voltar.' : 'Na fila do aparelho. Nova tentativa a cada 15 s.'}
          </Banner>
          {!offline ? <Button label="Enviar agora" icon="send" variant="dark" loading={flushing} onPress={() => void reenviarFila().then(() => irParaPedidos())} /> : null}
          {qd && qd.notes.length > 0 ? <Text style={[t.small, { color: colors.accentInk }]}>{qd.notes.join(' ')}</Text> : null}
        </View>
      ) : null}

      <Card style={{ padding: 14, gap: 6 }}>
        <Row label="Subtotal" value={formatBRL(subtotal)} />
        {surchargePct > 0 ? <Row label={`Acréscimo do pedido ${formatPct(surchargePct)}`} value={`+ ${formatBRL(Math.max(0, total - subtotal))}`} /> : <Row label={`Desconto ${formatPct(discountPct)}`} value={`− ${formatBRL(discount)}`} />}
        {effectivePct !== null ? <Row label="Desconto efetivo (sem frete)" value={formatPct(effectivePct)} /> : null}
        <Row label={`Total · prazo ${terms}`} value={formatBRL(total)} strong />
        {base && !queued && base.branch_name ? <Row label="Filial" value={base.branch_name} /> : null}
        {!queued && detail?.freight ? <Row label="Frete" value={textoFrete(detail.freight).replace(/^Frete: /, '')} /> : null}
        {!queued && detail?.price_table_name ? <Row label="Tabela de preço" value={detail.price_table_name} /> : null}
      </Card>

      {freteTexto || enderecoTexto ? (
        <Card style={{ padding: 14, gap: 6 }} testID="order-delivery">
          {freteTexto ? <Row label="Frete" value={freteTexto} /> : null}
          {enderecoTexto ? <Row label="Entrega em" value={enderecoTexto} /> : null}
        </Card>
      ) : null}

      {situacaoFaturamento.length > 0 ? (
        <Card style={{ padding: 14, gap: 6 }} testID="order-invoicing">
          <Text style={t.bodyStrong}>Faturamento</Text>
          {situacaoFaturamento.map((linha) => (
            <Text key={linha} style={t.body}>
              {linha}
            </Text>
          ))}
          {notasFaturamento.map((n, i) => (
            <Row key={`nf-${n.numero ?? i}-${n.faturado_em}`} label={`NF ${n.numero ?? '—'}${n.serie ? `/${n.serie}` : ''} · ${dateTimeLabel(n.faturado_em, agoraTela, tz)}${n.parcial ? ' · parcial' : ''}`} value={n.total_cents === null ? `${n.unidades} un.` : formatBRL(n.total_cents)} />
          ))}
          {devolucoes.map((d, i) => (
            <Row key={`dev-${d.numero}-${i}`} label={`Devolução NF ${d.numero}${d.serie ? `/${d.serie}` : ''} · ${dateTimeLabel(d.emitida_em, agoraTela, tz)}`} value={`− ${formatBRL(d.total_cents)}`} />
          ))}
        </Card>
      ) : null}

      {detail?.aprovacao ? (
        <Card style={{ padding: 14, gap: 8 }} testID="order-approval">
          <Row label="Desconto do pedido" value={formatPct(detail.aprovacao.desconto_efetivo_pct)} />
          <Row label="Alçada do vendedor" value={formatPct(detail.aprovacao.limite_vendedor_pct)} />
          <Row label="Quem aprova" value={rotuloDoNivel(detail.aprovacao.nivel)} />
          {detail.aprovacao.pode_decidir && podeAprovar ? (
            <View style={{ gap: 8, marginTop: 4 }}>
              <View style={styles.actionsRow}>
                <Button testID="pedido-aprovar" label="Aprovar" icon="check" variant="accent" style={{ flex: 1 }} disabled={offline || deciding} onPress={() => void decidir('aprovar', '')} loading={deciding && sheet === null} />
                <Button testID="pedido-rejeitar" label="Rejeitar" icon="close" variant="danger" style={{ flex: 1 }} disabled={offline || deciding} onPress={() => { setSheetError(null); setSheet('reject'); }} />
              </View>
              {offline ? <Text style={t.small} testID="approve-offline">Aprovar exige internet: conecte-se para decidir este pedido.</Text> : null}
              {detail.aprovacao.acima_do_nivel ? <Text style={t.small}>Este pedido é do nível supervisor; a decisão fica registrada como do gerente.</Text> : null}
            </View>
          ) : status === 'pending_approval' ? (
            <Text style={t.small} testID="approve-wait">Aguardando {detail.aprovacao.nivel === 'supervisor' ? 'o supervisor' : detail.aprovacao.nivel === 'gerente' ? 'o gerente' : 'o analista'}.</Text>
          ) : null}
        </Card>
      ) : null}

      <View style={{ gap: 8 }}>
        <SectionHeader title="Itens" right={lines.length > 0 ? `${lines.length} ${lines.length === 1 ? 'item' : 'itens'}` : undefined} />
        <Card>
          {lines.length === 0 ? <Text style={[t.sub, { padding: 14 }]}>{TEXTO_SEM_ITENS}</Text> : null}
          {lines.map((l, i) => (
            <View key={l.key} style={[styles.item, i < lines.length - 1 && styles.divider]}>
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={t.mono}>{l.erp_code}</Text>
                <Text style={t.bodyStrong}>{l.description}</Text>
                <Text style={t.small}>
                  {l.quantity} {l.unit_label || 'UN'} × {formatBRL(l.unit_price_cents)}
                  {(l.surcharge_pct ?? 0) > 0 ? ` · acréscimo ${formatPct(l.surcharge_pct!)}` : (l.discount_pct ?? 0) > 0 && effectivePct !== null ? ` · desconto ${formatPct(l.discount_pct!)}` : ''}
                </Text>
                {textoItemFaturado(l.quantity_base ?? l.quantity, l.quantity_invoiced) ? <Text style={[t.small, { color: colors.accentInk }]}>{textoItemFaturado(l.quantity_base ?? l.quantity, l.quantity_invoiced)}</Text> : null}
              </View>
              <Text style={[t.bodyStrong, { fontVariant: ['tabular-nums'] }]}>{formatBRL(l.total_cents)}</Text>
            </View>
          ))}
        </Card>
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeader title="Histórico" />
        <Card style={{ padding: 14, gap: 12 }}>
          {history.length === 0 ? <Text style={t.sub}>Sem eventos.</Text> : null}
          {history.map((e, i) => {
            const eb = statusBadge(e.status);
            return (
              <View key={`${e.status}-${e.at}-${i}`} style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ alignItems: 'center' }}>
                  <View style={[styles.dot, { backgroundColor: eb.fg }]} />
                  {i < history.length - 1 ? <View style={styles.rail} /> : null}
                </View>
                <View style={{ flex: 1, gap: 1, paddingBottom: 2 }}>
                  <Text style={t.bodyStrong}>{eb.label}</Text>
                  <Text style={t.small}>
                    {dateTimeLabel(e.at, new Date(), tz)} · {e.by}
                  </Text>
                  {e.note ? <Text style={[t.small, { color: colors.ink }]}>{e.note}</Text> : null}
                </View>
              </View>
            );
          })}
        </Card>
      </View>

      {somenteLeitura ? null : (
      <View style={{ gap: 8 }} testID="order-actions">
        <SectionHeader title="Ações" />
        <Card style={{ padding: 14, gap: 10 }}>
          {ehOrc && acoesOrc?.pode_converter && !queued ? (
            <Button
              testID="orcamento-converter"
              label="Converter em pedido"
              icon="send"
              variant="accent"
              disabled={!podeCriar || !hasLines || busy !== null}
              loading={busy === 'convert'}
              onPress={() => void converter()}
            />
          ) : null}
          {ehOrc && acoesOrc?.texto ? <Text style={t.small}>{acoesOrc.texto}</Text> : null}
          {ehVendedor ? (
            <View style={styles.actionsRow}>
              <Button
                testID="pedido-duplicar"
                label="Duplicar"
                icon="copy"
                variant="outline"
                style={{ flex: 1 }}
                disabled={!ehVendedor || !podeCriar || !acts.can_duplicate || !hasLines || busy !== null}
                loading={busy === 'duplicate'}
                onPress={() => void startDraft('duplicate')}
              />
              <Button testID="pedido-editar" label="Editar" icon="edit" variant="outline" style={{ flex: 1 }} disabled={!canEdit || busy !== null} loading={busy === 'edit'} onPress={() => void startDraft('edit')} />
            </View>
          ) : null}
          <View style={styles.actionsRow}>
            <Button
              testID="pedido-excluir"
              label="Excluir"
              icon="trash"
              variant="danger"
              style={{ flex: 1 }}
              disabled={!canDelete}
              onPress={() => {
                setSheetError(null);
                setSheet('delete');
              }}
            />
            <Button
              testID="action-pdf"
              label="Exportar PDF"
              icon="file"
              variant="outline"
              style={{ flex: 1 }}
              disabled={!hasLines}
              onPress={() => {
                setSheetError(null);
                setSheet('pdf');
              }}
            />
          </View>
          {lockedReason ? (
            <View style={styles.locked}>
              <Icon name="lock" size={14} color={colors.ink3} />
              <Text style={[t.small, { flex: 1 }]} testID="order-locked-reason">
                {lockedReason}
              </Text>
            </View>
          ) : null}
          {actionError ? (
            <Text style={[t.small, { color: colors.danger }]} testID="order-action-error">
              {actionError}
            </Text>
          ) : null}
        </Card>
      </View>
      )}

      <DeleteOrderSheet visible={sheet === 'delete'} title={title} queued={isQueued} busy={deleting} error={sheetError} onClose={() => setSheet(null)} onConfirm={(r) => void confirmDelete(r)} />
      <DecisionSheet visible={sheet === 'reject'} title={title} busy={deciding} error={sheetError} onClose={() => setSheet(null)} onConfirm={(motivo) => void decidir('rejeitar', motivo)} />
      <PdfSheet visible={sheet === 'pdf'} busy={pdfBusy} error={sheetError} onClose={() => setSheet(null)} onPick={(v) => void exportPdfFor(v)} />
    </ScrollView>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <Text style={[t.sub, strong && { color: colors.ink, fontFamily: fonts.semibold }]}>{label}</Text>
      <Text style={[strong ? { fontFamily: fonts.display, fontSize: 18, color: colors.ink } : t.body, { fontVariant: ['tabular-nums'] }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  rail: { width: 2, flex: 1, backgroundColor: colors.lineSoft, marginTop: 2 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  locked: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
});
