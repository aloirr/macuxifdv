/**
 * Salvar pela fila (T-0130, Frente G; RN-VEN-30 acréscimo de 08/11, RF-VEN-04, RN-CORE-23 item 2, RN-VEN-33).
 * Funções puras, sem React: o que a tela mostra para o pedido `na_fila`, a recusa da API com o motivo em português e o
 * rascunho gravado por "Apenas salvar" como linha da lista Pedidos. Spec: docs/design/formulario-pendencias.md §4.
 */
import type { PedidoDaLista, Rascunho } from './pedidos';

export const AVISO_SALVO_ENVIANDO = 'Pedido salvo · enviando';
export const AVISO_SALVO_SEM_SINAL = 'Pedido salvo · vai quando houver sinal';
export const ROTULO_CORRIGIR_PEDIDO = 'Corrigir pedido';
export const ROTULO_SALVO = 'Salvo';

/** Texto do aviso do rodapé depois do toque em "Salvar e enviar pedido" (sem ponto final, guia de UX). */
export function avisoDoSalvar(offline: boolean): string {
  return offline ? AVISO_SALVO_SEM_SINAL : AVISO_SALVO_ENVIANDO;
}

/** Códigos que a API devolve na recusa, traduzidos; o código cru nunca aparece na tela (spec §4.3). */
export function motivoDaRecusa(bruto: string): string {
  const t = (bruto ?? '').trim();
  const codigo = (/\b(preco_abaixo_minimo|cliente_bloqueado|item_inativo|estoque_insuficiente)\b/.exec(t) ?? [])[1];
  const item = /\b([A-Z]{2,}-\d+)\b/.exec(t)?.[1] ?? 'o item';
  switch (codigo) {
    case 'preco_abaixo_minimo':
      return `preço de ${item} abaixo do mínimo`;
    case 'cliente_bloqueado':
      return 'cliente bloqueado no ERP';
    case 'item_inativo':
      return `${item} não está mais à venda`;
    case 'estoque_insuficiente':
      return `estoque de ${item} não atende a quantidade`;
    default:
      return 'o Macuxi recusou o pedido. Fale com seu supervisor';
  }
}

/** Aba do editor para onde "Corrigir pedido" leva, pelo motivo da recusa. */
export function abaDaCorrecao(bruto: string): 'itens' | 'resumo' {
  return /preco_abaixo_minimo|item_inativo|estoque_insuficiente/.test(bruto ?? '') ? 'itens' : 'resumo';
}

export interface EstadoNaFila {
  chip: { texto: string; tom: 'neutro' | 'erro' };
  faixa: { texto: string; tom: 'warning' | 'danger'; icone: 'sync' | 'wifiOff' | 'alert' };
  /** pedido `na_fila` é só de leitura; só o recusado reabre para correção */
  somenteLeitura: boolean;
  podeCorrigir: boolean;
  podeEnviarAgora: boolean;
}

export function estadoNaFila(e: { recusado: boolean; offline: boolean; motivoBruto?: string }): EstadoNaFila {
  if (e.recusado) {
    const motivo = motivoDaRecusa(e.motivoBruto ?? '');
    const conhecido = motivo !== motivoDaRecusa('');
    return {
      chip: { texto: 'Não aceito', tom: 'erro' },
      faixa: { texto: conhecido ? `Não foi aceito: ${motivo}. Corrija e salve de novo.` : `Não foi aceito: ${motivo}`, tom: 'danger', icone: 'alert' },
      somenteLeitura: false,
      podeCorrigir: true,
      podeEnviarAgora: false,
    };
  }
  return {
    chip: { texto: 'Na fila', tom: 'neutro' },
    faixa: { texto: avisoDoSalvar(e.offline), tom: 'warning', icone: e.offline ? 'wifiOff' : 'sync' },
    somenteLeitura: true,
    podeCorrigir: false,
    podeEnviarAgora: !e.offline,
  };
}

/** Prefixo do id da linha da lista que representa um rascunho (não é pedido na fila nem no servidor). */
export const PREFIXO_RASCUNHO = 'rascunho:';
export const idDoRascunho = (customerId: string) => `${PREFIXO_RASCUNHO}${customerId}`;
export const clienteDoRascunho = (id: string): string | null => (id.startsWith(PREFIXO_RASCUNHO) ? id.slice(PREFIXO_RASCUNHO.length) : null);

/**
 * "Apenas salvar" (RN-VEN-38): o rascunho com `salvo_em` aparece na lista Pedidos com a tag "Salvo". Rascunho de edição
 * (`edit:<id>`), sem itens ou nunca guardado de propósito não entra (esse é o "Pedido não terminado" do Início).
 */
export function rascunhosSalvosComoPedidos(rascunhos: Record<string, Rascunho>, nomeDoCliente: (customerId: string) => string): PedidoDaLista[] {
  return Object.entries(rascunhos)
    .filter(([chave, r]) => !chave.startsWith('edit:') && Boolean(r.salvo_em) && Object.keys(r.lines).length > 0 && !r.edit_order_id)
    .map(([, r]): PedidoDaLista => {
      const quando = r.salvo_em ?? r.updated_at;
      return {
        id: idDoRascunho(r.customer_id),
        number: '',
        idempotency_key: idDoRascunho(r.customer_id),
        seller_id: '',
        seller_name: '',
        customer_id: r.customer_id,
        customer_name: nomeDoCliente(r.customer_id),
        branch_id: '',
        branch_name: '',
        price_table_id: null,
        discount_pct: r.discount_pct,
        subtotal_cents: 0,
        discount_cents: 0,
        total_cents: 0,
        payment_terms: r.payment_terms,
        status: 'draft',
        pending_reason: '',
        rejection_reason: '',
        erp_order_code: '',
        created_offline_at: quando,
        received_at: quando,
        updated_at: quando,
        items_count: Object.keys(r.lines).length,
        units: Object.values(r.lines).reduce((s, n) => s + n, 0),
        local: true,
        local_error: '',
        ...(r.tipo === 'orcamento' ? { tipo: 'orcamento' as const } : {}),
      };
    })
    .sort((a, b) => b.received_at.localeCompare(a.received_at));
}
