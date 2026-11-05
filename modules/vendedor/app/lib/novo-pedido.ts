/**
 * Novo pedido de distribuidora no aparelho (T-0061), em funções puras e testadas: linha por produto + medida (UN/CX), desconto
 * e acréscimo por item e por pedido, desconto efetivo e alçada, frete CIF/FOB e endereço de entrega. Usa o domain de preço
 * (`domain/preco-pedido`), a MESMA regra que a API revalida. Offline: tudo vem das linhas guardadas no aparelho.
 */
import type { Product } from '@macuxi/catalogo/contracts';
import { cnpjValido } from '@macuxi/comum';
import type { DiscountPolicy as AlcadaApi, PedidoPush } from '../../contracts';
import type { NivelAprovacao } from '../../domain/aprovacao';
import { checkDiscount, clampPct, type DiscountPolicy } from '../../domain/order';
import {
  ajusteDePct,
  ajusteDoPedidoCents,
  bloqueadoPelaAlcada,
  equivalenteDoAjuste,
  MSG_DESCONTO_E_ACRESCIMO,
  MSG_RECUSA_FRETE,
  nivelDeAprovacao,
  precoDoItem,
  totaisDoPedido,
  validarAcrescimoOuDesconto,
  validarFrete,
  type AjusteItem,
  type FretePedido,
  type LinhaParaTotal,
} from '../../domain/preco-pedido';
import { toDomainPolicy } from './catalog';

// ---------- linha = produto + medida ----------
export function chaveDaLinha(productId: string, unidade: string | null): string {
  return unidade ? `${productId}@${unidade}` : productId;
}

export function lerChaveDaLinha(chave: string): { product_id: string; unidade: string | null } {
  const i = chave.indexOf('@');
  return i < 0 ? { product_id: chave, unidade: null } : { product_id: chave.slice(0, i), unidade: chave.slice(i + 1) };
}

export interface UnidadeDaTela {
  produto_id: string;
  unidade: string;
  fator: number;
  padrao: boolean;
}

/** Medidas oferecidas para o produto: a base (fator 1) primeiro e as embalagens. Sem cadastro, só a base. */
export function unidadesDoProduto(productId: string, todas: readonly UnidadeDaTela[], unidadeBase: string): UnidadeDaTela[] {
  const doProduto = todas.filter((u) => u.produto_id === productId && u.fator >= 1);
  const base = doProduto.find((u) => u.fator === 1) ?? { produto_id: productId, unidade: unidadeBase, fator: 1, padrao: true };
  const outras = doProduto.filter((u) => u.fator > 1).sort((a, b) => a.fator - b.fator);
  return [base, ...outras];
}

/** Move a quantidade (e o ajuste) de uma medida para outra do mesmo produto. A medida `null` é a base. */
export function alternarUnidade(
  lines: Record<string, number>,
  ajustes: Record<string, Ajuste>,
  productId: string,
  de: string | null,
  para: string | null,
): { lines: Record<string, number>; ajustes: Record<string, Ajuste> } {
  const kDe = chaveDaLinha(productId, de);
  const kPara = chaveDaLinha(productId, para);
  if (kDe === kPara) return { lines, ajustes };
  const { [kDe]: qtd = 0, ...resto } = lines;
  const { [kDe]: aj, ...restoAj } = ajustes;
  return { lines: { ...resto, ...(qtd > 0 ? { [kPara]: (resto[kPara] ?? 0) + qtd } : {}) }, ajustes: aj && qtd > 0 ? { ...restoAj, [kPara]: aj } : restoAj };
}

// ---------- cálculo ----------
export interface Ajuste {
  desconto_pct?: number;
  acrescimo_pct?: number;
  /** T-0071: modo digitado (seletor % | R$ do item); ausente = % (rascunhos antigos) */
  em?: 'pct' | 'valor';
  /** T-0071: R$ POR UNIDADE da medida vendida, em centavos (modo `valor`) */
  desconto_cents?: number;
  acrescimo_cents?: number;
}

/**
 * RN-VEN-02 (v2): o ajuste do rascunho (item) vira o `AjusteItem` do domain. Só o modo escolhido vale (`em`); desconto e
 * acréscimo no mesmo modo são excludentes (`erro`).
 */
export function ajusteDoRascunho(aj: Ajuste): { ajuste: AjusteItem; erro: 'desconto_e_acrescimo' | null } {
  if (aj.em === 'valor') {
    const d = Math.max(0, Math.trunc(aj.desconto_cents ?? 0));
    const a = Math.max(0, Math.trunc(aj.acrescimo_cents ?? 0));
    if (d > 0 && a > 0) return { ajuste: null, erro: 'desconto_e_acrescimo' };
    return { ajuste: d > 0 ? { sentido: 'desconto', em: 'valor', cents: d } : a > 0 ? { sentido: 'acrescimo', em: 'valor', cents: a } : null, erro: null };
  }
  const desconto_pct = pct2(aj.desconto_pct);
  const acrescimo_pct = pct2(aj.acrescimo_pct);
  if (validarAcrescimoOuDesconto({ desconto_pct, acrescimo_pct })) return { ajuste: null, erro: 'desconto_e_acrescimo' };
  return { ajuste: ajusteDePct({ desconto_pct, acrescimo_pct }), erro: null };
}

export interface EntradaCalculo {
  /** chave da linha → quantidade na medida vendida */
  lines: Record<string, number>;
  ajustes: Record<string, Ajuste>;
  desconto_pct: number;
  acrescimo_pct: number;
  /** T-0071: ajuste do pedido em R$ sobre o total dos itens (modo `valor`); excludente entre si */
  desconto_valor_cents?: number;
  acrescimo_valor_cents?: number;
  /** T-0071: modo digitado no pedido; ausente = % */
  ajuste_em?: 'pct' | 'valor';
  catalogo: readonly Product[];
  unidades: readonly UnidadeDaTela[];
  politica: AlcadaApi;
  vendedor_id: string;
  /** preço próprio da embalagem (produto → unidade → centavos da medida), de `catalogo.precos_cliente@1` embalagens[]; ausente = UN × fator */
  embalagens?: Record<string, Record<string, number> | undefined>;
}

export interface LinhaDoPedido {
  chave: string;
  product_id: string;
  /** null = unidade base */
  unidade: string | null;
  /** sigla mostrada (UN, CX) */
  unidade_sigla: string;
  fator: number;
  quantity: number;
  quantidade_base: number;
  desconto_pct: number;
  acrescimo_pct: number;
  /** T-0071: modo do ajuste do item e R$ por unidade da medida (0 fora do modo `valor`) */
  ajuste_em: 'pct' | 'valor';
  desconto_unitario_cents: number;
  acrescimo_unitario_cents: number;
  /** T-0071: preço final da unidade vendida (arredondado no unitário, RN-VEN-02) */
  preco_unitario_cents: number;
  /** T-0071: o que o ajuste vale na outra moeda ("−R$ 0,89" / "= 5,3%"); null = sem ajuste */
  equivalente: { sentido: 'desconto' | 'acrescimo'; cents: number; pct_exibicao: number } | null;
  /** preço de tabela da medida vendida */
  preco_tabela_cents: number;
  /** total da linha depois do ajuste do item e do pedido */
  total_cents: number;
  /** total depois só do ajuste do item (antes do pedido) */
  total_item_cents: number;
}

export interface CalculoPedido {
  linhas: LinhaDoPedido[];
  total_tabela_cents: number;
  total_itens_cents: number;
  desconto_cents: number;
  acrescimo_cents: number;
  total_cents: number;
  /** T-0071: ajuste do pedido (R$ ou %) em centavos e o % equivalente, para a tela */
  ajuste_pedido: { sentido: 'desconto' | 'acrescimo'; cents: number; pct_exibicao: number } | null;
  /** T-0071 (RN-VEN-03): tabela − total (negativo = acréscimo); a linha "Descontos" do Resumo */
  descontos_cents: number;
  /** T-0071 (RN-VEN-03): o desconto efetivo da tela, 1 casa, calculado dos inteiros */
  desconto_efetivo_exibicao_pct: number;
  /** RN-VEN-03; negativo = acréscimo */
  desconto_efetivo_pct: number;
  /** pct usado na alçada (efetivo menos a folga de centavos) */
  desconto_alcada_pct: number;
  nivel: NivelAprovacao | null;
  bloqueado: boolean;
  unidades_base: number;
  /** impedem o envio (mensagens em português com a ação seguinte) */
  erros: string[];
}

function pct2(n: number | undefined): number {
  return clampPct(n ?? 0);
}

/** RN-VEN-15: embalagens[] da consulta de preço do Catálogo → produto → unidade → preço da medida. Item sem embalagens fica de fora. */
export function embalagensDaConsulta(itens: ReadonlyArray<{ produto_id: string; embalagens?: ReadonlyArray<{ unidade: string; preco_cents: number }> }>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const i of itens) {
    if (!i.embalagens || i.embalagens.length === 0) continue;
    out[i.produto_id] = Object.fromEntries(i.embalagens.map((x) => [x.unidade, x.preco_cents]));
  }
  return out;
}

export function calcularPedido(e: EntradaCalculo): CalculoPedido {
  const porId = new Map(e.catalogo.map((p) => [p.id, p]));
  const erros: string[] = [];
  const linhas: LinhaDoPedido[] = [];
  const parcial: LinhaParaTotal[] = [];
  for (const [chave, quantity] of Object.entries(e.lines)) {
    if (!(quantity > 0)) continue;
    const { product_id, unidade } = lerChaveDaLinha(chave);
    const produto = porId.get(product_id);
    if (!produto) continue;
    const nome = `${produto.erp_code} ${produto.description}`.trim();
    if (produto.price_cents === null) {
      erros.push(`${nome}: sem preço na tabela deste cliente. Remova o item ou peça a atualização da tabela.`);
      continue;
    }
    const medidas = unidadesDoProduto(product_id, e.unidades, produto.unit);
    const medida = unidade === null ? medidas[0]! : medidas.find((u) => u.unidade === unidade);
    if (!medida) {
      erros.push(`${nome}: a medida ${unidade} não está mais disponível. Escolha outra medida.`);
      continue;
    }
    const aj = e.ajustes[chave] ?? {};
    const r = ajusteDoRascunho(aj);
    if (r.erro) {
      erros.push(`${nome}: ${MSG_DESCONTO_E_ACRESCIMO} Limpe um dos dois no item.`);
      continue;
    }
    const desconto_pct = aj.em === 'valor' ? 0 : pct2(aj.desconto_pct);
    const acrescimo_pct = aj.em === 'valor' ? 0 : pct2(aj.acrescimo_pct);
    const proprio = medida.fator > 1 && e.embalagens?.[product_id]?.[medida.unidade] !== undefined ? { preco_proprio_unidade_cents: e.embalagens[product_id]![medida.unidade]! } : {};
    let preco;
    try {
      preco = precoDoItem({ preco_tabela_unidade_cents: produto.price_cents, quantidade: quantity, fator: medida.fator, desconto_pct, acrescimo_pct, ajuste: r.ajuste, ...proprio });
    } catch {
      erros.push(`${nome}: o desconto em R$ passa do preço de tabela. Reduza o desconto do item.`);
      continue;
    }
    const eq = r.ajuste ? equivalenteDoAjuste(preco.preco_tabela_cents, r.ajuste) : null;
    const unitario = r.ajuste && r.ajuste.em === 'valor' ? r.ajuste.cents : 0;
    parcial.push({ preco_tabela_cents: preco.preco_tabela_cents, quantidade: quantity, total_cents: preco.total_cents, desconto_pct, acrescimo_pct, ajuste: r.ajuste });
    linhas.push({
      chave,
      product_id,
      unidade,
      unidade_sigla: medida.unidade,
      fator: medida.fator,
      quantity,
      quantidade_base: preco.quantidade_base,
      desconto_pct,
      acrescimo_pct,
      ajuste_em: aj.em === 'valor' ? 'valor' : 'pct',
      desconto_unitario_cents: r.ajuste?.sentido === 'desconto' ? unitario : 0,
      acrescimo_unitario_cents: r.ajuste?.sentido === 'acrescimo' ? unitario : 0,
      preco_unitario_cents: preco.preco_unitario_cents,
      equivalente: r.ajuste && eq ? { sentido: r.ajuste.sentido, cents: eq.cents, pct_exibicao: eq.pct_exibicao } : null,
      preco_tabela_cents: preco.preco_tabela_cents,
      total_cents: preco.total_cents,
      total_item_cents: preco.total_cents,
    });
  }
  const desconto = pct2(e.desconto_pct);
  const acrescimo = pct2(e.acrescimo_pct);
  const emValor = e.ajuste_em === 'valor';
  const dV = Math.max(0, Math.trunc(e.desconto_valor_cents ?? 0));
  const aV = Math.max(0, Math.trunc(e.acrescimo_valor_cents ?? 0));
  let ajustePedido: AjusteItem = null;
  if (emValor ? dV > 0 && aV > 0 : validarAcrescimoOuDesconto({ desconto_pct: desconto, acrescimo_pct: acrescimo })) {
    erros.push(`Pedido: ${MSG_DESCONTO_E_ACRESCIMO} Limpe um dos dois nas Condições.`);
  } else if (emValor) {
    ajustePedido = dV > 0 ? { sentido: 'desconto', em: 'valor', cents: dV } : aV > 0 ? { sentido: 'acrescimo', em: 'valor', cents: aV } : null;
  } else {
    ajustePedido = ajusteDePct({ desconto_pct: desconto, acrescimo_pct: acrescimo });
  }
  const totalItens = parcial.reduce((s0, l) => s0 + l.total_cents, 0);
  if (ajustePedido && ajustePedido.sentido === 'desconto' && ajustePedido.em === 'valor' && ajustePedido.cents > totalItens) {
    erros.push('Pedido: o desconto em R$ passa do total dos itens. Reduza o desconto do pedido.');
    ajustePedido = null;
  }
  const t = totaisDoPedido(parcial, ajustePedido);
  linhas.forEach((l, i) => {
    l.total_cents = t.linhas_cents[i] ?? l.total_cents;
  });
  const policy: DiscountPolicy = toDomainPolicy(e.politica);
  const nivel = nivelDeAprovacao(t.desconto_efetivo_alcada_pct, policy, e.vendedor_id);
  const bloqueado = bloqueadoPelaAlcada(t.desconto_efetivo_alcada_pct, policy, e.vendedor_id);
  if (bloqueado) {
    erros.push(`Desconto efetivo de ${t.desconto_efetivo_pct.toLocaleString('pt-BR')}% acima da alçada máxima (${policy.manager_pct.toLocaleString('pt-BR')}%). Reduza o desconto do pedido ou dos itens.`);
  }
  return {
    linhas,
    total_tabela_cents: t.total_tabela_cents,
    total_itens_cents: t.total_itens_cents,
    desconto_cents: t.desconto_cents,
    acrescimo_cents: t.acrescimo_cents,
    total_cents: t.total_cents,
    ajuste_pedido: ajustePedido ? { sentido: ajustePedido.sentido, cents: ajusteDoPedidoCents(t.total_itens_cents, ajustePedido), pct_exibicao: equivalenteDoAjuste(t.total_itens_cents, ajustePedido).pct_exibicao } : null,
    descontos_cents: t.descontos_cents,
    desconto_efetivo_exibicao_pct: t.desconto_efetivo_exibicao_pct,
    desconto_efetivo_pct: t.desconto_efetivo_pct,
    desconto_alcada_pct: t.desconto_efetivo_alcada_pct,
    nivel,
    bloqueado,
    unidades_base: linhas.reduce((s, l) => s + l.quantidade_base, 0),
    erros,
  };
}

/** Itens do push: só a embalagem leva `unidade`; desconto/acréscimo só quando existem (o resto fica igual ao dos APKs anteriores). */
export function linhasParaPush(linhas: readonly LinhaDoPedido[]): PedidoPush['items'] {
  return linhas.map((l) => ({
    product_id: l.product_id,
    quantity: l.quantity,
    ...(l.unidade ? { unidade: l.unidade } : {}),
    ...(l.desconto_pct > 0 ? { desconto_pct: l.desconto_pct } : {}),
    ...(l.acrescimo_pct > 0 ? { acrescimo_pct: l.acrescimo_pct } : {}),
    // T-0071: em R$ vai só o valor da unidade vendida (o servidor grava o modo; % e R$ juntos dão 422 ajuste_invalido)
    ...(l.desconto_unitario_cents > 0 ? { desconto_unitario_cents: l.desconto_unitario_cents } : {}),
    ...(l.acrescimo_unitario_cents > 0 ? { acrescimo_unitario_cents: l.acrescimo_unitario_cents } : {}),
    ...(l.ajuste_em === 'valor' && l.equivalente ? { ajuste_em: 'valor' as const } : {}),
  }));
}

/** Efeito do desconto efetivo na alçada do vendedor, para o texto do rodapé. */
export function textoDaAlcada(c: Pick<CalculoPedido, 'desconto_efetivo_pct' | 'nivel' | 'bloqueado'>, limiteVendedor: number): { texto: string; tom: 'neutro' | 'ok' | 'aviso' | 'erro' } {
  const pct = c.desconto_efetivo_pct;
  const fmt = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
  if (pct < 0) return { texto: `Acréscimo efetivo de ${fmt(-pct)} · sem aprovação`, tom: 'neutro' };
  if (pct === 0) return { texto: 'Sem desconto', tom: 'neutro' };
  if (c.bloqueado) return { texto: `Desconto efetivo de ${fmt(pct)} · acima da alçada máxima · reduza para enviar`, tom: 'erro' };
  if (c.nivel) return { texto: `Desconto efetivo de ${fmt(pct)} · acima da sua alçada (${fmt(limiteVendedor)}) · vai para aprovação`, tom: 'aviso' };
  return { texto: `Desconto efetivo de ${fmt(pct)} · dentro da sua alçada`, tom: 'ok' };
}

// ---------- frete ----------
export interface FreteDoRascunho {
  modalidade: 'CIF' | 'FOB';
  transportadora_id?: string | null;
  transportadora_digitada?: { nome: string; cnpj: string; telefone?: string | null } | null;
}

export interface TransportadoraDaTela {
  id: string;
  nome: string;
  documento: string | null;
  telefone: string | null;
  ativo: boolean;
}

export function transportadorasAtivas(l: readonly TransportadoraDaTela[]): TransportadoraDaTela[] {
  return l.filter((t) => t.ativo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Mensagem de bloqueio do envio (null = frete ok). Mesma regra da API (`validarFrete`, RN-VEN-16). */
export function freteValido(f: FreteDoRascunho): string | null {
  const dig = f.transportadora_digitada;
  const codigo = validarFrete({
    modalidade: f.modalidade,
    transportadora_id: f.transportadora_id ?? null,
    transportadora_digitada: dig ? { nome: dig.nome, cnpj: dig.cnpj.replace(/\D/g, ''), telefone: dig.telefone ?? null } : null,
  } satisfies FretePedido);
  if (!codigo) return null;
  if (codigo === 'transportadora_invalida' && dig && !cnpjValido(dig.cnpj)) return 'CNPJ da transportadora inválido. Confira os 14 dígitos.';
  return MSG_RECUSA_FRETE[codigo];
}

export function rotuloDoFrete(f: FreteDoRascunho, transportadoras: readonly TransportadoraDaTela[]): string {
  if (f.modalidade === 'CIF') return 'CIF · por conta da empresa';
  const nome = f.transportadora_id ? transportadoras.find((t) => t.id === f.transportadora_id)?.nome : f.transportadora_digitada?.nome;
  return nome ? `FOB · por conta do cliente · ${nome}` : 'FOB · falta a transportadora';
}

/** Payload do frete no push (ausente = padrão do tenant, no servidor). */
export function fretePush(f: FreteDoRascunho | undefined): PedidoPush['frete'] {
  if (!f) return undefined;
  if (f.modalidade === 'CIF') return { modalidade: 'CIF' };
  if (f.transportadora_id) return { modalidade: 'FOB', transportadora_id: f.transportadora_id };
  const d = f.transportadora_digitada;
  return d ? { modalidade: 'FOB', transportadora_digitada: { nome: d.nome.trim(), cnpj: d.cnpj.replace(/\D/g, ''), ...(d.telefone?.trim() ? { telefone: d.telefone.trim() } : {}) } } : { modalidade: 'FOB' };
}

// ---------- endereço de entrega ----------
export interface EnderecoDaTela {
  id: string;
  cliente_id: string;
  tipo: string;
  descricao: string | null;
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  cep: string | null;
  principal: boolean;
  ativo: boolean;
}

/** Endereços que o vendedor pode escolher para entrega: o principal primeiro e depois os de entrega (cobrança não entra). */
export function enderecosDoCliente(todos: readonly EnderecoDaTela[], clienteId: string): EnderecoDaTela[] {
  return todos
    .filter((e) => e.cliente_id === clienteId && e.ativo && (e.principal || e.tipo === 'principal' || e.tipo === 'entrega'))
    .sort((a, b) => Number(b.principal || b.tipo === 'principal') - Number(a.principal || a.tipo === 'principal') || a.logradouro.localeCompare(b.logradouro, 'pt-BR'));
}

export function textoDoEndereco(e: Pick<EnderecoDaTela, 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'uf'>): string {
  const rua = [e.logradouro, e.numero].filter((x) => x && x.trim() !== '').join(', ');
  const local = e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ''}` : '';
  return [rua, e.bairro, local].filter((x) => x && x.trim() !== '').join(' · ');
}

/** Alçada do vendedor no domínio (exceções por vendedor), para o texto do rodapé. */
export function limiteDoVendedor(politica: AlcadaApi, vendedorId: string): number {
  return checkDiscount(0, toDomainPolicy(politica), vendedorId).limit_pct;
}

// ---------- campo em R$ (T-0071) ----------
/** "1,00" / "1.5" / "R$ 1.234,56" / "5" → centavos inteiros; inválido ou negativo = 0. */
export function reaisParaCents(texto: string): number {
  const bruto = texto.replace(/[^\d,.-]/g, '');
  // W4: um único "." sem vírgula e com até 2 casas depois é decimal ("1.5" = 1,50); com 3 casas ou mais de um ponto é milhar
  const pontoDecimal = !bruto.includes(',') && /^-?\d*\.\d{0,2}$/.test(bruto);
  const limpo = pontoDecimal ? bruto : bruto.replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Number((n * 100).toFixed(4)));
}

/** Centavos → texto do campo, sem o símbolo: 100 → "1,00". */
export function centsParaCampo(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Troca o modo do ajuste do item (% ↔ R$) levando o que estava digitado para o outro modo pelo equivalente da linha
 * (R$ 1,00 sobre 18,90 → 5,3%; 5% sobre 17,90 → R$ 0,89). Sem ajuste, só troca o modo.
 */
export function trocarModoDoAjuste(aj: Ajuste, para: 'pct' | 'valor', equivalente: { cents: number; pct_exibicao: number } | null): Ajuste {
  const de = aj.em === 'valor' ? 'valor' : 'pct';
  if (de === para) return aj;
  const desconto = para === 'valor' ? (aj.desconto_pct ?? 0) > 0 : (aj.desconto_cents ?? 0) > 0;
  const acrescimo = para === 'valor' ? (aj.acrescimo_pct ?? 0) > 0 : (aj.acrescimo_cents ?? 0) > 0;
  if (!equivalente || (!desconto && !acrescimo)) return { em: para };
  if (para === 'valor') return { em: 'valor', ...(desconto ? { desconto_cents: equivalente.cents } : { acrescimo_cents: equivalente.cents }) };
  return { em: 'pct', ...(desconto ? { desconto_pct: equivalente.pct_exibicao } : { acrescimo_pct: equivalente.pct_exibicao }) };
}
