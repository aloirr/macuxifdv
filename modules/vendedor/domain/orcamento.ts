/**
 * Orçamento (pré-venda) × pedido (T-0053, T-0071; RF-VEN-03, RN-VEN-18, RN-VEN-32, RN-VEN-13). Funções puras: o app
 * (offline) e a API usam a mesma regra; a API sempre revalida.
 *
 * - Orçamento é um documento do vendedor, gravado como o pedido (mesma linha, `tipo = 'orcamento'`), que NÃO vai para
 *   aprovação nem para o ERP, não reserva estoque, não consome crédito e vale por [7] dias (RN-VEN-18/32), fora da meta.
 * - Cliente bloqueado, inativo ou com cadastro incompleto: só orçamento (RN-VEN-13).
 * - Converter = criar um pedido NOVO (UUID do aparelho, RN-VEN-33) com `orcamento_origem_id`; o pedido passa por toda a
 *   validação do dia (preço vigente, alçada, condição). Um orçamento converte uma vez.
 */
import { localIsoDate, zonedParts } from '@macuxi/comum/fuso';
import { somarDiasCivis as somarDias } from '@macuxi/comum/relogio';
import { dataDoPreco, type EventoHistorico, type Recusa } from './aprovacao';
import type { DiscountPolicy, OrderStatus } from './order';
import {
  descontoMaximoDoItemPct,
  limiteDoAjusteDoItem,
  nivelDeAprovacao,
  precoDoItem,
  totaisDoPedido,
  type AjusteItem,
  type AjustePedido,
  type NivelDePreco,
  type TotaisDoPedido,
} from './preco-pedido';

export const TIPOS_DOCUMENTO = ['pedido', 'orcamento'] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

/** RN-VEN-18: validade padrão; parâmetro do tenant `orcamento.validade_dias` (1 a 90). */
export const VALIDADE_ORCAMENTO_DIAS_PADRAO = 7;
export const PARAMETRO_VALIDADE_ORCAMENTO = 'orcamento.validade_dias';
const VALIDADE_MAX_DIAS = 90;

export function validadeOrcamentoDias(parametros: Record<string, unknown>): number {
  const bruto = parametros[PARAMETRO_VALIDADE_ORCAMENTO];
  const n = typeof bruto === 'number' ? bruto : typeof bruto === 'string' && bruto.trim() !== '' ? Number(bruto) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= VALIDADE_MAX_DIAS ? n : VALIDADE_ORCAMENTO_DIAS_PADRAO;
}

/** Início (00:00) do dia civil AAAA-MM-DD no fuso, como instante UTC. */
function inicioDoDia(data: string, fuso: string): string {
  const [y, m, d] = data.split('-').map(Number) as [number, number, number];
  const alvo = Date.UTC(y, m - 1, d);
  let t = alvo;
  for (let k = 0; k < 3; k++) {
    const p = zonedParts(t, fuso);
    t += alvo - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return new Date(t).toISOString();
}

/**
 * RN-VEN-18: validade por DATA CIVIL no fuso do tenant. `data` = dia do momento + N dias (vale até o fim desse dia);
 * `ate` = início do dia seguinte no fuso, em UTC — vencido ⇔ agora ≥ `ate`. `momento` é o do aparelho (`dataDoPreco`).
 */
export function validadeDoOrcamento(momento: string, dias: number, fuso: string): { data: string; ate: string } {
  const data = somarDias(localIsoDate(momento, fuso), dias);
  return { data, ate: inicioDoDia(somarDias(data, 1), fuso) };
}

/**
 * T-0141 (RN-VEN-18, 09/11): o orçamento NÃO expira. O que vale 7 dias ([orcamento.validade_dias]) é o PREÇO congelado: a função
 * ÚNICA do prazo do preço. `data` = último dia (D+7) e `ate` = início do dia seguinte no fuso, em UTC (o preço vale até 23:59:59).
 */
export const validadeDoPreco = validadeDoOrcamento;

/** RN-VEN-18: o preço congelado ainda vale? `ate` = `validade_ate` do orçamento; sem data = vale (documento antigo). */
export function precoDoOrcamentoVale(ate: string | null | undefined, agora: Date): boolean {
  return !ate || agora.getTime() < Date.parse(ate);
}

/** RN-VEN-18: a etiqueta do orçamento, "preço de dd/mm" (dia em que o preço foi tirado, no fuso do tenant). */
export function etiquetaPrecoDe(momentoDoPreco: string, fuso: string): string {
  return `preço de ${dataDaValidade(localIsoDate(momentoDoPreco, fuso))}`;
}

/** Dia civil do preço de um orçamento que guardou só o último dia do preço (D+dias): D = validade − dias. */
export function dataDoPrecoDoOrcamento(validadeData: string, dias: number): string {
  return somarDias(validadeData, -dias);
}

/** Ex.: "Preço de 09/11" (primeira letra maiúscula), para botões e folhas. */
export function textoPrecoDe(aaaaMmDd: string): string {
  return `Preço de ${dataDaValidade(aaaaMmDd)}`;
}

/**
 * T-0135 (RN-VEN-18): a ÚNICA forma de escrever uma data civil na tela, no histórico, no PDF e no BKO. Recebe a data civil
 * (`validadeDoOrcamento(...).data`, AAAA-MM-DD) e devolve "dd/mm" ou "dd/mm/aaaa". Nunca derive a data do instante `ate`
 * (início do dia seguinte), que mostra um dia a mais.
 */
export function dataDaValidade(data: string, comAno = false): string {
  const [a, m, d] = data.split('-');
  return comAno ? `${d}/${m}/${a}` : `${d}/${m}`;
}

export const SITUACOES_ORCAMENTO = ['aberto', 'convertido', 'cancelado'] as const;
export type SituacaoOrcamento = (typeof SITUACOES_ORCAMENTO)[number];

export const SITUACAO_ORCAMENTO_LABEL: Record<SituacaoOrcamento, string> = {
  aberto: 'Orçamento',
  convertido: 'Virou pedido',
  cancelado: 'Cancelado',
};

export interface OrcamentoEstado {
  status: OrderStatus | string;
  validade_ate: string | null;
  convertido_pedido_id: string | null;
}

/** RN-VEN-18 (09/11): cancelado e convertido prevalecem; o resto é aberto, a qualquer tempo (o orçamento não vence). */
export function situacaoDoOrcamento(o: OrcamentoEstado, _agora?: Date): SituacaoOrcamento {
  if (o.status === 'cancelled') return 'cancelado';
  if (o.convertido_pedido_id) return 'convertido';
  return 'aberto';
}

export interface AcoesOrcamento {
  pode_converter: boolean;
  /** T-0071: editar só o aberto (dono) */
  pode_editar: boolean;
  pode_cancelar: boolean;
  pode_duplicar: boolean;
  pode_pdf: boolean;
  /** texto para a tela (vazio quando pode converter) */
  texto: string;
}

/** RN-VEN-18 / desenho §1.2: o que o vendedor pode fazer com o orçamento em cada situação. */
export function acoesDoOrcamento(s: SituacaoOrcamento): AcoesOrcamento {
  switch (s) {
    case 'aberto':
      return { pode_converter: true, pode_editar: true, pode_cancelar: true, pode_duplicar: true, pode_pdf: true, texto: '' };
    case 'convertido':
      return { pode_converter: false, pode_editar: false, pode_cancelar: false, pode_duplicar: true, pode_pdf: true, texto: '' };
    case 'cancelado':
      return { pode_converter: false, pode_editar: false, pode_cancelar: false, pode_duplicar: true, pode_pdf: false, texto: 'Orçamento cancelado.' };
  }
}

/** RN-VEN-13 / RN-CORE-17: situação do cliente que decide se faz pedido ou só orçamento. */
export interface SituacaoCliente {
  ativo: boolean;
  bloqueado: boolean;
  cadastro_incompleto: boolean;
  campos_faltantes: readonly string[];
}

/** Por que o cliente só faz orçamento (texto curto da folha do Salvar); `null` = faz pedido. */
export function motivoSoOrcamento(c: SituacaoCliente): string | null {
  if (c.bloqueado) return 'Cliente bloqueado.';
  if (!c.ativo) return 'Cliente inativo.';
  if (c.cadastro_incompleto) return c.campos_faltantes.length > 0 ? `Cadastro incompleto: falta ${c.campos_faltantes.join(', ')}.` : 'Cadastro incompleto.';
  return null;
}

/** RN-VEN-38 / RN-VEN-13: a linha que explica a falta do "Salvar pedido" (texto do designer, §2.3 da spec). */
export function avisoSoOrcamento(c: SituacaoCliente): string | null {
  if (motivoSoOrcamento(c) === null) return null;
  if (c.bloqueado) return 'Cliente bloqueado: só dá para salvar como orçamento';
  if (!c.ativo) return 'Cliente inativo: só dá para salvar como orçamento';
  return 'Cadastro do cliente incompleto: só dá para salvar como orçamento';
}

/**
 * RN-VEN-13: cliente bloqueado, inativo ou com cadastro incompleto → só orçamento. `null` = pode. Aceita só o `ativo`
 * (forma antiga) ou a situação completa (T-0071).
 */
export function verificarTipoParaCliente(tipo: TipoDocumento, cliente: boolean | SituacaoCliente): Recusa | null {
  if (tipo !== 'pedido') return null;
  const motivo = typeof cliente === 'boolean' ? (cliente ? null : 'Cliente bloqueado ou inativo.') : motivoSoOrcamento(cliente);
  if (!motivo) return null;
  return { codigo: 'RN-VEN-13', http: 422, mensagem: `${motivo.replace(/\.$/, '')}: não é possível fazer pedido. Salve como orçamento (RN-VEN-13).` };
}

export interface OrcamentoParaConversao extends OrcamentoEstado {
  id: string;
  tipo: TipoDocumento;
  vendedor_id: string;
  cliente_id: string;
}

/**
 * Momento da conversão para conferir a validade: o do aparelho (converteu offline antes de expirar e sincronizou
 * depois), nunca no futuro e no máximo 7 dias antes da chegada — a mesma janela do preço (P-4).
 */
export function momentoDaConversao(criadoNoAparelhoEm: string | null | undefined, chegada: Date): Date {
  return new Date(dataDoPreco(criadoNoAparelhoEm, chegada));
}

/** RF-VEN-03 / RN-VEN-32: o pedido `pedido_id` pode nascer deste orçamento? `null` = pode. */
export function verificarConversao(e: { orcamento: OrcamentoParaConversao | null; vendedor_id: string; cliente_id: string; pedido_id: string; momento: Date }): Recusa | null {
  const o = e.orcamento;
  if (!o || o.tipo !== 'orcamento' || o.vendedor_id !== e.vendedor_id) {
    return { codigo: 'ORCAMENTO_NAO_ENCONTRADO', http: 404, mensagem: 'Orçamento não encontrado. Atualize os dados e tente de novo.' };
  }
  if (o.cliente_id !== e.cliente_id) return { codigo: 'PAYLOAD_INVALIDO', http: 422, mensagem: 'O pedido precisa ser do mesmo cliente do orçamento.' };
  if (o.convertido_pedido_id) {
    if (o.convertido_pedido_id === e.pedido_id) return null; // RN-VEN-33: reenvio do mesmo pedido
    return { codigo: 'ORCAMENTO_JA_CONVERTIDO', http: 409, mensagem: 'Este orçamento já virou outro pedido. Abra o pedido ou duplique o orçamento.' };
  }
  // RN-VEN-18 (09/11): sem expiração; passados os 7 dias do preço, o pedido nasce pela tabela do dia (preço não congelado)
  if (situacaoDoOrcamento(o, e.momento) === 'cancelado') return { codigo: 'RN-VEN-18', http: 422, mensagem: 'Orçamento cancelado: não pode virar pedido. Duplique para fazer um novo.' };
  return null;
}

/** RN-VEN-32: histórico do orçamento recebido (não passa pela alçada: quem passa é o pedido convertido). */
export function historicoDoOrcamento(validadeData: string, dias = VALIDADE_ORCAMENTO_DIAS_PADRAO): EventoHistorico[] {
  return [{ de: null, para: 'received', motivo: `Orçamento salvo, preço de ${dataDaValidade(somarDias(validadeData, -dias), true)}; não reserva estoque nem consome crédito` }];
}

// ---------- preço congelado (T-0134; RN-VEN-18) ----------
/** Item salvo do orçamento: o que o aparelho e o servidor guardaram (preço de tabela da MEDIDA vendida e o fator). */
export interface ItemSalvoParaCongelar {
  product_id: string;
  preco_tabela_cents: number;
  fator: number;
}

/**
 * RN-VEN-18 (preço congelado): produto → preço de tabela por UNIDADE como o orçamento gravou. Reeditar ou transformar usa
 * este preço, nunca a tabela de hoje. Produto repetido em medidas diferentes vale o da 1ª linha salva.
 */
export function precosCongelados(itens: ReadonlyArray<ItemSalvoParaCongelar>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of itens) {
    if (i.product_id in out || !(i.preco_tabela_cents > 0)) continue;
    out[i.product_id] = i.preco_tabela_cents / (i.fator > 0 ? i.fator : 1);
  }
  return out;
}

/**
 * RN-VEN-18: o preço de UM item ao editar ou transformar. Item já salvo no orçamento (`congelado_cents` presente) mantém o
 * preço salvo e ignora a tabela de hoje e as faixas de hoje; só o item NOVO entra pelo preço de hoje. `null` = sem preço.
 */
export function precoDoItemNaEdicao<F>(i: { congelado_cents?: number | null; hoje_cents: number | null; faixas_hoje?: F }): { preco_unidade_cents: number | null; faixas: F | undefined; congelado: boolean } {
  if (i.congelado_cents != null) return { preco_unidade_cents: i.congelado_cents, faixas: undefined, congelado: true };
  return { preco_unidade_cents: i.hoje_cents, faixas: i.faixas_hoje, congelado: false };
}

// ---------- cópia completa: transformar e duplicar (T-0071; desenho §1.4 c) ----------
export interface ItemParaCopia {
  product_id: string;
  quantity: number;
  unidade?: string;
  desconto_pct?: number;
  acrescimo_pct?: number;
  desconto_unitario_cents?: number;
  acrescimo_unitario_cents?: number;
  ajuste_em?: 'pct' | 'valor';
  /** T-0084 (RN-VEN-19): retrato da aplicação do item; vai junto na conversão do orçamento (o cliente viu esse texto) */
  aplicacao?: string | null;
}
export interface FreteParaCopia {
  modalidade: 'CIF' | 'FOB';
  transportadora_id?: string | null;
  transportadora_digitada?: { nome: string; cnpj: string; telefone?: string | null } | null;
}
export interface OrcamentoParaPedido {
  id: string;
  cliente_id: string;
  desconto_pct: number;
  acrescimo_pct?: number;
  desconto_valor_cents?: number;
  acrescimo_valor_cents?: number;
  ajuste_em?: 'pct' | 'valor';
  condicao_pagamento_id: string | null;
  /** T-0089 (RN-VEN-24): forma e prazo do documento de origem; os dois juntos ou nenhum */
  forma_pagamento_id?: string | null;
  prazo_pagamento_id?: string | null;
  observacao: string | null;
  visita_id: string | null;
  frete?: FreteParaCopia | null;
  endereco_entrega_id?: string | null;
  itens: ReadonlyArray<ItemParaCopia>;
}

/** Só o modo gravado (ajuste_em) segue: o servidor grava os dois (R$ e % equivalente) e receber os dois dá 422 ajuste_invalido (RN-VEN-02). Ausente = legado em %. */
function copiarItens(itens: ReadonlyArray<ItemParaCopia>): ItemParaCopia[] {
  return itens.map((i) => {
    const out: Record<string, unknown> = { product_id: i.product_id, quantity: i.quantity };
    if (i.unidade !== undefined) out.unidade = i.unidade;
    if (i.ajuste_em === 'valor') {
      out.ajuste_em = 'valor';
      if ((i.desconto_unitario_cents ?? 0) > 0) out.desconto_unitario_cents = i.desconto_unitario_cents;
      else if ((i.acrescimo_unitario_cents ?? 0) > 0) out.acrescimo_unitario_cents = i.acrescimo_unitario_cents;
    } else {
      if (i.ajuste_em === 'pct') out.ajuste_em = 'pct';
      if ((i.desconto_pct ?? 0) > 0) out.desconto_pct = i.desconto_pct;
      else if ((i.acrescimo_pct ?? 0) > 0) out.acrescimo_pct = i.acrescimo_pct;
    }
    if (i.aplicacao) out.aplicacao = i.aplicacao;
    return out as unknown as ItemParaCopia;
  });
}

/** Cabeçalho: frete e endereço sempre; o ajuste do pedido só no modo gravado (RN-VEN-02). */
function copiarCabecalho(o: OrcamentoParaPedido): { discount_pct: number } & Record<string, unknown> {
  const out: { discount_pct: number } & Record<string, unknown> = { discount_pct: 0 };
  if (o.ajuste_em === 'valor') {
    out.ajuste_em = 'valor';
    if ((o.desconto_valor_cents ?? 0) > 0) out.desconto_valor_cents = o.desconto_valor_cents;
    else if ((o.acrescimo_valor_cents ?? 0) > 0) out.acrescimo_valor_cents = o.acrescimo_valor_cents;
  } else {
    if (o.ajuste_em === 'pct') out.ajuste_em = 'pct';
    if ((o.desconto_pct ?? 0) > 0) out.discount_pct = o.desconto_pct;
    else if ((o.acrescimo_pct ?? 0) > 0) out.acrescimo_pct = o.acrescimo_pct;
  }
  if (o.frete !== undefined) out.frete = o.frete;
  if (o.endereco_entrega_id !== undefined) out.endereco_entrega_id = o.endereco_entrega_id;
  return out;
}

/**
 * RF-VEN-03 / RN-VEN-18: o pedido que nasce do orçamento (vai para a fila do aparelho como um pedido novo). Copia medida,
 * ajustes do item e do pedido, frete, endereço, condição, observação e visita. O preço não vai no payload: o servidor
 * reaplica o preço salvo no orçamento (preço congelado, RN-VEN-18) e revalida estoque, mínimo e alçada (RN-VEN-10/11).
 */
export function pedidoDoOrcamento(o: OrcamentoParaPedido, novoId: string, criadoEm: string) {
  return {
    id: novoId,
    tipo: 'pedido' as const,
    orcamento_origem_id: o.id,
    customer_id: o.cliente_id,
    ...copiarCabecalho(o),
    condicao_pagamento_id: o.condicao_pagamento_id,
    ...(o.forma_pagamento_id && o.prazo_pagamento_id ? { forma_pagamento_id: o.forma_pagamento_id, prazo_pagamento_id: o.prazo_pagamento_id } : {}),
    observacao: o.observacao,
    visita_id: o.visita_id,
    created_offline_at: criadoEm,
    items: copiarItens(o.itens),
  };
}

/** RN-VEN-18: duplicar (vencido ou qualquer outro) = rascunho novo com o mesmo conteúdo, sem origem; os preços são os de hoje. */
export function duplicarDocumento(o: OrcamentoParaPedido, novoId: string, criadoEm: string) {
  const { orcamento_origem_id: _origem, ...rascunho } = pedidoDoOrcamento(o, novoId, criadoEm);
  void _origem;
  return rascunho;
}

// ---------- reconferir ao transformar (desenho §1.5) ----------
export interface ItemOrcado {
  product_id: string;
  unidade: string;
  quantity: number;
  ajuste: AjusteItem;
  /** preço de tabela da MEDIDA no orçamento */
  tabela_cents: number;
}
export interface OrcamentoParaReconferir {
  itens: ReadonlyArray<ItemOrcado>;
  ajuste_pedido: AjustePedido;
  /** nível que o orçamento tinha na alçada quando foi feito */
  alcada_nivel: NivelDePreco | null;
}
export interface DadosAtuais {
  cliente: SituacaoCliente;
  itens: Record<
    string,
    {
      /** tabela de hoje da medida vendida; null = sem preço (RN-CAT-06) */
      tabela_cents: number | null;
      medida_ativa: boolean;
      /** saldo em unidade base; null = sem controle */
      estoque_base: number | null;
      fator: number;
      minimo_base_cents: number | null;
    }
  >;
  policy: DiscountPolicy;
  /** RN-VEN-20: parâmetro que bloqueia (em vez de só avisar) quando falta estoque */
  estoque_bloqueia: boolean;
}
export type MudancaNaConversao =
  | { tipo: 'preco'; produto_id: string; de_cents: number; para_cents: number }
  | { tipo: 'sem_preco'; produto_id: string }
  | { tipo: 'estoque'; produto_id: string; pedido_base: number; disponivel_base: number }
  | { tipo: 'ajuste_travado'; produto_id: string; de: AjusteItem; para: AjusteItem }
  /** T-0134 (RN-VEN-11): com o preço congelado, o desconto do item passa do mínimo de hoje; avisa o item, não troca o preço */
  | { tipo: 'abaixo_minimo'; produto_id: string; unidade: string }
  | { tipo: 'medida_inativa'; produto_id: string; unidade: string }
  | { tipo: 'alcada'; de: NivelDePreco | null; para: NivelDePreco | null }
  | { tipo: 'cliente'; motivo: 'bloqueado' | 'inativo' | 'cadastro_incompleto'; campos: string[] };
export interface RascunhoReconferido {
  itens: ItemOrcado[];
  ajuste_pedido: AjustePedido;
}
export interface CalculoReconferido {
  totais: TotaisDoPedido;
  nivel: NivelDePreco | null;
}

/** Ajuste do item reduzido ao teto do mínimo (RN-VEN-11), no mesmo modo (% ou R$) em que foi digitado. */
function limitarAjuste(a: AjusteItem, tabela: number, minimo: number): AjusteItem {
  if (a === null || a.sentido !== 'desconto') return a;
  if (a.em === 'valor') {
    const teto = limiteDoAjusteDoItem(tabela, minimo).cents ?? 0;
    return a.cents > teto ? { ...a, cents: teto } : a;
  }
  const maxPct = descontoMaximoDoItemPct(tabela, minimo) ?? 0;
  return a.pct > maxPct ? { ...a, pct: maxPct } : a;
}

/**
 * RN-VEN-18 (preço congelado, T-0134): o que muda ao transformar o orçamento em pedido (puro, offline). O PREÇO é o do
 * orçamento; só se reconfere estoque e preço mínimo (RN-VEN-11): item abaixo do mínimo é avisado (mudança `abaixo_minimo` e
 * bloqueio), sem trocar preço nem desconto. Item de produto que saiu do catálogo ou com medida inativa sai; a alçada é
 * recalculada (RN-VEN-10). Cliente bloqueado, inativo ou incompleto não transforma (RN-VEN-13).
 */
export function reconferirOrcamento(
  o: OrcamentoParaReconferir,
  hoje: DadosAtuais,
  /** T-0141 (RN-VEN-18): `preco_vale` = o preço congelado ainda está nos 7 dias (padrão: vale). Vencido = tabela do dia. */
  opcoes: { preco_vale?: boolean } = {},
): {
  rascunho: RascunhoReconferido;
  calculo: CalculoReconferido;
  mudancas: MudancaNaConversao[];
  pode_enviar: boolean;
  bloqueio: string | null;
  /** total do orçamento como foi salvo (sem frete) e quanto o total muda hoje (0 com o preço vigente) */
  total_orcado_cents: number;
  diferenca_total_cents: number;
} {
  const precoVale = opcoes.preco_vale ?? true;
  const mudancas: MudancaNaConversao[] = [];
  const itens: ItemOrcado[] = [];
  let bloqueio: string | null = null;

  const motivo = motivoSoOrcamento(hoje.cliente);
  if (motivo) {
    const m = hoje.cliente.bloqueado ? 'bloqueado' : !hoje.cliente.ativo ? 'inativo' : 'cadastro_incompleto';
    mudancas.push({ tipo: 'cliente', motivo: m, campos: [...hoje.cliente.campos_faltantes] });
    bloqueio = motivo;
  }

  for (const it of o.itens) {
    const d = hoje.itens[it.product_id];
    // T-0134: o preço é o do orçamento; sem preço na tabela de hoje não impede (só produto fora do catálogo do aparelho)
    // T-0141: com o preço vencido (depois de D+7), a tabela do dia manda; sem preço hoje o item sai
    if (!d || (!precoVale && d.tabela_cents == null)) {
      mudancas.push({ tipo: 'sem_preco', produto_id: it.product_id });
      continue;
    }
    if (!d.medida_ativa) {
      mudancas.push({ tipo: 'medida_inativa', produto_id: it.product_id, unidade: it.unidade });
      continue;
    }
    const ajuste = it.ajuste;
    if (d.minimo_base_cents != null) {
      const limitado = limitarAjuste(ajuste, it.tabela_cents, d.minimo_base_cents * d.fator);
      if (JSON.stringify(limitado) !== JSON.stringify(ajuste)) {
        mudancas.push({ tipo: 'abaixo_minimo', produto_id: it.product_id, unidade: it.unidade });
        if (!bloqueio) bloqueio = 'Um item ficou abaixo do preço mínimo de hoje. Ajuste o desconto do item e envie de novo.';
      }
    }
    if (d.estoque_base != null && it.quantity * d.fator > d.estoque_base) {
      mudancas.push({ tipo: 'estoque', produto_id: it.product_id, pedido_base: it.quantity * d.fator, disponivel_base: d.estoque_base });
      if (hoje.estoque_bloqueia && !bloqueio) bloqueio = 'Sem estoque suficiente para um dos itens.';
    }
    const tabela = !precoVale && d.tabela_cents != null ? d.tabela_cents : it.tabela_cents;
    if (tabela !== it.tabela_cents) mudancas.push({ tipo: 'preco', produto_id: it.product_id, de_cents: it.tabela_cents, para_cents: tabela });
    itens.push({ product_id: it.product_id, unidade: it.unidade, quantity: it.quantity, ajuste, tabela_cents: tabela });
  }

  const precos = itens.map((i) => precoDoItem({ preco_tabela_unidade_cents: i.tabela_cents, fator: 1, quantidade: i.quantity, desconto_pct: 0, acrescimo_pct: 0, ajuste: i.ajuste }));
  const totais = totaisDoPedido(
    precos.map((p, k) => ({ preco_tabela_cents: p.preco_tabela_cents, quantidade: itens[k]!.quantity, total_cents: p.total_cents, desconto_pct: 0, acrescimo_pct: 0, ajuste: itens[k]!.ajuste })),
    o.ajuste_pedido,
  );
  const totalOrcado = totalDosItens(o.itens, o.ajuste_pedido);
  const nivel = nivelDeAprovacao(totais.desconto_efetivo_alcada_pct, hoje.policy);
  if (nivel !== o.alcada_nivel) mudancas.push({ tipo: 'alcada', de: o.alcada_nivel, para: nivel });
  if (itens.length === 0 && !bloqueio) bloqueio = 'Nenhum item do orçamento pode ser enviado hoje.';
  // item que saiu do pedido muda o total por outro motivo (já avisado): a diferença compara só os que ficaram
  const ficaram = o.itens.filter((i) => itens.some((x) => x.product_id === i.product_id && x.unidade === i.unidade));
  return {
    rascunho: { itens, ajuste_pedido: o.ajuste_pedido },
    calculo: { totais, nivel },
    mudancas,
    pode_enviar: bloqueio === null,
    bloqueio,
    total_orcado_cents: totalOrcado,
    diferenca_total_cents: precoVale ? 0 : totais.total_cents - totalDosItens(ficaram, o.ajuste_pedido),
  };
}

/** Total (centavos) de uma lista de itens do orçamento com o ajuste do pedido, pelo mesmo cálculo do preço. */
function totalDosItens(lista: ReadonlyArray<ItemOrcado>, ajustePedido: AjustePedido): number {
  const precos = lista.map((i) => precoDoItem({ preco_tabela_unidade_cents: i.tabela_cents, fator: 1, quantidade: i.quantity, desconto_pct: 0, acrescimo_pct: 0, ajuste: i.ajuste }));
  return totaisDoPedido(
    precos.map((p, k) => ({ preco_tabela_cents: p.preco_tabela_cents, quantidade: lista[k]!.quantity, total_cents: p.total_cents, desconto_pct: 0, acrescimo_pct: 0, ajuste: lista[k]!.ajuste })),
    ajustePedido,
  ).total_cents;
}
