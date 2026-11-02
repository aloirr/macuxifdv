/**
 * Orçamento (pré-venda) × pedido (T-0053; RF-VEN-03, RN-VEN-32, RN-VEN-13). Funções puras: o app (offline) e a API usam a
 * mesma regra; a API sempre revalida.
 *
 * - Orçamento é um documento do vendedor, gravado como o pedido (mesma linha, `tipo = 'orcamento'`), que NÃO vai para
 *   aprovação nem para o ERP, não reserva estoque, não consome crédito e expira em [7] dias (RN-VEN-32).
 * - Cliente bloqueado/inativo: só orçamento (RN-VEN-13).
 * - Converter = criar um pedido NOVO (UUID do aparelho, RN-VEN-33) com `orcamento_origem_id`; o pedido passa por toda a
 *   validação do dia (preço vigente, alçada, condição). Um orçamento converte uma vez.
 */
import { localIsoDate } from '@macuxi/comum/fuso';
import { dataDoPreco, type EventoHistorico, type Recusa } from './aprovacao';
import type { OrderStatus } from './order';

export const TIPOS_DOCUMENTO = ['pedido', 'orcamento'] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

/** RN-VEN-32: validade padrão; parâmetro do tenant `orcamento.validade_dias` (1 a 90). */
export const VALIDADE_ORCAMENTO_DIAS_PADRAO = 7;
export const PARAMETRO_VALIDADE_ORCAMENTO = 'orcamento.validade_dias';
const VALIDADE_MAX_DIAS = 90;

export function validadeOrcamentoDias(parametros: Record<string, unknown>): number {
  const bruto = parametros[PARAMETRO_VALIDADE_ORCAMENTO];
  const n = typeof bruto === 'number' ? bruto : typeof bruto === 'string' && bruto.trim() !== '' ? Number(bruto) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= VALIDADE_MAX_DIAS ? n : VALIDADE_ORCAMENTO_DIAS_PADRAO;
}

/** RN-VEN-32: instante UTC em que o orçamento expira (criação + N × 24 h). */
export function validadeDoOrcamento(criadoEm: string, dias: number): string {
  return new Date(Date.parse(criadoEm) + dias * 86_400_000).toISOString();
}

export const SITUACOES_ORCAMENTO = ['aberto', 'expirado', 'convertido', 'cancelado'] as const;
export type SituacaoOrcamento = (typeof SITUACOES_ORCAMENTO)[number];

export const SITUACAO_ORCAMENTO_LABEL: Record<SituacaoOrcamento, string> = {
  aberto: 'Orçamento aberto',
  expirado: 'Orçamento expirado',
  convertido: 'Convertido em pedido',
  cancelado: 'Orçamento cancelado',
};

export interface OrcamentoEstado {
  status: OrderStatus | string;
  validade_ate: string | null;
  convertido_pedido_id: string | null;
}

/** RN-VEN-32: cancelado e convertido prevalecem; depois da validade = expirado. */
export function situacaoDoOrcamento(o: OrcamentoEstado, agora: Date): SituacaoOrcamento {
  if (o.status === 'cancelled') return 'cancelado';
  if (o.convertido_pedido_id) return 'convertido';
  if (o.validade_ate && agora.getTime() > Date.parse(o.validade_ate)) return 'expirado';
  return 'aberto';
}

export interface AcoesOrcamento {
  pode_converter: boolean;
  pode_cancelar: boolean;
  pode_duplicar: boolean;
  /** texto para a tela (vazio quando pode converter) */
  texto: string;
}

/** RF-VEN-03: o que o vendedor pode fazer com o orçamento em cada situação. */
export function acoesDoOrcamento(s: SituacaoOrcamento): AcoesOrcamento {
  switch (s) {
    case 'aberto':
      return { pode_converter: true, pode_cancelar: true, pode_duplicar: true, texto: '' };
    case 'expirado':
      return { pode_converter: false, pode_cancelar: true, pode_duplicar: true, texto: 'Este orçamento expirou. Duplique para fazer um novo com o preço de hoje.' };
    case 'convertido':
      return { pode_converter: false, pode_cancelar: false, pode_duplicar: true, texto: 'Este orçamento já virou pedido.' };
    case 'cancelado':
      return { pode_converter: false, pode_cancelar: false, pode_duplicar: true, texto: 'Orçamento cancelado.' };
  }
}

/** RN-VEN-13: cliente bloqueado ou inativo → só orçamento. `null` = pode. */
export function verificarTipoParaCliente(tipo: TipoDocumento, clienteAtivo: boolean): Recusa | null {
  if (tipo === 'pedido' && !clienteAtivo) {
    return { codigo: 'RN-VEN-13', http: 422, mensagem: 'Cliente bloqueado ou inativo: não é possível fazer pedido. Salve como orçamento (RN-VEN-13).' };
  }
  return null;
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
  const s = situacaoDoOrcamento(o, e.momento);
  if (s === 'cancelado') return { codigo: 'RN-VEN-32', http: 422, mensagem: 'Orçamento cancelado: não pode virar pedido. Duplique para fazer um novo.' };
  if (s === 'expirado') return { codigo: 'RN-VEN-32', http: 422, mensagem: 'Orçamento expirado (RN-VEN-32). Duplique para fazer um novo com o preço de hoje.' };
  return null;
}

/** RN-VEN-32: histórico do orçamento recebido (não passa pela alçada: quem passa é o pedido convertido). */
export function historicoDoOrcamento(validadeAte: string, fuso: string): EventoHistorico[] {
  const [a, m, d] = localIsoDate(validadeAte, fuso).split('-');
  return [{ de: null, para: 'received', motivo: `Orçamento salvo, válido até ${d}/${m}/${a}; não reserva estoque nem consome crédito` }];
}

export interface OrcamentoParaPedido {
  id: string;
  cliente_id: string;
  desconto_pct: number;
  condicao_pagamento_id: string | null;
  observacao: string | null;
  visita_id: string | null;
  itens: ReadonlyArray<{ product_id: string; quantity: number }>;
}

/**
 * RF-VEN-03: o pedido que nasce do orçamento (vai para a fila do aparelho como um pedido novo). O preço NÃO é copiado: o
 * servidor usa a tabela vigente na data do pedido (RN-VEN-01) e revalida a alçada (RN-VEN-10).
 */
export function pedidoDoOrcamento(o: OrcamentoParaPedido, novoId: string, criadoEm: string) {
  return {
    id: novoId,
    tipo: 'pedido' as const,
    orcamento_origem_id: o.id,
    customer_id: o.cliente_id,
    discount_pct: o.desconto_pct,
    condicao_pagamento_id: o.condicao_pagamento_id,
    observacao: o.observacao,
    visita_id: o.visita_id,
    created_offline_at: criadoEm,
    items: o.itens.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
  };
}
