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

// ---------- tabela ajustada pelo prazo (RN-VEN-43) ----------
/** Faixa do percentual do prazo em bp (centésimos de ponto percentual): -99,99 a +99,99. */
export const AJUSTE_PRAZO_BP_MAX = 9_999;

/** RN-VEN-43: % do prazo (2 casas, negativo = desconto) → bp inteiro; ausente = 0. Arredonda só para limpar o ponto flutuante. */
export function percentualAjusteParaBp(pct: number | null | undefined): number {
  return pct == null ? 0 : Math.round(pct * 100);
}

/**
 * RN-VEN-43: tabela do produto ajustada pelo % do prazo, POR UNIDADE e antes da quantidade, em centavos inteiros:
 * `meia-para-cima(tabela × (10 000 + bp) ÷ 10 000)`. `bp` é inteiro em centésimos de ponto percentual (-1,71% = -171).
 * Parte sempre da tabela ORIGINAL (RN-VEN-44). `bp` 0 devolve a tabela intacta.
 */
export function tabelaAjustadaCents(tabelaCents: number, percentualBp: number): number {
  if (!Number.isInteger(percentualBp) || Math.abs(percentualBp) > AJUSTE_PRAZO_BP_MAX) throw new Error('RN-VEN-43: percentual do prazo fora da faixa -99,99 a +99,99.');
  if (percentualBp === 0) return tabelaCents;
  return aplicarPontosBase(tabelaCents, percentualBp);
}

/**
 * RN-VEN-46: desconto/acréscimo digitado em R$ na troca de prazo. O R$ vira o % equivalente sobre a tabela ANTERIOR, o % se
 * mantém e o R$ é refeito sobre a NOVA tabela (meia para cima, centavos inteiros). As tabelas podem ser o preço do item ou, sem
 * o catálogo, `10 000 + bp` de cada prazo (a razão é a mesma). Tabela anterior inválida (<= 0) mantém o valor.
 */
export function valorMantendoPercentualCents(valorCents: number, tabelaAnteriorCents: number, tabelaNovaCents: number): number {
  if (!(tabelaAnteriorCents > 0) || valorCents <= 0) return valorCents;
  return Math.floor((valorCents * tabelaNovaCents * 2 + tabelaAnteriorCents) / (tabelaAnteriorCents * 2));
}

export const MSG_DESCONTO_E_ACRESCIMO = 'Desconto e acréscimo são excludentes: use um ou outro.';

/** RN-VEN-02: desconto e acréscimo (item ou pedido) são excludentes. `null` = ok. */
export function validarAcrescimoOuDesconto(p: { desconto_pct: number; acrescimo_pct: number }): 'desconto_e_acrescimo' | null {
  return p.desconto_pct > 0 && p.acrescimo_pct > 0 ? 'desconto_e_acrescimo' : null;
}

function exigirExcludente(p: { desconto_pct: number; acrescimo_pct: number }): void {
  if (validarAcrescimoOuDesconto(p)) throw new Error(`RN-VEN-02: ${MSG_DESCONTO_E_ACRESCIMO}`);
}

// ---------- ajuste em % ou R$ (T-0071; RN-VEN-02 v2) ----------
/**
 * Ajuste do item (R$ POR UNIDADE da medida vendida) ou do pedido (R$ sobre o TOTAL DOS ITENS). `null` = sem ajuste.
 * Desconto e acréscimo são excludentes por construção (um só `sentido`).
 */
export type AjusteItem = null | { sentido: 'desconto' | 'acrescimo'; em: 'pct'; pct: number } | { sentido: 'desconto' | 'acrescimo'; em: 'valor'; cents: number };
export type AjustePedido = AjusteItem;

/** Compatibilidade: o par `desconto_pct`/`acrescimo_pct` (APK e contratos @1) vira um `AjusteItem` em %. */
export function ajusteDePct(p: { desconto_pct: number; acrescimo_pct: number }): AjusteItem {
  exigirExcludente(p);
  if (p.acrescimo_pct > 0) return { sentido: 'acrescimo', em: 'pct', pct: p.acrescimo_pct };
  if (p.desconto_pct > 0) return { sentido: 'desconto', em: 'pct', pct: p.desconto_pct };
  return null;
}

type ComAjuste = { desconto_pct: number; acrescimo_pct: number; ajuste?: AjusteItem };
/** O `ajuste` explícito (v2) vale; sem ele, os percentuais legados. */
function ajusteDe(p: ComAjuste): AjusteItem {
  return p.ajuste !== undefined ? p.ajuste : ajusteDePct(p);
}
function ajusteDoPedidoDe(p: ComAjuste | AjusteItem): AjusteItem {
  if (p === null) return null;
  return 'sentido' in p ? p : ajusteDe(p);
}

const AJUSTE_INVALIDO = 'RN-VEN-02: ajuste_invalido';

/** Preço unitário depois do ajuste, meia para cima em centavos (RN-VEN-02: arredonda-se o UNITÁRIO). */
export function precoUnitarioFinal(tabela_cents: number, a: AjusteItem): number {
  if (a === null) return tabela_cents;
  const sinal = a.sentido === 'desconto' ? -1 : 1;
  if (a.em === 'pct') return aplicarPontosBase(tabela_cents, sinal * pontosBase(a.pct));
  if (!Number.isInteger(a.cents) || a.cents < 0) throw new Error(`${AJUSTE_INVALIDO}: valor em R$ inválido.`);
  if (a.sentido === 'desconto' && a.cents > tabela_cents) throw new Error(`${AJUSTE_INVALIDO}: o desconto em R$ passa do preço de tabela.`);
  return tabela_cents + sinal * a.cents;
}

/** RN-VEN-11 (T-0151): a recusa curta, só do problema; a mesma frase no aparelho e na API (`preco_abaixo_minimo`). */
export function mensagemAcimaDoMaximo(codigos: readonly string[]): string {
  return `${codigos.join(', ')} acima do desconto máximo`;
}

/**
 * RN-VEN-03 (T-0151): o % que o detalhe e o PDF escrevem em "Desconto X%" sai dos centavos (tabela − total sobre a tabela),
 * nunca do % digitado no pedido: desconto de item e de pedido juntos dão o efetivo, que pode ser menor que o digitado.
 */
export function descontoDoPedidoPct(subtotal_cents: number, total_cents: number): number {
  return pctExibicao(Math.max(0, subtotal_cents - total_cents), subtotal_cents);
}

/** RN-VEN-03: percentual com 1 casa, meia para cima, calculado dos INTEIROS (nunca do valor já arredondado). Sinal preservado. */
export function pctExibicao(num: number, den: number): number {
  return permilDe(num, den) / 10;
}

function permilDe(num: number, den: number): number {
  if (!(den > 0) || num === 0) return 0;
  const abs = Math.abs(num);
  const decimos = Math.floor((abs * 2_000 + den) / (2 * den));
  return num < 0 ? -decimos : decimos;
}

/**
 * RN-VEN-11a (T-0168 v2): o desconto do pedido em décimos de % (‰), inteiro, EXATAMENTE como a linha "Desconto (%)" dos Totais mostra
 * (`pctExibicao(total_tabela − total, total_tabela)`). Acréscimo (total > tabela) dá ≤ 0. É a fórmula única da tela e da trava.
 */
export function permilDoDescontoExibido(t: { total_tabela_cents: number; total_cents: number }): number {
  return permilDe(t.total_tabela_cents - t.total_cents, t.total_tabela_cents);
}

/** O que o ajuste vale em R$ e em % (1 casa) sobre a base: "−R$ 0,89" / "= 5,3%". `cents` é sempre positivo. */
export function equivalenteDoAjuste(base_cents: number, a: AjusteItem): { cents: number; pct_exibicao: number } {
  if (a === null) return { cents: 0, pct_exibicao: 0 };
  const cents = Math.abs(base_cents - precoUnitarioFinal(base_cents, a));
  return { cents, pct_exibicao: pctExibicao(cents, base_cents) };
}

/** Ajuste do pedido em centavos (positivo), sobre o total dos itens. R$ de desconto acima do total é `ajuste_invalido`. */
export function ajusteDoPedidoCents(total_itens_cents: number, a: AjustePedido): number {
  return Math.abs(total_itens_cents - precoUnitarioFinal(total_itens_cents, a));
}

/** Rateio de `total_cents` proporcional às linhas pelo MAIOR RESTO (empate: menor sequência); Σ = total. */
export function ratear(linhas_cents: readonly number[], total_cents: number): number[] {
  const soma = linhas_cents.reduce((s, n) => s + n, 0);
  if (linhas_cents.length === 0 || total_cents === 0 || soma <= 0) return linhas_cents.map(() => 0);
  const parte = linhas_cents.map((l) => Math.floor((total_cents * l) / soma));
  const resto = linhas_cents.map((l, k) => total_cents * l - parte[k]! * soma);
  let falta = total_cents - parte.reduce((s, n) => s + n, 0);
  const ordem = resto.map((r, k) => ({ r, k })).sort((a, b) => b.r - a.r || a.k - b.k);
  for (const { k } of ordem) {
    if (falta <= 0) break;
    parte[k]! += 1;
    falta -= 1;
  }
  return parte;
}

/** RN-VEN-11: o maior ajuste do item que não fura o mínimo, em % (2 casas, truncado) e em R$ por unidade da medida vendida. */
export function limiteDoAjusteDoItem(tabela_cents: number, minimo_cents: number | null): { pct: number | null; cents: number | null } {
  if (minimo_cents == null) return { pct: null, cents: null };
  return { pct: descontoMaximoDoItemPct(tabela_cents, minimo_cents), cents: Math.max(0, tabela_cents - minimo_cents) };
}

// ---------- item ----------
export interface ItemParaPreco {
  /** preço da UNIDADE BASE na tabela do cliente */
  preco_tabela_unidade_cents: number;
  /** quantidade na unidade vendida (UN ou CX) */
  quantidade: number;
  /** quantidade de unidades base por unidade vendida (UN = 1, CX c/ 12 = 12) */
  fator: number;
  desconto_pct: number;
  acrescimo_pct: number;
  /** T-0071: ajuste em % ou R$ por unidade vendida; quando presente vale no lugar de desconto_pct/acrescimo_pct */
  ajuste?: AjusteItem;
  /** RN-VEN-11: preço mínimo por unidade base (null = sem trava) */
  preco_minimo_base_cents?: number | null;
  /** RN-VEN-43: % do prazo em bp; a tabela da unidade base é ajustada antes do fator e do desconto. Ausente = 0. */
  percentual_ajuste_bp?: number;
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

/** Preço de tabela da unidade vendida (RN-VEN-15 nova, T-0089): sempre preço da unidade × quantidade da embalagem, sem preço de caixa. */
export function precoTabelaDaUnidade(i: Pick<ItemParaPreco, 'preco_tabela_unidade_cents' | 'fator' | 'percentual_ajuste_bp'>): number {
  exigirFator(i.fator);
  // RN-VEN-43: a unidade base é ajustada pelo prazo antes do fator (a caixa é sempre a unidade ajustada × fator)
  return tabelaAjustadaCents(i.preco_tabela_unidade_cents, i.percentual_ajuste_bp ?? 0) * i.fator;
}

/** RN-VEN-02 (v2): o preço UNITÁRIO é arredondado e o total da linha é unitário × quantidade. */
export function precoDoItem(i: ItemParaPreco): PrecoDoItem {
  const preco_tabela_cents = precoTabelaDaUnidade(i);
  const preco_unitario_cents = precoUnitarioFinal(preco_tabela_cents, ajusteDe(i));
  const total_cents = preco_unitario_cents * i.quantidade;
  return {
    preco_tabela_cents,
    preco_unitario_cents,
    total_cents,
    quantidade_base: i.quantidade * i.fator,
    preco_minimo_cents: i.preco_minimo_base_cents == null ? null : i.preco_minimo_base_cents * i.fator,
  };
}

// ---------- preço mínimo (RN-VEN-11) ----------
/** Mínimo por unidade base: preço de venda × (1 − desconto máximo), arredondado PARA CIMA ao centavo (igual ao `precoMinimoCents` do Core que o BKO mostra; a API nunca aceita abaixo do exibido). `null` = produto sem preço de venda. */
export function precoMinimoBaseCents(p: { preco_venda_cents: number | null; desconto_maximo_pct: number; /** RN-VEN-43: % do prazo em bp; o mínimo parte da tabela ajustada */ percentual_ajuste_bp?: number }): number | null {
  if (p.preco_venda_cents == null) return null;
  return Math.ceil((tabelaAjustadaCents(p.preco_venda_cents, p.percentual_ajuste_bp ?? 0) * (10_000 - pontosBase(clampPct(p.desconto_maximo_pct)))) / 10_000);
}

/** "Desconto máximo deste produto: X%": maior desconto do item que não fura o mínimo (2 casas, truncado); 0 se a tabela já está abaixo. */
export function descontoMaximoDoItemPct(preco_tabela_cents: number, preco_minimo_cents: number | null): number | null {
  if (preco_minimo_cents == null) return null;
  if (preco_tabela_cents <= 0 || preco_tabela_cents <= preco_minimo_cents) return 0;
  return Math.floor(((preco_tabela_cents - preco_minimo_cents) * 10_000) / preco_tabela_cents) / 100;
}

/**
 * RN-VEN-11 (P5, RN-VEN-23): o preço final da unidade (só desconto/acréscimo do item) não fica abaixo do mínimo, que só trava o DESCONTO.
 * Base (tabela ou faixa) já abaixo do mínimo vale como está, com desconto máximo 0: o piso é o menor entre o mínimo e a base. Sem trava = true.
 */
export function itemRespeitaPrecoMinimo(i: ItemParaPreco): boolean {
  const minimo = i.preco_minimo_base_cents;
  if (minimo == null) return true;
  const base = precoTabelaDaUnidade(i);
  const final = precoUnitarioFinal(base, ajusteDe(i));
  return final >= Math.min(minimo * i.fator, base);
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
  /** T-0071: ajuste do item em % ou R$ por unidade; quando presente vale no lugar de desconto_pct/acrescimo_pct */
  ajuste?: AjusteItem;
}

/**
 * RN-VEN-10: desconto efetivo da ALÇADA pelo valor nominal exato, sem arredondar por linha e sem folga:
 * `1 − Σ(tabela_i × (10000 + δ_i)) × (10000 + Δ) ÷ (Σ tabela_i × 10^8)`, em inteiros (BigInt), 2 casas meia para cima.
 * `tabela_i` = preço de tabela × quantidade; δ_i/Δ = −desconto ou +acréscimo do item/pedido em pontos-base. Nunca negativo.
 */
export function descontoEfetivoAlcadaPct(linhas: readonly LinhaParaTotal[], pedido: { desconto_pct: number; acrescimo_pct: number; ajuste?: AjusteItem } | AjustePedido): number {
  const ap = ajusteDoPedidoDe(pedido);
  let tabela = 0n;
  let itens = 0n; // Σ nominal × 10^4 (centavos × 10^4)
  for (const l of linhas) {
    const al = ajusteDe(l);
    const unit = BigInt(l.preco_tabela_cents);
    const q = BigInt(l.quantidade);
    tabela += unit * q;
    if (al !== null && al.em === 'valor') itens += q * (unit * 10_000n + (al.sentido === 'desconto' ? -1n : 1n) * BigInt(al.cents) * 10_000n);
    else itens += unit * q * BigInt(10_000 + (al === null ? 0 : (al.sentido === 'desconto' ? -1 : 1) * pontosBase((al as { pct: number }).pct)));
  }
  if (tabela <= 0n) return 0;
  // valor nominal final × 10^8: pedido em % multiplica; em R$ subtrai/soma o valor
  const final =
    ap === null
      ? itens * 10_000n
      : ap.em === 'pct'
        ? itens * BigInt(10_000 + (ap.sentido === 'desconto' ? -1 : 1) * pontosBase(ap.pct))
        : (itens + (ap.sentido === 'desconto' ? -1n : 1n) * BigInt(ap.cents) * 10_000n) * 10_000n;
  const den = tabela * 100_000_000n;
  const num = den - final;
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
  /** RN-VEN-03: o que a tela mostra — 1 casa, calculado dos inteiros (`pctExibicao`) */
  desconto_efetivo_exibicao_pct: number;
  /** Descontos da tela de Resumo: tabela − total (negativo = "Acréscimos") */
  descontos_cents: number;
  /** Desconto efetivo para a ALÇADA (RN-VEN-10): valor nominal exato, sem folga (`descontoEfetivoAlcadaPct`). Nunca negativo. */
  desconto_efetivo_alcada_pct: number;
  /** total de cada linha depois do ajuste do pedido (soma = `total_cents`) */
  linhas_cents: number[];
}

/** RN-VEN-02 (v2): o ajuste do pedido incide sobre o total dos itens e é rateado nas linhas pelo maior resto. */
export function totaisDoPedido(linhas: readonly LinhaParaTotal[], pedido: { desconto_pct: number; acrescimo_pct: number; ajuste?: AjusteItem } | AjustePedido): TotaisDoPedido {
  const ap = ajusteDoPedidoDe(pedido);
  const total_tabela_cents = linhas.reduce((s, l) => s + l.preco_tabela_cents * l.quantidade, 0);
  const total_itens_cents = linhas.reduce((s, l) => s + l.total_cents, 0);
  const A = ajusteDoPedidoCents(total_itens_cents, ap);
  const sinal = ap === null ? 0 : ap.sentido === 'desconto' ? -1 : 1;
  const rateio = ratear(
    linhas.map((l) => l.total_cents),
    A,
  );
  const linhas_cents = linhas.map((l, k) => l.total_cents + sinal * rateio[k]!);
  const total_cents = total_itens_cents + sinal * A;
  const ajuste = total_cents - total_itens_cents;
  const descontos_cents = total_tabela_cents - total_cents;
  const efetivo = total_tabela_cents > 0 ? Math.round((descontos_cents / total_tabela_cents) * 10_000) / 100 : 0;
  const alcada = descontoEfetivoAlcadaPct(linhas, pedido);
  return {
    total_tabela_cents,
    total_itens_cents,
    desconto_cents: Math.max(0, -ajuste),
    acrescimo_cents: Math.max(0, ajuste),
    total_cents,
    desconto_efetivo_pct: efetivo === 0 ? 0 : efetivo,
    desconto_efetivo_exibicao_pct: pctExibicao(descontos_cents, total_tabela_cents),
    descontos_cents,
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
