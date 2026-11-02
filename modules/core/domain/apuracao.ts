/**
 * Apuração da meta pelo TIPO (RN-CORE-20/21; T-0065 B). Funções puras: o app e a API fazem a mesma conta.
 * - Meta de pedido: pedidos aprovados (aprovado, integrado, faturado) na DATA DE EMISSÃO, no fuso do tenant. A data da
 *   aprovação não muda o mês (emitido em 31/10, aprovado em 02/11, conta em outubro). Aguardando, rejeitado, cancelado e
 *   orçamento não contam.
 * - Meta de faturamento: valor faturado na DATA DO FATURAMENTO informada pelo ERP, líquido de devoluções e cancelamentos.
 * - Positivado = cliente com ≥ 1 pedido aprovado emitido no período (mesma regra da meta de pedido).
 * - Fechamento no 2º dia útil do mês seguinte; até lá o período é "parcial até o fechamento".
 * O frete nunca entra no realizado. Dinheiro em centavos. Não lê o relógio: quem chama passa `hoje`.
 */
import { isBusinessDay, localDate, yearMonthOf } from '@macuxi/comum';

export type TipoMeta = 'pedido' | 'faturamento';

/** Estados do pedido que contam como aprovados (RN-CORE-21). */
export const STATUS_APROVADOS = ['aprovado', 'integrado', 'faturado'] as const;

export interface PedidoDaMeta {
  /** Dono do número: pedido feito pelo gestor em nome do vendedor conta para o vendedor; `criado_por` não entra. */
  vendedor_id: string;
  criado_por?: string | null;
  cliente_id?: string | null;
  /** Instante UTC da emissão (data do pedido); vira data civil no fuso do tenant. */
  emitido_em: string;
  /** Informativo: nunca decide o mês. */
  aprovado_em?: string | null;
  status: string;
  total_cents: number;
  /** Frete incluído no total; fica fora do realizado. */
  frete_cents?: number | null;
  /** Cancelamento parcial já abatido. */
  cancelado_cents?: number | null;
}

export interface FaturamentoApuravel {
  vendedor_id: string;
  cliente_id?: string | null;
  /** Instante UTC do faturamento informado pelo ERP (retorno `faturado_parcial`/`faturado_total`). */
  faturado_em: string;
  valor_cents: number;
  cancelado_cents?: number | null;
  devolvido_cents?: number | null;
}

export interface OpcoesApuracao {
  usuario_id: string;
  /** AAAA-MM. */
  periodo: string;
  /** Fuso IANA do tenant. */
  fuso: string;
}

const contaComoAprovado = (status: string) => (STATUS_APROVADOS as readonly string[]).includes(status);
const dataCivil = (instante: string, fuso: string) => localDate(new Date(instante), fuso);

function liquidoDoPedido(p: PedidoDaMeta): number {
  return Math.max(0, p.total_cents - (p.frete_cents ?? 0) - (p.cancelado_cents ?? 0));
}

function pedidosDoPeriodo(pedidos: readonly PedidoDaMeta[], o: OpcoesApuracao): PedidoDaMeta[] {
  return pedidos.filter((p) => p.vendedor_id === o.usuario_id && contaComoAprovado(p.status) && yearMonthOf(dataCivil(p.emitido_em, o.fuso)) === o.periodo);
}

/** RN-CORE-21: realizado do vendedor no período, conforme o tipo da meta. */
export function realizadoPorTipo(
  tipo: TipoMeta,
  fonte: { pedidos?: readonly PedidoDaMeta[]; faturamentos?: readonly FaturamentoApuravel[] },
  o: OpcoesApuracao,
): number {
  if (tipo === 'pedido') return pedidosDoPeriodo(fonte.pedidos ?? [], o).reduce((s, p) => s + liquidoDoPedido(p), 0);
  return (fonte.faturamentos ?? [])
    .filter((f) => f.vendedor_id === o.usuario_id && yearMonthOf(dataCivil(f.faturado_em, o.fuso)) === o.periodo)
    .reduce((s, f) => s + Math.max(0, f.valor_cents - (f.cancelado_cents ?? 0) - (f.devolvido_cents ?? 0)), 0);
}

/** RN-CORE-20: clientes distintos com pedido aprovado emitido no período (mesma regra da meta de pedido). */
export function positivadosDoPeriodo(pedidos: readonly PedidoDaMeta[], o: OpcoesApuracao): number {
  return new Set(pedidosDoPeriodo(pedidos, o).map((p) => p.cliente_id).filter((c): c is string => Boolean(c))).size;
}

function proximoMes(periodo: string): string {
  const [a, m] = periodo.split('-').map(Number) as [number, number];
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
}

/** RN-CORE-21: data civil do fechamento = 2º dia útil do mês seguinte (feriados do tenant, AAAA-MM-DD). */
export function dataDoFechamento(periodo: string, feriados: Iterable<string> = []): string {
  const fer = new Set(feriados);
  const seguinte = proximoMes(periodo);
  let uteis = 0;
  for (let d = 1; d <= 31; d++) {
    const data = `${seguinte}-${String(d).padStart(2, '0')}`;
    if (isBusinessDay(data, fer)) uteis += 1;
    if (uteis === 2) return data;
  }
  throw new Error(`Não foi possível achar o 2º dia útil depois de ${periodo}`);
}

export type SituacaoPeriodo = 'parcial' | 'fechado';

/** RN-CORE-21: o período só fecha no dia do fechamento (inclusive) e depois; antes disso a tela mostra "parcial até o fechamento". */
export function situacaoDoPeriodo(periodo: string, hoje: string, feriados: Iterable<string> = []): SituacaoPeriodo {
  return hoje >= dataDoFechamento(periodo, feriados) ? 'fechado' : 'parcial';
}

export function periodoFechado(periodo: string, hoje: string, feriados: Iterable<string> = []): boolean {
  return situacaoDoPeriodo(periodo, hoje, feriados) === 'fechado';
}
