/**
 * Preço do pedido de distribuidora (T-0061; desenho §3). Funções puras, em centavos inteiros, usadas pelo app (offline)
 * e revalidadas na API. Regras: RN-VEN-02 (desconto ou acréscimo por item e por pedido, meia para cima), RN-VEN-03
 * (desconto efetivo, sem frete), RN-VEN-10 (alçada olha só o efetivo), RN-VEN-11 (preço mínimo), RN-VEN-15 (UN × CX),
 * RN-VEN-16 (frete CIF/FOB sem valor) e RN-VEN-17 (endereço de entrega). Percentuais têm 2 casas (`Pct`).
 */
import { cnpjValido, somenteDigitos } from '@macuxi/comum';

import { checkDiscount, clampPct, type DiscountPolicy } from './order';

/** Mesmos níveis de `aprovacao.ts` (copiados aqui para o domain de preço não importar a aprovação: sem ciclo). */
export type NivelDePreco = 'supervisor' | 'gerente' | 'analista';

// ---------- aritmética ----------
/** Percentual → pontos-base inteiros (2 casas), para não somar erro de ponto flutuante. */
function pontosBase(pct: number): number {
  return Math.round(pct * 100);
}

/** `valor × (10000 + delta) ÷ 10000`, meia para cima (valores não negativos). */
function aplicarPontosBase(valor: number, delta: number): number {
  const bruto = valor * (10_000 + delta);
  return Math.floor((bruto + 5_000) / 10_000);
}

export const MSG_DESCONTO_E_ACRESCIMO = 'Desconto e acréscimo são excludentes: use um ou outro.';

/** RN-VEN-02: desconto e acréscimo (item ou pedido) são excludentes. `null` = ok. */
export function validarAcrescimoOuDesconto(p: { desconto_pct: number; acrescimo_pct: number }): 'desconto_e_acrescimo' | null {
  return p.desconto_pct > 0 && p.acrescimo_pct > 0 ? 'desconto_e_acrescimo' : null;
}

function exigirExcludente(p: { desconto_pct: number; acrescimo_pct: number }): void {
  if (validarAcrescimoOuDesconto(p)) throw new Error(`RN-VEN-02: ${MSG_DESCONTO_E_ACRESCIMO}`);
}

/** Delta em pontos-base: negativo = desconto, positivo = acréscimo. */
function deltaDe(p: { desconto_pct: number; acrescimo_pct: number }): number {
  return p.acrescimo_pct > 0 ? pontosBase(p.acrescimo_pct) : -pontosBase(p.desconto_pct);
}

// ---------- item ----------
export interface ItemParaPreco {
  /** preço da UNIDADE BASE na tabela do cliente */
  preco_tabela_unidade_cents: number;
  /** quantidade na unidade vendida (UN ou CX) */
  quantidade: number;
  /** quantidade de unidades base por unidade vendida (UN = 1, CX c/ 12 = 12) */
  fator: number;
  /** preço próprio da embalagem na tabela (RN-VEN-15; fila de corte); null = UN × fator */
  preco_proprio_unidade_cents?: number | null;
  desconto_pct: number;
  acrescimo_pct: number;
  /** RN-VEN-11: preço mínimo por unidade base (null = sem trava) */
  preco_minimo_base_cents?: number | null;
}

export interface PrecoDoItem {
  /** preço de tabela da unidade vendida (UN, ou CX = UN × fator) */
  preco_tabela_cents: number;
  /** preço final da unidade vendida (total do item ÷ quantidade, arredondado) */
  preco_unitario_cents: number;
  total_cents: number;
  quantidade_base: number;
  /** mínimo na unidade vendida (mínimo base × fator) */
  preco_minimo_cents: number | null;
}

function exigirFator(fator: number): void {
  if (!Number.isInteger(fator) || fator < 1) throw new Error('RN-VEN-15: fator da unidade inválido.');
}

/** Preço de tabela da unidade vendida (RN-VEN-15). */
export function precoTabelaDaUnidade(i: Pick<ItemParaPreco, 'preco_tabela_unidade_cents' | 'fator' | 'preco_proprio_unidade_cents'>): number {
  exigirFator(i.fator);
  return i.preco_proprio_unidade_cents ?? i.preco_tabela_unidade_cents * i.fator;
}

export function precoDoItem(i: ItemParaPreco): PrecoDoItem {
  exigirExcludente(i);
  const preco_tabela_cents = precoTabelaDaUnidade(i);
  const bruto = preco_tabela_cents * i.quantidade;
  const total_cents = aplicarPontosBase(bruto, deltaDe(i));
  return {
    preco_tabela_cents,
    preco_unitario_cents: i.quantidade > 0 ? Math.floor((total_cents * 2 + i.quantidade) / (2 * i.quantidade)) : 0,
    total_cents,
    quantidade_base: i.quantidade * i.fator,
    preco_minimo_cents: i.preco_minimo_base_cents == null ? null : i.preco_minimo_base_cents * i.fator,
  };
}

// ---------- preço mínimo (RN-VEN-11) ----------
/** Mínimo por unidade base: preço de venda × (1 − desconto máximo), meia para cima. `null` = produto sem preço de venda. */
export function precoMinimoBaseCents(p: { preco_venda_cents: number | null; desconto_maximo_pct: number }): number | null {
  if (p.preco_venda_cents == null) return null;
  return aplicarPontosBase(p.preco_venda_cents, -pontosBase(clampPct(p.desconto_maximo_pct)));
}

/** "Desconto máximo deste produto: X%": maior desconto do item que não fura o mínimo (2 casas, truncado); 0 se a tabela já está abaixo. */
export function descontoMaximoDoItemPct(preco_tabela_cents: number, preco_minimo_cents: number | null): number | null {
  if (preco_minimo_cents == null) return null;
  if (preco_tabela_cents <= 0 || preco_tabela_cents <= preco_minimo_cents) return 0;
  return Math.floor(((preco_tabela_cents - preco_minimo_cents) * 10_000) / preco_tabela_cents) / 100;
}

/** RN-VEN-11: o preço final da unidade (só desconto/acréscimo do item) não fica abaixo do mínimo. Sem trava = true. */
export function itemRespeitaPrecoMinimo(i: ItemParaPreco): boolean {
  const minimo = i.preco_minimo_base_cents;
  if (minimo == null) return true;
  exigirExcludente(i);
  const tabela = precoTabelaDaUnidade(i);
  const final = aplicarPontosBase(tabela, deltaDe(i));
  return final >= minimo * i.fator;
}

// ---------- pedido ----------
export interface LinhaParaTotal {
  preco_tabela_cents: number;
  quantidade: number;
  /** total da linha depois do desconto/acréscimo do ITEM */
  total_cents: number;
  /** desconto do ITEM (%; 2 casas) — entra no efetivo exato da alçada (RN-VEN-10) */
  desconto_pct: number;
  /** acréscimo do ITEM (%; 2 casas), excludente com o desconto */
  acrescimo_pct: number;
}

/**
 * RN-VEN-10: desconto efetivo da ALÇADA pelo valor nominal exato, sem arredondar por linha e sem folga:
 * `1 − Σ(tabela_i × (10000 + δ_i)) × (10000 + Δ) ÷ (Σ tabela_i × 10^8)`, em inteiros (BigInt), 2 casas meia para cima.
 * `tabela_i` = preço de tabela × quantidade; δ_i/Δ = −desconto ou +acréscimo do item/pedido em pontos-base. Nunca negativo.
 */
export function descontoEfetivoAlcadaPct(linhas: readonly LinhaParaTotal[], pedido: { desconto_pct: number; acrescimo_pct: number }): number {
  exigirExcludente(pedido);
  const D = BigInt(10_000 + deltaDe(pedido));
  let tabela = 0n;
  let final = 0n;
  for (const l of linhas) {
    exigirExcludente(l);
    const bruto = BigInt(l.preco_tabela_cents) * BigInt(l.quantidade);
    tabela += bruto;
    final += bruto * BigInt(10_000 + deltaDe(l));
  }
  if (tabela <= 0n) return 0;
  const den = tabela * 100_000_000n;
  const num = den - final * D;
  if (num <= 0n) return 0;
  const bp = (num * 20_000n + den) / (2n * den);
  return Number(bp) / 100;
}

export interface TotaisDoPedido {
  total_tabela_cents: number;
  /** soma das linhas depois dos ajustes dos itens, antes do ajuste do pedido */
  total_itens_cents: number;
  desconto_cents: number;
  acrescimo_cents: number;
  total_cents: number;
  /** RN-VEN-03: 2 casas; negativo = acréscimo; sem frete (RN-VEN-16) */
  desconto_efetivo_pct: number;
  /** Desconto efetivo para a ALÇADA (RN-VEN-10): valor nominal exato, sem folga (`descontoEfetivoAlcadaPct`). Nunca negativo. */
  desconto_efetivo_alcada_pct: number;
  /** total de cada linha depois do ajuste do pedido (soma = `total_cents`) */
  linhas_cents: number[];
}

export function totaisDoPedido(linhas: readonly LinhaParaTotal[], pedido: { desconto_pct: number; acrescimo_pct: number }): TotaisDoPedido {
  exigirExcludente(pedido);
  const delta = deltaDe(pedido);
  const linhas_cents = linhas.map((l) => aplicarPontosBase(l.total_cents, delta));
  const total_tabela_cents = linhas.reduce((s, l) => s + l.preco_tabela_cents * l.quantidade, 0);
  const total_itens_cents = linhas.reduce((s, l) => s + l.total_cents, 0);
  const total_cents = linhas_cents.reduce((s, n) => s + n, 0);
  const ajuste = total_cents - total_itens_cents;
  const efetivo = total_tabela_cents > 0 ? Math.round(((total_tabela_cents - total_cents) / total_tabela_cents) * 10_000) / 100 : 0;
  const alcada = descontoEfetivoAlcadaPct(linhas, pedido);
  return {
    total_tabela_cents,
    total_itens_cents,
    desconto_cents: Math.max(0, -ajuste),
    acrescimo_cents: Math.max(0, ajuste),
    total_cents,
    desconto_efetivo_pct: efetivo === 0 ? 0 : efetivo,
    desconto_efetivo_alcada_pct: alcada,
    linhas_cents,
  };
}

/**
 * RN-VEN-10: nível que aprova, olhando SÓ o desconto efetivo (RN-VEN-03), nunca o de um item. ≤ alçada do vendedor (ou ≤ 0,
 * acréscimo) não vai para aprovação (`null`). Acima da alçada do gestor: analista (ou bloqueio — `bloqueadoPelaAlcada`).
 */
export function nivelDeAprovacao(desconto_efetivo_pct: number, policy: DiscountPolicy, vendedor_id = ''): NivelDePreco | null {
  if (desconto_efetivo_pct <= 0) return null;
  const c = checkDiscount(desconto_efetivo_pct, policy, vendedor_id);
  return c.level === 'needs_approval' ? (c.approver === 'supervisor' ? 'supervisor' : c.approver === 'manager' ? 'gerente' : 'analista') : null;
}

/** RN-VEN-10: acima da alçada do gestor com `alcada.acima_gerente = bloquear`. */
export function bloqueadoPelaAlcada(desconto_efetivo_pct: number, policy: DiscountPolicy, vendedor_id = ''): boolean {
  return desconto_efetivo_pct > 0 && checkDiscount(desconto_efetivo_pct, policy, vendedor_id).level === 'blocked';
}

// ---------- frete (RN-VEN-16) ----------
export const MODALIDADES_FRETE = ['CIF', 'FOB'] as const;
export type ModalidadeFrete = (typeof MODALIDADES_FRETE)[number];

export interface TransportadoraDigitadaEntrada {
  nome: string;
  cnpj: string;
  telefone?: string | null;
}
export interface FretePedido {
  modalidade: ModalidadeFrete;
  transportadora_id?: string | null;
  transportadora_digitada?: TransportadoraDigitadaEntrada | null;
}
export type CodigoRecusaFrete = 'transportadora_obrigatoria' | 'transportadora_invalida';

export const MSG_RECUSA_FRETE: Record<CodigoRecusaFrete, string> = {
  transportadora_obrigatoria: 'Informe a transportadora do frete FOB.',
  transportadora_invalida: 'Transportadora inválida: escolha da lista ou informe nome e CNPJ válidos.',
};

/** CIF não pede transportadora; FOB exige a cadastrada OU a digitada (nome ≥ 2 e CNPJ válido). */
export function validarFrete(f: FretePedido): CodigoRecusaFrete | null {
  if (f.modalidade === 'CIF') return null;
  const id = f.transportadora_id ?? null;
  const dig = f.transportadora_digitada ?? null;
  if (id === null && dig === null) return 'transportadora_obrigatoria';
  if (id !== null && dig !== null) return 'transportadora_invalida';
  if (dig !== null && (dig.nome.trim().length < 2 || !cnpjValido(dig.cnpj))) return 'transportadora_invalida';
  return null;
}

/** Modalidade padrão do tenant (`frete.modalidade_padrao`); qualquer valor fora de CIF/FOB cai em CIF. */
export function modalidadePadraoDosParametros(parametros: Readonly<Record<string, unknown>>): ModalidadeFrete {
  return parametros['frete.modalidade_padrao'] === 'FOB' ? 'FOB' : 'CIF';
}

/** CNPJ só com dígitos (a API grava assim). */
export function cnpjSomenteDigitos(valor: string): string {
  return somenteDigitos(valor);
}

// ---------- endereço de entrega (RN-VEN-17) ----------
export interface EnderecoParaEntrega {
  id: string;
  principal: boolean;
  ativo: boolean;
  tipo?: string;
}
export type ResultadoEndereco = { ok: true; endereco_id: string | null } | { ok: false; codigo: 'endereco_invalido' };

/** Sem escolha vale o principal; a escolha tem de ser um endereço ativo do cliente. Cliente sem endereço: sem endereço de entrega. */
export function resolverEnderecoEntrega(escolhido: string | null | undefined, enderecos: readonly EnderecoParaEntrega[]): ResultadoEndereco {
  const ativos = enderecos.filter((e) => e.ativo);
  if (escolhido) return ativos.some((e) => e.id === escolhido) ? { ok: true, endereco_id: escolhido } : { ok: false, codigo: 'endereco_invalido' };
  const principal = ativos.find((e) => e.principal) ?? ativos.find((e) => e.tipo === 'principal') ?? null;
  return { ok: true, endereco_id: principal?.id ?? null };
}

// ---------- medida (RN-CORE-19) ----------
/** PDF e detalhe: fator 1 → "UN"; embalagem → "CX c/ 12". */
export function rotuloMedida(unidade: string, fator: number): string {
  return fator > 1 ? `${unidade} c/ ${fator}` : unidade;
}

// ---------- unidade vendida (RN-VEN-15) ----------
export interface UnidadeDeVendaDoProduto {
  unidade: string;
  fator: number;
  ativo: boolean;
}
export type ResultadoUnidade = { ok: true; unidade: string; fator: number } | { ok: false; codigo: 'unidade_invalida' };

/**
 * Medida vendida do item. O `fator` vem do cadastro do Core, nunca do aparelho: sem escolha vale a unidade base (APK antigo);
 * com escolha, ela tem de ser a base ou uma embalagem ATIVA do produto (`unidade_invalida`).
 */
export function resolverUnidadeDoItem(escolhida: string | null | undefined, produto: { unidade: string; unidades?: readonly UnidadeDeVendaDoProduto[] | null }): ResultadoUnidade {
  const lista = (produto.unidades ?? []).filter((u) => u.ativo);
  if (!escolhida) return { ok: true, unidade: produto.unidade, fator: 1 };
  const achada = lista.find((u) => u.unidade === escolhida);
  if (achada) return { ok: true, unidade: achada.unidade, fator: achada.fator };
  if (escolhida === produto.unidade) return { ok: true, unidade: escolhida, fator: 1 };
  return { ok: false, codigo: 'unidade_invalida' };
}
