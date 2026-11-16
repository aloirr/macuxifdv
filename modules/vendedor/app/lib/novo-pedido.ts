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
import { retratoAplicacao } from '../../domain/aplicacao';
import { limiteDoUsuario, minimoDoItem, pedidoAcimaDoLimite, permilDoDescontoExibido } from '../../domain/limite-desconto';
import type { LimiteDesconto } from '@macuxi/core/contracts';
import { alcadaDoAutorPct } from '../../domain/pedido-em-nome';
import { precoDoItemNaEdicao } from '../../domain/orcamento';
import type { ErroDeCalculo } from '../../domain/pendencias-preenchimento';
import { faixasDaConsulta, medidaDaFaixa, precoBaseDoItem, type FaixaEscalonada } from '../../domain/preco-item';
import {
  ajusteDePct,
  ajusteDoPedidoCents,
  bloqueadoPelaAlcada,
  bpDoItem,
  equivalenteDoAjuste,
  itemRespeitaPrecoMinimo,
  MSG_DESCONTO_E_ACRESCIMO,
  MSG_RECUSA_FRETE,
  nivelDeAprovacao,
  precoDoItem,
  precoMinimoBaseCents,
  totaisDoPedido,
  validarAcrescimoOuDesconto,
  validarFrete,
  type AjusteItem,
  type FretePedido,
  type LinhaParaTotal,
} from '../../domain/preco-pedido';
import { normalize, toDomainPolicy } from './catalog';

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
  /** T-0084 (RN-VEN-19): caixa "Incluir aplicação no orçamento" do item; ausente = o padrão do tenant (marcada) */
  aplicacao_marcada?: boolean;
  /** T-0084: retrato já gravado (edição de orçamento); vale enquanto a caixa não for desmarcada e marcada de novo */
  aplicacao_retrato?: string;
}

/** RN-VEN-19: a caixa do item (marcada ou não) dado o padrão do tenant. */
export function aplicacaoMarcada(aj: Pick<Ajuste, 'aplicacao_marcada'> | undefined, padrao: boolean): boolean {
  return aj?.aplicacao_marcada ?? padrao;
}

/**
 * RN-VEN-19: alterna a caixa do item. Desmarcar e marcar de novo descarta o retrato antigo (o próximo pega o texto atual
 * do cadastro). `marcadaAgora` é o estado atual da caixa (`LinhaDoPedido.aplicacao_marcada`).
 */
export function alternarAplicacao(aj: Ajuste | undefined, marcadaAgora: boolean): Ajuste {
  const { aplicacao_retrato: _antigo, ...resto } = aj ?? {};
  return { ...resto, aplicacao_marcada: !marcadaAgora };
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

/** RN-VEN-11: o produto do aparelho pode trazer o preço mínimo por unidade base (preço de venda × (1 − desconto máximo)); ausente = sem trava. */
/** RN-VEN-43: `preco_venda_cents` e `desconto_maximo_pct` ficam no produto para o mínimo ser refeito sobre a tabela ajustada quando o prazo muda. */
export type ProdutoComMinimo = Product & { preco_minimo_base_cents?: number | null; preco_venda_cents?: number | null; desconto_maximo_pct?: number | null };

/** RN-VEN-43: mínimo por unidade base sobre a tabela ajustada (refeito do preço de venda); sem o dado do produto ou sem percentual, o mínimo do aparelho. */
export function minimoDoProdutoNoPrazo(p: ProdutoComMinimo, bp: number): number | null {
  if (bp !== 0 && p.preco_venda_cents != null && p.desconto_maximo_pct != null) return precoMinimoBaseCents({ preco_venda_cents: p.preco_venda_cents, desconto_maximo_pct: p.desconto_maximo_pct, percentual_ajuste_bp: bp });
  return p.preco_minimo_base_cents ?? null;
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
  /** RN-VEN-11a (T-0168): funções e limite de desconto do usuário da sessão; ausente = padrão */
  limite?: Partial<LimiteDesconto> | null;
  /** RN-VEN-23: faixas vigentes da tabela escalonada por produto (de `catalogo.precos_cliente@1` faixas[]); ausente = sem faixa */
  faixas?: Record<string, readonly FaixaEscalonada[] | undefined>;
  /** T-0134 (RN-VEN-18): produto → preço de tabela por unidade já gravado no orçamento em edição; esses itens não são reprecificados */
  congelados?: Record<string, number>;
  /** T-0084 (RN-VEN-19): parâmetros do tenant; ausente = a linha não leva aplicação */
  aplicacao?: { padrao: boolean; max: number };
  /** RN-VEN-43/44: % do prazo do rascunho em bp; a tabela de cada item é ajustada por ele, sempre a partir da tabela original. Ausente = 0. */
  percentual_ajuste_bp?: number;
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
  /** T-0084 (RN-VEN-19): retrato da aplicação a gravar; null = desmarcada ou produto sem aplicação */
  aplicacao: string | null;
  /** T-0084: estado da caixa "Incluir aplicação no orçamento" (false quando o produto não tem aplicação) */
  aplicacao_marcada: boolean;
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
  /** RN-VEN-11 (T-0151): códigos dos itens com desconto acima do máximo do produto; bloqueiam o envio do pedido (só orçamento) */
  acima_do_maximo: string[];
  /** RN-VEN-11a (T-0168): limite do pedido em ‰ quando o desconto efetivo passa dele (só orçamento; sem linha de alçada); senão null */
  acima_do_limite: number | null;
  unidades_base: number;
  /** impedem o envio (mensagens em português com a ação seguinte) */
  erros: string[];
  /** RD-0037: os mesmos erros, com código e alvo (as pendências decidem por eles, nunca pelo texto) */
  pendencias: ErroDeCalculo[];
}

function pct2(n: number | undefined): number {
  return clampPct(n ?? 0);
}

/** RN-VEN-23: faixas da consulta de preço do Catálogo → produto → faixas. Item sem faixa fica de fora. */
export function faixasPorProduto(itens: ReadonlyArray<{ produto_id: string }>): Record<string, FaixaEscalonada[]> {
  const out: Record<string, FaixaEscalonada[]> = {};
  for (const i of itens) {
    const f = faixasDaConsulta(i);
    if (f.length > 0) out[i.produto_id] = f;
  }
  return out;
}

export function calcularPedido(e: EntradaCalculo): CalculoPedido {
  const porId = new Map(e.catalogo.map((p) => [p.id, p]));
  const limite = limiteDoUsuario(e.limite);
  const pendencias: ErroDeCalculo[] = [];
  const linhas: LinhaDoPedido[] = [];
  const acimaDoMaximo: string[] = [];
  const parcial: LinhaParaTotal[] = [];
  for (const [chave, quantity] of Object.entries(e.lines)) {
    if (!(quantity > 0)) continue;
    const { product_id, unidade } = lerChaveDaLinha(chave);
    const produto = porId.get(product_id);
    if (!produto) continue;
    const nome = `${produto.erp_code} ${produto.description}`.trim();
    // T-0134 (RN-VEN-18): item salvo no orçamento mantém o preço salvo; só o item novo entra pelo preço de hoje
    const escolhido = precoDoItemNaEdicao({ congelado_cents: e.congelados?.[product_id], hoje_cents: produto.price_cents, faixas_hoje: e.faixas?.[product_id] });
    // RN-VEN-43: o preço congelado do orçamento (RN-VEN-18) já está gravado ajustado e não ajusta de novo
    const bp = bpDoItem(e.congelados?.[product_id] !== undefined, e.percentual_ajuste_bp ?? 0);
    if (escolhido.preco_unidade_cents === null) {
      pendencias.push({ codigo: 'sem_preco', alvo: { item: nome }, mensagem: `${nome}: sem preço na tabela deste cliente. Remova o item ou peça a atualização da tabela.` });
      continue;
    }
    const medidas = unidadesDoProduto(product_id, e.unidades, produto.unit);
    const medida = unidade === null ? medidas[0]! : medidas.find((u) => u.unidade === unidade);
    if (!medida) {
      pendencias.push({ codigo: 'medida_indisponivel', alvo: { item: nome }, mensagem: `${nome}: a medida ${unidade} não está mais disponível. Escolha outra medida.` });
      continue;
    }
    const aj = e.ajustes[chave] ?? {};
    const r = ajusteDoRascunho(aj);
    if (r.erro) {
      pendencias.push({ codigo: 'desconto_e_acrescimo', alvo: { item: nome }, mensagem: `${nome}: ${MSG_DESCONTO_E_ACRESCIMO} Limpe um dos dois no item.` });
      continue;
    }
    const desconto_pct = aj.em === 'valor' ? 0 : pct2(aj.desconto_pct);
    const acrescimo_pct = aj.em === 'valor' ? 0 : pct2(aj.acrescimo_pct);
    // RN-VEN-15/23: a base é o menor entre a tabela e a faixa da quantidade; a embalagem é sempre UN × fator
    const base = precoBaseDoItem({ preco_tabela_unidade_cents: escolhido.preco_unidade_cents, faixas: escolhido.faixas, medida: medidaDaFaixa(medida.unidade, medida.fator), fator: medida.fator, quantidade: quantity });
    let preco;
    try {
      preco = precoDoItem({ preco_tabela_unidade_cents: base.base_unidade_cents, quantidade: quantity, fator: medida.fator, desconto_pct, acrescimo_pct, ajuste: r.ajuste, percentual_ajuste_bp: bp });
    } catch {
      pendencias.push({ codigo: 'desconto_acima_tabela', alvo: { item: nome }, mensagem: `${nome}: o desconto em R$ passa do preço de tabela. Reduza o desconto do item.` });
      continue;
    }
    // RN-VEN-11 (T-0151): desconto que leva o preço final abaixo do mínimo do produto bloqueia o envio do pedido
    // RN-VEN-43: o mínimo parte da tabela ajustada pelo prazo
    const minimoBase = minimoDoProdutoNoPrazo(produto as ProdutoComMinimo, bp);
    const minimo = minimoDoItem(minimoBase, limite);
    if (!itemRespeitaPrecoMinimo({ preco_tabela_unidade_cents: base.base_unidade_cents, quantidade: quantity, fator: medida.fator, desconto_pct, acrescimo_pct, ajuste: r.ajuste, preco_minimo_base_cents: minimo, percentual_ajuste_bp: bp }) && !acimaDoMaximo.includes(produto.erp_code)) acimaDoMaximo.push(produto.erp_code);
    // T-0084 (RN-VEN-19): retrato no momento do pedido; o retrato já gravado (edição) vale até a caixa ser refeita
    const aplicacaoDaLinha = e.aplicacao ? retratoAplicacao(aj.aplicacao_retrato ?? produto.applications, aplicacaoMarcada(aj, e.aplicacao.padrao), e.aplicacao.max) : null;
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
      aplicacao: aplicacaoDaLinha,
      aplicacao_marcada: aplicacaoDaLinha !== null,
    });
  }
  const desconto = pct2(e.desconto_pct);
  const acrescimo = pct2(e.acrescimo_pct);
  const emValor = e.ajuste_em === 'valor';
  const dV = Math.max(0, Math.trunc(e.desconto_valor_cents ?? 0));
  const aV = Math.max(0, Math.trunc(e.acrescimo_valor_cents ?? 0));
  let ajustePedido: AjusteItem = null;
  if (emValor ? dV > 0 && aV > 0 : validarAcrescimoOuDesconto({ desconto_pct: desconto, acrescimo_pct: acrescimo })) {
    pendencias.push({ codigo: 'desconto_e_acrescimo', alvo: 'pedido', mensagem: `Pedido: ${MSG_DESCONTO_E_ACRESCIMO} Limpe um dos dois nas Condições.` });
  } else if (emValor) {
    ajustePedido = dV > 0 ? { sentido: 'desconto', em: 'valor', cents: dV } : aV > 0 ? { sentido: 'acrescimo', em: 'valor', cents: aV } : null;
  } else {
    ajustePedido = ajusteDePct({ desconto_pct: desconto, acrescimo_pct: acrescimo });
  }
  const totalItens = parcial.reduce((s0, l) => s0 + l.total_cents, 0);
  if (ajustePedido && ajustePedido.sentido === 'desconto' && ajustePedido.em === 'valor' && ajustePedido.cents > totalItens) {
    pendencias.push({ codigo: 'desconto_acima_total', alvo: 'pedido', mensagem: 'Pedido: o desconto em R$ passa do total dos itens. Reduza o desconto do pedido.' });
    ajustePedido = null;
  }
  const t = totaisDoPedido(parcial, ajustePedido);
  linhas.forEach((l, i) => {
    l.total_cents = t.linhas_cents[i] ?? l.total_cents;
  });
  const policy: DiscountPolicy = toDomainPolicy(e.politica);
  // RN-VEN-11a: acima do limite do pedido não há linha de alçada (só orçamento)
  const acimaDoLimite = pedidoAcimaDoLimite(permilDoDescontoExibido(t), limite) ? limite.desconto_maximo_pedido_permil : null;
  const nivel = acimaDoLimite !== null ? null : nivelDeAprovacao(t.desconto_efetivo_alcada_pct, policy, e.vendedor_id);
  const bloqueado = bloqueadoPelaAlcada(t.desconto_efetivo_alcada_pct, policy, e.vendedor_id);
  if (bloqueado) {
    const limite = `${policy.manager_pct.toLocaleString('pt-BR')}%`;
    pendencias.push({ codigo: 'acima_alcada', alvo: 'pedido', limite, mensagem: `Desconto ${t.desconto_efetivo_pct.toLocaleString('pt-BR')}% acima do máximo` });
  }
  return {
    linhas,
    erros: pendencias.map((p) => p.mensagem),
    pendencias,
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
    acima_do_maximo: acimaDoMaximo,
    acima_do_limite: acimaDoLimite,
    unidades_base: linhas.reduce((s, l) => s + l.quantidade_base, 0),
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
    // T-0084 (RN-VEN-19): só quando há texto; nulo/ausente = sem aplicação (o payload fica igual ao dos APKs anteriores)
    ...(l.aplicacao ? { aplicacao: l.aplicacao } : {}),
  }));
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

/** T-0165 (RN-VEN-16): a folha "Transportadora" procura no nome, sem acento e sem caixa; busca vazia traz todas (já em ordem alfabética). */
export function filtrarTransportadoras(l: readonly TransportadoraDaTela[], busca: string): TransportadoraDaTela[] {
  const q = normalize(busca).trim();
  const ativas = transportadorasAtivas(l);
  return q ? ativas.filter((t) => normalize(t.nome).includes(q)) : ativas;
}

export const OUTRA_TRANSPORTADORA = 'Outra (digitar)';

/** O que o campo mostra: o nome da cadastrada, "Outra" quando digita, vazio ("Escolher") sem escolha. */
export function textoDoCampoTransportadora(f: FreteDoRascunho, l: readonly TransportadoraDaTela[]): string | null {
  if (f.transportadora_id) return l.find((t) => t.id === f.transportadora_id)?.nome ?? null;
  return f.transportadora_digitada != null ? 'Outra' : null;
}

/** Mensagem de bloqueio do envio (null = frete ok). Mesma regra da API (`validarFrete`, RN-VEN-16). */
export function freteValido(f: FreteDoRascunho): string | null {
  const r = recusaDoFrete(f);
  if (!r) return null;
  return r.codigo === 'cnpj' ? 'CNPJ da transportadora inválido. Confira os 14 dígitos.' : MSG_RECUSA_FRETE[r.recusa];
}

/** RN-VEN-16: a recusa do frete em código (RD-0037); `codigo` é o que as pendências leem, nunca o texto. */
function recusaDoFrete(f: FreteDoRascunho): { recusa: NonNullable<ReturnType<typeof validarFrete>>; codigo: 'transportadora' | 'cnpj' } | null {
  const dig = f.transportadora_digitada;
  const recusa = validarFrete({
    modalidade: f.modalidade,
    transportadora_id: f.transportadora_id ?? null,
    transportadora_digitada: dig ? { nome: dig.nome, cnpj: dig.cnpj.replace(/\D/g, ''), telefone: dig.telefone ?? null } : null,
  } satisfies FretePedido);
  if (!recusa) return null;
  return { recusa, codigo: recusa === 'transportadora_invalida' && dig && !cnpjValido(dig.cnpj) ? 'cnpj' : 'transportadora' };
}

/** RN-VEN-16 / RN-CORE-36: o código da pendência do frete (a aba é Entrega). */
export function situacaoDoFrete(f: FreteDoRascunho): 'ok' | 'transportadora' | 'cnpj' {
  return recusaDoFrete(f)?.codigo ?? 'ok';
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

export function textoDoEndereco(e: { logradouro: string; numero?: string | null; complemento?: string | null; bairro?: string | null; cidade: string; uf: string }): string {
  const rua = [e.logradouro, e.numero, e.complemento].filter((x) => x && x.trim() !== '').join(', ');
  const local = e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ''}` : '';
  return [rua, e.bairro, local].filter((x) => x && x.trim() !== '').join(' · ');
}

/**
 * RN-VEN-10 (pedido em nome): a alçada do gestor no lugar da do vendedor, sem as exceções individuais. Mesma regra do
 * servidor (`politicaDoAutor`), aplicada à política no formato da API.
 */
export function politicaParaAutor(politica: AlcadaApi, perfilAutor: string): AlcadaApi {
  return { ...politica, seller_pct: alcadaDoAutorPct(perfilAutor, politica), exceptions: [] };
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

// ---------- tipo do ajuste do item (T-0089: Desc % · Desc R$ · Acrésc % · Acrésc R$) ----------
export type TipoDoAjuste = 'desc_pct' | 'desc_reais' | 'acresc_pct' | 'acresc_reais';

/** O tipo que o ajuste do rascunho representa; sem valor (ajuste vazio) lê o modo e fica em desconto. */
export function tipoDoAjuste(aj: Ajuste): TipoDoAjuste {
  const reais = aj.em === 'valor';
  const acrescimo = reais ? (aj.acrescimo_cents ?? 0) > 0 : (aj.acrescimo_pct ?? 0) > 0;
  return `${acrescimo ? 'acresc' : 'desc'}_${reais ? 'reais' : 'pct'}` as TipoDoAjuste;
}

/** O número do ajuste: % (como digitado) ou centavos por unidade vendida. */
export function valorDoAjuste(aj: Ajuste): number {
  const t = tipoDoAjuste(aj);
  return t === 'desc_pct' ? (aj.desconto_pct ?? 0) : t === 'acresc_pct' ? (aj.acrescimo_pct ?? 0) : t === 'desc_reais' ? (aj.desconto_cents ?? 0) : (aj.acrescimo_cents ?? 0);
}

/** O ajuste do rascunho para um tipo e um valor (% ou centavos). Sentido e modo ficam sempre coerentes (RN-VEN-02: nunca os dois juntos). */
export function ajusteDoTipo(tipo: TipoDoAjuste, valor: number): Ajuste {
  const v = Math.max(0, valor);
  switch (tipo) {
    case 'desc_pct':
      return { em: 'pct', desconto_pct: v };
    case 'acresc_pct':
      return { em: 'pct', acrescimo_pct: v };
    case 'desc_reais':
      return { em: 'valor', desconto_cents: Math.round(v) };
    case 'acresc_reais':
      return { em: 'valor', acrescimo_cents: Math.round(v) };
  }
}

/**
 * Troca o tipo do ajuste levando o valor: na troca de % para R$ (ou o contrário) vale o equivalente da linha
 * (`trocarModoDoAjuste`); na troca entre desconto e acréscimo o número fica.
 */
export function trocarTipoDoAjuste(aj: Ajuste, novo: TipoDoAjuste, equivalente: { cents: number; pct_exibicao: number } | null): Ajuste {
  const atual = tipoDoAjuste(aj);
  if (atual === novo) return aj;
  const modoNovo = novo.endsWith('reais') ? 'valor' : 'pct';
  const modoAtual = aj.em === 'valor' ? 'valor' : 'pct';
  const base = modoAtual === modoNovo ? aj : trocarModoDoAjuste(aj, modoNovo, equivalente);
  return ajusteDoTipo(novo, valorDoAjuste(base));
}
