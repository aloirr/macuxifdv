/**
 * Indicadores básicos e meta × realizado (RF-CORE-08; RN-CORE-20 a 22). Funções puras: a mesma conta roda sobre as
 * linhas locais (app) e sobre as do banco (API), então o número é igual nos dois lugares.
 * Dinheiro em centavos; cobertura em pontos-base (8500 = 85,00%).
 */
import { businessDays, yearMonthOf } from '@macuxi/comum';

export type BaseApuracao = 'aprovado' | 'faturado';

export interface PedidoApuravel {
  /** Dono do número (RN-CORE-21): pedido em nome do vendedor conta para ele; `criado_por` não entra na conta. */
  vendedor_id: string;
  criado_por?: string | null;
  cliente_id?: string;
  /** Data civil do pedido no fuso do tenant. */
  data: string;
  total_cents: number;
  aprovado: boolean;
  faturado: boolean;
  cancelado: boolean;
  /** Cancelamento parcial já abatido (RN-CORE-21: líquido de cancelamentos). */
  cancelado_cents?: number | null;
}

function naBase(p: PedidoApuravel, base: BaseApuracao): boolean {
  if (p.cancelado) return false;
  return base === 'faturado' ? p.faturado : p.aprovado || p.faturado;
}

function liquido(p: PedidoApuravel): number {
  return Math.max(0, p.total_cents - (p.cancelado_cents ?? 0));
}

/** RN-CORE-21: soma dos pedidos do vendedor no período na base de apuração, líquida de cancelamentos. */
export function realizadoDaMeta(pedidos: PedidoApuravel[], o: { usuario_id: string; periodo: string; base: BaseApuracao }): number {
  return pedidos
    .filter((p) => p.vendedor_id === o.usuario_id && yearMonthOf(p.data) === o.periodo && naBase(p, o.base))
    .reduce((s, p) => s + liquido(p), 0);
}

/** RN-CORE-22: (meta − realizado) ÷ dias úteis restantes, em centavos (arredonda para cima); nunca negativa; null sem dias úteis. */
export function necessidadeDiaria(meta_cents: number, realizado_cents: number, diasUteisRestantes: number): number | null {
  if (diasUteisRestantes <= 0) return null;
  return Math.max(0, Math.ceil((meta_cents - realizado_cents) / diasUteisRestantes));
}

export interface EntradaIndicadores {
  periodo: string;
  usuario_id: string;
  paradas: Array<{ rota_parada_id?: string; cliente_id: string; data: string }>;
  visitas: Array<{ cliente_id: string; data_local: string }>;
  hoje: string;
  feriados?: Iterable<string>;
  /** Pedidos já filtrados pelo escopo do usuário; ausente = ainda não há pedido no servidor (positivação/realizado nulos). */
  pedidos?: PedidoApuravel[];
  base?: BaseApuracao;
  meta_cents?: number | null;
}

export interface IndicadoresCalculados {
  periodo: string;
  usuario_id: string;
  planejados: number;
  visitados: number;
  cobertura_pct: number;
  positivados: number | null;
  realizado_cents: number | null;
  meta_cents: number | null;
  dias_uteis_restantes: number;
  necessidade_diaria_cents: number | null;
}

/**
 * RN-CORE-20: visitado = check-in no dia da parada planejada (visita extra não entra); cobertura = visitados ÷ planejados;
 * positivado = cliente com ≥ 1 pedido na base de apuração no período.
 */
export function indicadoresDoPeriodo(e: EntradaIndicadores): IndicadoresCalculados {
  const base = e.base ?? 'aprovado';
  const doMes = e.paradas.filter((p) => yearMonthOf(p.data) === e.periodo);
  const planejadas = new Set(doMes.map((p) => `${p.cliente_id}|${p.data}`));
  const checkins = new Set(e.visitas.map((v) => `${v.cliente_id}|${v.data_local}`));
  const visitados = [...planejadas].filter((k) => checkins.has(k)).length;
  const dias = businessDays(e.periodo, e.hoje, e.feriados ?? []).remaining;
  let positivados: number | null = null;
  let realizado: number | null = null;
  if (e.pedidos) {
    const doPeriodo = e.pedidos.filter((p) => p.vendedor_id === e.usuario_id && yearMonthOf(p.data) === e.periodo && naBase(p, base));
    positivados = new Set(doPeriodo.map((p) => p.cliente_id).filter((c): c is string => Boolean(c))).size;
    realizado = realizadoDaMeta(e.pedidos, { usuario_id: e.usuario_id, periodo: e.periodo, base });
  }
  const meta = e.meta_cents ?? null;
  return {
    periodo: e.periodo,
    usuario_id: e.usuario_id,
    planejados: planejadas.size,
    visitados,
    cobertura_pct: planejadas.size > 0 ? Math.round((visitados / planejadas.size) * 10000) : 0,
    positivados,
    realizado_cents: realizado,
    meta_cents: meta,
    dias_uteis_restantes: dias,
    necessidade_diaria_cents: meta !== null && realizado !== null ? necessidadeDiaria(meta, realizado, dias) : null,
  };
}
