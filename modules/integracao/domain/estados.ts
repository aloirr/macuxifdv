/**
 * Máquinas de estado do lote e do retorno de pedido ao ERP (RN-INT-08, RN-INT-03).
 */
import type { EstadoLote, EstadoPedidoErp } from '../contracts';
import { PARAMETROS_PADRAO } from './parametros';

export type ResultadoTransicao<E extends string> =
  | { ok: true; estado: E; repetida: boolean }
  | { ok: false; codigo: 'transicao_invalida'; de: E; para: E; mensagem: string };

function transicionar<E extends string>(tabela: Readonly<Record<E, readonly E[]>>, de: E, para: E, aceitaRepetida: boolean, objeto: string): ResultadoTransicao<E> {
  if (aceitaRepetida && de === para) return { ok: true, estado: para, repetida: true };
  if (tabela[de].includes(para)) return { ok: true, estado: para, repetida: false };
  const permitidos = tabela[de];
  return {
    ok: false,
    codigo: 'transicao_invalida',
    de,
    para,
    mensagem: `Transição inválida do ${objeto}: ${de} → ${para}. ${permitidos.length ? `Depois de ${de} só é possível: ${permitidos.join(', ')}.` : `${de} é um estado final.`}`,
  };
}

/** Lote: `concluido` é final; `concluido_com_erros` e `falhou` podem ser reprocessados. */
export const TRANSICOES_LOTE: Readonly<Record<EstadoLote, readonly EstadoLote[]>> = {
  recebido: ['processando', 'falhou'],
  processando: ['concluido', 'concluido_com_erros', 'falhou'],
  concluido: [],
  concluido_com_erros: ['processando'],
  falhou: ['processando'],
};

export function transicionarLote(de: EstadoLote, para: EstadoLote): ResultadoTransicao<EstadoLote> {
  return transicionar(TRANSICOES_LOTE, de, para, false, 'lote');
}

/**
 * Pedido no ERP: pendente → enviado → integrado | rejeitado_erp; integrado → faturado_parcial → faturado_total.
 * Decisões: integrado → faturado_total direto é aceito (nota única); enviado → pendente é o timeout.
 * `cancelado` só vem do ERP (enviado/integrado/faturado_* → cancelado; final; motivo opcional guardado pelo Hub).
 * O Macuxi nunca escreve cancelamento no ERP: não há transição de saída para o ERP.
 * Repetir o mesmo estado é idempotente (`repetida: true`).
 */
export const TRANSICOES_PEDIDO_ERP: Readonly<Record<EstadoPedidoErp, readonly EstadoPedidoErp[]>> = {
  pendente: ['enviado'],
  enviado: ['integrado', 'rejeitado_erp', 'pendente', 'cancelado'],
  integrado: ['faturado_parcial', 'faturado_total', 'cancelado'],
  rejeitado_erp: [],
  faturado_parcial: ['faturado_total', 'cancelado'],
  faturado_total: ['cancelado'],
  cancelado: [],
};

export function transicionarPedidoErp(de: EstadoPedidoErp, para: EstadoPedidoErp): ResultadoTransicao<EstadoPedidoErp> {
  return transicionar(TRANSICOES_PEDIDO_ERP, de, para, true, 'pedido no ERP');
}

/** RN-INT-08: só pedido `aprovado` (status do Vendedor) entra na fila de pendentes. */
export function podeEntrarNaFila(statusPedido: string): boolean {
  return statusPedido === 'aprovado';
}

export interface ItemFilaPedido {
  estado: EstadoPedidoErp;
  enviado_em: string | null;
  tentativas: number;
}

/** `enviado` sem confirmação em [10 min] volta a `pendente` (o Conector pode ter caído). Outros estados não mudam. */
export function aplicarTimeoutEnvio(
  item: ItemFilaPedido,
  agora: string,
  opcoes: { timeoutMin?: number } = {},
): ItemFilaPedido & { reenviado: boolean } {
  const timeoutMin = opcoes.timeoutMin ?? PARAMETROS_PADRAO.timeoutEnvioMin;
  if (item.estado !== 'enviado' || item.enviado_em === null) return { ...item, reenviado: false };
  const venceu = Date.parse(agora) - Date.parse(item.enviado_em) >= timeoutMin * 60_000;
  if (!venceu) return { ...item, reenviado: false };
  return { estado: 'pendente', enviado_em: null, tentativas: item.tentativas, reenviado: true };
}
