/**
 * Pagamento e crédito do cliente (T-0089; RN-VEN-12/13/25). Funções puras, as mesmas na API e no aparelho.
 * O Core só entrega o dado do cliente (financeiro e restrições de pagamento vindas do ERP); as regras de pedido (RN-VEN-13/25) são do Vendedor.
 */
import { resumoFinanceiro, type FinanceiroLike, type TituloLike } from './cliente360';

export interface FinanceiroClienteResultado {
  limite_cents: number;
  /** RN-VEN-12 (P4): falso = sem limite do ERP. Hoje o banco grava 0 quando o ERP não manda, então 0 conta como não informado. */
  limite_informado: boolean;
  saldo_aberto_cents: number;
  /** Do ERP; nulo = o ERP não mandou (o Vendedor calcula limite − saldo, RN-VEN-12). */
  credito_disponivel_erp_cents: number | null;
  bloqueado: boolean;
  motivo_bloqueio: string | null;
  vencidos_qtd: number;
  vencidos_cents: number;
  maior_atraso_dias: number;
  atualizado_erp_em: string | null;
}

/** RN-VEN-12/13: limite, saldo e vencidos do cliente. `hoje` é a data civil no fuso do tenant. Sem linha financeira = `null`. */
export function financeiroDoCliente(
  f: (FinanceiroLike & { atualizado_erp_em?: string | null }) | null | undefined,
  titulos: readonly TituloLike[],
  hoje: string,
): FinanceiroClienteResultado | null {
  const r = resumoFinanceiro(f, [...titulos], hoje);
  if (!r || !f) return null;
  return {
    limite_cents: r.limite_cents,
    limite_informado: r.limite_cents > 0,
    saldo_aberto_cents: r.saldo_aberto_cents,
    credito_disponivel_erp_cents: f.credito_disponivel_cents ?? null,
    bloqueado: r.bloqueado,
    motivo_bloqueio: r.motivo_bloqueio,
    vencidos_qtd: r.vencidos_qtd,
    vencidos_cents: r.vencidos_cents,
    maior_atraso_dias: r.maior_atraso_dias,
    atualizado_erp_em: f.atualizado_erp_em ?? null,
  };
}

export interface PagamentoDoClienteDoErp {
  /** Ausente = não altera; `null` = limpa. */
  prazo_medio_max_dias?: number | null;
  formas_pagamento?: string[] | null;
}

/** RN-VEN-25: lê do payload do Hub só o que veio. Ausente = não altera; `null` ou `[]` = limpa; códigos em maiúsculas, sem repetir, até 20. */
export function pagamentoDoClienteDoErp(r: { prazo_medio_max_dias?: number | null; formas_pagamento?: readonly string[] | null }): PagamentoDoClienteDoErp {
  const saida: PagamentoDoClienteDoErp = {};
  if (r.prazo_medio_max_dias === null) saida.prazo_medio_max_dias = null;
  else if (typeof r.prazo_medio_max_dias === 'number' && Number.isInteger(r.prazo_medio_max_dias) && r.prazo_medio_max_dias >= 0 && r.prazo_medio_max_dias <= 365) saida.prazo_medio_max_dias = r.prazo_medio_max_dias;
  if (r.formas_pagamento === null) saida.formas_pagamento = null;
  else if (Array.isArray(r.formas_pagamento)) {
    const codigos = [...new Set(r.formas_pagamento.map((c) => c.trim().toUpperCase()).filter((c) => c.length >= 1 && c.length <= 20))].slice(0, 20);
    saida.formas_pagamento = codigos.length > 0 ? codigos : null;
  }
  return saida;
}
