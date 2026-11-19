/**
 * Forma de pagamento e prazo no Novo pedido (T-0089; RN-VEN-24 e RN-VEN-25), em funções puras sobre o domain `pagamento`:
 * as opções das duas listas suspensas (o Prazo mostra só o prazo, nunca "médio 42"), o padrão do cliente, a troca de forma
 * e as pendências do envio. Tudo sai das linhas do aparelho (vale offline); a API revalida.
 */
import { descricaoPrazo, formasDaLista, formasDoCliente, pagamentoPadrao, prazosDaForma, validarPagamento, type FormaDePagamento, type PrazoDePagamento } from '../../domain/pagamento';
import type { EntradaPendencias } from '../../domain/pendencias-preenchimento';
import { percentualAjusteParaBp, valorMantendoPercentualCents } from '../../domain/preco-pedido';
import type { Rascunho } from './pedidos';

export interface OpcaoDaLista {
  id: string;
  rotulo: string;
  desabilitada?: boolean;
  motivo?: string;
}

export interface LimitesDoCliente {
  formas_pagamento: readonly string[] | null | undefined;
}

export const TEXTO_ESCOLHA_A_FORMA = 'Escolha a forma';

/** Todas as formas ativas, por ordem; a que o cadastro do cliente não aceita fica desabilitada, com o motivo (RN-VEN-25; T-0129). */
export function opcoesDeForma(formas: readonly FormaDePagamento[], cliente: LimitesDoCliente): OpcaoDaLista[] {
  return formasDaLista(formas, cliente.formas_pagamento).map((x) => ({ id: x.forma.id, rotulo: x.forma.nome, ...(x.habilitada ? {} : { desabilitada: true, motivo: x.motivo }) }));
}

/** Prazos ativos da forma escolhida: só o texto do prazo (RN-VEN-25). */
export function opcoesDePrazo(prazos: readonly PrazoDePagamento[], formaId: string | null): OpcaoDaLista[] {
  if (!formaId) return [];
  return prazosDaForma(prazos, formaId).map((x) => ({
    id: x.id,
    rotulo: x.descricao || descricaoPrazo(x.parcelas_dias),
  }));
}

/**
 * Pagamento do rascunho para este cliente. Sem forma e sem prazo (rascunho novo): o padrão (primeira forma permitida e primeiro
 * prazo habilitado). Com escolha do vendedor nunca há troca silenciosa (T-0129): o rascunho fica como está e, se a forma ou o prazo
 * não servem ao cliente, `situacaoDoPagamento` diz o que corrigir.
 */
export function rascunhoComPagamentoPadrao(r: Rascunho, formas: readonly FormaDePagamento[], prazos: readonly PrazoDePagamento[], cliente: LimitesDoCliente): Rascunho {
  if (!r.forma_pagamento_id && !r.prazo_pagamento_id) {
    const padrao = pagamentoPadrao(formasDoCliente(formas, cliente.formas_pagamento), prazos);
    return padrao ? comPagamento(r, padrao.forma, padrao.prazo) : r;
  }
  return r;
}

/**
 * RN-VEN-46: na troca de prazo, o desconto/acréscimo digitado em R$ (itens e pedido) mantém o % sobre a tabela e o R$ é refeito
 * sobre a nova tabela. Sem o catálogo aqui, a razão das tabelas é `10 000 + bp` de cada prazo.
 */
export function comValoresMantendoPercentual(r: Rascunho, pctNovo: number): Rascunho {
  const antes = 10_000 + percentualAjusteParaBp(r.prazo_percentual_ajuste);
  const depois = 10_000 + percentualAjusteParaBp(pctNovo);
  if (antes === depois) return r;
  const f = (v: number | undefined) => (v ? valorMantendoPercentualCents(v, antes, depois) : v);
  const ajustes = r.ajustes && Object.fromEntries(Object.entries(r.ajustes).map(([k, a]) => [k, a.em === 'valor' ? { ...a, desconto_cents: f(a.desconto_cents), acrescimo_cents: f(a.acrescimo_cents) } : a]));
  return { ...r, ...(ajustes ? { ajustes } : {}), desconto_valor_cents: f(r.desconto_valor_cents), acrescimo_valor_cents: f(r.acrescimo_valor_cents) };
}

export function comPagamento(r0: Rascunho, forma: FormaDePagamento, prazo: PrazoDePagamento): Rascunho {
  const r = comValoresMantendoPercentual(r0, prazo.percentual_ajuste ?? 0);
  return { ...r, forma_pagamento_id: forma.id, prazo_pagamento_id: prazo.id, prazo_percentual_ajuste: prazo.percentual_ajuste ?? 0, payment_terms: `${forma.nome} · ${prazo.descricao}`, condicao_pagamento_id: null };
}

/** Trocar a forma: o prazo atual só fica se ele for dessa forma e estiver ativo; senão volta ao placeholder (o campo fica com erro até escolher). */
export function comForma(r: Rascunho, forma: FormaDePagamento, prazos: readonly PrazoDePagamento[]): Rascunho {
  const prazo = prazosDaForma(prazos, forma.id).find((x) => x.id === r.prazo_pagamento_id);
  if (prazo) return comPagamento(r, forma, prazo);
  return { ...comValoresMantendoPercentual(r, 0), forma_pagamento_id: forma.id, prazo_pagamento_id: null, prazo_percentual_ajuste: 0, payment_terms: forma.nome, condicao_pagamento_id: null };
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
