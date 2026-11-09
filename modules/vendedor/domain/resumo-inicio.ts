/**
 * Cards do Início do Vendedor (T-0076): contagem e soma de orçamentos em aberto e de pedidos a faturar. Funções puras;
 * sem relógio aqui. O orçamento não expira (RN-VEN-18, 09/11): não há "vence amanhã".
 * Dinheiro em centavos.
 */
export interface DocumentoDoInicio {
  /** ausente = pedido (linhas antigas) */
  tipo?: 'pedido' | 'orcamento';
  status: string;
  total_cents: number;
  convertido_pedido_id?: string | null;
  /** ainda na fila do aparelho (não enviado) */
  local?: boolean;
}

export interface ResumoOrcamentos {
  quantidade: number;
  valor_cents: number;
}
export interface ResumoAFaturar {
  quantidade: number;
  valor_cents: number;
  aguardando_aprovacao: number;
}

/** RN-VEN-18: orçamento em aberto = não cancelado e não convertido, a qualquer tempo (não expira). Regra única do card e do filtro vindo do card. */
export function orcamentoEmAberto(o: DocumentoDoInicio): boolean {
  return o.tipo === 'orcamento' && o.status !== 'cancelled' && !o.convertido_pedido_id;
}

/** RN-VEN-18: resumo dos orçamentos em aberto (não cancelado, não convertido). */
export function resumoOrcamentos(docs: readonly DocumentoDoInicio[]): ResumoOrcamentos {
  const abertos = docs.filter((o) => orcamentoEmAberto(o));
  return {
    quantidade: abertos.length,
    valor_cents: abertos.reduce((s, o) => s + o.total_cents, 0),
  };
}

/**
 * Estados de pedido que ainda esperam faturamento (RN-VEN-30, decisão do gerente em 04/11): aguardando aprovação, aprovado,
 * enviado ao ERP e integrado. Faturado (`invoiced`/`invoiced_partial`), cancelado e rejeitado ficam fora; o pedido na fila do
 * aparelho (`queued` ou `local`) também, pois já aparece em "Na fila". O aparelho não tem "entregue/devolvido": o faturamento
 * registrado é o status `invoiced_partial`/`invoiced`.
 */
/**
 * Rótulo do cartão e do chip da lista (premissa do gerente na T-0124; o dono do produto ainda não confirmou). Para reverter ao
 * texto de antes, troque só esta linha por 'A faturar'.
 */
export const ROTULO_A_FATURAR = 'Pedidos a faturar';

export const STATUS_A_FATURAR = ['pending_approval', 'approved', 'sent_to_erp', 'integrated'] as const;

export function pedidoAFaturar(o: Pick<DocumentoDoInicio, 'tipo' | 'status'> & { local?: boolean }): boolean {
  return o.tipo !== 'orcamento' && !o.local && (STATUS_A_FATURAR as readonly string[]).includes(o.status);
}

export function resumoAFaturar(docs: readonly DocumentoDoInicio[]): ResumoAFaturar {
  const lista = docs.filter(pedidoAFaturar);
  return {
    quantidade: lista.length,
    valor_cents: lista.reduce((s, o) => s + o.total_cents, 0),
    aguardando_aprovacao: lista.filter((o) => o.status === 'pending_approval').length,
  };
}
