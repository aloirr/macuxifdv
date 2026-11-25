/**
 * RN-VEN-48 (R-20261124-114951): as ações do botão "Ações" de cada item da aba Pedidos. Função pura; a tela só desenha e a API
 * revalida com a mesma `verificarAcaoDaLista`.
 *   Enviar pedido       só o pedido salvo e ainda não enviado; nunca o orçamento
 *   Converter em pedido só o orçamento em aberto
 *   Editar              a RN-VEN-31 (o detalhe usa esta mesma função): pedido no aparelho (salvo ou recusado pela API) e orçamento aberto
 *   Duplicar            documento com itens que já existe como registro, e também o pedido salvo (draft): a cópia é outro rascunho, e o cliente pode ter vários salvos
 *   Excluir             só enquanto não foi enviado ao ERP
 * Pedido já enviado ao ERP mostra só Duplicar. Sem permissão de escrita (promotor, regra 7), nenhuma ação.
 */
import { editavelNaFatia, enviadoAoErp, orderActions, type OrderStatus } from './order';
import type { Recusa } from './aprovacao';

/** RN-PRO-01 / O-3: sem nenhuma permissão de escrita de pedido (caso do promotor, regra 7), a lista e o detalhe do pedido são só de leitura. */
export function pedidoSomenteLeitura(pode: { criar: boolean; editar: boolean; cancelar: boolean }): boolean {
  return !pode.criar && !pode.editar && !pode.cancelar;
}

export type AcaoDaLista = 'enviar' | 'converter' | 'editar' | 'duplicar' | 'excluir';

/** A ordem em que aparecem na folha. */
export const ORDEM_DAS_ACOES_DA_LISTA: readonly AcaoDaLista[] = ['enviar', 'converter', 'editar', 'duplicar', 'excluir'];

export const ROTULOS_DAS_ACOES_DA_LISTA: Record<AcaoDaLista, string> = {
  enviar: 'Enviar pedido',
  converter: 'Converter em pedido',
  editar: 'Editar',
  duplicar: 'Duplicar',
  excluir: 'Excluir',
};

export const CODIGO_ACAO_DA_LISTA = 'RN-VEN-48';

export interface EntradaAcoesDaLista {
  tipo: 'pedido' | 'orcamento';
  status: string;
  /** padrão: derivado do status (`enviadoAoErp`) */
  enviado_ao_erp?: boolean;
  /** orçamento ainda em aberto (nem convertido, nem cancelado) */
  orcamento_aberto?: boolean;
  /** pedido na fila do aparelho: a fila envia sozinha (RN-CORE-23) */
  na_fila?: boolean;
  /** pedido da fila que a API recusou: pode corrigir e descartar */
  recusado?: boolean;
  /** o documento tem itens no aparelho */
  tem_itens?: boolean;
  /** permissões do perfil: pedido.criar, pedido.editar, pedido.cancelar; `false` em tudo = só leitura (promotor) */
  pode: { criar: boolean; editar: boolean; cancelar: boolean };
}

export type AcoesDaLista = Record<AcaoDaLista, boolean> & { lista: AcaoDaLista[] };

export function acoesDoPedidoNaLista(e: EntradaAcoesDaLista): AcoesDaLista {
  const nenhuma = { enviar: false, converter: false, editar: false, duplicar: false, excluir: false };
  const enviado = e.enviado_ao_erp ?? enviadoAoErp(e.status);
  const temItens = e.tem_itens ?? true;
  const r = { ...nenhuma };
  if (pedidoSomenteLeitura(e.pode)) return { ...r, lista: [] };

  if (e.tipo === 'orcamento') {
    const aberto = e.orcamento_aberto === true && !enviado && !e.na_fila;
    r.converter = aberto && e.pode.criar && temItens;
    r.editar = aberto && e.pode.editar && temItens;
    r.excluir = aberto && e.pode.cancelar;
  } else if (!enviado) {
    const acoes = orderActions(e.status as OrderStatus);
    const naFilaSemRecusa = e.na_fila === true && e.recusado !== true;
    r.enviar = e.status === 'draft' && !e.na_fila && e.pode.criar && temItens;
    r.editar = editavelNaFatia(e.status as OrderStatus) && !naFilaSemRecusa && e.pode.editar && temItens;
    r.excluir = acoes.can_cancel && !naFilaSemRecusa && e.pode.cancelar;
  }
  // todo documento duplica, inclusive o salvo (draft): a cópia é outro rascunho e o cliente pode ter vários salvos (RN-VEN-48)
  r.duplicar = e.pode.criar && temItens;
  return { ...r, lista: ORDEM_DAS_ACOES_DA_LISTA.filter((a) => r[a]) };
}

const DUPLIQUE = 'Duplique para fazer um novo.';

/** A frase de recusa, pela causa certa (a API, a lista e o detalhe do pedido usam esta, RN-VEN-48). */
export function motivoDaAcaoNegada(acao: AcaoDaLista, e: Omit<EntradaAcoesDaLista, 'pode'>): string {
  const enviado = e.enviado_ao_erp ?? enviadoAoErp(e.status);
  const alvo = e.tipo === 'orcamento' ? 'Orçamento' : 'Pedido';
  if (acao === 'enviar') return 'Só o pedido salvo e ainda não enviado pode ser enviado. Orçamento vira pedido pelo Converter em pedido.';
  if (acao === 'converter') return 'Só o orçamento em aberto pode virar pedido.';
  if (acao === 'duplicar') return 'Este documento não pode ser duplicado.';
  const verbo = acao === 'editar' ? 'editado' : 'excluído';
  if (enviado) return acao === 'editar' ? `Pedido já enviado ao ERP: não pode ser editado. ${DUPLIQUE}` : 'Pedido já enviado ao ERP: não pode ser excluído por aqui.';
  if (e.tipo === 'orcamento' && e.orcamento_aberto !== true) return `Orçamento fechado: não pode ser ${verbo}.`;
  if (e.na_fila && e.recusado !== true) return `${alvo} na fila: aguarde o envio.`;
  if (e.tem_itens === false) return 'Itens ainda não sincronizados. Sincronize para ver.';
  if (acao === 'editar' && e.tipo === 'pedido' && !editavelNaFatia(e.status as OrderStatus)) return `Pedido já recebido pelo servidor: não pode ser editado. ${DUPLIQUE}`;
  return `${alvo} não pode ser ${verbo}.`;
}

/** RN-VEN-48: a API recusa (422) a ação que a lista não ofereceria. `null` = pode. */
export function verificarAcaoDaLista(acao: AcaoDaLista, e: Omit<EntradaAcoesDaLista, 'pode'> & { pode?: EntradaAcoesDaLista['pode'] }): Recusa | null {
  const pode = e.pode ?? { criar: true, editar: true, cancelar: true };
  return acoesDoPedidoNaLista({ ...e, pode })[acao] ? null : { codigo: CODIGO_ACAO_DA_LISTA, http: 422, mensagem: motivoDaAcaoNegada(acao, e) };
}
