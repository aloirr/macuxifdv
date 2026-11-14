/**
 * Forma de pagamento e prazo no Novo pedido (T-0089; RN-VEN-24 e RN-VEN-25), em funções puras sobre o domain `pagamento`:
 * as opções das duas listas suspensas (o Prazo mostra só o prazo, nunca "médio 42"), o padrão do cliente, a troca de forma
 * e as pendências do envio. Tudo sai das linhas do aparelho (vale offline); a API revalida.
 */
import { descricaoPrazo, formasDaLista, formasDoCliente, pagamentoPadrao, prazosDaForma, validarPagamento, type FormaDePagamento, type PrazoDePagamento } from '../../domain/pagamento';
import type { EntradaPendencias } from '../../domain/pendencias-preenchimento';
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

/** Todas as formas ativas, por ordem; a que o cadastro do cliente não aceita fica desabilitada, com o motivo (RN-VEN-25; T-0129). */
export function opcoesDeForma(formas: readonly FormaDePagamento[], cliente: LimitesDoCliente): OpcaoDaLista[] {
  return formasDaLista(formas, cliente.formas_pagamento).map((x) => ({ id: x.forma.id, rotulo: x.forma.nome, ...(x.habilitada ? {} : { desabilitada: true, motivo: x.motivo }) }));
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

/**
 * Pagamento do rascunho para este cliente. Sem forma e sem prazo (rascunho novo): o padrão (primeira forma permitida e primeiro
 * prazo habilitado). Com escolha do vendedor nunca há troca silenciosa (T-0129): o rascunho fica como está e, se a forma ou o prazo
 * não servem ao cliente, `situacaoDoPagamento` diz o que corrigir.
 */
export function rascunhoComPagamentoPadrao(r: Rascunho, formas: readonly FormaDePagamento[], prazos: readonly PrazoDePagamento[], cliente: LimitesDoCliente): Rascunho {
  if (!r.forma_pagamento_id && !r.prazo_pagamento_id) {
    const padrao = pagamentoPadrao(formasDoCliente(formas, cliente.formas_pagamento), prazos, cliente.prazo_medio_max_dias);
    return padrao ? comPagamento(r, padrao.forma, padrao.prazo) : r;
  }
  return r;
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

/** Pendência do pagamento que trava o envio, em código, para a falta no campo e em Alertas. Sem nenhuma forma no aparelho (antes do 1º sync) não trava; mesma regra da API (`validarPagamento`) (RN-CORE-36; `pendenciasDePreenchimento` do domain). */
export function situacaoDoPagamento(r: Rascunho, formas: readonly FormaDePagamento[], prazos: readonly PrazoDePagamento[], cliente: LimitesDoCliente): EntradaPendencias['pagamento'] {
  if (formas.length === 0) return { tipo: 'ok' };
  if (formasDoCliente(formas, cliente.formas_pagamento).length === 0) return { tipo: 'sem_forma_permitida' };
  if (!r.forma_pagamento_id) return { tipo: 'forma' };
  if (!r.prazo_pagamento_id) return { tipo: 'prazo' };
  const v = validarPagamento({ forma: formas.find((f) => f.id === r.forma_pagamento_id), prazo: prazos.find((p) => p.id === r.prazo_pagamento_id), cliente });
  return v.ok ? { tipo: 'ok' } : { tipo: 'invalido', codigo: v.motivo, mensagem: v.mensagem };
}
