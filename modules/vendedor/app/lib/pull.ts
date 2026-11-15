/**
 * Telas do Vendedor sobre o pull do sync (T-0029 §8): transforma as linhas locais (`pedido`, `pedido_item`, `pedido_evento`,
 * `cliente`, `produto`, `cliente_tabela_preco`, condições) nos tipos que as telas já usam (`Order`, `OrderDetail`,
 * `CustomerSummary`, `Product`). Puro e testado, sem React nem armazenamento: a leitura do SQLite é do hook.
 * Offline-first: tudo daqui nasce das linhas guardadas no aparelho.
 */
import type { LinhaSync } from '@macuxi/platform-sdk';
import type { LimiteDesconto, UsuarioSync, CarteiraSync, ClienteEnderecoSync, ClienteFinanceiroSync, ClienteSync, CustomerSummary, Me, ProdutoSync, ProdutoUnidadeSync } from '@macuxi/core/contracts';
import type { ClienteTabelaPrecoSync, DepositoSync, EstoqueSaldoSync, Product, TabelaPrecoSync } from '@macuxi/catalogo/contracts';
import type { DiscountPolicy as AlcadaApi, Order, OrderDetail, OrderItem } from '../../contracts';
import type { CondicaoPagamentoSync, ClienteCondicaoSync, FormaPagamentoSync, PedidoEventoSync, PedidoItemSync, PedidoSync, PrazoPagamentoSync } from '../../contracts/sync';
import type { FormaDePagamento, PrazoDePagamento } from '../../domain/pagamento';
import type { TransportadoraSync } from '../../contracts/frete';
import { limiteDoUsuario } from '../../domain/limite-desconto';
import { precoMinimoBaseCents, rotuloMedida } from '../../domain/preco-pedido';
import type { EnderecoDaTela, ProdutoComMinimo, TransportadoraDaTela, UnidadeDaTela } from './novo-pedido';
import { politicaDosParametros, quemDecide, textoPendencia } from '../../domain/aprovacao';
import { ultimaMudancaDeStatus } from '../../domain/busca-periodo';
import { camposFaturamento } from '../../domain/retorno-erp';
import { dadosFiscaisDaFilial, nomeDaFilialDoPedido } from '../../domain/filial-pedido';
import { depositosDaFilial, saldoPorProdutoDaFilial } from '@macuxi/catalogo/contracts';
import { disponivel, reservadoLocalNaFilial } from '../../domain/reserva-filial';

export interface LinhasVendedor {
  pedidos: PedidoSync[];
  itens: PedidoItemSync[];
  eventos: PedidoEventoSync[];
  clientes: ClienteSync[];
  produtos: ProdutoSync[];
  tabelasDoCliente: ClienteTabelaPrecoSync[];
  condicoes: CondicaoPagamentoSync[];
  condicoesDoCliente: ClienteCondicaoSync[];
  // --- T-0061: embalagens (core), endereços de entrega (core), transportadoras (vendedor) e nome da tabela de preço (catálogo) ---
  unidades: ProdutoUnidadeSync[];
  enderecos: ClienteEnderecoSync[];
  transportadoras: TransportadoraSync[];
  tabelasPreco: TabelaPrecoSync[];
  /** RN-VEN-13: situação financeira do cliente (bloqueado) vinda do pull do Core; ausente = sem bloqueio conhecido */
  financeiros?: ClienteFinanceiroSync[];
  /** RN-VEN-20: saldo por depósito (catálogo); produto sem linha = estoque não controlado */
  saldos?: EstoqueSaldoSync[];
  /** T-0149 (RN-VEN-20): depósitos com a filial; ausentes = saldo de todos os depósitos (comportamento anterior) */
  depositos?: DepositoSync[];
  /** T-0089 (RN-VEN-24): formas de pagamento e prazos do tenant; ausentes antes do primeiro sync com a 0037 */
  formas?: FormaPagamentoSync[];
  prazos?: PrazoPagamentoSync[];
  /** RN-VEN-35 (T-0101): vínculos de carteira (core) para o seletor do pedido em nome; ausentes = carteira desconhecida */
  carteiras?: CarteiraSync[];
  /** RN-VEN-11a (T-0168): funções e limite de desconto do usuário (entidade `usuario` do Core); ausente = padrão */
  usuarios?: UsuarioSync[];
}

export const LINHAS_VAZIAS: LinhasVendedor = { pedidos: [], itens: [], eventos: [], clientes: [], produtos: [], tabelasDoCliente: [], condicoes: [], condicoesDoCliente: [], unidades: [], enderecos: [], transportadoras: [], tabelasPreco: [], financeiros: [], saldos: [], depositos: [], formas: [], prazos: [], carteiras: [], usuarios: [] };

/** O que o motor oferece para ler as linhas locais (subconjunto estrutural de `MotorSync`). */
export interface LeitorDeLinhas {
  linhas<L extends LinhaSync = LinhaSync>(entidade: string): Promise<L[]>;
}

const vivas = <T extends { deleted_at: string | null }>(l: T[]): T[] => l.filter((x) => !x.deleted_at);

export async function lerLinhas(motor: LeitorDeLinhas): Promise<LinhasVendedor> {
  const ler = async <T extends LinhaSync>(e: string): Promise<T[]> => vivas(await motor.linhas<T>(e));
  const [pedidos, itens, eventos, clientes, produtos, tabelasDoCliente, condicoes, condicoesDoCliente, unidades, enderecos, transportadoras, tabelasPreco, financeiros, saldos, depositos, formas, prazos, carteiras, usuarios] = await Promise.all([
    ler<PedidoSync>('pedido'),
    ler<PedidoItemSync>('pedido_item'),
    ler<PedidoEventoSync>('pedido_evento'),
    ler<ClienteSync>('cliente'),
    ler<ProdutoSync>('produto'),
    ler<ClienteTabelaPrecoSync>('cliente_tabela_preco'),
    ler<CondicaoPagamentoSync>('condicao_pagamento'),
    ler<ClienteCondicaoSync>('cliente_condicao'),
    ler<ProdutoUnidadeSync>('produto_unidade'),
    ler<ClienteEnderecoSync>('cliente_endereco'),
    ler<TransportadoraSync>('transportadora'),
    ler<TabelaPrecoSync>('tabela_preco'),
    ler<ClienteFinanceiroSync>('cliente_financeiro'),
    ler<EstoqueSaldoSync>('estoque_saldo'),
    ler<DepositoSync>('deposito'),
    ler<FormaPagamentoSync>('forma_pagamento'),
    ler<PrazoPagamentoSync>('prazo_pagamento'),
    ler<CarteiraSync>('carteira'),
    ler<UsuarioSync>('usuario'),
  ]);
  return { pedidos, itens, eventos, clientes, produtos, tabelasDoCliente, condicoes, condicoesDoCliente, unidades, enderecos, transportadoras, tabelasPreco, financeiros, saldos, depositos, formas, prazos, carteiras, usuarios };
}

/** RN-VEN-11a (T-0168): o limite da linha do usuário da sessão; sem linha (antes do 1º sync, servidor antigo) = padrão. */
export function limiteDoUsuarioNasLinhas(linhas: Pick<LinhasVendedor, 'usuarios'>, usuarioId: string | null | undefined): LimiteDesconto {
  return limiteDoUsuario((linhas.usuarios ?? []).find((u) => u.id === usuarioId));
}

// ---------- alçada e usuário ----------
/** Política vigente a partir dos parâmetros do tenant guardados do último `GET /v1/me/modulos` (valem offline, E3). */
export function politicaApi(parametros: Readonly<Record<string, unknown>>): AlcadaApi {
  const p = politicaDosParametros({ ...parametros });
  return { seller_pct: p.seller_pct, supervisor_pct: p.supervisor_pct, manager_pct: p.manager_pct, above_manager: p.above_manager, exceptions: [] };
}

export interface UsuarioDoAparelho {
  id: string;
  nome: string;
  perfil: string | null;
  fuso?: string;
}

/** O `Me` mínimo que as telas usam (fuso, vendedor logado, nome do produto); a API v1 não tem `/me` da Fase M. */
export function meDoAparelho(u: UsuarioDoAparelho, parametros: Readonly<Record<string, unknown>>, agora: Date): Me {
  const limite = politicaDosParametros({ ...parametros }).seller_pct;
  const ehVendedor = u.perfil === 'vendedor';
  return {
    user: { id: u.id, name: u.nome, email: '', role: ehVendedor ? 'seller' : u.perfil === 'admin' ? 'admin' : u.perfil === 'gerente' ? 'manager' : u.perfil === 'analista' ? 'analyst' : 'bko_assistant', seller_id: ehVendedor ? u.id : null, team_name: null },
    tenant: { id: '', name: '', timezone: u.fuso || 'America/Sao_Paulo', product_name: 'Macuxi FDV' },
    seller: ehVendedor ? { id: u.id, name: u.nome, short_name: u.nome.split(' ')[0] ?? u.nome, team_id: '', team_name: '', branch_id: '', max_discount_pct: limite } : null,
    server_time: agora.toISOString(),
    today: agora.toISOString().slice(0, 10),
    last_erp_load_at: null,
  };
}

// ---------- cliente e produto ----------
export function clienteResumo(c: ClienteSync, tabelaPrecoId: string | null, vendedor: { id: string; name: string }): CustomerSummary {
  const endereco = [c.logradouro, c.numero].filter((x) => x && x.trim() !== '').join(', ');
  const lat = c.latitude == null ? null : Number(c.latitude);
  const lng = c.longitude == null ? null : Number(c.longitude);
  return {
    id: c.id,
    erp_code: c.external_id ?? '',
    trade_name: c.nome_fantasia || c.razao_social,
    legal_name: c.razao_social,
    cnpj: c.documento ?? '',
    segment: c.segmento ?? '',
    abc_curve: 'C',
    address: endereco,
    city: c.cidade ?? '',
    district: c.bairro ?? '',
    lat: lat !== null && Number.isFinite(lat) ? lat : null,
    lng: lng !== null && Number.isFinite(lng) ? lng : null,
    phone: c.telefone ?? '',
    email: c.email ?? '',
    seller_id: vendedor.id,
    seller_name: vendedor.name,
    customer_since: '',
    // crédito fora da fatia (P-6): o aparelho não calcula limite
    credit_limit_cents: 0,
    open_receivables_cents: 0,
    available_credit_cents: 0,
    overdue_count: 0,
    overdue_cents: 0,
    last_purchase_at: null,
    days_since_purchase: null,
    avg_monthly_cents: 0,
    positivated_this_month: false,
    price_table_id: tabelaPrecoId,
  };
}

export function listaDeClientes(l: LinhasVendedor, vendedor: { id: string; name: string }): CustomerSummary[] {
  const tabela = new Map<string, string>();
  for (const t of l.tabelasDoCliente) tabela.set(t.cliente_id, t.tabela_preco_id);
  return l.clientes
    .filter((c) => c.ativo)
    .map((c) => clienteResumo(c, tabela.get(c.id) ?? null, vendedor))
    .sort((a, b) => a.trade_name.localeCompare(b.trade_name, 'pt-BR'));
}

/** Estoque fora da fatia (RN-VEN-20): o seletor não limita a quantidade pelo saldo. */
export const ESTOQUE_NAO_CONTROLADO = 1_000_000;

/** Produto do seletor com o preço da tabela do cliente (`null` = "Sem preço para este cliente", RN-CAT-06). */
export function produtoComPreco(p: ProdutoSync, precoCents: number | null, saldoBase: number | null = null, aplicacao: string | null = null): ProdutoComMinimo {
  // RN-VEN-11 (T-0151): o mínimo só existe quando o sync traz o preço de venda E o desconto máximo do produto (sem eles, a API revalida)
  const x = p as ProdutoSync & { preco_venda_cents?: number | null; desconto_maximo_pct?: number | null };
  const minimo = x.preco_venda_cents != null && x.desconto_maximo_pct != null ? precoMinimoBaseCents({ preco_venda_cents: x.preco_venda_cents, desconto_maximo_pct: x.desconto_maximo_pct }) : null;
  return {
    ...(minimo !== null ? { preco_minimo_base_cents: minimo } : {}),
    id: p.id,
    erp_code: p.sku,
    description: p.nome,
    brand: p.marca ?? '',
    line: p.categoria ?? '',
    unit: p.unidade,
    ean: p.ean,
    active: p.ativo,
    external_id: p.external_id,
    // T-0084: aplicação do produto (descrição 2), de `catalogo.textos_produto@1`; vazio = sem aplicação
    applications: aplicacao ?? '',
    is_campaign: false,
    price_cents: precoCents,
    stock_total: saldoBase ?? ESTOQUE_NAO_CONTROLADO,
    stock: [],
  };
}

/**
 * RN-VEN-20: saldo por produto (unidade base); produto sem linha de saldo fica de fora = não controlado. Com `filialId` (T-0149,
 * a filial do cliente) conta só os depósitos da filial; sem filial ou sem depósito com filial no aparelho, soma todos (fallback).
 */
export function saldoPorProduto(saldos: readonly EstoqueSaldoSync[] | undefined, depositos?: readonly DepositoSync[], filialId?: string | null): Map<string, number> {
  const vivos = (saldos ?? []).filter((s) => !(s as { deleted_at?: string | null }).deleted_at);
  const deps = (depositos ?? []).filter((d) => !(d as { deleted_at?: string | null }).deleted_at);
  // Legado (nenhum depósito ligado a filial, ou depósitos fora do aparelho): vale todo depósito que tem saldo, como a API faz com a tabela inteira.
  const legado = !deps.some((d) => d.filial_id);
  const validos = legado ? new Set(vivos.map((x) => x.deposito_id)) : depositosDaFilial(deps.map((d) => ({ id: d.id, filial_id: d.filial_id })), filialId);
  const linhas = vivos.map((x) => ({ produto_id: x.produto_id, deposito_id: x.deposito_id, quantidade: Number(x.quantidade) }));
  return new Map(saldoPorProdutoDaFilial([...new Set(linhas.map((x) => x.produto_id))], validos, linhas).map((x) => [x.produto_id, x.quantidade_base]));
}

/**
 * Disponível por produto na filial (saldo − reservas dos pedidos já aceitos no aparelho, RN-VEN-20). Produto não controlado
 * não entra no mapa. Sem filial, só o saldo (comportamento anterior).
 */
export function disponivelPorProduto(l: LinhasVendedor, filialId: string | null | undefined, cargaDiariaEm?: string | null): Map<string, number> {
  const saldo = saldoPorProduto(l.saldos, l.depositos, filialId);
  if (!filialId) return saldo;
  const itensDe = new Map<string, PedidoItemSync[]>();
  for (const i of l.itens) itensDe.set(i.pedido_id, [...(itensDe.get(i.pedido_id) ?? []), i]);
  const reservado = reservadoLocalNaFilial(
    l.pedidos.map((p) => ({
      filial_id: p.filial_id ?? null,
      tipo: p.tipo ?? 'pedido',
      status: p.status,
      faturado_em: p.faturado_em ?? null,
      itens: (itensDe.get(p.id) ?? []).map((i) => ({ produto_id: i.produto_id, quantidade_base: i.quantidade_base ?? i.quantidade, quantidade_faturada: i.quantidade_faturada ?? 0 })),
    })),
    filialId,
    cargaDiariaEm,
  );
  for (const [pid, q] of saldo) saldo.set(pid, disponivel(q, reservado.get(pid) ?? 0));
  return saldo;
}

/** Estoque mostrado e validado offline: troca o `stock_total` pelo disponível da filial do cliente (sem filial, mantém). */
export function comEstoqueDaFilial<T extends Product>(items: readonly T[], l: LinhasVendedor, filialId: string | null | undefined, cargaDiariaEm?: string | null): T[] {
  if (!filialId) return [...items];
  const disp = disponivelPorProduto(l, filialId, cargaDiariaEm);
  return items.map((p) => (disp.has(p.id) ? { ...p, stock_total: disp.get(p.id)! } : p));
}

export function produtosComPrecos(l: LinhasVendedor, precos: ReadonlyMap<string, number | null>, aplicacoes: ReadonlyMap<string, string> = new Map(), filialId?: string | null): Product[] {
  const saldos = disponivelPorProduto(l, filialId);
  return l.produtos
    .filter((p) => p.ativo)
    .map((p) => produtoComPreco(p, precos.get(p.id) ?? null, saldos.get(p.id) ?? null, aplicacoes.get(p.id) ?? null))
    .sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'));
}

// ---------- condições de pagamento (RN-VEN-14) ----------
export interface CondicaoDaTela {
  id: string;
  descricao: string;
  padrao: boolean;
}

/** Condições permitidas ao cliente; sem lista própria, só a padrão do tenant. */
export function condicoesDoCliente(l: LinhasVendedor, clienteId: string): CondicaoDaTela[] {
  const ativas = l.condicoes.filter((c) => c.ativo).map((c) => ({ id: c.id, descricao: c.descricao, padrao: c.padrao }));
  const ids = new Set(l.condicoesDoCliente.filter((x) => x.cliente_id === clienteId).map((x) => x.condicao_pagamento_id));
  const lista = ids.size > 0 ? ativas.filter((c) => ids.has(c.id)) : ativas.filter((c) => c.padrao);
  return lista.sort((a, b) => Number(b.padrao) - Number(a.padrao) || a.descricao.localeCompare(b.descricao, 'pt-BR'));
}

// ---------- formas de pagamento e prazos (T-0089; RN-VEN-24) ----------
/** Formas do aparelho (todas, ativas e inativas; o domain filtra por cliente e por situação). */
export function formasDaTela(l: LinhasVendedor): FormaDePagamento[] {
  return (l.formas ?? []).map((f) => ({ id: f.id, codigo: f.codigo, nome: f.nome, ativo: f.ativo, ordem: f.ordem }));
}
export function prazosDaTela(l: LinhasVendedor): PrazoDePagamento[] {
  return (l.prazos ?? []).map((p) => ({ id: p.id, forma_pagamento_id: p.forma_pagamento_id, codigo: p.codigo, descricao: p.descricao, parcelas_dias: p.parcelas_dias, prazo_medio_dias: p.prazo_medio_dias, ordem: p.ordem, ativo: p.ativo }));
}

// ---------- medidas, endereços e transportadoras (T-0061) ----------
export function unidadesDaTela(l: LinhasVendedor): UnidadeDaTela[] {
  return l.unidades.filter((u) => u.ativo).map((u) => ({ produto_id: u.produto_id, unidade: u.unidade, fator: u.fator, padrao: u.padrao }));
}
export function enderecosDaTela(l: LinhasVendedor): EnderecoDaTela[] {
  return l.enderecos.map((e) => ({ id: e.id, cliente_id: e.cliente_id, tipo: e.tipo, descricao: e.descricao, logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairro: e.bairro, cidade: e.cidade, uf: e.uf, cep: e.cep, principal: e.principal, ativo: e.ativo }));
}
export function transportadorasDaTela(l: LinhasVendedor): TransportadoraDaTela[] {
  return l.transportadoras.map((t) => ({ id: t.id, nome: t.nome, documento: t.documento, telefone: t.telefone, ativo: t.ativo }));
}

/** Frete e endereço do pedido, do retrato que veio no pull (RN-VEN-16/17). */
function freteDaLinha(p: PedidoSync): Order['freight'] {
  if (!p.frete_modalidade) return null;
  const fob = p.frete_modalidade === 'FOB';
  return { modality: p.frete_modalidade, carrier_name: fob ? (p.transportadora_nome ?? null) : null, carrier_document: fob ? (p.transportadora_documento ?? null) : null, carrier_phone: fob ? (p.transportadora_telefone ?? null) : null, carrier_typed: fob && p.transportadora_digitada === true };
}
function enderecoDaLinha(p: PedidoSync): Order['delivery_address'] {
  const e = p.endereco_entrega;
  if (!e || typeof e !== 'object') return null;
  const t = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  return { id: t(e.id), external_id: t(e.external_id), tipo: t(e.tipo) ?? undefined, descricao: t(e.descricao), logradouro: String(e.logradouro ?? ''), numero: t(e.numero), complemento: t(e.complemento), bairro: t(e.bairro), cidade: String(e.cidade ?? ''), uf: String(e.uf ?? ''), cep: t(e.cep), principal: e.principal === true, origem: e.origem === 'editado' ? 'editado' : 'erp' };
}

// ---------- pedido ----------
export function agruparPorPedido<T extends { pedido_id: string }>(linhas: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of linhas) {
    const l = m.get(x.pedido_id);
    if (l) l.push(x);
    else m.set(x.pedido_id, [x]);
  }
  return m;
}

export function ordemDoPedido(p: PedidoSync, itens: readonly PedidoItemSync[], parametros: Readonly<Record<string, unknown>>, tabelasPreco: readonly TabelaPrecoSync[] = []): Order {
  const limite = politicaDosParametros({ ...parametros }).seller_pct;
  return {
    id: p.id,
    number: p.numero ?? '',
    idempotency_key: p.id,
    seller_id: p.vendedor_id,
    seller_name: p.vendedor_nome ?? '',
    customer_id: p.cliente_id,
    customer_name: p.cliente_nome ?? '',
    branch_id: p.filial_id ?? null,
    branch_name: nomeDaFilialDoPedido(p.filial) || null,
    ...(dadosFiscaisDaFilial(p.filial) ? { filial: dadosFiscaisDaFilial(p.filial) } : {}),
    price_table_id: p.tabela_preco_id ?? null,
    discount_pct: p.desconto_pct,
    subtotal_cents: p.total_tabela_cents,
    discount_cents: Math.max(0, p.total_tabela_cents - p.total_cents),
    total_cents: p.total_cents,
    payment_terms: p.condicao_pagamento_descricao ?? p.condicao_pagamento ?? '',
    status: p.status,
    pending_reason: p.status === 'pending_approval' && p.nivel_aprovacao ? textoPendencia(p.nivel_aprovacao, p.desconto_efetivo_pct ?? p.desconto_pct, limite) : '',
    rejection_reason: p.status === 'rejected' ? (p.motivo_rejeicao ?? '') : '',
    erp_order_code: p.numero_erp ?? '',
    created_offline_at: p.criado_no_aparelho_em,
    received_at: p.recebido_em ?? p.created_at,
    updated_at: p.updated_at,
    items_count: itens.length,
    units: itens.reduce((s, i) => s + i.quantidade, 0),
    nivel_aprovacao: p.status === 'pending_approval' ? (p.nivel_aprovacao ?? null) : null,
    // T-0054: resumo do retorno do ERP (faturado/devolução) que veio no pull; offline como o resto
    ...camposFaturamento(p),
    // T-0053 (0013): pré-venda; só quando a linha traz (linhas antigas ficam iguais)
    ...(p.tipo ? { tipo: p.tipo, validade_ate: p.validade_ate ?? null, orcamento_origem_id: p.orcamento_origem_id ?? null, convertido_pedido_id: p.convertido_pedido_id ?? null } : {}),
    // T-0061: acréscimo, desconto efetivo, frete CIF/FOB e endereço de entrega (linhas antigas ficam iguais)
    ...(p.acrescimo_pct ? { surcharge_pct: p.acrescimo_pct } : {}),
    // T-0071 (0020): validade por data civil e ajuste do pedido em R$ (Editar, Transformar e Duplicar reabrem no mesmo modo)
    ...(p.validade_data ? { validade_data: p.validade_data } : {}),
    ...(p.ajuste_em ? { order_adjust_mode: p.ajuste_em } : {}),
    ...(p.desconto_valor_cents ? { order_discount_value_cents: p.desconto_valor_cents } : {}),
    ...(p.acrescimo_valor_cents ? { order_surcharge_value_cents: p.acrescimo_valor_cents } : {}),
    ...(p.desconto_efetivo_pct !== undefined && p.desconto_efetivo_pct !== null ? { effective_discount_pct: p.desconto_efetivo_pct } : {}),
    // T-0089 (0037): retrato da forma e do prazo (pedido anterior fica igual)
    ...(p.forma_pagamento_id
      ? { forma_pagamento_id: p.forma_pagamento_id, forma_pagamento_nome: p.forma_pagamento_nome ?? null, prazo_pagamento_id: p.prazo_pagamento_id ?? null, prazo_descricao: p.prazo_descricao ?? null, prazo_parcelas_dias: p.prazo_parcelas_dias ?? null, prazo_medio_dias: p.prazo_medio_dias ?? null }
      : {}),
    ...(p.erp_aceita_cancelamento ? { erp_aceita_cancelamento: true } : {}),
    ...(p.frete_modalidade ? { freight: freteDaLinha(p) } : {}),
    ...(p.endereco_entrega ? { delivery_address: enderecoDaLinha(p) } : {}),
    ...(p.tabela_preco_id ? { price_table_name: tabelasPreco.find((t) => t.id === p.tabela_preco_id)?.nome ?? null } : {}),
  };
}

/** Lista de pedidos do aparelho (vivos), do mais novo ao mais antigo. */
export function listaDePedidos(l: LinhasVendedor, parametros: Readonly<Record<string, unknown>>): Order[] {
  const itens = agruparPorPedido(l.itens);
  const eventos = agruparPorPedido(l.eventos);
  return l.pedidos
    .map((p) => ({ ...ordemDoPedido(p, itens.get(p.id) ?? [], parametros, l.tabelasPreco), status_changed_at: ultimaMudancaDeStatus(eventos.get(p.id) ?? [], p.updated_at) }))
    .sort((a, b) => b.received_at.localeCompare(a.received_at) || b.id.localeCompare(a.id));
}

function itemDoPedido(i: PedidoItemSync): OrderItem {
  return {
    id: i.id,
    product_id: i.produto_id,
    erp_code: i.produto_sku ?? '',
    description: i.produto_nome ?? '',
    quantity: i.quantidade,
    // preço de TABELA por unidade (o PDF e a tela calculam o líquido pelo total do item)
    unit_price_cents: i.preco_tabela_cents,
    discount_pct: i.desconto_pct,
    total_cents: i.total_cents,
    ...(i.quantidade_faturada === undefined || i.quantidade_faturada === null ? {} : { quantity_invoiced: i.quantidade_faturada }),
    ...(i.quantidade_base === undefined || i.quantidade_base === null ? {} : { quantity_base: i.quantidade_base, base_quantity: i.quantidade_base }),
    ...(i.unidade ? { unit: i.unidade, factor: i.fator ?? 1, unit_label: rotuloMedida(i.unidade, i.fator ?? 1) } : {}),
    ...(i.acrescimo_pct ? { surcharge_pct: i.acrescimo_pct } : {}),
    // T-0071 (0020): R$ por unidade da medida vendida e o modo digitado
    ...(i.desconto_unitario_cents ? { unit_discount_cents: i.desconto_unitario_cents } : {}),
    ...(i.acrescimo_unitario_cents ? { unit_surcharge_cents: i.acrescimo_unitario_cents } : {}),
    ...(i.ajuste_em ? { adjust_mode: i.ajuste_em } : {}),
    // T-0084 (RN-VEN-19): retrato da aplicação no momento do pedido
    ...(i.aplicacao ? { application: i.aplicacao } : {}),
    ...(i.marca ? { brand: i.marca } : {}),
  };
}

/** Detalhe do pedido pelas linhas locais (offline); `null` se o pedido não está no aparelho. */
export function detalheDoPedido(l: LinhasVendedor, id: string, perfil: string, parametros: Readonly<Record<string, unknown>>): OrderDetail | null {
  const p = l.pedidos.find((x) => x.id === id);
  if (!p) return null;
  const itens = l.itens.filter((i) => i.pedido_id === id).sort((a, b) => a.sequencia - b.sequencia);
  const eventos = l.eventos.filter((e) => e.pedido_id === id).sort((a, b) => a.ocorrido_em.localeCompare(b.ocorrido_em) || a.created_at.localeCompare(b.created_at) || Number(a.de !== null) - Number(b.de !== null));
  const cliente = l.clientes.find((c) => c.id === p.cliente_id);
  const limite = politicaDosParametros({ ...parametros }).seller_pct;
  const nivel = p.nivel_aprovacao ?? null;
  const q = nivel ? quemDecide(perfil, nivel) : null;
  return {
    ...ordemDoPedido(p, itens, parametros, l.tabelasPreco),
    items: itens.map(itemDoPedido),
    history: eventos.map((e) => ({
      at: e.ocorrido_em,
      status: e.para,
      by: e.autor_nome ?? '',
      note: [e.motivo ?? '', e.acima_do_nivel ? 'Decidido pelo gerente no nível do supervisor.' : ''].filter(Boolean).join(' '),
    })),
    cliente: cliente
      ? {
          razao_social: cliente.razao_social,
          nome_fantasia: cliente.nome_fantasia ?? '',
          documento: cliente.documento ?? '',
          endereco: [cliente.logradouro, cliente.numero].filter((x) => x && x.trim() !== '').join(', '),
          bairro: cliente.bairro ?? '',
          cidade: cliente.cidade ?? '',
          uf: cliente.uf ?? '',
          codigo_erp: cliente.external_id ?? '',
        }
      : null,
    aprovacao:
      p.nivel_aprovacao && q
        ? {
            nivel: p.nivel_aprovacao,
            motivos: p.motivos_aprovacao ?? ['desconto'],
            desconto_efetivo_pct: Math.max(0, p.desconto_efetivo_pct ?? p.desconto_pct),
            limite_vendedor_pct: limite,
            pode_decidir: p.status === 'pending_approval' && q.pode,
            acima_do_nivel: q.acima_do_nivel,
          }
        : null,
  };
}

/** Pedidos que o perfil pode decidir agora (aba "Para aprovar" da Gestão; matriz §2, P-3). */
export function paraAprovar(l: LinhasVendedor, perfil: string): PedidoSync[] {
  return l.pedidos.filter((p) => p.tipo !== 'orcamento' && p.status === 'pending_approval' && p.nivel_aprovacao != null && quemDecide(perfil, p.nivel_aprovacao).pode);
}

