/**
 * Pré-venda no aparelho (T-0053; RF-VEN-03, RN-VEN-32). Puro, sem React: as regras vêm do domain (as mesmas do servidor).
 * - Orçamento aparece com o parâmetro do tenant `orcamento.ativo`, LIGADO por padrão desde a T-0071 (a migração 0013 está no
 *   banco e a API usa o repositório SQL); o tenant desliga com `false`.
 * - Converter é offline: o pedido novo entra na fila do aparelho com `orcamento_origem_id`; o servidor revalida tudo.
 */
import type { Order, OrderDetail, PedidoPush } from '../../contracts';
import { copiaDoDetalhe, type DetalheParaCopia } from './documento';
import type { TransportadoraDaTela } from './novo-pedido';
import { localIsoDate } from '@macuxi/comum/fuso';
import { acoesDoOrcamento, pedidoDoOrcamento, situacaoDoOrcamento, SITUACAO_ORCAMENTO_LABEL, validadeDoOrcamento, type AcoesOrcamento, type SituacaoOrcamento } from '../../domain/orcamento';
import { ORDER_STATUS_LABEL, type OrderStatus } from '../../domain/order';

export const PARAMETRO_PRE_VENDA_ATIVA = 'orcamento.ativo';

/** O tenant liberou o orçamento no app? Padrão: sim (ausente = ligado). */
export function preVendaAtiva(parametros: Readonly<Record<string, unknown>>): boolean {
  const v = parametros[PARAMETRO_PRE_VENDA_ATIVA];
  if (v === undefined || v === null) return true;
  return !(v === false || v === 'false' || v === 0 || v === '0');
}

type DocumentoNaTela = Pick<Order, 'status'> & Partial<Pick<Order, 'tipo' | 'validade_ate' | 'convertido_pedido_id' | 'situacao_orcamento'>>;

export function ehOrcamento(o: DocumentoNaTela): boolean {
  return o.tipo === 'orcamento';
}

/** Situação do orçamento no aparelho (offline: calcula pela validade); `null` = pedido. */
export function situacaoNaTela(o: DocumentoNaTela, agora: Date): SituacaoOrcamento | null {
  if (!ehOrcamento(o)) return null;
  return situacaoDoOrcamento({ status: o.status, validade_ate: o.validade_ate ?? null, convertido_pedido_id: o.convertido_pedido_id ?? null }, agora);
}

/** Rótulo do status na lista/detalhe: orçamento mostra a situação; pedido, o status (RN-VEN-30). */
export function rotuloDoDocumento(o: DocumentoNaTela, agora: Date): string {
  const s = situacaoNaTela(o, agora);
  if (s) return SITUACAO_ORCAMENTO_LABEL[s];
  return ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status;
}

/** Ações do orçamento na tela (converter exige ser o vendedor dono; tudo funciona offline). `null` = pedido. */
export function acoesNaTela(o: DocumentoNaTela, agora: Date, ehVendedor: boolean): AcoesOrcamento | null {
  const s = situacaoNaTela(o, agora);
  if (!s) return null;
  const a = acoesDoOrcamento(s);
  return ehVendedor ? a : { ...a, pode_converter: false, pode_cancelar: false };
}

/**
 * RF-VEN-03: pedido novo a partir do orçamento (vai para a fila). Os preços NÃO são copiados: o servidor usa a tabela do dia.
 * `condicaoId` vem da linha do pull (`condicao_pagamento_id`); ausente = padrão do tenant.
 */
export function pedidoDaConversao(
  d: DetalheParaCopia & Pick<OrderDetail, 'payment_terms'>,
  extra: { condicaoId: string | null; observacao: string | null; novoId: string; agora: string; transportadoras?: readonly TransportadoraDaTela[] },
): PedidoPush {
  const base = pedidoDoOrcamento(copiaDoDetalhe(d, { condicaoId: extra.condicaoId, observacao: extra.observacao, transportadoras: extra.transportadoras }), extra.novoId, extra.agora);
  return { ...base, payment_terms: d.payment_terms || '28/56 dias' } as PedidoPush;
}

/**
 * RN-VEN-18: a validade por DATA CIVIL (AAAA-MM-DD) no fuso do tenant, sem conta de relógio na tela. Vale a que veio do
 * servidor (`validade_data`); linha antiga só com `validade_ate` (= início do dia seguinte) usa o dia anterior a esse instante;
 * orçamento ainda na fila usa o momento da criação + dias do parâmetro.
 */
export function validadeCivilDoDocumento(o: { validade_data: string | null; validade_ate: string | null; criado_em: string | null }, p: { fuso: string; dias: number }): string | null {
  if (o.validade_data) return o.validade_data;
  if (o.validade_ate) return localIsoDate(new Date(Date.parse(o.validade_ate) - 1), p.fuso);
  if (o.criado_em) return validadeDoOrcamento(o.criado_em, p.dias, p.fuso).data;
  return null;
}
