/**
 * Detalhe do pedido e do orçamento (RF-VEN-05, T-0138; spec docs/design/pedido-v2.md §4): cabeçalho em destaque (número, tag,
 * cliente com código, vendedor) -> itens -> total separado com forma, prazo e frete -> histórico em tags (RN-VEN-30) -> rodapé
 * compacto com 1 ação grande e as outras em ícone + rótulo curto; Cancelar fica no menu ⋮, com confirmação.
 * Pedido da fila mostra o que está no aparelho. Editar/cancelar seguem orderActions (domain do Vendedor, RN-VEN-31):
 * só enquanto o pedido não está no ERP (ou com o aceite do conector), e só com a permissão por ação do manifesto (ADR 0004).
 */
import { formatBRL, formatPct } from '@macuxi/comum';
import { useAmbiente, usePode } from '@macuxi/platform-sdk/react';
import { BackLink, Banner, Botao, Button, Card, colors, dateTimeLabel, EstadoVazio, fonts, Folha, HistoricoEmTags, Icon, LinhaValor, LinkTexto, Loading, MenuMais, OpcaoFolha, RodapeAcoes, RotuloSecao, Selo, tagsDoHistorico, type as t, useAtualizacaoAutomatica, type AcaoCompacta } from '@macuxi/ui/mobile';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { OrderEvent } from '../../contracts';
import type { NivelDePreco } from '../../domain/preco-pedido';
import { referenciaNoOrcamento } from '../../domain/aplicacao';
import { enviadoAoErp, sellerDiscountLimit } from '../../domain/order';
import { textoItemFaturado } from '../../domain/retorno-erp';
import { vendedorDoPdf } from '../../domain/pedido-em-nome';
import { AvisoRapido, useAviso } from '../components/aviso';
import { pegarAvisoPendente } from '../lib/aviso-pendente';
import { DecisionSheet, DeleteOrderSheet, PdfSheet } from '../components/order-sheets';
import { estadoDasAcoes, rotuloDoNivel, TEXTO_SEM_ITENS } from '../lib/acoes-pedido';
import { acoesDoDetalhe, clienteComCodigo, eventosDoOrcamento, eventosDoPedido, itensVisiveis, linhaDoAjusteDoItem, linhaDoVendedor, linhaFormaPrazoFrete } from '../lib/detalhe-pedido';
import { toDomainPolicy } from '../lib/catalog';
import { buildOrderPdfHtml, nomeDaDistribuidora, orderPdfFileName, pdfDoPedido, type OrderPdfOrder, type OrderPdfView } from '../lib/order-pdf';
import { errorMessage } from '../lib/erros';
import { textoDoEndereco } from '../lib/novo-pedido';
import { pedidoSomenteLeitura } from '../lib/somente-leitura';
import { statusBadge, statusBadgeDaLinha } from '../lib/order-status';
import { estadoNaFila } from '../lib/salvar-na-fila';
import { exportPdf } from '../lib/pdf-export';
import { relogioReal } from '@macuxi/comum/relogio';
import { acoesNaTela, rotuloDoDocumento, situacaoNaTela, validadeCivilDoDocumento } from '../lib/pre-venda';
import { estadoDoDetalheAusente, folhaDoTransformar, itemCompacto, ROTULO_TENTAR_DE_NOVO, seloDoOrcamento } from '../lib/textos-pedido';
import { dataDoPrecoDoOrcamento, validadeOrcamentoDias } from '../../domain/orcamento';
import { hrefPedidos, irParaNovoPedido, irParaPedido, irParaPedidos } from '../rotas';
import { useVendedor } from '../state/use-vendedor';

interface Line {
  key: string;
  /** T-0138: para ler as referências cruzadas na hora do PDF */
  product_id?: string;
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
  /** T-0084 (RN-VEN-19): retrato da aplicação gravado no pedido */
  application?: string | null;
}

export default function OrderDetailScreen() {
  const { id, transformar: abrirTransformar } = useLocalSearchParams<{ id: string; transformar?: string }>();
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
  // tentativa de PDF em andamento (fechar a folha ou sair da tela encerra; ver `exportPdfFor`)
  const tentativaPdf = useRef(0);
  useEffect(
    () => () => {
      tentativaPdf.current += 1;
    },
    [],
  );
  /** spec §4.1: mais de 8 itens mostram os 8 primeiros e "Ver os N itens" */
  const [mostrarTodosItens, setMostrarTodosItens] = useState(false);
  /** RN-VEN-18: o que mudou desde o orçamento; o vendedor confirma antes de transformar */
  const [conferencia, setConferencia] = useState<{ mudancas: string[]; bloqueio: string | null; nivel: NivelDePreco | null; total_cents: number } | null>(null);
  /** desenho §1.5: a folha do Transformar abre sempre (toque 1); o envio é o toque 2 */
  const [transformarAberto, setTransformarAberto] = useState(false);
  // T-0137: "Transformar em pedido" da edição do orçamento salva e chega aqui com a folha do Transformar já aberta (uma vez)
  const transformarAoAbrir = useRef<(() => void) | null>(null);
  const jaAbriuTransformar = useRef(false);
  useEffect(() => {
    if (abrirTransformar === '1' && !jaAbriuTransformar.current && transformarAoAbrir.current) {
      jaAbriuTransformar.current = true;
      transformarAoAbrir.current();
    }
  });
  const detail = app.detalhe(id ?? '');
  const summary = orders.find((o) => o.id === id) ?? null;
  const queued = fila.find((o) => o.payload.id === id) ?? null;
  const qd = queued?.display ?? null;

  const isQueued = Boolean(queued);
  // RN-CORE-23 (T-0054): ao focar, só relê o aparelho; sem consulta periódica (o pull é do motor de sync da plataforma)
  useFocusEffect(
    useCallback(() => {
      const avisoDeEdicao = pegarAvisoPendente();
      if (avisoDeEdicao) sheets.mostrar(avisoDeEdicao);
      if (isQueued || !id) return;
      setCarregando(true);
      void loadOrder(id)
        .catch(() => undefined)
        .finally(() => setCarregando(false));
    }, [id, loadOrder, isQueued]),
  );
  const [carregando, setCarregando] = useState(true);
  // RN-CORE-23: puxar para baixo = Sincronizar (agendador do app); depois de cada sync relê o pedido no aparelho; rodapé de última sincronização
  const auto = useAtualizacaoAutomatica({ tz });

  const base = detail ?? summary;
  if (!base && !queued) {
    const ausente = estadoDoDetalheAusente({ offline, carregando });
    const tentarDeNovo = () => {
      setCarregando(true);
      void loadOrder(id ?? '')
        .catch(() => undefined)
        .finally(() => setCarregando(false));
    };
    return (
      <View style={[styles.root, { paddingTop: Math.max(16, insets.top + 4), paddingHorizontal: 20 }]}>
        <BackLink label="Pedidos" fallback={hrefPedidos()} />
        {ausente.tipo === 'carregando' ? (
          <Loading />
        ) : (
          <EstadoVazio titulo={ausente.titulo} texto={ausente.texto} testID="pedido-fora-do-aparelho" acao={ausente.tentarDeNovo ? { rotulo: ROTULO_TENTAR_DE_NOVO, onPress: tentarDeNovo } : undefined} />
        )}
      </View>
    );
  }

  const status = queued ? 'queued' : (detail?.status ?? summary?.status ?? 'received');
  const naFila = queued ? estadoNaFila({ recusado: queued.failed, offline, motivoBruto: queued.ultimo_erro ?? '' }) : null;
  const b = queued && queued.failed ? statusBadgeDaLinha({ status: 'queued', local_failed: true }) : statusBadge(status);
  const sellerNameHeader = queued ? (ambiente.usuario()?.nome ?? '') : (base?.seller_name ?? '');
  const customerName = queued ? (qd?.customer_name ?? '') : base!.customer_name;
  const number = queued ? null : base!.number;
  const lines: Line[] = queued
    ? (qd?.lines ?? []).map((l) => ({ key: l.product_id + (l.unit_label ?? ''), ...l }))
    : (detail?.items ?? []).map((it) => ({ key: it.id, product_id: it.product_id, erp_code: it.erp_code, description: it.description, quantity: it.quantity, unit_price_cents: it.unit_price_cents, total_cents: it.total_cents, quantity_invoiced: it.quantity_invoiced, quantity_base: it.quantity_base, unit_label: it.unit_label, discount_pct: it.discount_pct, surcharge_pct: it.surcharge_pct, application: it.application }));
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
  const enderecoTexto = (() => {
    if (queued) {
      const e = queued.payload.endereco_entrega_id ? app.enderecos.find((x) => x.id === queued.payload.endereco_entrega_id) : null;
      return e ? textoDoEndereco(e) : null;
    }
    return base!.delivery_address ? textoDoEndereco({ ...base!.delivery_address, numero: base!.delivery_address.numero ?? null, complemento: base!.delivery_address.complemento ?? null, bairro: base!.delivery_address.bairro ?? null }) : null;
  })();
  const terms = queued ? queued.payload.payment_terms : base!.payment_terms;
  const history: OrderEvent[] = queued
    ? [{ at: queued.criado_em, status: 'queued', by: 'aparelho', note: queued.payload.created_offline_at ? 'Criado no aparelho sem sinal' : 'Aguardando envio' }]
    : (detail?.history ?? []);

  // ---------- ações ----------
  // RN-VEN-31 (T-0114/T-0138): com o aceite do conector (marca do pull), o enviado/integrado cancela no Macuxi e o texto do bloqueio não manda cancelar no ERP
  const erpAceitaCancelamento = !queued && base?.erp_aceita_cancelamento === true;
  const acts = app.acoesDe(status, erpAceitaCancelamento);
  // T-0053 (RF-VEN-03, RN-VEN-32): orçamento mostra a situação (offline, pela validade) e a ação de converter
  const agoraTela = relogioReal().agora();
  const doc = queued ? { status, tipo: queued.payload.tipo } : { ...base!, status };
  const acoesOrc = acoesNaTela(doc, agoraTela, !v1 || perfil === 'vendedor');
  const ehOrc = acoesOrc !== null;
  // RN-VEN-18 (09/11): o orçamento não vence; a etiqueta mostra o dia do preço ("preço de 09/11"), no fuso do tenant, offline
  const diasDoPreco = validadeOrcamentoDias(ambiente.parametros('vendedor'));
  const validadeData = ehOrc
    ? validadeCivilDoDocumento({ validade_data: queued ? null : (base?.validade_data ?? null), validade_ate: queued ? null : (base?.validade_ate ?? null), criado_em: queued?.criado_em ?? null }, { fuso: tz, dias: diasDoPreco })
    : null;
  const situacaoOrc = ehOrc ? situacaoNaTela(doc, agoraTela) : null;
  const numeroConvertido = base && !queued && base.convertido_pedido_id ? (orders.find((o) => o.id === base.convertido_pedido_id)?.number ?? null) : null;
  const selo = ehOrc && situacaoOrc && validadeData ? seloDoOrcamento({ situacao: situacaoOrc, preco_data: dataDoPrecoDoOrcamento(validadeData, diasDoPreco), pedido_numero: numeroConvertido }) : null;
  const title = number ? `${ehOrc ? 'Orçamento' : 'Pedido'} ${number}` : ehOrc ? 'Orçamento no aparelho' : 'Pedido no aparelho';
  const hasLines = lines.length > 0;
  const ehVendedor = !v1 || perfil === 'vendedor';
  const { podeEditar: canEdit, podeExcluir: canDelete, motivoBloqueio: lockedReason } = estadoDasAcoes({
    status,
    naFila: Boolean(queued),
    recusado: Boolean(queued?.failed),
    offline,
    v1,
    ehVendedor,
    temItens: hasLines,
    pode: { editar: podeEditar, cancelar: podeCancelar },
    acoes: acts,
    orcamentoAberto: ehOrc && acoesOrc.pode_editar && !queued,
  });
  const podeExcluirDoc = canDelete && (acoesOrc ? acoesOrc.pode_cancelar : true);
  const podeDuplicarDoc = acoesOrc ? acoesOrc.pode_duplicar : acts.can_duplicate;

  const folhaTransformar = folhaDoTransformar(conferencia);

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

  /** RN-VEN-18: Transformar reconfere preço, estoque, mínimo e alçada com os dados do aparelho e abre sempre a folha "Enviar pedido" com a alçada. */
  const transformar = async () => {
    setBusy('convert');
    setActionError(null);
    try {
      const c = v1 ? await app.reconferirOrcamentoLocal(id ?? '') : null;
      setConferencia(c ? { mudancas: c.mudancas, bloqueio: c.bloqueio, nivel: c.nivel, total_cents: c.total_cents } : null);
      setTransformarAberto(true);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  transformarAoAbrir.current = acoesOrc?.pode_converter && !queued && podeCriar && hasLines ? () => void transformar() : null;

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
      sheets.mostrar(decisao === 'aprovar' ? `Pedido ${r.number} aprovado` : `Pedido ${r.number} rejeitado. O vendedor vê o motivo`);
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
        sheets.mostrar('Pedido removido da fila do aparelho');
        irParaPedidos();
      } else {
        sheets.mostrar(`Pedido ${r.order.number} excluído`);
      }
    } catch (e) {
      setSheetError(errorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  /** `refs`: referências cruzadas por produto (RN-CAT-09/10), lidas na hora de gerar o PDF; não são retrato do pedido */
  const pdfOrder = (refs: ReadonlyMap<string, Array<{ brand: string; code: string }>> = new Map()): OrderPdfOrder => {
    const idPorCodigo = new Map(lines.map((l) => [l.erp_code, l.product_id]));
    const comReferencias = (o: OrderPdfOrder): OrderPdfOrder => ({ ...o, items: o.items.map((it) => { const r = refs.get(idPorCodigo.get(it.erp_code) ?? ''); return r && r.length > 0 ? { ...it, references: r } : it; }) });
    return comReferencias(pdfBase());
  };
  const pdfBase = (): OrderPdfOrder => {
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
      // RN-VEN-35: pedido em nome na fila sai com o vendedor dono (nunca o gestor) e "feito por" o gestor
      ...(queued ? vendedorDoPdf({ dono_nome: qd?.seller_name ?? '', autor_nome: ambiente.usuario()?.nome ?? '', em_nome: Boolean(queued.payload.vendedor_id) && queued.payload.vendedor_id !== c?.me.seller?.id }) : { seller_name: mine?.name ?? base!.seller_name }),
      payment_terms: terms,
      discount_pct: discountPct,
      items: lines.map((l) => ({ erp_code: l.erp_code, description: l.description, quantity: l.quantity, unit_price_cents: l.unit_price_cents, total_cents: l.total_cents, ...(l.unit_label ? { unit_label: l.unit_label } : {}), ...(l.discount_pct !== undefined && (queued || effectivePct !== null) ? { discount_pct: l.discount_pct } : {}), ...(l.surcharge_pct ? { surcharge_pct: l.surcharge_pct } : {}), ...(l.application ? { application: l.application } : {}) })),
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
      ...(ehOrc ? { tipo: 'orcamento' as const } : {}),
    };
  };

  /** Fechar a folha (ou sair da tela) encerra a tentativa: "Gerando…" some, o resultado atrasado é ignorado e o compartilhar não abre. */
  const fecharPdf = () => {
    tentativaPdf.current += 1;
    setPdfBusy(null);
    setSheetError(null);
    setSheet(null);
  };
  const exportPdfFor = async (view: OrderPdfView) => {
    const minha = ++tentativaPdf.current;
    const vigente = () => tentativaPdf.current === minha;
    setPdfBusy(view);
    setSheetError(null);
    try {
      const me = dados.me;
      // T-0138 (RN-CAT-09/10, desenho T-0085 §5): "Equivale a" no PDF interno; no do cliente só com `referencia_no_orcamento`
      const referenciaNoCliente = referenciaNoOrcamento(ambiente.parametros('vendedor'));
      const refs = view === 'bko' || referenciaNoCliente ? await app.referenciasDeProdutos(lines.map((l) => l.product_id).filter((x): x is string => Boolean(x))) : new Map<string, Array<{ brand: string; code: string }>>();
      const pedidoPdf = pdfOrder(refs);
      const html = buildOrderPdfHtml(pedidoPdf, view, {
        tenant_name: nomeDaDistribuidora(me?.tenant.name, ambiente.parametros('core')),
        product_name: me?.tenant.product_name ?? 'Macuxi FDV',
        tz,
        generated_at: new Date().toISOString(),
        reference_on_customer_pdf: referenciaNoCliente,
      });
      const r = await exportPdf(html, orderPdfFileName(number, pedidoPdf.created_at, tz, pedidoPdf.tipo), () => !vigente());
      if (r.kind !== 'cancelado' && vigente()) setSheet(null);
    } catch (e) {
      if (vigente()) setSheetError(errorMessage(e));
    } finally {
      if (vigente()) setPdfBusy(null);
    }
  };

  // ---------- T-0138: detalhe na ordem da spec (pedido-v2 §4) ----------
  const vendedorNome = sellerNameHeader;
  const codigoDoCliente = (queued ? dados.clientes.find((x) => x.id === queued.payload.customer_id)?.erp_code : (detail?.cliente?.codigo_erp ?? dados.clientes.find((x) => x.id === base!.customer_id)?.erp_code)) ?? null;
  const eventosDoHistorico =
    ehOrc && situacaoOrc
      ? eventosDoOrcamento(history, { vendedorNome, situacao: situacaoOrc, criadoEm: queued?.criado_em ?? base?.received_at ?? new Date(agoraTela).toISOString(), convertidoEm: queued ? null : (base?.updated_at ?? null), numeroPedido: numeroConvertido })
      : eventosDoPedido(history, { vendedorNome, motivoDoFechamento: queued ? null : (base?.rejection_reason ?? null) });
  const tagsDoDetalhe = tagsDoHistorico(eventosDoHistorico, { tipo: ehOrc ? 'orcamento' : 'pedido', tz, agora: agoraTela });
  const ultimaTag = tagsDoDetalhe.length > 0 ? tagsDoDetalhe[tagsDoDetalhe.length - 1]! : null;
  const modalidade = queued ? (queued.payload.frete?.modalidade ?? null) : (base?.freight?.modality ?? null);
  const transportadora = (() => {
    if (queued) {
      const f = queued.payload.frete;
      if (!f || f.modalidade !== 'FOB') return null;
      return app.transportadoras.find((x) => x.id === f.transportadora_id)?.nome ?? f.transportadora_digitada?.nome ?? null;
    }
    return base?.freight?.carrier_name ?? null;
  })();
  const formaPrazoFrete = linhaFormaPrazoFrete({ forma: queued ? null : (base?.forma_pagamento_nome ?? null), prazo: queued ? terms : (base?.prazo_descricao ?? terms), modalidade, transportadora });
  const acoesDaTela = acoesDoDetalhe({
    tipo: ehOrc ? 'orcamento' : 'pedido',
    status,
    situacao: situacaoOrc,
    naFila: Boolean(queued),
    recusado: Boolean(queued?.failed),
    somenteLeitura,
    podeEditar: canEdit && (ehOrc ? Boolean(acoesOrc?.pode_editar) : true),
    podeCancelar: podeExcluirDoc && (ehOrc ? Boolean(acoesOrc?.pode_cancelar) : true),
    podeDuplicar: ehVendedor && podeCriar && podeDuplicarDoc && hasLines && (ehOrc ? Boolean(acoesOrc?.pode_duplicar) : true),
    podePdf: hasLines && (ehOrc ? Boolean(acoesOrc?.pode_pdf) : true),
    podeConverter: Boolean(acoesOrc?.pode_converter) && !queued && podeCriar && hasLines,
    pedidoGeradoId: ehOrc && !queued ? (base?.convertido_pedido_id ?? null) : null,
  });
  const executar = (id: string) => {
    switch (id) {
      case 'transformar':
        return void transformar();
      case 'continuar':
      case 'corrigir':
      case 'editar':
        return void startDraft('edit');
      case 'duplicar':
        return void startDraft('duplicate');
      case 'pdf':
        setSheetError(null);
        return setSheet('pdf');
      case 'pedido':
        return base?.convertido_pedido_id ? irParaPedido(base.convertido_pedido_id) : undefined;
      case 'cancelar':
        setSheetError(null);
        return setSheet('delete');
    }
  };
  const desligadaPorOcupado = busy !== null;
  const principal = acoesDaTela.principal
    ? {
        rotulo: acoesDaTela.principal.rotulo,
        icone: acoesDaTela.principal.icone,
        apoio: acoesDaTela.principal.apoio,
        rotuloAcessivel: acoesDaTela.principal.rotuloAcessivel,
        desligado: desligadaPorOcupado,
        ocupado: busy === (acoesDaTela.principal.id === 'transformar' ? 'convert' : acoesDaTela.principal.id === 'duplicar' ? 'duplicate' : 'edit'),
        onPress: () => executar(acoesDaTela.principal!.id),
        testID: { transformar: 'orcamento-converter', duplicar: 'pedido-duplicar', continuar: 'pedido-editar', corrigir: 'pedido-editar' }[acoesDaTela.principal.id as string] ?? 'rodape-acoes-principal',
      }
    : null;
  const testIdDaAcao: Record<string, string> = { editar: 'pedido-editar', pdf: 'action-pdf', duplicar: 'pedido-duplicar', pedido: 'orcamento-abrir-pedido' };
  const iconesDaTela: AcaoCompacta[] = acoesDaTela.icones.map((a) => ({ id: a.id, rotulo: a.rotulo, rotuloAcessivel: a.rotuloAcessivel, icone: a.icone, desligado: desligadaPorOcupado && a.id !== 'pdf' && a.id !== 'pedido', testID: testIdDaAcao[a.id], onPress: () => executar(a.id) }));
  const opcoesDoMenu = acoesDaTela.menu.map((a) => ({ id: a.id, rotulo: a.rotulo, icone: a.icone, perigo: true, testID: 'pedido-excluir', onPress: () => executar(a.id) }));
  const rotuloDoMenu = ehOrc ? 'Mais ações do orçamento' : 'Mais ações do pedido';
  const tabelaDoTotal = surchargePct > 0 ? { rotulo: `Acréscimo do pedido ${formatPct(surchargePct)}`, valor: `+ ${formatBRL(Math.max(0, total - subtotal))}` } : discount > 0 ? { rotulo: `Desconto ${formatPct(discountPct)}`, valor: `− ${formatBRL(discount)}` } : null;
  const { visiveis, rotuloVerTodos } = itensVisiveis(lines, mostrarTodosItens);
  const rodapeFixo = !somenteLeitura && (principal !== null || iconesDaTela.length > 0);
  const mostraNota = !somenteLeitura && !ehOrc && Boolean(lockedReason) && !queued;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={{ paddingTop: Math.max(16, insets.top + 4), paddingHorizontal: 20, paddingBottom: 24, gap: 14 }}
        refreshControl={<RefreshControl refreshing={auto.puxando} onRefresh={auto.puxar} />}>
        {/* 1. cabeçalho em destaque: voltar + ⋮, número com a tag, cliente com código, vendedor */}
        <View style={styles.topo}>
          <View style={{ flex: 1 }}>
            <BackLink label="Pedidos" fallback={hrefPedidos()} />
          </View>
          {somenteLeitura ? null : (
            <MenuMais rotuloAcessivel={rotuloDoMenu} titulo={title} opcoes={opcoesDoMenu} rotuloFechar="Fechar" rodape="Voltar" testID="menu-mais" />
          )}
        </View>
        <View style={{ gap: 6 }} testID="detalhe-cabecalho">
          <View style={styles.tituloLinha}>
            <Text style={[t.h1Small, { flexShrink: 1 }]} testID="order-title">
              {title}
            </Text>
            {selo ? (
              <Selo testID="orcamento-selo" texto={selo.texto} tom={selo.tom} tamanho="m" pilula />
            ) : ehOrc ? (
              <Selo testID="orcamento-selo" texto={rotuloDoDocumento(doc, agoraTela)} tom="neutro" tamanho="m" pilula />
            ) : ultimaTag ? (
              <Selo testID="pedido-selo" texto={ultimaTag.rotulo} tom={ultimaTag.tom} tamanho="m" pilula rotuloAcessivel={`Situação: ${ultimaTag.rotulo}`} />
            ) : (
              <Selo testID="pedido-selo" texto={b.label} tom="neutro" tamanho="m" pilula />
            )}
          </View>
          <Text style={[t.bodyStrong, { color: colors.ink }]} testID="detalhe-cliente">
            {clienteComCodigo(customerName, codigoDoCliente)}
          </Text>
          {vendedorNome ? (
            <Text style={t.small} testID="detalhe-vendedor">
              {linhaDoVendedor(vendedorNome)}
            </Text>
          ) : null}
          {base && !queued && base.erp_order_code ? <Text style={t.small}>{`Pedido no ERP: ${base.erp_order_code}`}</Text> : null}
        </View>

        {queued ? (
          <View style={{ gap: 8 }}>
            {naFila ? (
              <Banner testID="pedido-faixa-fila" tone={naFila.faixa.tom} icon={naFila.faixa.icone} anunciar>
                {naFila.faixa.texto}
              </Banner>
            ) : null}
            {naFila?.podeEnviarAgora ? <Button label="Enviar agora" icon="send" variant="dark" loading={flushing} onPress={() => void reenviarFila().then(() => irParaPedidos())} /> : null}
            {qd && qd.notes.length > 0 ? <Text style={[t.small, { color: colors.accentInk }]}>{qd.notes.join(' ')}</Text> : null}
          </View>
        ) : null}
        {!queued && base && !ehOrc && status === 'pending_approval' && base.pending_reason ? (
          <Text style={[t.small, { color: b.fg }]} testID="detalhe-pendencia">
            {base.pending_reason}
          </Text>
        ) : null}

        {/* 2. itens */}
        <View style={{ gap: 8 }} testID={ehOrc ? 'orcamento-resumo' : 'order-items'}>
          <RotuloSecao texto="Itens" />
          {lines.length === 0 ? <Text style={t.sub}>{TEXTO_SEM_ITENS}</Text> : null}
          {visiveis.map((l) => {
            const ajuste = queued || effectivePct !== null || ehOrc ? linhaDoAjusteDoItem(l) : null;
            const faturado = textoItemFaturado(l.quantity_base ?? l.quantity, l.quantity_invoiced);
            return (
              <View key={l.key} style={{ gap: 1 }}>
                <LinhaValor forte rotulo={itemCompacto(l.description, l.quantity, l.unit_label || 'UN')} valor={formatBRL(l.total_cents)} />
                {ajuste ? <Text style={t.small}>{ajuste}</Text> : null}
                {l.application ? (
                  <Text style={t.small} testID={`aplicacao-${l.erp_code}`}>
                    Aplicação: {l.application}
                  </Text>
                ) : null}
                {faturado ? <Text style={[t.small, { color: colors.accentInk }]}>{faturado}</Text> : null}
              </View>
            );
          })}
          {rotuloVerTodos ? <LinkTexto rotulo={rotuloVerTodos} onPress={() => setMostrarTodosItens(true)} testID="ver-todos-itens" /> : null}
        </View>

        {/* 3. total separado, com forma, prazo e frete */}
        <View style={{ gap: 4 }} testID="detalhe-total">
          {tabelaDoTotal ? <LinhaValor rotulo="Tabela" valor={formatBRL(subtotal)} /> : null}
          {tabelaDoTotal ? <LinhaValor rotulo={tabelaDoTotal.rotulo} valor={tabelaDoTotal.valor} /> : null}
          <LinhaValor destaque divisor rotulo="Total" valor={formatBRL(total)} testID={ehOrc ? 'orcamento-total' : 'order-total'} />
          {formaPrazoFrete ? (
            <Text style={t.small} testID="orcamento-entrega">
              {formaPrazoFrete}
            </Text>
          ) : null}
          {effectivePct !== null && !ehOrc ? <Text style={t.small}>{`Desconto efetivo (sem frete): ${formatPct(effectivePct)}`}</Text> : null}
          {enderecoTexto ? (
            <Text style={t.small} testID="order-delivery">
              {`Entrega em ${enderecoTexto}`}
            </Text>
          ) : null}
          {base && !queued && base.branch_name ? <Text style={t.small}>{`Filial: ${base.branch_name}`}</Text> : null}
          {!queued && detail?.price_table_name ? <Text style={t.small}>{`Tabela de preço: ${detail.price_table_name}`}</Text> : null}
        </View>

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
                  <Button
                    testID="pedido-rejeitar"
                    label="Rejeitar"
                    icon="close"
                    variant="danger"
                    style={{ flex: 1 }}
                    disabled={offline || deciding}
                    onPress={() => {
                      setSheetError(null);
                      setSheet('reject');
                    }}
                  />
                </View>
                {offline ? (
                  <Text style={t.small} testID="approve-offline">
                    Aprovar exige internet: conecte-se para decidir este pedido.
                  </Text>
                ) : null}
                {detail.aprovacao.acima_do_nivel ? <Text style={t.small}>Este pedido é do nível supervisor; a decisão fica registrada como do gerente.</Text> : null}
              </View>
            ) : status === 'pending_approval' ? (
              <Text style={t.small} testID="approve-wait">
                Aguardando {detail.aprovacao.nivel === 'supervisor' ? 'o supervisor' : detail.aprovacao.nivel === 'gerente' ? 'o gerente' : 'o analista'}.
              </Text>
            ) : null}
          </Card>
        ) : null}

        {/* 4. histórico só com tags (RN-VEN-30): sem "Recebido pelo servidor", motivo em 1 linha, autor só quando não é o vendedor */}
        {tagsDoDetalhe.length > 0 ? (
          <View style={{ gap: 8 }}>
            <RotuloSecao texto="Histórico" />
            <HistoricoEmTags tags={tagsDoDetalhe} titulo="Histórico" testID="detalhe-historico" />
          </View>
        ) : null}

        {mostraNota ? (
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

        <DeleteOrderSheet visible={sheet === 'delete'} title={title} queued={isQueued} ehOrcamento={ehOrc} solicitaAoErp={enviadoAoErp(status) && erpAceitaCancelamento} busy={deleting} error={sheetError} onClose={() => setSheet(null)} onConfirm={(r) => void confirmDelete(r)} />
        <DecisionSheet visible={sheet === 'reject'} title={title} busy={deciding} error={sheetError} onClose={() => setSheet(null)} onConfirm={(motivo) => void decidir('rejeitar', motivo)} />
        <Folha visivel={transformarAberto} onFechar={() => setTransformarAberto(false)} rotuloFechar="Fechar" titulo={folhaTransformar.titulo} testID="folha-conferencia" rodape={{ rotulo: 'Voltar', onPress: () => setTransformarAberto(false), testID: 'conferencia-voltar' }}>
          <View style={{ gap: 8 }}>
            {conferencia?.bloqueio ? (
              <Text style={[t.smallStrong, { color: colors.danger }]} testID="conferencia-bloqueio">
                {conferencia.bloqueio}
              </Text>
            ) : null}
            {(conferencia?.mudancas ?? []).map((m) => (
              <Text key={m} style={t.body}>
                {m}
              </Text>
            ))}
            {folhaTransformar.mostrarTotal && conferencia ? <LinhaValor rotulo="Total" valor={formatBRL(conferencia.total_cents)} destaque divisor testID="conferencia-total" /> : null}
            {folhaTransformar.mostrarTotal && acoesOrc?.pode_editar && ehVendedor ? (
              <Botao
                testID="conferencia-editar"
                rotulo="Editar"
                icone="edit"
                onPress={() => {
                  setTransformarAberto(false);
                  void startDraft('edit');
                }}
              />
            ) : null}
            <OpcaoFolha
              testID="conferencia-enviar"
              icone="send"
              titulo="Enviar pedido"
              subtitulo={folhaTransformar.subtitulo}
              desligado={!folhaTransformar.podeEnviar || busy === 'convert'}
              onPress={() => {
                setTransformarAberto(false);
                void converter();
              }}
            />
          </View>
        </Folha>
        <Text style={[t.small, { textAlign: 'center' }]} testID="order-sync-rodape">
          {auto.rodape}
        </Text>
        <PdfSheet visible={sheet === 'pdf'} busy={pdfBusy} error={sheetError} onClose={fecharPdf} onPick={(v) => void exportPdfFor(v)} />
      </ScrollView>
      {/* 5. rodapé compacto fora do ScrollView; a barra do shell já reserva a área segura de baixo (sem somar insets.bottom) */}
      {rodapeFixo ? <RodapeAcoes principal={principal} acoes={iconesDaTela} testID="rodape-acoes" /> : null}
      <AvisoRapido aviso={sheets.aviso} acima={rodapeFixo ? 120 : 0} />
    </View>
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
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tituloLinha: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  locked: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
});
