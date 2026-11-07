/**
 * Pagamento e crédito do cliente (T-0089; RN-VEN-12/13/25). Funções puras, as mesmas na API e no aparelho.
 * O Core só entrega o dado do cliente (financeiro, títulos, formas e prazo médio máximo); quem decide o pedido é o Vendedor.
 */
import { resumoFinanceiro, type FinanceiroLike, type TituloLike } from './cliente360';

/** RN-VEN-13: padrão do parâmetro `titulo_vencido_dias` (do Vendedor); o código usa este valor quando o parâmetro não existe. */
export const PRAZO_TITULO_VENCIDO_PADRAO_DIAS = 5;

export interface FinanceiroClienteResultado {
  limite_cents: number;
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

/** RN-VEN-13: título vencido há mais de `limite_dias` e prazo a prazo (prazo médio > 0) vai para aprovação; à vista segue. */
export function exigeAprovacaoPorTituloVencido(e: { maior_atraso_dias: number; prazo_medio_dias: number; limite_dias?: number }): boolean {
  return e.prazo_medio_dias > 0 && e.maior_atraso_dias > (e.limite_dias ?? PRAZO_TITULO_VENCIDO_PADRAO_DIAS);
}

export interface RestricaoPagamentoCliente {
  /** Códigos das formas permitidas; nulo, ausente ou vazio = todas as ativas. */
  formas_pagamento?: readonly string[] | null;
  /** Prazo médio máximo em dias; nulo ou ausente = sem teto. */
  prazo_medio_max_dias?: number | null;
}

export type ResultadoPagamentoCliente = { ok: true } | { ok: false; regra: 'RN-VEN-25'; motivo: 'forma_nao_permitida' | 'prazo_acima_do_maximo' };

/** RN-VEN-25: a forma escolhida precisa estar nas permitidas do cliente e o prazo médio não pode passar do máximo dele. */
export function pagamentoPermitidoAoCliente(c: RestricaoPagamentoCliente, escolha: { forma_codigo: string; prazo_medio_dias: number }): ResultadoPagamentoCliente {
  const formas = c.formas_pagamento ?? [];
  if (formas.length > 0 && !formas.some((f) => f.toUpperCase() === escolha.forma_codigo.toUpperCase())) return { ok: false, regra: 'RN-VEN-25', motivo: 'forma_nao_permitida' };
  if (c.prazo_medio_max_dias !== null && c.prazo_medio_max_dias !== undefined && escolha.prazo_medio_dias > c.prazo_medio_max_dias) return { ok: false, regra: 'RN-VEN-25', motivo: 'prazo_acima_do_maximo' };
  return { ok: true };
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
