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
  bloqueadoPelaAlcada,
  MSG_DESCONTO_E_ACRESCIMO,
  MSG_RECUSA_FRETE,
  nivelDeAprovacao,
  precoDoItem,
  totaisDoPedido,
  validarAcrescimoOuDesconto,
  validarFrete,
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
}

export interface EntradaCalculo {
  /** chave da linha → quantidade na medida vendida */
  lines: Record<string, number>;
  ajustes: Record<string, Ajuste>;
  desconto_pct: number;
  acrescimo_pct: number;
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
    const desconto_pct = pct2(aj.desconto_pct);
    const acrescimo_pct = pct2(aj.acrescimo_pct);
    if (validarAcrescimoOuDesconto({ desconto_pct, acrescimo_pct })) {
      erros.push(`${nome}: ${MSG_DESCONTO_E_ACRESCIMO} Limpe um dos dois no item.`);
      continue;
    }
    const preco = precoDoItem({ preco_tabela_unidade_cents: produto.price_cents, quantidade: quantity, fator: medida.fator, desconto_pct, acrescimo_pct, ...(medida.fator > 1 && e.embalagens?.[product_id]?.[medida.unidade] !== undefined ? { preco_proprio_unidade_cents: e.embalagens[product_id]![medida.unidade]! } : {}) });
    parcial.push({ preco_tabela_cents: preco.preco_tabela_cents, quantidade: quantity, total_cents: preco.total_cents, desconto_pct, acrescimo_pct });
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
      preco_tabela_cents: preco.preco_tabela_cents,
      total_cents: preco.total_cents,
      total_item_cents: preco.total_cents,
    });
  }
  const desconto = pct2(e.desconto_pct);
  const acrescimo = pct2(e.acrescimo_pct);
  if (validarAcrescimoOuDesconto({ desconto_pct: desconto, acrescimo_pct: acrescimo })) {
    erros.push(`Pedido: ${MSG_DESCONTO_E_ACRESCIMO} Limpe um dos dois nas Condições.`);
  }
  const ok = !erros.some((m) => m.includes(MSG_DESCONTO_E_ACRESCIMO) && m.startsWith('Pedido'));
  const t = totaisDoPedido(parcial, ok ? { desconto_pct: desconto, acrescimo_pct: acrescimo } : { desconto_pct: 0, acrescimo_pct: 0 });
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
