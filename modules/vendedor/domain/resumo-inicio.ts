/**
 * Cards do Início do Vendedor (T-0076): contagem e soma de orçamentos em aberto e de pedidos a faturar. Funções puras;
 * a data civil de "hoje" (no fuso do tenant) e a validade civil de cada orçamento chegam prontas (sem relógio aqui).
 * Dinheiro em centavos.
 */
export interface DocumentoDoInicio {
  /** ausente = pedido (linhas antigas) */
  tipo?: 'pedido' | 'orcamento';
  status: string;
  total_cents: number;
  /** AAAA-MM-DD: último dia de validade do orçamento no fuso do tenant; `null` = desconhecida */
  validade_data: string | null;
  convertido_pedido_id?: string | null;
  /** ainda na fila do aparelho (não enviado) */
  local?: boolean;
}

export interface ResumoOrcamentos {
  quantidade: number;
  valor_cents: number;
  vencem_amanha: number;
}
export interface ResumoAFaturar {
  quantidade: number;
  valor_cents: number;
  aguardando_aprovacao: number;
}

/** Próximo dia da data civil AAAA-MM-DD (calendário, sem fuso). */
export function diaSeguinte(data: string): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** RN-VEN-18: orçamento em aberto = não cancelado, não convertido e com validade de hoje em diante (validade desconhecida conta). Regra única do card e do filtro vindo do card. */
export function orcamentoEmAberto(o: DocumentoDoInicio, hoje: string): boolean {
  return o.tipo === 'orcamento' && o.status !== 'cancelled' && !o.convertido_pedido_id && (o.validade_data === null || o.validade_data >= hoje);
}

/** RN-VEN-18: resumo dos orçamentos em aberto = não cancelado, não convertido e com validade de hoje em diante; "vence amanhã" = último dia amanhã. */
export function resumoOrcamentos(docs: readonly DocumentoDoInicio[], hoje: string): ResumoOrcamentos {
  const amanha = diaSeguinte(hoje);
  const abertos = docs.filter((o) => orcamentoEmAberto(o, hoje));
  return {
    quantidade: abertos.length,
    valor_cents: abertos.reduce((s, o) => s + o.total_cents, 0),
    vencem_amanha: abertos.filter((o) => o.validade_data === amanha).length,
  };
}

/**
 * Estados de pedido que ainda esperam faturamento (RN-VEN-30, decisão do gerente em 04/11): aguardando aprovação, aprovado,
 * enviado ao ERP e integrado. Faturado (`invoiced`/`invoiced_partial`), cancelado e rejeitado ficam fora; o pedido na fila do
 * aparelho (`queued` ou `local`) também, pois já aparece em "Na fila". O aparelho não tem "entregue/devolvido": o faturamento
 * registrado é o status `invoiced_partial`/`invoiced`.
 */
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
