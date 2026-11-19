/**
 * Cartão "Crédito do cliente" da aba Detalhes (T-0089; RN-VEN-12 e RN-VEN-13). A consulta `core.financeiro_cliente@1` responde
 * no aparelho com as linhas locais do Core (vale offline); aqui só se monta o que o cartão mostra: limite total, limite
 * disponível (domain `creditoDoCartao`) e o alerta de título vencido. Sem a linha "Após este pedido" (decisão de 06/11).
 */
import { creditoDoCartao } from '../../domain/pagamento';
import { limiteInformadoPeloErp, STATUS_QUE_PESAM_NO_CREDITO } from '../../domain/credito-pedido';

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
      /** o ERP informou limite ou disponível (P4 A, T-0184: sem limite informado, a prazo, o pedido vai para aprovação) */
      limite_informado: boolean;
      alerta: { titulos: number; valorCents: number; dias: number } | null;
    };

export function modeloDoCredito(f: FinanceiroDaConsulta | null, pedidos: readonly PedidoParaCredito[]): ModeloDoCredito {
  if (!f) return { tipo: 'vazio' };
  const c = creditoDoCartao(
    f,
    pedidos.filter((p) => STATUS_QUE_PESAM_NO_CREDITO.has(p.status)).map((p) => ({ total_cents: p.total_cents, integrado: p.status === 'integrated' })),
  );
  return {
    tipo: 'dados',
    limite_cents: c.limite_cents,
    disponivel_cents: c.disponivel_cents,
    limite_informado: limiteInformadoPeloErp(f),
    alerta: f.vencidos_qtd > 0 ? { titulos: f.vencidos_qtd, valorCents: f.vencidos_cents, dias: f.maior_atraso_dias } : null,
  };
}

/**
 * RN-VEN-12 e RN-VEN-13 (T-0184): o que o pedido precisa saber do crédito para ir (ou não) para aprovação. `null` = o Core não
 * respondeu (`modelo` nulo ou ainda carregando): o app não decide. Sem linha financeira (`vazio`), o limite não foi informado (P4 A).
 */
export function financeiroParaAprovacao(modelo: ModeloDoCredito | null | undefined, prazo_medio_dias: number | undefined, limite_dias: number) {
  if (!modelo) return null;
  if (modelo.tipo === 'vazio') return { prazo_medio_dias, limite_informado: false, disponivel_cents: 0, maior_atraso_dias: 0, limite_dias };
  return { prazo_medio_dias, limite_informado: modelo.limite_informado, disponivel_cents: modelo.disponivel_cents, maior_atraso_dias: modelo.alerta?.dias ?? 0, limite_dias };
}
