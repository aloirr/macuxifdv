/**
 * Detalhe do pedido: itens, histórico de status e ações (duplicar, editar, excluir, exportar PDF).
 * Pedido da fila mostra o que está no aparelho. Editar/excluir seguem orderActions (domain do Vendedor):
 * só enquanto o pedido não está no ERP, e só com a permissão por ação do manifesto (ADR 0004).
 */
import { formatBRL, formatPct, formatarDocumento } from '@macuxi/comum';
import { useAmbiente, usePode } from '@macuxi/platform-sdk/react';
import { BackLink, Badge, Banner, Botao, Button, Card, colors, dateTimeLabel, EstadoVazio, fonts, Folha, Icon, LinhaValor, Loading, OpcaoFolha, SectionHeader, Selo, type as t, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { OrderEvent } from '../../contracts';
import type { NivelDePreco } from '../../domain/preco-pedido';
import { sellerDiscountLimit } from '../../domain/order';
import { textoItemFaturado } from '../../domain/retorno-erp';
import { vendedorDoPdf } from '../../domain/pedido-em-nome';
import { AvisoRapido, useAviso } from '../components/aviso';
import { pegarAvisoPendente } from '../lib/aviso-pendente';
import { DecisionSheet, DeleteOrderSheet, PdfSheet } from '../components/order-sheets';
import { estadoDasAcoes, rotuloDoNivel, TEXTO_SEM_ITENS } from '../lib/acoes-pedido';
import { toDomainPolicy } from '../lib/catalog';
import { buildOrderPdfHtml, nomeDaDistribuidora, orderPdfFileName, pdfDoPedido, type OrderPdfOrder, type OrderPdfView } from '../lib/order-pdf';
import { errorMessage } from '../lib/erros';
import { rotuloDoFrete, textoDoEndereco } from '../lib/novo-pedido';
import { pedidoSomenteLeitura } from '../lib/somente-leitura';
import { orderNote, statusBadge, statusBadgeDaLinha } from '../lib/order-status';
import { estadoNaFila, ROTULO_CORRIGIR_PEDIDO } from '../lib/salvar-na-fila';
import { exportPdf } from '../lib/pdf-export';
import { relogioReal } from '@macuxi/comum/relogio';
import { acoesNaTela, rotuloDoDocumento, situacaoNaTela, validadeCivilDoDocumento } from '../lib/pre-venda';
import { estadoDoDetalheAusente, folhaDoTransformar, itemCompacto, linhaDeEntrega, linhaDoAjusteSomenteLeitura, ROTULO_TENTAR_DE_NOVO, seloDoOrcamento, textoNaoFoiAceito } from '../lib/textos-pedido';
import { validadeOrcamentoDias } from '../../domain/orcamento';
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
    : (detail?.items ?? []).map((it) => ({ key: it.id, erp_code: it.erp_code, description: it.description, quantity: it.quantity, unit_price_cents: it.unit_price_cents, total_cents: it.total_cents, quantity_invoiced: it.quantity_invoiced, quantity_base: it.quantity_base, unit_label: it.unit_label, discount_pct: it.discount_pct, surcharge_pct: it.surcharge_pct, application: it.application }));
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
  const note = queued ? '' : base ? orderNote(base) : '';
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
  // RN-VEN-18: validade por data civil no fuso do tenant ("até 10/11"), offline
  const validadeData = ehOrc
    ? validadeCivilDoDocumento({ validade_data: queued ? null : (base?.validade_data ?? null), validade_ate: queued ? null : (base?.validade_ate ?? null), criado_em: queued?.criado_em ?? null }, { fuso: tz, dias: validadeOrcamentoDias(ambiente.parametros('vendedor')) })
    : null;
  const situacaoOrc = ehOrc ? situacaoNaTela(doc, agoraTela) : null;
  const numeroConvertido = base && !queued && base.convertido_pedido_id ? (orders.find((o) => o.id === base.convertido_pedido_id)?.number ?? null) : null;
  const selo = ehOrc && situacaoOrc && validadeData ? seloDoOrcamento({ situacao: situacaoOrc, validade_data: validadeData, pedido_numero: numeroConvertido }) : null;
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
      ...(ehOrc ? { tipo: 'orcamento' as const, validade_data: validadeData } : {}),
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
      await exportPdf(html, orderPdfFileName(number, view, pdfOrder().tipo));
      setSheet(null);
    } catch (e) {
      setSheetError(errorMessage(e));
    } finally {
      setPdfBusy(null);
    }
  };

  // V6 (tela 5 da referência): um só cartão com os itens compactos, o ajuste do pedido, o Total e "CIF · 28 dias"; os botões logo abaixo
  const ajusteOrc = linhaDoAjusteSomenteLeitura(surchargePct > 0 ? { sentido: 'acrescimo', cents: Math.max(0, total - subtotal), pct_exibicao: surchargePct } : discount > 0 ? { sentido: 'desconto', cents: discount, pct_exibicao: discountPct } : null);
  const modalidadeOrc = queued ? (queued.payload.frete?.modalidade ?? null) : (base?.freight?.modality ?? null);
  const entregaOrc = modalidadeOrc ? linhaDeEntrega({ modalidade: modalidadeOrc, prazo: terms, endereco: null }) : terms;
  const vencido = ehOrc && situacaoOrc === 'expirado';
  // T-0130: o pedido na fila é só de leitura (sem Editar); o recusado pela API volta com "Corrigir pedido"
  const mostrarEditar = ehOrc ? Boolean(acoesOrc?.pode_editar) : !queued || queued.failed;
  const rotuloEditar = queued ? ROTULO_CORRIGIR_PEDIDO : 'Editar';
  const mostrarDuplicar = ehOrc ? Boolean(acoesOrc?.pode_duplicar) : true;
  const mostrarPdf = ehOrc ? Boolean(acoesOrc?.pode_pdf) : true;
  const mostrarCancelar = ehOrc ? Boolean(acoesOrc?.pode_cancelar) : true;
  const filaDeBotoes = (itens: Array<ReactElement | false | null>, testID: string) => {
    const presentes = itens.filter((x): x is ReactElement => Boolean(x));
    return presentes.length > 0 ? (
      <View style={styles.actionsRow} testID={testID}>
        {presentes}
      </View>
    ) : null;
  };
  const botaoEditar = mostrarEditar && ehVendedor ? <Botao key="editar" testID="pedido-editar" rotulo={rotuloEditar} icone="edit" alto style={{ flex: 1 }} desligado={!canEdit || busy !== null} ocupado={busy === 'edit'} onPress={() => void startDraft('edit')} /> : null;
  const botaoPdf = mostrarPdf ? (
    <Botao
      key="pdf"
      testID="action-pdf"
      rotulo="PDF"
      icone="file"
      alto
      style={{ flex: 1 }}
      desligado={!hasLines}
      onPress={() => {
        setSheetError(null);
        setSheet('pdf');
      }}
    />
  ) : null;
  const botaoDuplicar =
    mostrarDuplicar && ehVendedor ? (
      <Botao
        key="duplicar"
        testID="pedido-duplicar"
        rotulo="Duplicar"
        icone="copy"
        nivel={vencido ? 'principal' : 'neutro'}
        alto={!vencido}
        style={vencido ? undefined : { flex: 1 }}
        desligado={!ehVendedor || !podeCriar || !podeDuplicarDoc || !hasLines || busy !== null}
        ocupado={busy === 'duplicate'}
        onPress={() => void startDraft('duplicate')}
      />
    ) : null;
  const botaoCancelarOrc = mostrarCancelar ? (
    <Botao
      key="cancelar"
      testID="pedido-excluir"
      rotulo="Cancelar orçamento"
      icone="trash"
      nivel="perigo"
      alto
      style={{ flex: 1 }}
      desligado={!podeExcluirDoc}
      onPress={() => {
        setSheetError(null);
        setSheet('delete');
      }}
    />
  ) : null;
  const blocoOrcamento = somenteLeitura ? null : (
    <View style={{ gap: 10 }} testID="order-actions">
      {acoesOrc?.pode_converter && !queued ? (
        <Botao testID="orcamento-converter" rotulo="Transformar em pedido" icone="send" nivel="principal" desligado={!podeCriar || !hasLines || busy !== null} ocupado={busy === 'convert'} onPress={() => void transformar()} />
      ) : null}
      {vencido ? botaoDuplicar : null}
      {filaDeBotoes([botaoEditar, botaoPdf], 'orcamento-fila-1')}
      {vencido ? null : filaDeBotoes([botaoDuplicar, botaoCancelarOrc], 'orcamento-fila-2')}
      {acoesOrc?.texto ? <Text style={t.small}>{acoesOrc.texto}</Text> : null}
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
    </View>
  );
  const blocoAcoes = (
    <>
      {/* RN-PRO-01: sem permissão de escrita, nenhuma ação renderiza */}
      {somenteLeitura ? null : (
    <View style={{ gap: 8 }} testID="order-actions">
      <SectionHeader title="Ações" />
      <Card style={{ padding: 14, gap: 10 }}>
        {ehOrc && acoesOrc?.pode_converter && !queued ? (
          <Botao
            testID="orcamento-converter"
            rotulo="Transformar em pedido"
            icone="send"
            nivel="principal"
            desligado={!podeCriar || !hasLines || busy !== null}
            ocupado={busy === 'convert'}
            onPress={() => void transformar()}
          />
        ) : null}
        {ehOrc && acoesOrc?.texto ? <Text style={t.small}>{acoesOrc.texto}</Text> : null}
        {ehVendedor && (mostrarEditar || mostrarDuplicar) ? (
          <View style={styles.actionsRow}>
            {mostrarEditar ? (
              <Botao testID="pedido-editar" rotulo={rotuloEditar} icone="edit" alto style={{ flex: 1 }} desligado={!canEdit || busy !== null} ocupado={busy === 'edit'} onPress={() => void startDraft('edit')} />
            ) : null}
            {mostrarDuplicar ? (
              <Botao
                testID="pedido-duplicar"
                rotulo="Duplicar"
                icone="copy"
                alto
                style={{ flex: 1 }}
                desligado={!ehVendedor || !podeCriar || !podeDuplicarDoc || !hasLines || busy !== null}
                ocupado={busy === 'duplicate'}
                onPress={() => void startDraft('duplicate')}
              />
            ) : null}
          </View>
        ) : null}
        <View style={styles.actionsRow}>
          {mostrarPdf ? (
            <Botao
              testID="action-pdf"
              rotulo="PDF"
              icone="file"
              alto
              style={{ flex: 1 }}
              desligado={!hasLines}
              onPress={() => {
                setSheetError(null);
                setSheet('pdf');
              }}
            />
          ) : null}
          {mostrarCancelar ? (
            <Botao
              testID="pedido-excluir"
              rotulo={ehOrc ? 'Cancelar orçamento' : 'Excluir'}
              icone="trash"
              nivel="perigo"
              alto
              style={{ flex: 1 }}
              desligado={!podeExcluirDoc}
              onPress={() => {
                setSheetError(null);
                setSheet('delete');
              }}
            />
          ) : null}
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
    </>
  );

  return (
    <View style={styles.root}>
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: Math.max(16, insets.top + 4), paddingHorizontal: 20, paddingBottom: 24, gap: 14 }}
      refreshControl={<RefreshControl refreshing={auto.puxando} onRefresh={auto.puxar} />}>
      <BackLink label="Pedidos" fallback={hrefPedidos()} />
      <View style={{ gap: 6 }}>
        <Text style={t.h1Small} testID="order-title">
          {title}
        </Text>
        <Text style={t.sub}>{sellerNameHeader ? `${customerName} · ${sellerNameHeader}` : customerName}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {selo ? <Selo testID="orcamento-selo" texto={selo.texto} tom={selo.tom} tamanho="m" pilula /> : ehOrc ? <Selo testID="orcamento-selo" texto={rotuloDoDocumento(doc, agoraTela)} tom="neutro" tamanho="m" pilula /> : null}
          {ehOrc && !queued ? null : <Badge label={b.label} fg={b.fg} bg={b.bg} />}
          {base && !queued && base.erp_order_code ? <Badge label={`ERP ${base.erp_order_code}`} tone="neutral" /> : null}
        </View>
        {note ? <Text style={[t.small, { color: b.fg }]}>{note}</Text> : null}
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

      {ehOrc ? (
        <>
          <Card style={{ padding: 14, gap: 8 }} testID="orcamento-resumo">
            {lines.length === 0 ? <Text style={t.sub}>{TEXTO_SEM_ITENS}</Text> : null}
            {lines.map((l) => (
              <LinhaValor key={l.key} forte rotulo={itemCompacto(l.description, l.quantity, l.unit_label || 'UN')} valor={formatBRL(l.total_cents)} />
            ))}
            {ajusteOrc ? <LinhaValor rotulo={ajusteOrc.rotulo} valor={ajusteOrc.valor} /> : null}
            <LinhaValor destaque divisor rotulo="Total" valor={formatBRL(total)} testID="orcamento-total" />
            <Text style={t.small} testID="orcamento-entrega">
              {entregaOrc}
            </Text>
          </Card>
          {blocoOrcamento}
        </>
      ) : (
      <Card style={{ padding: 14, gap: 6 }}>
        <Row label="Subtotal" value={formatBRL(subtotal)} />
        {surchargePct > 0 ? <Row label={`Acréscimo do pedido ${formatPct(surchargePct)}`} value={`+ ${formatBRL(Math.max(0, total - subtotal))}`} /> : discount > 0 ? <Row label={`Desconto ${formatPct(discountPct)}`} value={`− ${formatBRL(discount)}`} /> : null}
        {effectivePct !== null ? <Row label="Desconto efetivo (sem frete)" value={formatPct(effectivePct)} /> : null}
        <Row label={`Total · prazo ${terms}`} value={formatBRL(total)} strong />
        {base && !queued && base.branch_name ? <Row label="Filial" value={base.branch_name} /> : null}
        {!queued && detail?.price_table_name ? <Row label="Tabela de preço" value={detail.price_table_name} /> : null}
      </Card>
      )}

      {!ehOrc && (freteTexto || enderecoTexto) ? (
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

      {ehOrc ? null : (
      <View style={{ gap: 8 }}>
        <SectionHeader title="Itens" right={lines.length > 0 ? `${lines.length} ${lines.length === 1 ? 'item' : 'itens'}` : undefined} />
        <Card>
          {lines.length === 0 ? <Text style={[t.sub, { padding: 14 }]}>{TEXTO_SEM_ITENS}</Text> : null}
          {lines.map((l, i) => (
            <View key={l.key} style={[styles.item, i < lines.length - 1 && styles.divider]}>
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={t.mono}>{l.erp_code}</Text>
                <Text style={t.bodyStrong}>{l.description}</Text>
                {l.application ? <Text style={t.small} testID={`aplicacao-${l.erp_code}`}>Aplicação: {l.application}</Text> : null}
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
      )}

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

      {ehOrc ? null : blocoAcoes}

      <DeleteOrderSheet visible={sheet === 'delete'} title={title} queued={isQueued} ehOrcamento={ehOrc} busy={deleting} error={sheetError} onClose={() => setSheet(null)} onConfirm={(r) => void confirmDelete(r)} />
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
      <PdfSheet visible={sheet === 'pdf'} busy={pdfBusy} error={sheetError} onClose={() => setSheet(null)} onPick={(v) => void exportPdfFor(v)} />
    </ScrollView>
    <AvisoRapido aviso={sheets.aviso} />
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
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  rail: { width: 2, flex: 1, backgroundColor: colors.lineSoft, marginTop: 2 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  locked: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
});
