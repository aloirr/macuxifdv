/**
 * Detalhe do pedido e do orçamento (RF-VEN-05, T-0138; spec docs/design/pedido-v2.md §4): cabeçalho em destaque (número, tag,
 * cliente com código, vendedor) -> itens -> total separado com forma, prazo e frete -> histórico em tags (RN-VEN-30) -> rodapé
 * compacto com 1 ação grande e as outras em ícone + rótulo curto; Cancelar fica no menu ⋮, com confirmação.
 * Pedido da fila mostra o que está no aparelho. Editar/cancelar seguem orderActions (domain do Vendedor, RN-VEN-31):
 * só enquanto o pedido não está no ERP (ou com o aceite do conector), e só com a permissão por ação do manifesto (ADR 0004).
 */
import { formatBRL } from '@macuxi/comum';
import { useAmbiente, usePode } from '@macuxi/platform-sdk/react';
import { BackLink, Botao, Card, colors, dateTimeLabel, Dialogo, EstadoVazio, fonts, Folha, HistoricoEmTags, LinhaValor, LinkTexto, Loading, MenuMais, OpcaoFolha, RodapeAcoes, RotuloSecao, TabelaValores, tagsDoHistorico, type as t, useAtualizacaoAutomatica, type AcaoCompacta } from '@macuxi/ui/mobile';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { OrderEvent } from '../../contracts';
import type { MudancaNaConversao } from '../../domain/orcamento';
import type { NivelDePreco } from '../../domain/preco-pedido';
import { referenciaNoOrcamento } from '../../domain/aplicacao';
import { soOrcamentoPorAlertas } from '../../domain/alertas-pedido';
import { enviadoAoErp, sellerDiscountLimit } from '../../domain/order';
import { textoItemFaturado } from '../../domain/retorno-erp';
import { vendedorDoPdf } from '../../domain/pedido-em-nome';
import { AreaAlertas } from '../components/area-alertas';
import { AvisoRapido, useAviso } from '../components/aviso';
import { CartaoDeTotais, TabelaDeItens, TabelaRotuloValor } from '../components/tabelas-pedido';
import { pegarAvisoPendente } from '../lib/aviso-pendente';
import { DecisionSheet, DeleteOrderSheet, PdfSheet } from '../components/order-sheets';
import { estadoDasAcoes, TEXTO_SEM_ITENS } from '../lib/acoes-pedido';
import { PERGUNTA_DA_ALCADA, perguntaDaAlcada } from '../../domain/botoes-resumo';
import { acoesDoDetalhe, alertasDoDetalhe, clienteComCodigo, eventosDoOrcamento, eventosDoPedido, itensVisiveis, linhaDeItemEmTabela, linhaLiquidaDosTotais } from '../lib/detalhe-pedido';
import { textoDoFrete } from '../lib/resumo-tabela';
import { toDomainPolicy } from '../lib/catalog';
import { buildOrderPdfHtml, nomeDaDistribuidora, orderPdfFileName, pdfDoPedido, type OrderPdfOrder, type OrderPdfView } from '../lib/order-pdf';
import { errorMessage } from '../lib/erros';
import { TEXTOS_ENDERECO } from '../lib/endereco-pedido';
import { textoDoEndereco } from '../lib/novo-pedido';
import { pedidoSomenteLeitura } from '../lib/somente-leitura';
import { estadoNaFila, notaDaEtapaNaFila } from '../lib/salvar-na-fila';
import { exportPdf } from '../lib/pdf-export';
import { relogioReal } from '@macuxi/comum/relogio';
import { acoesNaTela, situacaoNaTela, validadeCivilDoDocumento } from '../lib/pre-venda';
import { estadoDoDetalheAusente, folhaDoTransformar, ROTULO_TENTAR_DE_NOVO } from '../lib/textos-pedido';
import { dataDaValidade, dataDoPrecoDoOrcamento, precoDoOrcamentoVale, validadeOrcamentoDias } from '../../domain/orcamento';
import { folhaPrecosDeHoje, TEXTOS_PRECOS_DE_HOJE, type DadosDosPrecosDeHoje } from '../lib/precos-de-hoje';
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
  // RN-VEN-10 (T-0151): a alçada só aparece na pergunta ao enviar; dentro da alçada, o Transformar segue direto
  const [perguntaAlcada, setPerguntaAlcada] = useState(false);
  // T-0150 🟡 7: o erro de uma ação vira aviso no rodapé, não texto vermelho solto
  const setActionError = (m: string | null) => {
    if (m) sheets.mostrar(m);
  };
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
  const [conferencia, setConferencia] = useState<{ mudancas: string[]; bloqueio: string | null; nivel: NivelDePreco | null; total_cents: number; precos: DadosDosPrecosDeHoje } | null>(null);
  /** T-0141 G: "Ver os N itens" da folha Preços de hoje */
  const [todosOsPrecos, setTodosOsPrecos] = useState(false);
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
  /** RN-VEN-42: o que a reconferência local do orçamento achou (acima do máximo, sem estoque, cliente) vira Alertas no topo */
  const [mudancasDoOrcamento, setMudancasDoOrcamento] = useState<MudancaNaConversao[]>([]);
  const detail = app.detalhe(id ?? '');
  const summary = orders.find((o) => o.id === id) ?? null;
  const queued = fila.find((o) => o.payload.id === id) ?? null;
  const orcamentoAberto = !queued && (detail ?? summary)?.tipo === 'orcamento' && (detail ?? summary)?.status !== 'cancelled';
  const { reconferirOrcamentoLocal } = app;
  const itensDoDetalhe = detail?.items.length ?? 0;
  useEffect(() => {
    if (!orcamentoAberto || !v1 || !id || itensDoDetalhe === 0) {
      setMudancasDoOrcamento([]);
      return;
    }
    let vivo = true;
    void reconferirOrcamentoLocal(id)
      .then((c) => vivo && setMudancasDoOrcamento(c?.mudancas_brutas ?? []))
      .catch(() => vivo && setMudancasDoOrcamento([]));
    return () => {
      vivo = false;
    };
  }, [orcamentoAberto, v1, id, itensDoDetalhe, reconferirOrcamentoLocal]);
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
  const sellerNameHeader = queued ? (ambiente.usuario()?.nome ?? '') : (base?.seller_name ?? '');
  const customerName = queued ? (qd?.customer_name ?? '') : base!.customer_name;
  const number = queued ? null : base!.number;
  const lines: Line[] = queued
    ? (qd?.lines ?? []).map((l) => ({ key: l.product_id + (l.unit_label ?? ''), ...l }))
    : (detail?.items ?? []).map((it) => ({ key: it.id, product_id: it.product_id, erp_code: it.erp_code, description: it.description, quantity: it.quantity, unit_price_cents: it.unit_price_cents, total_cents: it.total_cents, quantity_invoiced: it.quantity_invoiced, quantity_base: it.quantity_base, unit_label: it.unit_label, discount_pct: it.discount_pct, surcharge_pct: it.surcharge_pct, application: it.application }));
  // T-0054 (RF-VEN-05): resumo do retorno do ERP (pull local, vale offline) e notas do detalhe online, quando vierem
  const notasFaturamento = queued ? [] : (detail?.faturamento?.notas ?? []);
  const devolucoes = queued ? [] : (detail?.faturamento?.devolucoes ?? []);
  const subtotal = queued ? (qd?.subtotal_cents ?? 0) : base!.subtotal_cents;
  const discount = queued ? (qd?.discount_cents ?? 0) : base!.discount_cents;
  const total = queued ? (qd?.total_cents ?? 0) : base!.total_cents;
  const discountPct = queued ? queued.payload.discount_pct : base!.discount_pct;
  // T-0061 (RN-VEN-02/03/16/17): desconto efetivo, frete e endereço de entrega do pedido
  const effectivePct = queued ? null : (base!.effective_discount_pct ?? null);
  const enderecoTexto = (() => {
    if (queued) {
      if (queued.payload.endereco_entrega_editado) return textoDoEndereco(queued.payload.endereco_entrega_editado);
      const e = queued.payload.endereco_entrega_id ? app.enderecos.find((x) => x.id === queued.payload.endereco_entrega_id) : null;
      return e ? textoDoEndereco(e) : null;
    }
    return base!.delivery_address ? textoDoEndereco({ ...base!.delivery_address, numero: base!.delivery_address.numero ?? null, complemento: base!.delivery_address.complemento ?? null, bairro: base!.delivery_address.bairro ?? null }) : null;
  })();
  // T-0141 (RN-VEN-17): o endereço foi digitado só neste pedido → selo "Editado neste pedido"
  const enderecoEditado = queued ? Boolean(queued.payload.endereco_entrega_editado) : base!.delivery_address?.origem === 'editado';
  const terms = queued ? queued.payload.payment_terms : base!.payment_terms;
  const history: OrderEvent[] = queued
    ? [{ at: queued.criado_em, status: 'queued', by: 'aparelho', note: notaDaEtapaNaFila({ recusado: queued.failed, criadoSemSinal: Boolean(queued.payload.created_offline_at) }) }]
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
  const title = number ? `${ehOrc ? 'Orçamento' : 'Pedido'} ${number}` : ehOrc ? 'Orçamento no aparelho' : 'Pedido no aparelho';
  const hasLines = lines.length > 0;
  const ehVendedor = !v1 || perfil === 'vendedor';
  const { podeEditar: canEdit, podeExcluir: canDelete } = estadoDasAcoes({
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

  // T-0141 G (RN-VEN-18): depois dos 7 dias do preço e com o total diferente, a folha é "Preços de hoje"; senão, a de sempre
  const precosDeHoje = conferencia && validadeData
    ? folhaPrecosDeHoje({ preco_vale: conferencia.precos.preco_vale, preco_data: dataDaValidade(dataDoPrecoDoOrcamento(validadeData, diasDoPreco)), r: conferencia.precos.r, nome: (pid) => conferencia.precos.nomes[pid] ?? 'Produto', todos: todosOsPrecos })
    : null;

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

  /** RN-VEN-18: Transformar reconfere preço, estoque, mínimo e alçada com os dados do aparelho e abre sempre a folha "Enviar pedido". */
  const transformar = async () => {
    setBusy('convert');
    setActionError(null);
    try {
      const c = v1 ? await app.reconferirOrcamentoLocal(id ?? '') : null;
      setConferencia(c ? { mudancas: c.mudancas, bloqueio: c.bloqueio, nivel: c.nivel, total_cents: c.total_cents, precos: c.precos } : null);
      setTodosOsPrecos(false);
      setTransformarAberto(true);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  /** Enviar pedido da folha: acima da alçada do vendedor pergunta "Enviar para aprovação?" (RN-VEN-10); senão converte direto. */
  const converterOuPerguntar = () => {
    setTransformarAberto(false);
    if (perguntaDaAlcada({ tipo: 'pedido', nivel: conferencia?.nivel ?? null })) setPerguntaAlcada(true);
    else void converter();
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
    const comReferencias = (o: OrderPdfOrder): OrderPdfOrder => ({ ...o, items: o.items.map((it) => { const r = refs.get(idPorCodigo.get(it.erp_code) ?? ''); return r && r.length > 0 ? { ...it, references: r } : it; }), ...(alertasDaTela.length > 0 ? { alertas: alertasDaTela.map((a) => a.texto) } : {}) });
    return comReferencias(pdfBase());
  };
  // T-0141 (RN-VEN-18): o PDF usa o mesmo dia do preço do selo e da folha (uma fonte só)
  const precoDataDoPdf = ehOrc && validadeData ? { preco_data: dataDoPrecoDoOrcamento(validadeData, diasDoPreco) } : {};
  const pdfBase = (): OrderPdfOrder => {
    if (detail && !queued) {
      // o retrato do pedido pode vir sem documento: completa com o cadastro do cliente no aparelho (CNPJ sempre impresso)
      const doc = detail.cliente?.documento?.trim() ? null : dados.clientes.find((x) => x.id === detail.customer_id)?.cnpj;
      const pdf = { ...pdfDoPedido(detail), ...precoDataDoPdf };
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
      pending_reason: queued ? '' : base!.pending_reason,
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
      ...precoDataDoPdf,
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
  // RN-VEN-42 (T-0150): o motivo do supervisor/cancelamento vai para os Alertas; a etapa do Histórico leva só o nome de quem fechou
  const motivoDoFechamento = [...eventosDoHistorico].reverse().find((e) => ['rejected', 'cancelled'].includes(e.status) && e.motivo)?.motivo ?? null;
  const eventosSemMotivo = eventosDoHistorico.map((e) => (['rejected', 'cancelled'].includes(e.status) ? { ...e, motivo: null } : e));
  const tagsDoDetalhe = tagsDoHistorico(eventosSemMotivo, { tipo: ehOrc ? 'orcamento' : 'pedido', tz, agora: agoraTela });
  const modalidade = queued ? (queued.payload.frete?.modalidade ?? null) : (base?.freight?.modality ?? null);
  const transportadora = (() => {
    if (queued) {
      const f = queued.payload.frete;
      if (!f || f.modalidade !== 'FOB') return null;
      return app.transportadoras.find((x) => x.id === f.transportadora_id)?.nome ?? f.transportadora_digitada?.nome ?? null;
    }
    return base?.freight?.carrier_name ?? null;
  })();
  // RN-VEN-42: a área Alertas (recusa do servidor do pedido na fila; no orçamento, o que impede o pedido). A situação fica só no Histórico.
  const alertasDaTela = alertasDoDetalhe({
    recusaDoServidor: queued?.failed && naFila ? naFila.faixa.texto : null,
    recusaDoSupervisor: ehOrc || queued ? null : motivoDoFechamento,
    mudancas: ehOrc ? mudancasDoOrcamento : [],
    codigoDoProduto: (pid) => lines.find((l) => l.product_id === pid)?.erp_code ?? 'Item',
  });
  const acoesDaTela = acoesDoDetalhe({
    alertaImpedeTransformar: ehOrc && soOrcamentoPorAlertas(alertasDaTela),
    tipo: ehOrc ? 'orcamento' : 'pedido',
    status,
    situacao: situacaoOrc,
    naFila: Boolean(queued),
    recusado: Boolean(queued?.failed),
    somenteLeitura,
    precoVencido: ehOrc && !queued && !precoDoOrcamentoVale(base?.validade_ate, agoraTela),
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
  const linhaLiquida = linhaLiquidaDosTotais({ subtotal_cents: subtotal, total_cents: total });
  const tabelaPagamento = [{ rotulo: 'Pagamento', valor: [queued ? null : (base?.forma_pagamento_nome ?? null), queued ? terms : (base?.prazo_descricao ?? terms)].filter(Boolean).join(' · ') }, { rotulo: 'Entrega', valor: [modalidade ? textoDoFrete(modalidade, transportadora) : null, enderecoTexto].filter(Boolean).join(' · ') }];
  // T-0150 🟡 5/6: Nº no ERP, Filial e Tabela são linhas da tabela (só com valor); "Editado neste pedido" é a 2ª linha da Entrega
  const linhasExtras = [
    { rotulo: 'Nº no ERP', valor: base && !queued ? (base.erp_order_code ?? '') : '' },
    { rotulo: 'Filial', valor: base && !queued ? (base.branch_name ?? '') : '' },
    { rotulo: 'Tabela', valor: !queued ? (detail?.price_table_name ?? '') : '' },
  ].filter((l) => l.valor);
  const tabelaBase = [...tabelaPagamento.map((l) => (l.rotulo === 'Entrega' && enderecoEditado ? { ...l, complemento: TEXTOS_ENDERECO.editadoNestePedido, testIDComplemento: 'order-delivery-editado' } : l)), ...linhasExtras];
  const tabelaGestao = !ehVendedor && vendedorNome ? [{ rotulo: 'Vendedor', valor: vendedorNome }, ...tabelaBase] : tabelaBase;
  const { visiveis, rotuloVerTodos } = itensVisiveis(lines, mostrarTodosItens);
  // T-0150 🟡 4: "Enviar agora" é a ação principal do rodapé do pedido na fila (com sinal)
  const principalDoRodape = principal ?? (queued && naFila?.podeEnviarAgora ? { rotulo: 'Enviar agora', icone: 'send' as const, ocupado: flushing, onPress: () => void reenviarFila().then(() => irParaPedidos()), testID: 'pedido-enviar-agora' } : null);
  // T-0150 🔴 3: quem decide (Gestão) vê Aprovar e Rejeitar no rodapé; sem sinal ficam desligados ("Aprovar exige internet")
  const decide = Boolean(detail?.aprovacao && detail.aprovacao.pode_decidir && podeAprovar);
  const rodapeFixo = !somenteLeitura && (principalDoRodape !== null || iconesDaTela.length > 0);

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
          <Text style={t.h1Small} testID="order-title">
            {title}
          </Text>
          <Text style={[t.body, { color: colors.ink }]} testID="detalhe-cliente">
            {clienteComCodigo(customerName, codigoDoCliente)}
          </Text>
        </View>

        {/* RN-VEN-42: área Alertas logo abaixo do cliente; sem selo de situação (a situação é a última etapa do Histórico) */}
        <AreaAlertas alertas={alertasDaTela} aoTocar={ehOrc && acoesOrc?.pode_editar ? () => void startDraft('edit') : undefined} />
        <TabelaRotuloValor linhas={tabelaGestao} testID="detalhe-pagamento-entrega" />


        {/* 2. itens em tabela (RN-VEN-42: "ITENS (n)" com a contagem, não há aba) */}
        <View style={{ gap: 8 }} testID={ehOrc ? 'orcamento-resumo' : 'order-items'}>
          <RotuloSecao texto={`Itens (${lines.length})`} />
          {lines.length === 0 ? <Text style={t.sub}>{TEXTO_SEM_ITENS}</Text> : <TabelaDeItens itens={visiveis.map((l) => ({ key: l.key, ...linhaDeItemEmTabela(l) }))} />}
          {visiveis.map((l) => {
            const faturado = textoItemFaturado(l.quantity_base ?? l.quantity, l.quantity_invoiced);
            return l.application || faturado ? (
              <View key={`${l.key}-extra`} style={{ gap: 1 }}>
                {l.application ? (
                  <Text style={t.small} testID={`aplicacao-${l.erp_code}`}>
                    {`${l.erp_code} · Aplicação: ${l.application}`}
                  </Text>
                ) : null}
                {faturado ? <Text style={[t.small, { color: colors.accentInk }]}>{`${l.erp_code} · ${faturado}`}</Text> : null}
              </View>
            ) : null;
          })}
          {rotuloVerTodos ? <LinkTexto rotulo={rotuloVerTodos} onPress={() => setMostrarTodosItens(true)} testID="ver-todos-itens" /> : null}
        </View>

        {/* 3. totais: Tabela, linha líquida (% sobre a tabela) e Total */}
        <View style={{ gap: 4 }}>
          <CartaoDeTotais tabela={formatBRL(subtotal)} liquida={linhaLiquida} total={formatBRL(total)} testIDTotal={ehOrc ? 'orcamento-total' : 'order-total'} />
        </View>

        {notasFaturamento.length > 0 || devolucoes.length > 0 ? (
          <View style={{ gap: 8 }} testID="order-invoicing">
            <RotuloSecao texto="Faturamento" />
            <Card style={{ padding: 14, gap: 6 }}>
              {notasFaturamento.map((n, i) => (
                <Row key={`nf-${n.numero ?? i}-${n.faturado_em}`} label={`NF ${n.numero ?? '—'}${n.serie ? `/${n.serie}` : ''} · ${dateTimeLabel(n.faturado_em, agoraTela, tz)}${n.parcial ? ' · parcial' : ''}`} value={n.total_cents === null ? `${n.unidades} un.` : formatBRL(n.total_cents)} />
              ))}
              {devolucoes.map((d, i) => (
                <Row key={`dev-${d.numero}-${i}`} label={`Devolução NF ${d.numero}${d.serie ? `/${d.serie}` : ''} · ${dateTimeLabel(d.emitida_em, agoraTela, tz)}`} value={`− ${formatBRL(d.total_cents)}`} />
              ))}
            </Card>
          </View>
        ) : null}

        {/* 4. histórico só com tags (RN-VEN-30): sem "Recebido pelo servidor", motivo em 1 linha, autor só quando não é o vendedor */}
        {tagsDoDetalhe.length > 0 ? (
          <View style={{ gap: 8 }}>
            <RotuloSecao texto="Histórico" />
            <HistoricoEmTags tags={tagsDoDetalhe} titulo="Histórico" testID="detalhe-historico" />
          </View>
        ) : null}

        <DeleteOrderSheet visible={sheet === 'delete'} title={title} queued={isQueued} ehOrcamento={ehOrc} solicitaAoErp={enviadoAoErp(status) && erpAceitaCancelamento} busy={deleting} error={sheetError} onClose={() => setSheet(null)} onConfirm={(r) => void confirmDelete(r)} />
        <DecisionSheet visible={sheet === 'reject'} title={title} busy={deciding} error={sheetError} onClose={() => setSheet(null)} onConfirm={(motivo) => void decidir('rejeitar', motivo)} />
        {precosDeHoje ? (
          <Folha visivel={transformarAberto} onFechar={() => setTransformarAberto(false)} rotuloFechar="Fechar" titulo={precosDeHoje.titulo} fechar={{ rotulo: 'Fechar', testID: 'precos-fechar' }} rolavel testID="folha-precos-de-hoje" rodape={{ rotulo: TEXTOS_PRECOS_DE_HOJE.voltar, onPress: () => setTransformarAberto(false), testID: 'precos-voltar' }}>
            <View style={{ gap: 12 }}>
              <TabelaValores testID="precos-totais" linhas={precosDeHoje.totais.map((x) => ({ id: x.id, rotulo: x.rotulo, valor: x.valor, ...(x.tom ? { tom: x.tom } : {}) }))} />
              {precosDeHoje.mudaram.length > 0 ? (
                <View style={{ gap: 4 }} testID="precos-mudaram">
                  <RotuloSecao texto={TEXTOS_PRECOS_DE_HOJE.mudaram} />
                  {precosDeHoje.mudaram.map((m) => (
                    <LinhaValor key={m.id} rotulo={m.rotulo} valor={m.valor} forte />
                  ))}
                  {precosDeHoje.verTodos ? <LinkTexto rotulo={precosDeHoje.verTodos} onPress={() => setTodosOsPrecos(true)} testID="precos-ver-todos" /> : null}
                </View>
              ) : null}
              {precosDeHoje.semPreco.length > 0 ? (
                <View style={{ gap: 4 }} testID="precos-sem-preco">
                  {precosDeHoje.semPreco.map((n) => (
                    <LinhaValor key={n} rotulo={n} valor={TEXTOS_PRECOS_DE_HOJE.semPrecoHoje} tomValor="erro" />
                  ))}
                </View>
              ) : null}
              <Botao
                testID="precos-transformar"
                nivel="principal"
                rotulo={precosDeHoje.acao}
                desligado={!folhaTransformar.podeEnviar || busy === 'convert'}
                onPress={converterOuPerguntar}
              />
            </View>
          </Folha>
        ) : null}
        <Dialogo
          visivel={perguntaAlcada}
          titulo={PERGUNTA_DA_ALCADA.titulo}
          cancelar={{ rotulo: PERGUNTA_DA_ALCADA.voltar, onPress: () => setPerguntaAlcada(false), testID: 'alcada-voltar' }}
          confirmar={{
            rotulo: PERGUNTA_DA_ALCADA.enviar,
            testID: 'alcada-enviar',
            onPress: () => {
              setPerguntaAlcada(false);
              void converter();
            },
          }}
          testID="pergunta-alcada"
        />
        <Folha visivel={transformarAberto && !precosDeHoje} onFechar={() => setTransformarAberto(false)} rotuloFechar="Fechar" titulo={folhaTransformar.titulo} testID="folha-conferencia" rodape={{ rotulo: 'Voltar', onPress: () => setTransformarAberto(false), testID: 'conferencia-voltar' }}>
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
              desligado={!folhaTransformar.podeEnviar || busy === 'convert'}
              onPress={() => {
                converterOuPerguntar();
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
      {decide ? (
        <View style={[styles.rodapeDecisao, { paddingBottom: 8 + insets.bottom }]} testID="rodape-decisao">
          <Botao testID="pedido-aprovar" nivel="principal" icone="check" rotulo="Aprovar" rotuloAcessivel={offline ? 'Aprovar exige internet' : 'Aprovar o pedido'} desligado={offline || deciding} ocupado={deciding && sheet === null} onPress={() => void decidir('aprovar', '')} />
          <Botao
            testID="pedido-rejeitar"
            nivel="perigo"
            icone="close"
            rotulo="Rejeitar"
            rotuloAcessivel={offline ? 'Rejeitar exige internet' : 'Rejeitar o pedido'}
            desligado={offline || deciding}
            onPress={() => {
              setSheetError(null);
              setSheet('reject');
            }}
          />
        </View>
      ) : rodapeFixo ? (
        <RodapeAcoes principal={principalDoRodape} acoes={iconesDaTela} testID="rodape-acoes" />
      ) : null}
      <AvisoRapido aviso={sheets.aviso} acima={rodapeFixo || decide ? 120 : 0} />
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
  rodapeDecisao: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
});
