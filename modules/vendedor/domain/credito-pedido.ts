/**
 * Crédito e inadimplência mandam o pedido para aprovação (T-0184, P-6; simulação aprovada em 18/11, P1 A, P3 B, P4 A).
 * Funções puras, usadas pelo app (offline, para avisar e mostrar a pergunta "Enviar para aprovação?"). O servidor revalida
 * ao receber (critério 4) com a mesma regra (`api/financeiro-aprovacao.ts`).
 *  - RN-VEN-12: a prazo, total acima do crédito disponível (limite − saldo em aberto − aprovados não faturados) vai para
 *    aprovação com o motivo `credito`; igual ao disponível não vai; à vista nunca vai por crédito; cliente sem limite
 *    informado pelo ERP, a prazo, vai (P4 A).
 *  - RN-VEN-13: título vencido há mais que o limite vai para aprovação com o motivo `inadimplencia`, também à vista (P1 A).
 */
import type { AprovacaoNova, NivelAprovacao } from './aprovacao';

export type MotivoFinanceiro = 'credito' | 'inadimplencia';

/** RN-VEN-12: status do pedido do cliente que ainda pesa no crédito (aprovado e ainda não faturado); `integrated` o ERP já descontou quando mandou o disponível. */
export const STATUS_QUE_PESAM_NO_CREDITO: ReadonlySet<string> = new Set(['approved', 'sent_to_erp', 'integrated']);

/** O ERP informou limite ou disponível para o cliente (P4 A: sem isso, a prazo, o pedido vai para aprovação). */
export const limiteInformadoPeloErp = (f: { limite_cents: number; credito_disponivel_erp_cents: number | null }): boolean => f.limite_cents > 0 || f.credito_disponivel_erp_cents != null;

export interface EntradaCreditoPedido {
  /** `undefined` = prazo ainda não escolhido (conta como a prazo, o pedido nem segue sem prazo) */
  prazo_medio_dias: number | undefined;
  total_cents: number;
  /** o ERP informou limite (ou disponível) para o cliente */
  limite_informado: boolean;
  disponivel_cents: number;
}

const aVista = (prazo: number | undefined): boolean => prazo === 0;

export function exigeAprovacaoPorCredito(i: EntradaCreditoPedido): boolean {
  if (aVista(i.prazo_medio_dias) || i.total_cents <= 0) return false;
  return !i.limite_informado || i.total_cents > i.disponivel_cents;
}

export function exigeAprovacaoPorInadimplencia(i: { maior_atraso_dias: number; limite_dias: number }): boolean {
  return i.maior_atraso_dias > i.limite_dias;
}

/** Os motivos financeiros do pedido, na ordem crédito, inadimplência (uma aprovação por motivo, P3 B). */
export function motivosFinanceirosDoPedido(i: EntradaCreditoPedido & { maior_atraso_dias: number; limite_dias: number }): MotivoFinanceiro[] {
  return [...(exigeAprovacaoPorCredito(i) ? (['credito'] as const) : []), ...(exigeAprovacaoPorInadimplencia(i) ? (['inadimplencia'] as const) : [])];
}

/** O disponível que alimenta o alerta "Limite de crédito excedido": `null` = sem alerta (à vista); sem limite informado = 0. */
export function disponivelParaAlerta(i: Pick<EntradaCreditoPedido, 'prazo_medio_dias' | 'limite_informado' | 'disponivel_cents'>): number | null {
  if (aVista(i.prazo_medio_dias)) return null;
  return i.limite_informado ? i.disponivel_cents : 0;
}

const reais = (c: number): string => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** O que o servidor sabe do financeiro do cliente ao receber o pedido. `undefined` = consulta indisponível (não bloqueia, RN-VEN-13). */
export interface FinanceiroParaAprovacao {
  limite_informado: boolean;
  disponivel_cents: number;
  maior_atraso_dias: number;
  limite_dias: number;
}

/**
 * RN-VEN-12 e RN-VEN-13 (T-0184): as aprovações financeiras do pedido, uma por motivo (P3 B), cada uma com o nível do parâmetro
 * (`niveisDosParametros`) e o texto que o aprovador lê. Ordem: crédito, inadimplência.
 */
export function aprovacoesFinanceiras(i: {
  prazo_medio_dias: number | undefined;
  total_cents: number;
  financeiro: FinanceiroParaAprovacao | undefined;
  niveis: { credito: NivelAprovacao; inadimplencia: NivelAprovacao };
}): AprovacaoNova[] {
  const f = i.financeiro;
  if (!f) return [];
  const saida: AprovacaoNova[] = [];
  if (exigeAprovacaoPorCredito({ prazo_medio_dias: i.prazo_medio_dias, total_cents: i.total_cents, limite_informado: f.limite_informado, disponivel_cents: f.disponivel_cents })) {
    const texto = f.limite_informado
      ? `Total de ${reais(i.total_cents)} acima do crédito disponível de ${reais(Math.max(0, f.disponivel_cents))}: aguardando ${i.niveis.credito}`
      : `Cliente sem limite de crédito informado pelo ERP: aguardando ${i.niveis.credito}`;
    saida.push({ motivo: 'credito', nivel: i.niveis.credito, texto });
  }
  if (exigeAprovacaoPorInadimplencia(f)) {
    saida.push({ motivo: 'inadimplencia', nivel: i.niveis.inadimplencia, texto: `Título vencido há ${f.maior_atraso_dias} dias (limite de ${f.limite_dias}): aguardando ${i.niveis.inadimplencia}` });
  }
  return saida;
}
