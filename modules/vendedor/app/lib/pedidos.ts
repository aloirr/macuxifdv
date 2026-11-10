/**
 * Regras de montagem de pedido no aparelho (função pura, sem React): rascunho, resumo da fila e junção da
 * fila com os pedidos do servidor. A validação é a MESMA do servidor (`validateOrder`, RN-VEN-*): a API revalida.
 */
import type { CustomerSummary, Me } from '@macuxi/core/contracts';
import type { DiscountPolicy, Order, OrderDetail, PedidoPush } from '../../contracts';
import type { Product } from '@macuxi/catalogo/contracts';
import type { EnderecoEditadoValido } from '../../domain/endereco-pedido';
import { validateOrder, type OrderIssue, type OrderTotals, type OrderValidation } from '../../domain/order';
import type { FaixaEscalonada } from '../../domain/preco-item';
import { mensagemAcimaDoMaximo } from '../../domain/preco-pedido';
import { toDomainPolicy } from './catalog';
import { calcularPedido, fretePush, freteValido, linhasParaPush, politicaParaAutor, type Ajuste, type CalculoPedido, type FreteDoRascunho, type UnidadeDaTela } from './novo-pedido';
import type { PrefillLine } from './order-prefill';

export interface Rascunho {
  customer_id: string;
  /** product_id → quantidade (ordem de inclusão preservada) */
  lines: Record<string, number>;
  discount_pct: number;
  payment_terms: string;
  /** condição de pagamento escolhida entre as permitidas ao cliente (RN-VEN-14); ausente = padrão do tenant */
  condicao_pagamento_id?: string | null;
  /** T-0089 (RN-VEN-24/25): forma e prazo escolhidos; os dois juntos ou nenhum (rascunho anterior segue pela condição) */
  forma_pagamento_id?: string | null;
  prazo_pagamento_id?: string | null;
  observacao?: string;
  visit_id: string | null;
  route_stop_id: string | null;
  updated_at: string;
  /** T-0137 (RN-VEN-38): "Apenas salvar" — quando o vendedor guardou o rascunho de propósito (aceita pendências); reabre no Resumo e não vira "Pedido não terminado" */
  salvo_em?: string | null;
  /** T-0141 (RN-VEN-39): aba em que o vendedor parou; a lista Rascunhos retoma por ela (gravar a aba não renova as 24 h) */
  aba?: 'venda' | 'itens' | 'entrega' | 'resumo';
  /** edição: id do pedido editado (rascunho guardado na chave `edit:<id>`) */
  edit_order_id?: string | null;
  /** aviso do duplicar/editar: de onde veio e itens removidos (sem preço/inativos) */
  notice?: string;
  /** T-0053 (RF-VEN-03): salvar como orçamento (só com `orcamento.ativo`); ausente = pedido */
  tipo?: 'pedido' | 'orcamento';
  // --- T-0061: a chave de `lines` é o produto (unidade base) ou `produto@CX` (embalagem) ---
  /** desconto OU acréscimo por linha (RN-VEN-02), por chave de `lines` */
  ajustes?: Record<string, Ajuste>;
  /** T-0134 (RN-VEN-18): edição de orçamento — produto → preço de tabela por unidade já salvo; o item salvo não é reprecificado */
  precos_congelados?: Record<string, number>;
  /** acréscimo do pedido (excludente com `discount_pct`) */
  acrescimo_pct?: number;
  /** T-0071 (RN-VEN-02): ajuste do pedido em R$ sobre o total dos itens e o modo digitado (seletor % | R$); ausente = % */
  desconto_valor_cents?: number;
  acrescimo_valor_cents?: number;
  ajuste_em?: 'pct' | 'valor';
  /** RN-VEN-16: ausente = padrão do tenant (CIF) */
  frete?: FreteDoRascunho;
  /** RN-VEN-17: ausente = endereço principal do cliente */
  endereco_entrega_id?: string | null;
  /** T-0141 (RN-VEN-17): endereço digitado SÓ para este pedido (o cadastro do cliente não muda); com ele o id acima fica nulo */
  endereco_entrega_editado?: EnderecoEditadoValido | null;
  /** RN-VEN-35: pedido em nome. Dono (vendedor) escolhido pelo gestor; ausente = pedido do próprio usuário. O autor é o token. */
  vendedor_em_nome_id?: string | null;
  /** RN-VEN-35: nome do dono, só para o PDF da fila (o servidor devolve o nome certo depois do pull) */
  vendedor_em_nome_nome?: string | null;
}

/**
 * T-0071 (RN-VEN-02): grava o ajuste do pedido no rascunho no modo escolhido (% ou R$ sobre o total dos itens). Só um dos quatro
 * valores fica > 0 (desconto e acréscimo, em % e em R$, são excludentes) e `ajuste_em` guarda o modo digitado.
 */
export function aplicarAjusteDoPedido(r: Rascunho, a: { modo: 'pct' | 'valor'; sentido: 'desconto' | 'acrescimo'; valor: number }): Rascunho {
  const v = Math.max(0, a.valor);
  return {
    ...r,
    ajuste_em: a.modo,
    discount_pct: a.modo === 'pct' && a.sentido === 'desconto' ? v : 0,
    acrescimo_pct: a.modo === 'pct' && a.sentido === 'acrescimo' ? v : 0,
    desconto_valor_cents: a.modo === 'valor' && a.sentido === 'desconto' ? v : 0,
    acrescimo_valor_cents: a.modo === 'valor' && a.sentido === 'acrescimo' ? v : 0,
  };
}

export const PRAZO_PADRAO = '28/56 dias';

export function rascunhoVazio(customerId: string): Rascunho {
  return { customer_id: customerId, lines: {}, discount_pct: 0, payment_terms: PRAZO_PADRAO, visit_id: null, route_stop_id: null, updated_at: '' };
}

/** Chave do rascunho: novo pedido usa o id do cliente; edição usa `edit:<id do pedido>`. */
export function draftKeyFor(customerId: string, editOrderId?: string | null): string {
  return editOrderId ? `edit:${editOrderId}` : customerId;
}

export interface OrderLineDisplay {
  product_id: string;
  erp_code: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  /** T-0061: medida vendida (ex.: "CX c/ 12"); ausente = unidade base */
  unit_label?: string;
  /** T-0061: desconto OU acréscimo do ITEM (PDF interno); ausente em itens antigos da fila */
  discount_pct?: number;
  surcharge_pct?: number;
  /** T-0084 (RN-VEN-19): retrato da aplicação do item; ausente/nulo = sem aplicação */
  application?: string | null;
}

/** Resumo guardado junto do item da fila (a fila genérica só tem o `CreateOrderRequest`). */
export interface OrderDisplay {
  customer_name: string;
  /** RN-VEN-35: nome do vendedor dono, no pedido em nome */
  seller_name?: string;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  items_count: number;
  units: number;
  lines: OrderLineDisplay[];
  /** o que o aparelho já sabe que vai acontecer: segue direto ou vai para aprovação */
  expected: 'ok' | 'pending_approval';
}

export interface VendedorLogado {
  id: string;
  name: string;
  branch_id: string;
}

export interface EntradaPrepararPedido {
  rascunho: Rascunho;
  cliente: CustomerSummary;
  catalogo: Product[];
  politica: DiscountPolicy;
  eu: Me['seller'];
  /** RN-VEN-35/10: supervisor/gerente digitando pelo vendedor; vale a alçada do gestor e o `eu` não é exigido */
  emNome?: { vendedor_id: string; perfil_autor: string; nome?: string } | null;
  /** pedidos do cliente ainda na fila (consomem o crédito), sem o pedido em edição */
  filaDoClienteCents: number;
  /** sem uso desde que o crédito saiu da fatia (P-6); mantido para as chamadas existentes */
  pedidoEditado?: Pick<Order, 'status' | 'total_cents'> | null;
  /** T-0061: embalagens dos produtos (UN/CX), das linhas `produto_unidade` do aparelho */
  unidades?: readonly UnidadeDaTela[];
  /** RN-VEN-23: faixas vigentes da tabela escalonada (faixas[] do Catálogo) */
  faixas?: Record<string, readonly FaixaEscalonada[]>;
  /** T-0084 (RN-VEN-19): `aplicacao_no_orcamento_padrao` e `aplicacao_max_orcamento` do tenant */
  aplicacao?: { padrao: boolean; max: number };
}

/** `OrderValidation` com o cálculo do novo pedido (medidas, ajustes, desconto efetivo) anexado. */
export type ValidacaoDoPedido = OrderValidation & { calculo: CalculoPedido };

/** Rótulo curto da medida de uma linha: "UN" ou "CX c/ 12". */
function rotuloDaLinha(sigla: string, fator: number): string {
  return fator > 1 ? `${sigla} c/ ${fator}` : sigla;
}

/**
 * Valida o rascunho e monta o resumo da fila. Recusado = lança `Error` em português com o que corrigir.
 * T-0061: o cálculo é o do domain de preço (UN/CX, desconto e acréscimo por item e por pedido); a alçada olha só o
 * desconto efetivo (RN-VEN-03/10). Frete FOB sem transportadora bloqueia (RN-VEN-16).
 */
export function prepararPedido(e: EntradaPrepararPedido): { v: ValidacaoDoPedido; display: OrderDisplay } {
  if (!e.eu && !e.emNome) throw new Error('Seu usuário não é vendedor com carteira. Peça ao gestor para vinculá-lo a um vendedor.');
  const vendedorId = e.emNome ? e.emNome.vendedor_id : e.eu!.id;
  const politica = e.emNome ? politicaParaAutor(e.politica, e.emNome.perfil_autor) : e.politica;
  const byId = new Map(e.catalogo.map((p) => [p.id, p]));
  const calculo = calcularPedido({
    lines: e.rascunho.lines,
    ajustes: e.rascunho.ajustes ?? {},
    desconto_pct: e.rascunho.discount_pct,
    acrescimo_pct: e.rascunho.acrescimo_pct ?? 0,
    desconto_valor_cents: e.rascunho.desconto_valor_cents,
    acrescimo_valor_cents: e.rascunho.acrescimo_valor_cents,
    ajuste_em: e.rascunho.ajuste_em,
    catalogo: e.catalogo,
    unidades: e.unidades ?? [],
    faixas: e.faixas,
    ...(e.rascunho.precos_congelados ? { congelados: e.rascunho.precos_congelados } : {}),
    aplicacao: e.aplicacao,
    politica,
    vendedor_id: vendedorId,
  });
  const validado = validateOrder({
    seller_id: vendedorId,
    discount_pct: Math.max(0, calculo.desconto_alcada_pct),
    lines: calculo.linhas.map((l) => ({ product_id: l.product_id, quantity: l.quantity, unit_price_cents: l.preco_tabela_cents })),
    policy: toDomainPolicy(politica),
    // P-6 (T-0029): crédito fora da fatia, igual ao servidor — nenhum pedido vai para aprovação por crédito
    credit: null,
  });
  const issues: OrderIssue[] = [
    ...(calculo.linhas.length === 0 && calculo.erros.length === 0 ? [validado.issues.find((i) => i.code === 'empty_order')].filter((i): i is OrderIssue => Boolean(i)) : []),
    ...calculo.erros.map((message): OrderIssue => ({ code: /sem preço/i.test(message) ? 'price_not_found' : calculo.bloqueado && /acima do máximo/.test(message) ? 'discount_blocked' : 'invalid_item', message, blocking: true, needs_approval: false })),
    ...validado.issues.filter((i) => i.code === 'discount_above_limit'),
    // RN-VEN-11 (T-0151): desconto acima do máximo do produto não passa nem com aprovação; só orçamento (RN-VEN-18)
    ...(calculo.acima_do_maximo.length > 0 && e.rascunho.tipo !== 'orcamento' ? [{ code: 'invalid_item' as const, message: mensagemAcimaDoMaximo(calculo.acima_do_maximo), blocking: true, needs_approval: false }] : []),
  ];
  const aviso = e.rascunho.frete ? freteValido(e.rascunho.frete) : null;
  if (aviso) issues.push({ code: 'invalid_item', message: aviso, blocking: true, needs_approval: false });
  const outcome: OrderValidation['outcome'] = issues.some((i) => i.blocking) ? 'rejected' : issues.some((i) => i.needs_approval) ? 'pending_approval' : 'ok';
  const totals: OrderTotals = {
    units: calculo.unidades_base,
    lines: calculo.linhas.map((l) => ({
      product_id: l.product_id,
      quantity: l.quantity,
      unit_price_cents: l.preco_tabela_cents,
      gross_cents: l.preco_tabela_cents * l.quantity,
      discount_cents: Math.max(0, l.preco_tabela_cents * l.quantity - l.total_cents),
      total_cents: l.total_cents,
    })),
    subtotal_cents: calculo.total_tabela_cents,
    discount_cents: Math.max(0, calculo.total_tabela_cents - calculo.total_cents),
    total_cents: calculo.total_cents,
  };
  const v: ValidacaoDoPedido = { ...validado, totals, issues, outcome, calculo };
  if (v.outcome === 'rejected') throw new Error(v.issues.filter((i) => i.blocking).map((i) => i.message).join(' '));
  const display: OrderDisplay = {
    customer_name: e.cliente.trade_name,
    ...(e.emNome?.nome ? { seller_name: e.emNome.nome } : {}),
    subtotal_cents: totals.subtotal_cents,
    discount_cents: totals.discount_cents,
    total_cents: totals.total_cents,
    items_count: totals.lines.length,
    units: totals.units,
    lines: calculo.linhas.map((l) => ({
      product_id: l.product_id,
      erp_code: byId.get(l.product_id)?.erp_code ?? '',
      description: byId.get(l.product_id)?.description ?? '',
      quantity: l.quantity,
      unit_price_cents: l.preco_tabela_cents,
      total_cents: l.total_cents,
      // RN-VEN-15 (T-0151): a medida vai sempre, também na unidade base (FD, CX…); sem ela o detalhe caía em UN
      unit_label: rotuloDaLinha(l.unidade_sigla, l.fator),
      discount_pct: l.desconto_pct,
      ...(l.acrescimo_pct > 0 ? { surcharge_pct: l.acrescimo_pct } : {}),
      ...(l.aplicacao ? { application: l.aplicacao } : {}),
    })),
    expected: v.outcome === 'pending_approval' ? 'pending_approval' : 'ok',
  };
  return { v, display };
}

export function montarPedido(args: { id: string; cliente: CustomerSummary; rascunho: Rascunho; v: OrderValidation | ValidacaoDoPedido; semSinal: boolean; agora: string }): PedidoPush {
  const calculo = 'calculo' in args.v ? (args.v as ValidacaoDoPedido).calculo : null;
  const frete = fretePush(args.rascunho.frete);
  return {
    id: args.id,
    customer_id: args.cliente.id,
    // em R$ o pedido leva só o valor (os % ficam de fora: % e R$ juntos dão 422 ajuste_invalido)
    discount_pct: args.rascunho.ajuste_em === 'valor' ? 0 : args.rascunho.discount_pct,
    payment_terms: args.rascunho.payment_terms,
    created_offline_at: args.semSinal ? args.agora : null,
    route_stop_id: args.rascunho.route_stop_id,
    total_cents: args.v.totals.total_cents,
    items: calculo ? linhasParaPush(calculo.linhas) : args.v.totals.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
    // T-0089: com forma e prazo, a condição legada fica nula; sem eles (APK anterior, tenant sem formas) vale a condição
    condicao_pagamento_id: args.rascunho.forma_pagamento_id && args.rascunho.prazo_pagamento_id ? null : (args.rascunho.condicao_pagamento_id ?? null),
    ...(args.rascunho.forma_pagamento_id && args.rascunho.prazo_pagamento_id ? { forma_pagamento_id: args.rascunho.forma_pagamento_id, prazo_pagamento_id: args.rascunho.prazo_pagamento_id } : {}),
    observacao: args.rascunho.observacao?.trim() ? args.rascunho.observacao.trim() : null,
    visita_id: args.rascunho.visit_id ?? null,
    // T-0053: só o orçamento leva `tipo` (o payload do pedido fica igual ao dos APKs anteriores)
    ...(args.rascunho.tipo === 'orcamento' ? { tipo: 'orcamento' as const } : {}),
    // T-0061: campos novos só quando existem (RN-VEN-02/16/17); o resto do payload fica igual ao dos APKs anteriores
    ...(args.rascunho.ajuste_em !== 'valor' && (args.rascunho.acrescimo_pct ?? 0) > 0 ? { acrescimo_pct: args.rascunho.acrescimo_pct } : {}),
    ...(args.rascunho.ajuste_em === 'valor' && (args.rascunho.desconto_valor_cents ?? 0) > 0 ? { desconto_valor_cents: args.rascunho.desconto_valor_cents } : {}),
    ...(args.rascunho.ajuste_em === 'valor' && (args.rascunho.acrescimo_valor_cents ?? 0) > 0 ? { acrescimo_valor_cents: args.rascunho.acrescimo_valor_cents } : {}),
    ...(args.rascunho.ajuste_em ? { ajuste_em: args.rascunho.ajuste_em } : {}),
    ...(frete ? { frete } : {}),
    ...(args.rascunho.endereco_entrega_editado ? { endereco_entrega_editado: args.rascunho.endereco_entrega_editado } : args.rascunho.endereco_entrega_id ? { endereco_entrega_id: args.rascunho.endereco_entrega_id } : {}),
    // RN-VEN-35: só o dono; o autor_id nunca sai do aparelho (a API usa o token)
    ...(args.rascunho.vendedor_em_nome_id ? { vendedor_id: args.rascunho.vendedor_em_nome_id } : {}),
  };
}

// ---------- fila × servidor ----------

/** Forma mínima de um item da fila genérica do motor de sync (platform-sdk), sem acoplar ao tipo dele. */
export interface ItemFilaPedido {
  id: string;
  entidade: string;
  payload: unknown;
  criado_em: string;
  ultima_tentativa_em: string | null;
  ultimo_erro: string;
  situacao: 'pendente' | 'falhou' | 'modulo_inativo' | 'aceito';
}

export interface PedidoNaFila extends Omit<ItemFilaPedido, 'payload'> {
  payload: PedidoPush;
  display: OrderDisplay | null;
  /** erro definitivo (4xx/módulo desativado): não tenta sozinho; o vendedor reenvia ou descarta */
  failed: boolean;
}

export function pedidosNaFila(fila: readonly ItemFilaPedido[], exibicoes: Record<string, OrderDisplay>): PedidoNaFila[] {
  return fila
    .filter((i) => i.entidade === 'pedido')
    .map((i) => ({ ...i, payload: i.payload as PedidoPush, display: exibicoes[i.id] ?? null, failed: i.situacao !== 'pendente' && i.situacao !== 'aceito' }));
}

export type PedidoDaLista = Order & { local: boolean; local_error: string; /** T-0130: a API recusou o pedido (item `falhou` da fila) */ local_failed?: boolean };

/** Pedido da fila exibido na lista como "Na fila" · "no aparelho". */
export function pedidoDaFilaComoPedido(item: PedidoNaFila, vendedor: VendedorLogado): PedidoDaLista {
  const p = item.payload;
  const d = item.display;
  return {
    id: p.id,
    number: '',
    idempotency_key: item.id,
    seller_id: vendedor.id,
    seller_name: vendedor.name,
    customer_id: p.customer_id,
    customer_name: d?.customer_name ?? '',
    branch_id: p.branch_id ?? vendedor.branch_id,
    branch_name: '',
    price_table_id: null,
    discount_pct: p.discount_pct,
    subtotal_cents: d?.subtotal_cents ?? 0,
    discount_cents: d?.discount_cents ?? 0,
    total_cents: d?.total_cents ?? 0,
    payment_terms: p.payment_terms,
    status: 'queued',
    pending_reason: '',
    rejection_reason: '',
    erp_order_code: '',
    created_offline_at: p.created_offline_at ?? item.criado_em,
    received_at: item.criado_em,
    updated_at: item.ultima_tentativa_em ?? item.criado_em,
    items_count: d?.items_count ?? p.items.length,
    units: d?.units ?? p.items.reduce((s, i) => s + i.quantity, 0),
    local: true,
    local_error: item.ultimo_erro,
    ...(item.failed ? { local_failed: true } : {}),
    ...(p.tipo ? { tipo: p.tipo } : {}),
    ...(p.orcamento_origem_id ? { orcamento_origem_id: p.orcamento_origem_id } : {}),
  };
}

/** Junta pedidos do servidor e da fila (os da fila primeiro; se já chegou ao servidor, vale o do servidor). */
export function mergeOrders(servidor: Order[], fila: PedidoNaFila[], vendedor: VendedorLogado): PedidoDaLista[] {
  const noServidor = new Set(servidor.map((o) => o.id));
  const locais = fila
    .filter((i) => !noServidor.has(i.payload.id))
    .map((i) => pedidoDaFilaComoPedido(i, vendedor))
    .sort((a, b) => b.received_at.localeCompare(a.received_at));
  const remotos = [...servidor].sort((a, b) => b.received_at.localeCompare(a.received_at)).map((o) => ({ ...o, local: false, local_error: '' }));
  return [...locais, ...remotos];
}

/** Insere ou substitui um pedido na lista em cache. */
export function upsertOrder<T extends { id: string }>(lista: T[], pedido: T): T[] {
  const idx = lista.findIndex((o) => o.id === pedido.id);
  if (idx < 0) return [pedido, ...lista];
  const next = [...lista];
  next[idx] = pedido;
  return next;
}

/** Linhas de um pedido (fila ou servidor) para duplicar/editar. */
export interface FontePedido {
  customer_id: string;
  number: string;
  lines: PrefillLine[];
  discount_pct: number;
  payment_terms: string;
}

/** null = itens do pedido ainda não estão no aparelho. */
export function fonteDoPedido(id: string, fila: PedidoNaFila[], detalhes: Record<string, OrderDetail>): FontePedido | null {
  const q = fila.find((o) => o.payload.id === id);
  if (q) {
    const meta = new Map((q.display?.lines ?? []).map((l) => [l.product_id, l]));
    return {
      customer_id: q.payload.customer_id,
      number: '',
      lines: q.payload.items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, unidade: it.unidade ?? null, erp_code: meta.get(it.product_id)?.erp_code, description: meta.get(it.product_id)?.description })),
      discount_pct: q.payload.discount_pct,
      payment_terms: q.payload.payment_terms,
    };
  }
  const d = detalhes[id];
  if (!d || d.items.length === 0) return null;
  return {
    customer_id: d.customer_id,
    number: d.number,
    lines: d.items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, unidade: it.unit && (it.factor ?? 1) > 1 ? it.unit : null, erp_code: it.erp_code, description: it.description })),
    discount_pct: d.discount_pct,
    payment_terms: d.payment_terms,
  };
}

// ---------- ficha do cliente (slots do Core) ----------

/** "Últimos pedidos" da ficha: os da fila deste cliente primeiro, depois os do servidor; no máximo `limite`. */
export function ultimosPedidosDoCliente(customerId: string, servidor: PedidoDaLista[], limite = 3): PedidoDaLista[] {
  return servidor
    .filter((o) => o.customer_id === customerId)
    .sort((a, b) => b.received_at.localeCompare(a.received_at))
    .slice(0, limite);
}

/** Sugestão de mix: soma 1 unidade do produto ao rascunho (preserva o resto). */
export function somarAoRascunho(r: Rascunho, productId: string): Rascunho {
  return { ...r, lines: { ...r.lines, [productId]: (r.lines[productId] ?? 0) + 1 } };
}

/** Liga o rascunho à visita e à parada da rota (vindas da ficha); não sobrescreve ligação já existente. */
export function ligarRascunho(r: Rascunho, visitId: string | null | undefined, stopId: string | null | undefined): Rascunho {
  const visit_id = visitId || r.visit_id;
  const route_stop_id = r.route_stop_id ?? (stopId || null);
  return visit_id === r.visit_id && route_stop_id === r.route_stop_id ? r : { ...r, visit_id, route_stop_id };
}

// ---------- aceitos pelo servidor que o pull ainda não trouxe (ADR 0009 §3, D-3) ----------

/**
 * Item que o servidor já aceitou mas cujo pull ainda não trouxe a linha: aparece como "Recebido" até a próxima
 * sincronização (não é "na fila": já não se edita nem se descarta pelo aparelho).
 */
export function aceitosComoPedidos(aceitos: readonly PedidoNaFila[], jaNoServidor: ReadonlySet<string>, vendedor: VendedorLogado): PedidoDaLista[] {
  return aceitos
    .filter((i) => !jaNoServidor.has(i.payload.id))
    .map((i) => ({ ...pedidoDaFilaComoPedido(i, vendedor), status: 'received' as const, local: false, local_error: '' }));
}
