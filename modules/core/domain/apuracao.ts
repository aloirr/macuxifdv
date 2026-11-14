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
  /** T-0170 (A-4): produtos distintos do pedido; ausente = Vendedor antigo (Itens por pedido sem dado). */
  itens_distintos?: number;
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

/**
 * T-0170 (A-4): itens por pedido do período em centésimos = 100 × Σ itens distintos ÷ pedidos aprovados (emissão no fuso do tenant).
 * Sem pedido = 0 (A-3). Algum pedido sem `itens_distintos` = null (sem dado), nunca zero.
 */
export function itensPorPedidoDoPeriodo(pedidos: readonly PedidoDaMeta[], o: OpcoesApuracao): number | null {
  const doPeriodo = pedidosDoPeriodo(pedidos, o);
  if (doPeriodo.some((p) => p.itens_distintos === undefined)) return null;
  if (doPeriodo.length === 0) return 0;
  return Math.round((100 * doPeriodo.reduce((s, p) => s + (p.itens_distintos ?? 0), 0)) / doPeriodo.length);
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

/**
 * RN-CORE-20/26: clientes distintos positivados pelo vendedor em UM dia civil do tenant (pedido aprovado emitido nesse dia, fuso do tenant),
 * em ordem estável. É o que o consumidor do read-model grava em `core.indicador_diario.clientes_positivados_ids` junto com a contagem
 * (CHECK da 0023: contagem = tamanho da lista). Cancelamento: recalcular com o pedido cancelado e regravar o dia.
 */
export function positivadosDoDia(pedidos: readonly PedidoDaMeta[], o: { usuario_id: string; dia: string; fuso: string }): { clientes_positivados_ids: string[]; clientes_positivados: number } {
  const ids = new Set<string>();
  for (const p of pedidos) {
    if (p.vendedor_id !== o.usuario_id || !contaComoAprovado(p.status) || !p.cliente_id || dataCivil(p.emitido_em, o.fuso) !== o.dia) continue;
    ids.add(p.cliente_id);
  }
  const lista = [...ids].sort();
  return { clientes_positivados_ids: lista, clientes_positivados: lista.length };
}

/**
 * RN-CORE-20/26 (T-0073): positivados de CADA dia do mês, para o consumidor do evento do pedido regravar o read-model.
 * Entram os dias em que há pedido aprovado do vendedor (emissão no fuso do tenant) e os `diasGravados` (dias que já tinham lista:
 * se um cancelamento tirou o último cliente, o dia volta com lista vazia e zera). Ordem crescente; recalcular é idempotente.
 */
export function positivadosPorDia(
  pedidos: readonly PedidoDaMeta[],
  o: { usuario_id: string; periodo: string; fuso: string; diasGravados?: readonly string[] },
): Array<{ dia: string; clientes_positivados_ids: string[]; clientes_positivados: number }> {
  const dias = new Set<string>((o.diasGravados ?? []).filter((d) => yearMonthOf(d) === o.periodo));
  for (const p of pedidos) {
    if (p.vendedor_id !== o.usuario_id || !contaComoAprovado(p.status) || !p.cliente_id) continue;
    const dia = dataCivil(p.emitido_em, o.fuso);
    if (yearMonthOf(dia) === o.periodo) dias.add(dia);
  }
  return [...dias].sort().map((dia) => ({ dia, ...positivadosDoDia(pedidos, { usuario_id: o.usuario_id, dia, fuso: o.fuso }) }));
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

export interface OpcoesApuracaoPartida extends OpcoesApuracao {
  /** Dia civil de hoje no fuso do tenant (AAAA-MM-DD). */
  hoje: string;
}

export interface RealizadoPartidoDoDia {
  venda_cents: { ate_ontem: number; hoje: number };
  /** `ate_ontem` = clientes positivados até ontem; `hoje` = clientes NOVOS hoje (quem já tinha pedido antes de hoje não conta de novo). */
  positivacao: { ate_ontem: number; hoje: number };
}

/**
 * RN-CORE-26: realizado do mês partido em "até ontem" e "hoje" (data civil no fuso do tenant; depois de hoje não conta),
 * reaproveitando as regras do tipo da meta (RN-CORE-21): emissão para pedido, `faturado_em` para faturamento.
 */
export function realizadoPartido(
  tipo: TipoMeta,
  fonte: { pedidos?: readonly PedidoDaMeta[]; faturamentos?: readonly FaturamentoApuravel[] },
  o: OpcoesApuracaoPartida,
): RealizadoPartidoDoDia {
  const pedidos = fonte.pedidos ?? [];
  const faturamentos = fonte.faturamentos ?? [];
  const ate = (limite: (d: string) => boolean) => ({
    pedidos: pedidos.filter((p) => limite(dataCivil(p.emitido_em, o.fuso))),
    faturamentos: faturamentos.filter((f) => limite(dataCivil(f.faturado_em, o.fuso))),
  });
  const ateOntem = ate((d) => d < o.hoje);
  const ateHoje = ate((d) => d <= o.hoje);
  const venda = (f: { pedidos: readonly PedidoDaMeta[]; faturamentos: readonly FaturamentoApuravel[] }) => realizadoPorTipo(tipo, f, o);
  const vendaOntem = venda(ateOntem);
  const posOntem = positivadosDoPeriodo(ateOntem.pedidos, o);
  return {
    venda_cents: { ate_ontem: vendaOntem, hoje: venda(ateHoje) - vendaOntem },
    positivacao: { ate_ontem: posOntem, hoje: positivadosDoPeriodo(ateHoje.pedidos, o) - posOntem },
  };
}
