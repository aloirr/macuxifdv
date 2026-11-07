/**
 * Cartão "Crédito do cliente" da aba Detalhes (T-0089; RN-VEN-12 e RN-VEN-13). A consulta `core.financeiro_cliente@1` responde
 * no aparelho com as linhas locais do Core (vale offline); aqui só se monta o que o cartão mostra: limite total, limite
 * disponível (domain `creditoDoCartao`) e o alerta de título vencido. Sem a linha "Após este pedido" (decisão de 06/11).
 */
import { creditoDoCartao } from '../../domain/pagamento';

/** Subconjunto estrutural de `FinanceiroClienteSaida['financeiro']` (o Vendedor não importa o domain do Core). */
export interface FinanceiroDaConsulta {
  limite_cents: number;
  saldo_aberto_cents: number;
  credito_disponivel_erp_cents: number | null;
  bloqueado: boolean;
  motivo_bloqueio: string | null;
  vencidos_qtd: number;
  vencidos_cents: number;
  maior_atraso_dias: number;
  atualizado_erp_em: string | null;
}

/** Pedido do cliente que ainda pesa no crédito (RN-VEN-12): aprovado e ainda não faturado. */
export interface PedidoParaCredito {
  status: string;
  total_cents: number;
}

export type ModeloDoCredito =
  | { tipo: 'vazio' }
  | {
      tipo: 'dados';
      limite_cents: number;
      disponivel_cents: number;
      alerta: { titulos: number; valorCents: number; dias: number } | null;
    };

/** Status que ainda não foram faturados e já foram aprovados; `integrated` o ERP já descontou quando mandou o disponível. */
const STATUS_QUE_PESAM = new Set(['approved', 'sent_to_erp', 'integrated']);

export function modeloDoCredito(f: FinanceiroDaConsulta | null, pedidos: readonly PedidoParaCredito[]): ModeloDoCredito {
  if (!f) return { tipo: 'vazio' };
  const c = creditoDoCartao(
    f,
    pedidos.filter((p) => STATUS_QUE_PESAM.has(p.status)).map((p) => ({ total_cents: p.total_cents, integrado: p.status === 'integrated' })),
  );
  return {
    tipo: 'dados',
    limite_cents: c.limite_cents,
    disponivel_cents: c.disponivel_cents,
    alerta: f.vencidos_qtd > 0 ? { titulos: f.vencidos_qtd, valorCents: f.vencidos_cents, dias: f.maior_atraso_dias } : null,
  };
}
