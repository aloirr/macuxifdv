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
import { formatarCep, formatarDocumento, formatBRL } from '@macuxi/comum';
import type { FilialDadosFiscais } from '@macuxi/core/contracts';

import { linhaLiquidaDosTotais, semRs, siglaDaMedida } from './apresentacao-totais';
import { dataDaValidade } from './orcamento';
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
  /** T-0159: marca do produto (retrato no pedido, como a aplicação); coluna Marca nos dois PDFs, vazia se ausente */
  brand?: string | null;
}

/** T-0159 (T-0149): retrato da filial de faturamento do pedido; o cabeçalho do PDF do cliente mostra CNPJ, endereço e telefone dela. */
export type OrderPdfFilial = FilialDadosFiscais & { cidade?: string | null; uf?: string | null };

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
  /** RN-VEN-18: dia do preço do orçamento (AAAA-MM-DD, o mesmo do selo); ausente = deriva de created_at */
  preco_data?: string;
  /** T-0159: filial de faturamento do pedido (retrato); ausente = pedido anterior à filial, o cabeçalho sai sem a linha */
  filial?: OrderPdfFilial | null;
  /** T-0159: textos dos alertas da tela (RN-VEN-42, `alertasDoPedido`); o PDF não calcula. Só o pedido do escritório imprime. */
  alertas?: readonly string[];
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

/** Rótulo e valor do documento do cliente: 11 dígitos = CPF, 14 = CNPJ; outro tamanho mantém "CNPJ" com o texto original. */
export function documentoCliente(doc: string): { rotulo: 'CPF' | 'CNPJ'; valor: string } {
  const d = doc.replace(/\D/g, '');
  return { rotulo: d.length === 11 ? 'CPF' : 'CNPJ', valor: formatarDocumento(doc) };
}

/** Tabela de preço: o nome; sem nome, o id técnico (UUID) nunca aparece. */
export function priceTableLabel(id: string, nome?: string | null): string {
  if (nome && nome.trim()) return nome.trim();
  if (!id) return 'Padrão';
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? 'Padrão do cliente' : id;
}

/**
 * RN-VEN-41 (T-0141): nome do arquivo `ORC-0001-09112026.pdf` / `PED-0001-09112026.pdf`. XXXX = número do sistema com no mínimo 4
 * dígitos (acima de 9999 usa todos, sem cortar); DDMMAAAA = data de emissão no fuso do tenant. Sem número (ainda no aparelho):
 * `-PROV-`; o aparelho nunca inventa número. O mesmo documento sai sempre com o mesmo nome (nas duas versões do PDF).
 */
export function orderPdfFileName(number: string | null, createdAt: string, tz: string, tipo: 'pedido' | 'orcamento' = 'pedido'): string {
  const digitos = (number ?? '').replace(/\D/g, '').replace(/^0+/, '');
  const xxxx = number && /\d/.test(number) ? digitos.padStart(4, '0') : 'PROV';
  const p = zonedParts(createdAt, tz);
  return `${tipo === 'orcamento' ? 'ORC' : 'PED'}-${xxxx}-${pad(p.day)}${pad(p.month)}${p.year}.pdf`;
}

const CSS = `
@page { size: A4; margin: 12mm 12mm 14mm 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #FFFFFF; }
body { font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #16202A; font-size: 8.5pt; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cab { display: flex; justify-content: space-between; align-items: center; gap: 8mm; padding-bottom: 3mm; }
.empresa { font-weight: 800; font-size: 12pt; line-height: 1.15; }
.emit { font-size: 7.5pt; color: #4A5562; }
.doc { text-align: right; }
.doc .t { font-weight: 800; font-size: 14pt; line-height: 1.1; }
.doc .t small { font-weight: 700; font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; color: #C2540A; margin-right: 2mm; vertical-align: 2px; }
.doc .d { font-size: 8pt; color: #4A5562; }
.ficha { display: grid; grid-template-columns: repeat(6, 1fr); border: 1px solid #16202A; border-radius: 1.5mm; overflow: hidden; }
.c { padding: 1.6mm 2.4mm 1.8mm; border-right: 1px solid #C9CEC6; border-bottom: 1px solid #C9CEC6; }
.c.fim { border-right: 0; }
.c.base { border-bottom: 0; }
.s2 { grid-column: span 2; } .s3 { grid-column: span 3; } .s4 { grid-column: span 4; }
.r { font-weight: 700; font-size: 6.5pt; letter-spacing: .08em; text-transform: uppercase; color: #5B6673; margin-bottom: .6mm; }
.forte { font-weight: 600; }
.sec { color: #4A5562; }
.faixa { display: grid; grid-template-columns: 22mm 1fr; border: 1px solid #C9CEC6; border-radius: 1.5mm; margin-top: 3mm; break-inside: avoid; page-break-inside: avoid; }
.faixa > div { padding: 1.8mm 2.4mm; }
.faixa .r { margin: 0; align-self: center; }
.faixa.alerta { border-color: #E8B48F; background: #FDF4EC; }
.faixa.alerta .r { color: #8F3D06; }
.faixa.alerta .txt { font-weight: 600; }
.etapas > span + span::before { content: "→"; color: #5B6673; margin: 0 2mm; }
.etapas .q { color: #4A5562; font-variant-numeric: tabular-nums; margin-right: 1mm; }
.etapas .ultima { font-weight: 600; }
table { width: 186mm; border-collapse: collapse; table-layout: fixed; margin-top: 4mm; }
thead { display: table-header-group; }
th { font-weight: 700; font-size: 6.5pt; letter-spacing: .07em; text-transform: uppercase; color: #fff; background: #16202A; text-align: left; padding: 1.6mm 1.8mm; }
td { padding: 1.5mm 1.8mm; vertical-align: top; }
tbody tr:nth-child(even) td { background: #F3F4F1; }
tr { break-inside: avoid; page-break-inside: avoid; }
.v { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
td.cod { font-family: "IBM Plex Mono", Consolas, monospace; font-size: 8pt; color: #4A5562; }
td.emb { white-space: nowrap; }
td.tot { font-weight: 600; }
.apl { display: block; margin-top: 1px; font-size: 7.5pt; color: #4A5562; overflow-wrap: anywhere; }
tfoot td { background: #fff; padding-top: 1mm; padding-bottom: 1mm; }
tfoot tr:first-child td { border-top: 1.5px solid #16202A; padding-top: 2.2mm; }
tfoot .rt { text-align: right; }
tfoot tr.total td { font-weight: 600; padding-top: 1.6mm; }
tfoot .vt { font-weight: 800; font-size: 12pt; }
tfoot .disc td { color: #8F3D06; }
.nota { margin-top: 1.5mm; font-size: 7.5pt; color: #4A5562; }
`;

/** Telefone com máscara: 10 dígitos "(DD) NNNN-NNNN", 11 "(DD) NNNNN-NNNN"; outro tamanho sai como veio. */
export function formatTelefone(t: string): string {
  const d = t.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return t.trim();
}

/**
 * T-0159: identificação da filial de faturamento no cabeçalho das 4 versões (retrato do pedido, T-0149): linha 1 "Nome · CNPJ … · telefone",
 * linha 2 o endereço completo com CEP. Cada parte só sai se existir; sem nenhuma, não há linha.
 */
export function linhasDaFilial(f: OrderPdfFilial | null | undefined, nomeDaFilial?: string | null): string[] {
  if (!f) return [];
  const nome = nomeDaFilial?.trim() ?? '';
  const cnpj = f.cnpj?.trim() ? `CNPJ ${formatarDocumento(f.cnpj)}` : '';
  const tel = f.telefone?.trim() ? formatTelefone(f.telefone) : '';
  const endereco = f.logradouro?.trim() ? enderecoEmLinha({ logradouro: f.logradouro, numero: f.numero, complemento: f.complemento, bairro: f.bairro, cidade: f.cidade ?? '', uf: f.uf ?? '', cep: f.cep }) : '';
  return [[nome, cnpj, tel].filter(Boolean).join(' · '), endereco].filter(Boolean);
}

/** Entrega da ficha: "CIF · endereço" / "FOB · Transportadora (CNPJ …) · endereço" (sem "por conta de"). */
function textoEntrega(order: OrderPdfOrder): string {
  const f = order.freight;
  const nome = (f?.carrier_name ?? '').trim();
  const doc = f?.carrier_document ? formatarDocumento(f.carrier_document) : '';
  const frete = !f ? '' : f.modality === 'CIF' ? 'CIF' : ['FOB', nome ? `${nome}${doc ? ` (CNPJ ${doc})` : ''}` : ''].filter(Boolean).join(' · ');
  return [frete, order.delivery_address].filter((x) => x && x.trim()).join(' · ');
}

function header(order: OrderPdfOrder, view: OrderPdfView, ctx: OrderPdfContext): string {
  const orc = order.tipo === 'orcamento';
  const rotulo = `${orc ? 'Orçamento' : 'Pedido'}${view === 'bko' ? ' · uso interno' : ''}`;
  const emit = linhasDaFilial(order.filial, order.branch_name);
  // RN-VEN-18: o orçamento não vence; a data é a de emissão e, se o preço for de outro dia, sai "· preço de dd/mm"
  const dia = pdfDateTime(order.created_at, ctx.tz).slice(0, 10);
  const z = zonedParts(order.created_at, ctx.tz);
  const diaIso = `${z.year}-${pad(z.month)}-${pad(z.day)}`;
  const precoDe = orc && order.preco_data && order.preco_data !== diaIso ? `preço de ${dataDaValidade(order.preco_data, true)}` : '';
  const c = order.customer;
  const doc = c.cnpj ? documentoCliente(c.cnpj) : null;
  const docTxt = doc ? escapeHtml(doc.valor) : 'não informado';
  const docRotulo = doc ? doc.rotulo : 'CNPJ/CPF';
  const nome = c.legal_name || c.trade_name;
  const fantasia = c.legal_name && c.trade_name && c.legal_name !== c.trade_name ? ` <span class="sec">· ${escapeHtml(c.trade_name)}</span>` : '';
  const entrega = escapeHtml(textoEntrega(order)) || '&nbsp;';
  const vendedor = `${escapeHtml(order.seller_name)}${order.made_by ? ` <span class="sec">(feito por ${escapeHtml(order.made_by)})</span>` : ''}`;
  const cliente = `<div class="c s4"><div class="r">Cliente</div><span class="forte">${escapeHtml(nome)}</span>${fantasia}</div>`;
  const ficha =
    view === 'customer'
      ? `${cliente}
  <div class="c s2 fim"><div class="r">${docRotulo}</div>${docTxt}</div>
  <div class="c s3 base"><div class="r">Entrega</div>${entrega}</div>
  <div class="c s2 base"><div class="r">Pagamento</div>${escapeHtml(order.payment_terms)}</div>
  <div class="c base fim"><div class="r">Vendedor</div>${vendedor}</div>`
      : `${cliente}
  <div class="c s2 fim"><div class="r">${docRotulo} · código</div>${docTxt}${c.erp_code ? ` · ${escapeHtml(c.erp_code)}` : ''}</div>
  <div class="c s4"><div class="r">Entrega</div>${entrega}</div>
  <div class="c s2 fim"><div class="r">Pagamento</div>${escapeHtml(order.payment_terms)}</div>
  <div class="c s3 base"><div class="r">Vendedor</div>${vendedor}</div>
  <div class="c s3 base fim"><div class="r">Tabela</div>${escapeHtml(priceTableLabel(order.price_table, order.price_table_name))}</div>`;
  return `
<div class="cab">
  <div>
    <div class="empresa">${escapeHtml(ctx.tenant_name)}</div>
    ${emit.map((l) => `<div class="emit">${escapeHtml(l)}</div>`).join('')}
  </div>
  <div class="doc">
    <div class="t"><small>${rotulo}</small>${order.number ? escapeHtml(order.number) : ''}</div>
    <div class="d">${escapeHtml(dia)}${precoDe ? ` · ${escapeHtml(precoDe)}` : ''}</div>
  </div>
</div>
<div class="ficha">
  ${ficha}
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

/** RN-CORE-19: quantidade somada por embalagem ("2 FD + 4 CX + 10 UN"); a medida "CX c/ 12" conta como CX. */
export function quantidadePorEmbalagem(items: ReadonlyArray<Pick<OrderPdfItem, 'quantity' | 'unit_label'>>): string {
  const porMedida = new Map<string, number>();
  for (const i of items) {
    const medida = siglaDaMedida(i.unit_label);
    porMedida.set(medida, (porMedida.get(medida) ?? 0) + i.quantity);
  }
  return [...porMedida].map(([m, q]) => `${q} ${m}`).join(' + ');
}

/** Descrição + Aplicação + Equivale a (uma célula). */
function descricaoHtml(it: OrderPdfItem, view: OrderPdfView, ctx: OrderPdfContext): string {
  return `${escapeHtml(it.description)}${aplicacaoHtml(it)}${equivaleAHtml(it, view, ctx)}`;
}

function customerBody(order: OrderPdfOrder, ctx: OrderPdfContext): string {
  const rows = order.items
    .map(
      (it) => `
    <tr><td class="cod">${escapeHtml(it.erp_code)}</td><td>${descricaoHtml(it, 'customer', ctx)}</td><td>${escapeHtml(it.brand?.trim())}</td><td class="emb">${escapeHtml(it.unit_label || 'UN')}</td><td class="v">${it.quantity}</td><td class="v">${semRs(netUnitCents(it))}</td><td class="v tot">${semRs(it.total_cents)}</td></tr>`,
    )
    .join('');
  return `
<table>
  <colgroup><col style="width:20mm"><col><col style="width:24mm"><col style="width:18mm"><col style="width:11mm"><col style="width:21mm"><col style="width:25mm"></colgroup>
  <thead><tr><th>Código</th><th>Descrição</th><th>Marca</th><th>Emb.</th><th class="v">Qtd</th><th class="v">Preço unit. R$</th><th class="v">Total R$</th></tr></thead>
  <tbody>${rows}
  </tbody>
  <tfoot><tr><td colspan="6" class="rt">Total</td><td class="v vt">${formatBRL(order.total_cents)}</td></tr></tfoot>
</table>
<div class="nota">Valores sem impostos. Preço e estoque confirmados no faturamento.</div>`;
}

/** Coluna Desc./Acr. do item: pedido antigo (sem o campo do item) mostra o desconto do pedido. */
function itemAdjustText(it: OrderPdfItem, orderPct: number): string {
  if ((it.surcharge_pct ?? 0) > 0) return `+${pctText(it.surcharge_pct!)}`;
  if (it.discount_pct === undefined) return pctText(orderPct);
  return it.discount_pct > 0 ? `−${pctText(it.discount_pct)}` : '—';
}

/** Faixa Alertas (T-0159): só no pedido do escritório; o orçamento nunca imprime, e sem alerta a faixa não sai. */
function alertasHtml(order: OrderPdfOrder): string {
  const alertas = (order.alertas ?? []).filter((a) => a.trim());
  if (order.tipo === 'orcamento' || alertas.length === 0) return '';
  return `<div class="faixa alerta"><div class="r">Alertas</div><div class="txt">${alertas.map((a) => escapeHtml(a)).join(' · ')}</div></div>`;
}

/** Faixa Histórico: uma linha com setas; o nome só na etapa feita por quem não é o vendedor (RN-VEN-30). */
function historicoHtml(order: OrderPdfOrder, ctx: OrderPdfContext): string {
  const hist = order.history.slice(-8);
  if (hist.length < 2) return '';
  const etapas = hist.map((e, i) => {
    const q = pdfDateTime(e.at, ctx.tz).slice(0, 16);
    const hora = `${q.slice(0, 5)} ${q.slice(11)}`;
    const quem = e.by && e.by.trim() && e.by !== order.seller_name ? ` (${escapeHtml(e.by)})` : '';
    const txt = `${escapeHtml(statusText(e.status))}${quem}`;
    return `<span><span class="q">${hora}</span>${i === hist.length - 1 ? `<span class="ultima">${txt}</span>` : txt}</span>`;
  });
  return `<div class="faixa"><div class="r">Histórico</div><div class="etapas">${etapas.join('')}</div></div>`;
}

function bkoBody(order: OrderPdfOrder, ctx: OrderPdfContext): string {
  const pct = order.discount_pct;
  const rows = order.items
    .map(
      (it) => `
    <tr><td class="cod">${escapeHtml(it.erp_code)}</td><td>${descricaoHtml(it, 'bko', ctx)}</td><td>${escapeHtml(it.brand?.trim())}</td><td class="emb">${escapeHtml(it.unit_label || 'UN')}</td><td class="v">${it.quantity}</td><td class="v">${semRs(it.unit_price_cents)}</td><td class="v">${itemAdjustText(it, pct)}</td><td class="v">${semRs(netUnitCents(it))}</td><td class="v tot">${semRs(it.total_cents)}</td></tr>`,
    )
    .join('');
  const linhaLiquida = linhaLiquidaDosTotais(order);
  return `
${alertasHtml(order)}
<table>
  <colgroup><col style="width:18mm"><col><col style="width:21mm"><col style="width:16mm"><col style="width:10mm"><col style="width:15mm"><col style="width:16mm"><col style="width:15mm"><col style="width:25mm"></colgroup>
  <thead><tr><th>Código</th><th>Descrição</th><th>Marca</th><th>Emb.</th><th class="v">Qtd</th><th class="v">Tabela</th><th class="v">Desc./Acr.</th><th class="v">Líquido</th><th class="v">Total</th></tr></thead>
  <tbody>${rows}
  </tbody>
  <tfoot>
    <tr><td colspan="8" class="rt">Tabela</td><td class="v">${formatBRL(order.subtotal_cents)}</td></tr>
    ${linhaLiquida ? `<tr${linhaLiquida.rotulo.startsWith('Desconto') ? ' class="disc"' : ''}><td colspan="8" class="rt">${escapeHtml(linhaLiquida.rotulo)}</td><td class="v">${escapeHtml(linhaLiquida.valor)}</td></tr>` : ''}
    <tr class="total"><td colspan="8" class="rt">Total</td><td class="v vt">${formatBRL(order.total_cents)}</td></tr>
  </tfoot>
</table>
${historicoHtml(order, ctx)}`;
}

/** HTML completo do PDF do pedido. */
export function buildOrderPdfHtml(order: OrderPdfOrder, view: OrderPdfView, ctx: OrderPdfContext): string {
  const title = orderPdfFileName(order.number, order.created_at, ctx.tz, order.tipo).replace(/\.pdf$/, '');
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
${header(order, view, ctx)}
${view === 'customer' ? customerBody(order, ctx) : bkoBody(order, ctx)}
</body>
</html>`;
}

/** "Rua A, 10 – Galpão 2 · Distrito · Manaus/AM · CEP 69100-000". */
export function enderecoEmLinha(e: { logradouro: string; numero?: string | null; complemento?: string | null; bairro?: string | null; cidade: string; uf: string; cep?: string | null }): string {
  const rua = [[e.logradouro, e.numero].filter((x) => x && x.trim()).join(', '), e.complemento].filter((x) => x && x.trim()).join(' – ');
  const cep = e.cep ? `CEP ${formatarCep(e.cep)}` : '';
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
  items: Array<{ erp_code: string; description: string; quantity: number; unit_price_cents: number; total_cents: number; unit_label?: string | null; discount_pct?: number; surcharge_pct?: number; application?: string | null; brand?: string | null }>;
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
  /** T-0141 (RN-VEN-18): dia civil do preço (AAAA-MM-DD), a mesma conta do selo da tela; ausente = dia de `created_at` no fuso do tenant */
  preco_data?: string;
  /** T-0159: retrato da filial do pedido (dados fiscais incluídos); ausente = pedido anterior à filial */
  filial?: OrderPdfFilial | null;
  /** T-0159: textos dos alertas da tela (RN-VEN-42) */
  alertas?: readonly string[];
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
      ...(i.brand?.trim() ? { brand: i.brand.trim() } : {}),
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
    ...(d.tipo === 'orcamento' ? { tipo: 'orcamento' as const } : {}),
    ...(d.preco_data ? { preco_data: d.preco_data } : {}),
    ...(d.filial ? { filial: d.filial } : {}),
    ...(d.alertas && d.alertas.length > 0 ? { alertas: d.alertas } : {}),
  };
}
