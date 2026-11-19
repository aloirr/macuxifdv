/**
 * O financeiro do cliente que o servidor usa ao receber o pedido (T-0184; RN-VEN-12 e RN-VEN-13). A consulta é
 * `core.financeiro_cliente@1` (indisponível NÃO bloqueia); o crédito disponível desconta os pedidos do cliente aprovados e ainda
 * não faturados, somados aqui na mesma transação. A regra de entrada na aprovação mora no domínio (`aprovacoesFinanceiras`).
 */
import { CONSULTA_FINANCEIRO_CLIENTE } from '@macuxi/core/contracts';
import { ehConsultaIndisponivel, type ClienteBanco, type ContextoBase, type TransacaoTenant } from '@macuxi/platform-sdk';
import { creditoDisponivel } from '../contracts/credito-disponivel';
import { limiteInformadoPeloErp, STATUS_QUE_PESAM_NO_CREDITO, tituloVencidoDias, type FinanceiroParaAprovacao } from '../domain';

export interface FinanceiroDoCliente {
  /** `undefined` = consulta indisponível */
  para_aprovacao: FinanceiroParaAprovacao | undefined;
  /** retrato do crédito para o evento; `null` = sem linha financeira ou consulta indisponível */
  credito: { limite_cents: number; saldo_aberto_cents: number; disponivel_cents: number } | null;
  vencidos_cents: number;
}

export async function financeiroDoCliente(ctx: ContextoBase, db: ClienteBanco, tx: TransacaoTenant, clienteId: string): Promise<FinanceiroDoCliente> {
  let f;
  try {
    f = (await tx.consultar(CONSULTA_FINANCEIRO_CLIENTE, { cliente_id: clienteId })).financeiro;
  } catch (e) {
    if (!ehConsultaIndisponivel(e)) throw e;
    return { para_aprovacao: undefined, credito: null, vencidos_cents: 0 };
  }
  const limite_dias = tituloVencidoDias(ctx.parametros());
  if (!f) return { para_aprovacao: { limite_informado: false, disponivel_cents: 0, maior_atraso_dias: 0, limite_dias }, credito: null, vencidos_cents: 0 };
  const pedidos = (
    await db.query<{ status: string; total_cents: number }>(
      'select status, total_cents::float8 as total_cents from vendedor.pedido where cliente_id = $1 and deleted_at is null and status = any($2::text[])',
      [clienteId, [...STATUS_QUE_PESAM_NO_CREDITO]],
    )
  ).rows;
  const c = creditoDisponivel({ financeiro: f, pedidos_aprovados: pedidos.map((p) => ({ total_cents: Number(p.total_cents), integrado: p.status === 'integrated' })) });
  return {
    para_aprovacao: { limite_informado: limiteInformadoPeloErp(f), disponivel_cents: c.disponivel_cents, maior_atraso_dias: f.maior_atraso_dias, limite_dias },
    credito: { limite_cents: f.limite_cents, saldo_aberto_cents: f.saldo_aberto_cents, disponivel_cents: c.disponivel_cents },
    vencidos_cents: f.vencidos_cents,
  };
}
