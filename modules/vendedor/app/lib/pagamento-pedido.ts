/**
 * Forma de pagamento e prazo no Novo pedido (T-0089; RN-VEN-24 e RN-VEN-25), em funções puras sobre o domain `pagamento`:
 * as opções das duas listas suspensas (o Prazo mostra só o prazo, nunca "médio 42"), o padrão do cliente, a troca de forma
 * e as pendências do envio. Tudo sai das linhas do aparelho (vale offline); a API revalida.
 */
import { descricaoPrazo, formasDoCliente, pagamentoPadrao, prazosDaForma, validarPagamento, type FormaDePagamento, type PrazoDePagamento } from '../../domain/pagamento';
import type { Rascunho } from './pedidos';

export interface OpcaoDaLista {
  id: string;
  rotulo: string;
  desabilitada?: boolean;
  motivo?: string;
}

export interface LimitesDoCliente {
  prazo_medio_max_dias: number | null | undefined;
  formas_pagamento: readonly string[] | null | undefined;
}

export const MOTIVO_ACIMA_DO_PRAZO_MEDIO = 'Acima do prazo médio do cliente';
export const TEXTO_ESCOLHA_A_FORMA = 'Escolha a forma';
export const TEXTO_SEM_FORMAS = 'Cadastre as formas de pagamento no BKO';

/** Formas que o cliente aceita (RN-VEN-25), por ordem. */
export function opcoesDeForma(formas: readonly FormaDePagamento[], cliente: LimitesDoCliente): OpcaoDaLista[] {
  return formasDoCliente(formas, cliente.formas_pagamento).map((f) => ({ id: f.id, rotulo: f.nome }));
}

/** Prazos da forma escolhida: só o texto do prazo; o que passa do prazo médio do cliente fica desabilitado (o motivo vai ao leitor de tela). */
export function opcoesDePrazo(prazos: readonly PrazoDePagamento[], formaId: string | null, cliente: LimitesDoCliente): OpcaoDaLista[] {
  if (!formaId) return [];
  return prazosDaForma(prazos, formaId, cliente.prazo_medio_max_dias).map((x) => ({
    id: x.prazo.id,
    rotulo: x.prazo.descricao || descricaoPrazo(x.prazo.parcelas_dias),
    ...(x.habilitado ? {} : { desabilitada: true, motivo: MOTIVO_ACIMA_DO_PRAZO_MEDIO }),
  }));
}

/** O rascunho com forma e prazo válidos para este cliente? Senão, o padrão (primeira forma permitida e primeiro prazo habilitado). */
export function rascunhoComPagamentoPadrao(r: Rascunho, formas: readonly FormaDePagamento[], prazos: readonly PrazoDePagamento[], cliente: LimitesDoCliente): Rascunho {
  const permitidas = formasDoCliente(formas, cliente.formas_pagamento);
  const forma = permitidas.find((f) => f.id === r.forma_pagamento_id);
  const prazo = forma ? prazosDaForma(prazos, forma.id, cliente.prazo_medio_max_dias).find((x) => x.prazo.id === r.prazo_pagamento_id && x.habilitado) : undefined;
  if (forma && prazo) return r;
  const padrao = pagamentoPadrao(permitidas, prazos, cliente.prazo_medio_max_dias);
  if (!padrao) return r.forma_pagamento_id || r.prazo_pagamento_id ? { ...r, forma_pagamento_id: null, prazo_pagamento_id: null } : r;
  return comPagamento(r, padrao.forma, padrao.prazo);
}

export function comPagamento(r: Rascunho, forma: FormaDePagamento, prazo: PrazoDePagamento): Rascunho {
  return { ...r, forma_pagamento_id: forma.id, prazo_pagamento_id: prazo.id, payment_terms: `${forma.nome} · ${prazo.descricao}`, condicao_pagamento_id: null };
}

/** Trocar a forma: o prazo atual só fica se ele for dessa forma e estiver habilitado; senão volta ao placeholder (o campo fica com erro até escolher). */
export function comForma(r: Rascunho, forma: FormaDePagamento, prazos: readonly PrazoDePagamento[], cliente: LimitesDoCliente): Rascunho {
  const prazo = prazosDaForma(prazos, forma.id, cliente.prazo_medio_max_dias).find((x) => x.prazo.id === r.prazo_pagamento_id && x.habilitado)?.prazo;
  if (prazo) return comPagamento(r, forma, prazo);
  return { ...r, forma_pagamento_id: forma.id, prazo_pagamento_id: null, payment_terms: forma.nome, condicao_pagamento_id: null };
}

export function comPrazo(r: Rascunho, prazoId: string, formas: readonly FormaDePagamento[], prazos: readonly PrazoDePagamento[]): Rascunho {
  const prazo = prazos.find((p) => p.id === prazoId);
  const forma = prazo ? formas.find((f) => f.id === prazo.forma_pagamento_id) : undefined;
  return prazo && forma ? comPagamento(r, forma, prazo) : r;
}

/**
 * Pendência do pagamento que trava o envio (mensagem em português com a ação seguinte), ou `null`. Sem nenhuma forma no
 * aparelho (tenant antigo, antes do primeiro sync) não trava: vale a condição legada. Mesma regra da API (`validarPagamento`).
 */
export function pendenciaDoPagamento(r: Rascunho, formas: readonly FormaDePagamento[], prazos: readonly PrazoDePagamento[], cliente: LimitesDoCliente): string | null {
  if (formas.length === 0) return null;
  if (formasDoCliente(formas, cliente.formas_pagamento).length === 0) return TEXTO_SEM_FORMAS;
  if (!r.forma_pagamento_id) return 'Escolha a forma de pagamento.';
  if (!r.prazo_pagamento_id) return 'Escolha o prazo.';
  const v = validarPagamento({ forma: formas.find((f) => f.id === r.forma_pagamento_id), prazo: prazos.find((p) => p.id === r.prazo_pagamento_id), cliente });
  return v.ok ? null : v.mensagem;
}

/** "Total do pedido · 2 itens" (o rótulo da aba Resumo não repete o total). */
export function rotuloTotalDoPedido(itens: number): string {
  return `Total do pedido · ${itens} ${itens === 1 ? 'item' : 'itens'}`;
}
