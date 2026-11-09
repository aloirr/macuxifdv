/**
 * PDF do pedido (HTML para expo-print). Puro, sem React Native: testado com Vitest.
 *
 * Duas versões:
 * - 'customer' (para o cliente): sem nenhum percentual nem a palavra desconto; por item mostra o preço
 *   unitário final (líquido = total do item ÷ quantidade) e o total. O HTML inteiro não tem '%'.
 * - 'bko' (para o backoffice): preço de tabela, desconto %, preço líquido, alçada, status, motivo e histórico.
 *
 * Layout em grade CSS (sem tabelas com largura percentual), A4, fontes do sistema, cores do app.
 * TODO(fiscal): impostos (ST, ICMS, DIFAL) são calculados no faturamento pelo ERP; o PDF mostra valores sem impostos.
 */
import { formatBRL } from '@macuxi/comum';

import { ORDER_STATUS_LABEL, normalizarStatus, type OrderStatus } from './order';

/** Data/hora no fuso (Intl); local ao domínio para não importar a UI (E5 move isto para @macuxi/comum). */
function zonedParts(at: string, tz: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const d = new Date(at);
  const get = (parts: Intl.DateTimeFormatPart[], t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    return { year: get(parts, 'year'), month: get(parts, 'month'), day: get(parts, 'day'), hour: get(parts, 'hour'), minute: get(parts, 'minute') };
  } catch {
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
  }
}

export type OrderPdfView = 'customer' | 'bko';

export interface OrderPdfItem {
  erp_code: string;
  description: string;
  quantity: number;
  /** preço de TABELA por unidade */
  unit_price_cents: number;
  /** total líquido do item (já com o desconto) */
  total_cents: number;
  /** T-0061 (RN-CORE-19): coluna Medida, "UN" ou "CX c/ 12"; ausente = unidade */
  unit_label?: string;
  /** desconto/acréscimo do ITEM (versão interna); ausente = pedido antigo (vale o do pedido) */
  discount_pct?: number;
  surcharge_pct?: number;
  /** T-0084 (RN-VEN-19): retrato da aplicação, "Aplicação: …" abaixo da descrição nos dois PDFs; ausente/nulo = não sai */
  application?: string | null;
  /**
   * T-0138 (RN-CAT-09/10, desenho T-0085 §5): referências cruzadas do produto (`catalogo.textos_produto@1`, até 3), lidas na hora de
   * gerar o PDF. NÃO são retrato do pedido. Saem como "Equivale a: <marca> <código>" no PDF interno (sempre) e no PDF do cliente só com
   * `referencia_no_orcamento` ligado.
   */
  references?: ReadonlyArray<{ brand: string; code: string }>;
}

/** Frete CIF (empresa paga) ou FOB (cliente paga, com transportadora). Sem valor (RN-VEN-13, RN-VEN-16). */
export interface OrderPdfFreight {
  modality: 'CIF' | 'FOB';
  carrier_name?: string | null;
  carrier_document?: string | null;
  carrier_phone?: string | null;
  carrier_typed?: boolean;
}

export interface OrderPdfEvent {
  at: string;
  status: string;
  by: string;
  note: string;
}

export interface OrderPdfOrder {
  /** número do pedido; null = ainda na fila do aparelho */
  number: string | null;
  status: string;
  /** data/hora do pedido (ISO, UTC) */
  created_at: string;
  customer: { legal_name: string; trade_name: string; cnpj: string; address: string; district: string; city: string; erp_code: string };
  seller_name: string;
  /** RN-VEN-35: pedido em nome; quem digitou (o gestor). Ausente = pedido do próprio vendedor */
  made_by?: string;
  payment_terms: string;
  discount_pct: number;
  items: OrderPdfItem[];
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  pending_reason: string;
  rejection_reason: string;
  price_table: string;
  /** nome da tabela de preço (T-0061); o PDF interno mostra o nome, não o id */
  price_table_name?: string | null;
  branch_name: string;
  erp_order_code: string;
  /** alçada de desconto do vendedor (%), quando conhecida */
  seller_limit_pct: number | null;
  history: OrderPdfEvent[];
  // --- T-0061 ---
  freight?: OrderPdfFreight | null;
  /** endereço de entrega em uma linha */
  delivery_address?: string;
  surcharge_pct?: number;
  /** desconto efetivo (RN-VEN-03); negativo = acréscimo */
  effective_discount_pct?: number | null;
  // --- T-0071 (RF-VEN-03, RN-VEN-18) ---
  /** ausente = pedido */
  tipo?: 'pedido' | 'orcamento';
  /** último dia válido do orçamento (AAAA-MM-DD, data civil do tenant) */
  validade_data?: string | null;
}

export interface OrderPdfContext {
  tenant_name: string;
  product_name: string;
  tz: string;
  /** momento da geração (ISO) */
  generated_at: string;
  /** `referencia_no_orcamento` do tenant (RN-CAT-10, padrão não): a referência cruzada também sai no PDF do cliente */
  reference_on_customer_pdf?: boolean;
}

const ROTULO_EXTRA: Record<string, string> = { cancelled: 'Excluído', edited: 'Editado' };

export function statusText(status: string): string {
  const n = normalizarStatus(status);
  return ROTULO_EXTRA[n] ?? ORDER_STATUS_LABEL[(n in ORDER_STATUS_LABEL ? n : 'received') as OrderStatus] ?? n;
}

export function escapeHtml(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 12/10/2026 14:32 no fuso da empresa. */
export function pdfDateTime(at: string, tz: string): string {
  const p = zonedParts(at, tz);
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Preço unitário final (líquido) = total do item ÷ quantidade, arredondado ao centavo. */
export function netUnitCents(item: Pick<OrderPdfItem, 'quantity' | 'total_cents'>): number {
  return item.quantity > 0 ? Math.round(item.total_cents / item.quantity) : 0;
}

function pctText(n: number): string {
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
}

/** Nome da distribuidora no cabeçalho: o do login; senão `parametros.core.tenant_nome` (T-0061 §7); senão "Macuxi". */
export function nomeDaDistribuidora(nomeLogin: string | null | undefined, parametrosCore: Readonly<Record<string, unknown>> | null | undefined): string {
  const doParametro = parametrosCore?.tenant_nome;
  if (nomeLogin && nomeLogin.trim()) return nomeLogin.trim();
  if (typeof doParametro === 'string' && doParametro.trim()) return doParametro.trim();
  return 'Macuxi';
}

export function formatCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Rótulo e valor do documento do cliente: 11 dígitos = CPF, 14 = CNPJ; outro tamanho mantém "CNPJ" com o texto original. */
export function documentoCliente(doc: string): { rotulo: 'CPF' | 'CNPJ'; valor: string } {
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return { rotulo: 'CPF', valor: `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` };
  return { rotulo: 'CNPJ', valor: formatCnpj(doc) };
}

/** Tabela de preço: o nome; sem nome, o id técnico (UUID) nunca aparece. */
export function priceTableLabel(id: string, nome?: string | null): string {
  if (nome && nome.trim()) return nome.trim();
  if (!id) return 'Padrão';
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? 'Padrão do cliente' : id;
}

/** "Frete: CIF – por conta da empresa" · "Frete: FOB – por conta do cliente · Transp. (CNPJ 00.000.000/0000-00)". */
export function textoFrete(f: OrderPdfFreight | null | undefined): string {
  if (!f) return '';
  if (f.modality === 'CIF') return 'Frete: CIF – por conta da empresa';
  const nome = (f.carrier_name ?? '').trim();
  const doc = f.carrier_document ? formatCnpj(f.carrier_document) : '';
  const transp = nome ? ` · ${nome}${doc ? ` (CNPJ ${doc})` : ''}` : '';
  return `Frete: FOB – por conta do cliente${transp}`;
}

/** Nome sugerido do arquivo: pedido-10521-cliente.pdf · pedido-no-aparelho-bko.pdf · orcamento-10521-cliente.pdf */
export function orderPdfFileName(number: string | null, view: OrderPdfView, tipo: 'pedido' | 'orcamento' = 'pedido'): string {
  const n = number ? number.replace(/[^\w-]/g, '') : 'no-aparelho';
  return `${tipo === 'orcamento' ? 'orcamento' : 'pedido'}-${n}-${view === 'customer' ? 'cliente' : 'bko'}.pdf`;
}

/** AAAA-MM-DD -> dd/mm/aaaa (data civil: sem conta de fuso). Formato inesperado = vazio. */
export function dataCivilBr(d: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

const CSS = `
@page { size: A4; margin: 14mm 12mm 16mm 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #FFFFFF; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #16202A; font-size: 10pt; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.doc { padding: 0; }
.top { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; border-bottom: 3px solid #C2540A; padding-bottom: 8px; }
.brand { font-size: 15pt; font-weight: 800; letter-spacing: -0.2px; }
.product { font-size: 9pt; color: #4A5562; }
.doc-title { text-align: right; }
.doc-title .kind { font-size: 8pt; font-weight: 700; letter-spacing: 0.8px; color: #C2540A; text-transform: uppercase; }
.doc-title .num { font-size: 16pt; font-weight: 800; }
.meta { display: grid; grid-template-columns: 1.4fr 1fr; gap: 10px; margin-top: 10px; }
.box { border: 1px solid #E1E4DE; border-radius: 8px; padding: 8px 10px; }
.label { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #4A5562; margin-bottom: 3px; }
.strong { font-weight: 700; }
.muted { color: #4A5562; }
.kv { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; row-gap: 2px; }
.kv .k { color: #4A5562; }
.items { margin-top: 12px; border: 1px solid #E1E4DE; border-radius: 8px; overflow: hidden; }
.row { display: grid; gap: 6px; padding: 5px 8px; border-top: 1px solid #ECEEE9; break-inside: avoid; page-break-inside: avoid; align-items: baseline; }
.row.head { border-top: 0; background: #16202A; color: #FFFFFF; font-size: 7.5pt; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; }
.row:nth-child(even):not(.head) { background: #F7F8F5; }
.cols-customer { grid-template-columns: 22mm 1fr 20mm 11mm 25mm 27mm; }
.cols-bko { grid-template-columns: 18mm 1fr 18mm 9mm 20mm 15mm 20mm 23mm; }
.apl { display: block; margin-top: 1px; font-size: 8pt; color: #4A5562; overflow-wrap: anywhere; }
.code { font-family: "SF Mono", Menlo, Consolas, "Roboto Mono", monospace; font-size: 8.5pt; color: #4A5562; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.totals { margin-top: 10px; margin-left: auto; width: 82mm; }
.totals .line { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }
.totals .grand { border-top: 2px solid #16202A; margin-top: 4px; padding-top: 5px; font-size: 13pt; font-weight: 800; }
.totals .disc { color: #8F3D06; }
.section { margin-top: 12px; break-inside: avoid; page-break-inside: avoid; }
.badge { display: inline-block; border-radius: 6px; padding: 1px 7px; font-size: 8.5pt; font-weight: 700; background: #E6E9E2; color: #34404D; }
.badge.warn { background: #FBE9DC; color: #8F3D06; }
.badge.ok { background: #E2F1EA; color: #1D6B4F; }
.badge.bad { background: #FDE8E6; color: #A8261B; }
.reason { margin-top: 4px; color: #8F3D06; }
.hist { display: grid; grid-template-columns: 30mm 34mm 1fr; column-gap: 8px; row-gap: 2px; font-size: 9pt; }
.footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #E1E4DE; font-size: 8.5pt; color: #4A5562; display: grid; gap: 2px; }
`;

function badgeClass(status: string): string {
  if (status === 'integrated' || status === 'invoiced_partial' || status === 'invoiced' || status === 'approved') return 'badge ok';
  if (status === 'pending_approval' || status === 'queued') return 'badge warn';
  if (status === 'rejected' || status === 'cancelled') return 'badge bad';
  return 'badge';
}

function header(order: OrderPdfOrder, view: OrderPdfView, ctx: OrderPdfContext): string {
  const c = order.customer;
  const place = [c.address, c.district, c.city].filter((x) => x && x.trim()).join(' · ');
  const freteTxt = textoFrete(order.freight).replace(/^Frete: /, '');
  const freteHtml = freteTxt ? `<span class="k">Frete</span><span>${escapeHtml(freteTxt)}</span>` : '';
  const orc = order.tipo === 'orcamento';
  const doc = orc ? 'Orçamento' : 'Pedido';
  const numberText = order.number ? `${doc} ${escapeHtml(order.number)}` : `${doc} no aparelho`;
  const validade = orc && dataCivilBr(order.validade_data) ? `<div class="muted">Válido até ${dataCivilBr(order.validade_data)}</div>` : '';
  return `
<div class="top">
  <div>
    <div class="brand">${escapeHtml(ctx.tenant_name)}</div>
  </div>
  <div class="doc-title">
    <div class="kind">${view === 'customer' ? (orc ? 'Orçamento' : 'Pedido de venda') : `${doc} · conferência BKO`}</div>
    <div class="num">${numberText}</div>
    ${validade}
    <div class="muted">${escapeHtml(pdfDateTime(order.created_at, ctx.tz))}${order.number ? '' : ' · ainda na fila do aparelho'}</div>
  </div>
</div>
<div class="meta">
  <div class="box">
    <div class="label">Cliente</div>
    <div class="strong">${escapeHtml(c.legal_name || c.trade_name)}</div>
    ${c.legal_name && c.trade_name && c.legal_name !== c.trade_name ? `<div>${escapeHtml(c.trade_name)}</div>` : ''}
    <div class="muted">${c.cnpj ? (() => { const dc = documentoCliente(c.cnpj); return `${dc.rotulo} ${escapeHtml(dc.valor)}`; })() : 'CNPJ/CPF não informado'}${c.erp_code ? ` · cód. ${escapeHtml(c.erp_code)}` : ''}</div>
    ${place ? `<div class="muted">${escapeHtml(place)}</div>` : ''}
  </div>
  <div class="box kv">
    <span class="k">Vendedor</span><span class="strong">${escapeHtml(order.seller_name)}</span>${order.made_by ? `<span class="k"></span><span class="muted">feito por ${escapeHtml(order.made_by)}</span>` : ''}
    <span class="k">Prazo</span><span>${escapeHtml(order.payment_terms)}</span>
    <span class="k">Data</span><span>${escapeHtml(pdfDateTime(order.created_at, ctx.tz))}</span>
    ${freteHtml}
    ${order.branch_name ? `<span class="k">Filial</span><span>${escapeHtml(order.branch_name)}</span>` : ''}
  </div>
</div>`;
}

/** RN-VEN-19: linha "Aplicação: …" abaixo da descrição do item (texto já cortado no pedido); vazia quando não há retrato. */
function aplicacaoHtml(it: Pick<OrderPdfItem, 'application'>): string {
  const texto = it.application?.trim();
  return texto ? `<span class="apl">Aplicação: ${escapeHtml(texto)}</span>` : '';
}

/** Máximo de referências por item (RN-CAT-09: 3 linhas no cadastro). */
export const MAX_REFERENCIAS_NO_PDF = 3;

/**
 * T-0138 (RN-CAT-09/10): linha "Equivale a: <marca> <código>" abaixo da aplicação. PDF interno sempre; PDF do cliente só com
 * `referencia_no_orcamento`. Sem referência (marca inativa, produto sem cadastro, consulta indisponível) a linha não sai.
 */
export function equivaleAHtml(it: Pick<OrderPdfItem, 'references'>, view: OrderPdfView, ctx: Pick<OrderPdfContext, 'reference_on_customer_pdf'>): string {
  if (view === 'customer' && ctx.reference_on_customer_pdf !== true) return '';
  const refs = (it.references ?? []).filter((r) => r.brand.trim() && r.code.trim()).slice(0, MAX_REFERENCIAS_NO_PDF);
  if (refs.length === 0) return '';
  return `<span class="apl eqv">Equivale a: ${refs.map((r) => `${escapeHtml(r.brand.trim())} <strong>${escapeHtml(r.code.trim())}</strong>`).join(' · ')}</span>`;
}

function customerBody(order: OrderPdfOrder, ctx: OrderPdfContext): string {
  const rows = order.items
    .map(
      (it) => `
  <div class="row cols-customer">
    <span class="code">${escapeHtml(it.erp_code)}</span>
    <span>${escapeHtml(it.description)}${aplicacaoHtml(it)}${equivaleAHtml(it, 'customer', ctx)}</span>
    <span>${escapeHtml(it.unit_label || 'UN')}</span>
    <span class="num">${it.quantity}</span>
    <span class="num">${formatBRL(netUnitCents(it))}</span>
    <span class="num strong">${formatBRL(it.total_cents)}</span>
  </div>`,
    )
    .join('');
  return `
<div class="items">
  <div class="row head cols-customer"><span>Código</span><span>Descrição</span><span>Medida</span><span class="num">Qtd</span><span class="num">Preço unit.</span><span class="num">Total</span></div>${rows}
</div>
<div class="totals">
  <div class="line grand"><span>Total do pedido</span><span class="num">${formatBRL(order.total_cents)}</span></div>
  <div class="line muted"><span>${order.items.length} ${order.items.length === 1 ? 'item' : 'itens'} · ${order.items.reduce((s, i) => s + i.quantity, 0)} un.</span><span>Prazo ${escapeHtml(order.payment_terms)}</span></div>
</div>
<div class="footer">
  <div>Vendedor: <span class="strong">${escapeHtml(order.seller_name)}</span>${order.made_by ? ` (feito por ${escapeHtml(order.made_by)})` : ''} · Prazo de pagamento: ${escapeHtml(order.payment_terms)}</div>
  ${order.freight ? `<div class="strong">${escapeHtml(textoFrete(order.freight))}</div>` : ''}
  ${order.delivery_address ? `<div>Entrega: ${escapeHtml(order.delivery_address)}</div>` : ''}
  <div>Valores sem impostos; impostos calculados no faturamento.</div>
  <div>Preços e disponibilidade sujeitos à confirmação no faturamento.</div>
  <div>Gerado pelo ${escapeHtml(ctx.product_name || 'Macuxi FDV')}</div>
</div>`;
}

/** Coluna Desc./Acr. do item: pedido antigo (sem o campo do item) mostra o desconto do pedido. */
function itemAdjustText(it: OrderPdfItem, orderPct: number): string {
  if ((it.surcharge_pct ?? 0) > 0) return `+${pctText(it.surcharge_pct!)}`;
  if (it.discount_pct === undefined) return pctText(orderPct);
  return it.discount_pct > 0 ? `−${pctText(it.discount_pct)}` : '—';
}

function bkoBody(order: OrderPdfOrder, ctx: OrderPdfContext): string {
  const pct = order.discount_pct;
  const rows = order.items
    .map(
      (it) => `
  <div class="row cols-bko">
    <span class="code">${escapeHtml(it.erp_code)}</span>
    <span>${escapeHtml(it.description)}${aplicacaoHtml(it)}${equivaleAHtml(it, 'bko', ctx)}</span>
    <span>${escapeHtml(it.unit_label || 'UN')}</span>
    <span class="num">${it.quantity}</span>
    <span class="num">${formatBRL(it.unit_price_cents)}</span>
    <span class="num">${itemAdjustText(it, pct)}</span>
    <span class="num">${formatBRL(netUnitCents(it))}</span>
    <span class="num strong">${formatBRL(it.total_cents)}</span>
  </div>`,
    )
    .join('');
  const reason = order.status === 'pending_approval' ? order.pending_reason : order.status === 'rejected' || order.status === 'cancelled' ? order.rejection_reason : '';
  const limit = order.seller_limit_pct;
  const efetivo = order.effective_discount_pct ?? pct;
  const aboveLimit = limit !== null && efetivo > limit;
  const acrescimoPedido = order.surcharge_pct ?? 0;
  const hist = order.history.slice(-8);
  return `
<div class="items">
  <div class="row head cols-bko"><span>Código</span><span>Descrição</span><span>Medida</span><span class="num">Qtd</span><span class="num">Tabela</span><span class="num">Desc./Acr.</span><span class="num">Líquido</span><span class="num">Total</span></div>${rows}
</div>
<div class="totals">
  <div class="line"><span>Subtotal de tabela</span><span class="num">${formatBRL(order.subtotal_cents)}</span></div>
  ${
    acrescimoPedido > 0
      ? `<div class="line"><span>Acréscimo do pedido ${pctText(acrescimoPedido)}</span><span class="num">+ ${formatBRL(Math.max(0, order.total_cents - order.subtotal_cents))}</span></div>`
      : `<div class="line disc"><span>Desconto ${pctText(pct)}</span><span class="num">− ${formatBRL(order.discount_cents)}</span></div>`
  }
  ${order.effective_discount_pct != null ? `<div class="line muted"><span>Desconto efetivo (sem frete)</span><span class="num">${pctText(order.effective_discount_pct)}</span></div>` : ''}
  <div class="line grand"><span>Total</span><span class="num">${formatBRL(order.total_cents)}</span></div>
</div>
<div class="meta section">
  <div class="box kv">
    <span class="k">Status</span><span><span class="${badgeClass(order.status)}">${escapeHtml(statusText(order.status))}</span></span>
    <span class="k">Alçada do vendedor</span><span>${limit === null ? '—' : `${pctText(limit)}${aboveLimit ? ' · <span class="disc strong">desconto acima da alçada</span>' : ' · dentro da alçada'}`}</span>
    <span class="k">Tabela de preço</span><span>${escapeHtml(priceTableLabel(order.price_table, order.price_table_name))}</span>
    ${order.delivery_address ? `<span class="k">Entrega</span><span>${escapeHtml(order.delivery_address)}</span>` : ''}
    ${order.erp_order_code ? `<span class="k">Pedido no ERP</span><span>${escapeHtml(order.erp_order_code)}</span>` : ''}
  </div>
  <div class="box">
    <div class="label">${order.status === 'pending_approval' ? 'Motivo da pendência' : order.status === 'rejected' ? 'Motivo da rejeição' : order.status === 'cancelled' ? 'Exclusão' : 'Observação'}</div>
    <div class="${reason ? 'reason' : 'muted'}">${escapeHtml(reason || 'Sem pendências.')}</div>
  </div>
</div>
${
  hist.length > 0
    ? `<div class="section box">
  <div class="label">Histórico</div>
  <div class="hist">${hist
    .map((e) => `<span class="muted">${escapeHtml(pdfDateTime(e.at, ctx.tz))}</span><span class="strong">${escapeHtml(statusText(e.status))}</span><span>${escapeHtml([e.by, e.note].filter(Boolean).join(' · '))}</span>`)
    .join('')}</div>
</div>`
    : ''
}
<div class="footer">
  <div>Valores sem impostos; impostos calculados no faturamento.</div>
  <div>Gerado em ${escapeHtml(pdfDateTime(ctx.generated_at, ctx.tz))} · uso interno · Gerado pelo ${escapeHtml(ctx.product_name || 'Macuxi FDV')}</div>
</div>`;
}

/** HTML completo do PDF do pedido. */
export function buildOrderPdfHtml(order: OrderPdfOrder, view: OrderPdfView, ctx: OrderPdfContext): string {
  const title = orderPdfFileName(order.number, view).replace(/\.pdf$/, '');
  // TODO(fiscal): impostos não entram aqui; o ERP calcula no faturamento.
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="doc">
${header(order, view, ctx)}
${view === 'customer' ? customerBody(order, ctx) : bkoBody(order, ctx)}
</div>
</body>
</html>`;
}

/** "Rua A, 10 – Galpão 2 · Distrito · Manaus/AM · CEP 69100-000". */
export function enderecoEmLinha(e: { logradouro: string; numero?: string | null; complemento?: string | null; bairro?: string | null; cidade: string; uf: string; cep?: string | null }): string {
  const rua = [[e.logradouro, e.numero].filter((x) => x && x.trim()).join(', '), e.complemento].filter((x) => x && x.trim()).join(' – ');
  const cep = e.cep ? `CEP ${e.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : '';
  return [rua, e.bairro, e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ''}` : '', cep].filter((x) => x && x.trim()).join(' · ');
}

/** Forma mínima do `OrderDetail` (contracts) que o PDF usa; estrutural para o domínio não importar `contracts`. */
export interface DetalheParaPdf {
  number: string;
  status: string;
  received_at: string;
  created_offline_at?: string | null;
  seller_name: string;
  customer_name: string;
  payment_terms: string;
  discount_pct: number;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  pending_reason: string;
  rejection_reason: string;
  erp_order_code: string;
  price_table_id: string | null;
  branch_name?: string | null;
  items: Array<{ erp_code: string; description: string; quantity: number; unit_price_cents: number; total_cents: number; unit_label?: string | null; discount_pct?: number; surcharge_pct?: number; application?: string | null }>;
  history: OrderPdfEvent[];
  // --- T-0061 (opcionais; detalhe antigo sai igual) ---
  freight?: OrderPdfFreight | null;
  price_table_name?: string | null;
  delivery_address?: { logradouro: string; numero?: string | null; complemento?: string | null; bairro?: string | null; cidade: string; uf: string; cep?: string | null } | null;
  surcharge_pct?: number;
  effective_discount_pct?: number | null;
  cliente?: {
    razao_social: string;
    nome_fantasia: string;
    documento: string | null;
    endereco: string;
    bairro: string;
    cidade: string;
    codigo_erp: string;
  } | null;
  aprovacao?: { limite_vendedor_pct: number } | null;
  /** T-0071: orçamento sai com título e validade; ausente = pedido */
  tipo?: 'pedido' | 'orcamento';
  validade_data?: string | null;
}

/**
 * Monta o `OrderPdfOrder` do detalhe do pedido (BKO, Gestão online) ou das linhas locais (Campo, Gestão offline).
 * Pedido ainda na fila (`queued`/`draft`) sai sem número. Versão cliente não usa nenhum campo de desconto.
 */
export function pdfDoPedido(d: DetalheParaPdf): OrderPdfOrder {
  const c = d.cliente;
  return {
    number: d.status === 'queued' || d.status === 'draft' || !d.number ? null : d.number,
    status: d.status,
    created_at: d.created_offline_at || d.received_at,
    customer: {
      legal_name: c?.razao_social ?? d.customer_name,
      trade_name: c?.nome_fantasia ?? d.customer_name,
      cnpj: c?.documento?.trim() ?? '',
      address: c?.endereco ?? '',
      district: c?.bairro ?? '',
      city: c?.cidade ?? '',
      erp_code: c?.codigo_erp ?? '',
    },
    seller_name: d.seller_name,
    payment_terms: d.payment_terms,
    discount_pct: d.discount_pct,
    items: d.items.map((i) => ({
      erp_code: i.erp_code,
      description: i.description,
      quantity: i.quantity,
      unit_price_cents: i.unit_price_cents,
      total_cents: i.total_cents,
      unit_label: i.unit_label || 'UN',
      ...(i.discount_pct !== undefined && d.effective_discount_pct != null ? { discount_pct: i.discount_pct } : {}),
      ...(i.surcharge_pct ? { surcharge_pct: i.surcharge_pct } : {}),
      ...(i.application ? { application: i.application } : {}),
    })),
    subtotal_cents: d.subtotal_cents,
    discount_cents: d.discount_cents,
    total_cents: d.total_cents,
    pending_reason: d.pending_reason,
    rejection_reason: d.rejection_reason,
    price_table: d.price_table_id ?? '',
    price_table_name: d.price_table_name ?? null,
    freight: d.freight ?? null,
    branch_name: d.branch_name ?? '',
    erp_order_code: d.erp_order_code,
    seller_limit_pct: d.aprovacao?.limite_vendedor_pct ?? null,
    history: d.history,
    ...(d.delivery_address ? { delivery_address: enderecoEmLinha(d.delivery_address) } : {}),
    ...(d.surcharge_pct ? { surcharge_pct: d.surcharge_pct } : {}),
    ...(d.effective_discount_pct != null ? { effective_discount_pct: d.effective_discount_pct } : {}),
    ...(d.tipo === 'orcamento' ? { tipo: 'orcamento' as const, validade_data: d.validade_data ?? null } : {}),
  };
}
