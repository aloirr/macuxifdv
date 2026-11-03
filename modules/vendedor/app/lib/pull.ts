/**
 * Telas do Vendedor sobre o pull do sync (T-0029 §8): transforma as linhas locais (`pedido`, `pedido_item`, `pedido_evento`,
 * `cliente`, `produto`, `cliente_tabela_preco`, condições) nos tipos que as telas já usam (`Order`, `OrderDetail`,
 * `CustomerSummary`, `Product`). Puro e testado, sem React nem armazenamento: a leitura do SQLite é do hook.
 * Offline-first: tudo daqui nasce das linhas guardadas no aparelho.
 */
import type { LinhaSync } from '@macuxi/platform-sdk';
import type { ClienteEnderecoSync, ClienteSync, CustomerSummary, Me, ProdutoSync, ProdutoUnidadeSync } from '@macuxi/core/contracts';
import type { ClienteTabelaPrecoSync, Product, TabelaPrecoSync } from '@macuxi/catalogo/contracts';
import type { DiscountPolicy as AlcadaApi, Order, OrderDetail, OrderItem } from '../../contracts';
import type { CondicaoPagamentoSync, ClienteCondicaoSync, PedidoEventoSync, PedidoItemSync, PedidoSync } from '../../contracts/sync';
import type { TransportadoraSync } from '../../contracts/frete';
import { rotuloMedida } from '../../domain/preco-pedido';
import type { EnderecoDaTela, TransportadoraDaTela, UnidadeDaTela } from './novo-pedido';
import { politicaDosParametros, quemDecide, textoPendencia } from '../../domain/aprovacao';
import { camposFaturamento } from '../../domain/retorno-erp';

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
}

export const LINHAS_VAZIAS: LinhasVendedor = { pedidos: [], itens: [], eventos: [], clientes: [], produtos: [], tabelasDoCliente: [], condicoes: [], condicoesDoCliente: [], unidades: [], enderecos: [], transportadoras: [], tabelasPreco: [] };

/** O que o motor oferece para ler as linhas locais (subconjunto estrutural de `MotorSync`). */
export interface LeitorDeLinhas {
  linhas<L extends LinhaSync = LinhaSync>(entidade: string): Promise<L[]>;
}

const vivas = <T extends { deleted_at: string | null }>(l: T[]): T[] => l.filter((x) => !x.deleted_at);

export async function lerLinhas(motor: LeitorDeLinhas): Promise<LinhasVendedor> {
  const ler = async <T extends LinhaSync>(e: string): Promise<T[]> => vivas(await motor.linhas<T>(e));
  const [pedidos, itens, eventos, clientes, produtos, tabelasDoCliente, condicoes, condicoesDoCliente, unidades, enderecos, transportadoras, tabelasPreco] = await Promise.all([
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
  ]);
  return { pedidos, itens, eventos, clientes, produtos, tabelasDoCliente, condicoes, condicoesDoCliente, unidades, enderecos, transportadoras, tabelasPreco };
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
export function produtoComPreco(p: ProdutoSync, precoCents: number | null): Product {
  return {
    id: p.id,
    erp_code: p.sku,
    description: p.nome,
    brand: p.marca ?? '',
    line: p.categoria ?? '',
    unit: p.unidade,
    ean: p.ean,
    active: p.ativo,
    external_id: p.external_id,
    applications: '',
    is_campaign: false,
    price_cents: precoCents,
    stock_total: ESTOQUE_NAO_CONTROLADO,
    stock: [],
  };
}

export function produtosComPrecos(l: LinhasVendedor, precos: ReadonlyMap<string, number | null>): Product[] {
  return l.produtos
    .filter((p) => p.ativo)
    .map((p) => produtoComPreco(p, precos.get(p.id) ?? null))
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
  return { id: t(e.id), external_id: t(e.external_id), tipo: t(e.tipo) ?? undefined, descricao: t(e.descricao), logradouro: String(e.logradouro ?? ''), numero: t(e.numero), complemento: t(e.complemento), bairro: t(e.bairro), cidade: String(e.cidade ?? ''), uf: String(e.uf ?? ''), cep: t(e.cep), principal: e.principal === true };
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
    branch_id: null,
    branch_name: null,
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
    ...(p.desconto_efetivo_pct !== undefined && p.desconto_efetivo_pct !== null ? { effective_discount_pct: p.desconto_efetivo_pct } : {}),
    ...(p.frete_modalidade ? { freight: freteDaLinha(p) } : {}),
    ...(p.endereco_entrega ? { delivery_address: enderecoDaLinha(p) } : {}),
    ...(p.tabela_preco_id ? { price_table_name: tabelasPreco.find((t) => t.id === p.tabela_preco_id)?.nome ?? null } : {}),
  };
}

/** Lista de pedidos do aparelho (vivos), do mais novo ao mais antigo. */
export function listaDePedidos(l: LinhasVendedor, parametros: Readonly<Record<string, unknown>>): Order[] {
  const itens = agruparPorPedido(l.itens);
  return l.pedidos
    .map((p) => ordemDoPedido(p, itens.get(p.id) ?? [], parametros, l.tabelasPreco))
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
  return l.pedidos.filter((p) => p.status === 'pending_approval' && p.nivel_aprovacao != null && quemDecide(perfil, p.nivel_aprovacao).pode);
}

