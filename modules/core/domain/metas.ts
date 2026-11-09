/**
 * Indicadores básicos e meta × realizado (RF-CORE-08; RN-CORE-20 a 22). Funções puras: a mesma conta roda sobre as
 * linhas locais (app) e sobre as do banco (API), então o número é igual nos dois lugares.
 * Dinheiro em centavos; cobertura em pontos-base (8500 = 85,00%).
 */
import { yearMonthOf } from '@macuxi/comum';

import { CALENDARIO_PADRAO, diasUteisRestantes, type CalendarioTenant } from './meta-do-dia';
import { positivadosDoPeriodo, realizadoPorTipo, type FaturamentoApuravel, type PedidoDaMeta, type TipoMeta } from './apuracao';

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

import { necessidadeDiaria } from '../contracts/necessidade-diaria';
export { necessidadeDiaria };

/** Linha do read-model `indicador_diario` (vendas do vendedor no dia, já na base de apuração do tenant). */
export interface DiarioApuravel {
  usuario_id: string;
  data: string;
  pedidos: number;
  vendido_cents: number;
  cancelado_cents: number;
}

/** RN-CORE-21: soma dos diários do usuário no período, líquida de cancelamentos (dia nunca negativo). */
export function realizadoDosDiarios(diarios: readonly DiarioApuravel[], o: { usuario_id: string; periodo: string }): number {
  return diarios
    .filter((d) => d.usuario_id === o.usuario_id && yearMonthOf(d.data) === o.periodo)
    .reduce((s, d) => s + Math.max(0, d.vendido_cents - d.cancelado_cents), 0);
}

export interface EntradaIndicadores {
  periodo: string;
  usuario_id: string;
  paradas: Array<{ rota_parada_id?: string; cliente_id: string; data: string }>;
  visitas: Array<{ cliente_id: string; data_local: string }>;
  hoje: string;
  /** Calendário do tenant (RN-CORE-26): padrão segunda a sábado. Fonte única dos dias úteis do Início, Metas e BKO. */
  calendario?: CalendarioTenant;
  feriados?: Iterable<string>;
  /** Pedidos já filtrados pelo escopo do usuário; ausente = ainda não há pedido no servidor (positivação/realizado nulos). */
  pedidos?: PedidoApuravel[];
  /** Read-model diário (`indicador_diario`): usado quando não há `pedidos`; não permite positivação. */
  diarios?: DiarioApuravel[];
  base?: BaseApuracao;
  meta_cents?: number | null;
  /** T-0065 B: realizado já apurado pelo tipo da meta (`apuracao.ts`); vence `pedidos` e `diarios`. */
  apurado?: { realizado_cents: number; positivados: number };
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
  const cal = e.calendario ?? CALENDARIO_PADRAO;
  const dias = diasUteisRestantes(e.periodo, e.hoje, { ...cal, feriados: [...(cal.feriados ?? []), ...(e.feriados ?? [])] });
  let positivados: number | null = null;
  let realizado: number | null = null;
  if (e.apurado) {
    positivados = e.apurado.positivados;
    realizado = e.apurado.realizado_cents;
  } else if (e.pedidos) {
    const doPeriodo = e.pedidos.filter((p) => p.vendedor_id === e.usuario_id && yearMonthOf(p.data) === e.periodo && naBase(p, base));
    positivados = new Set(doPeriodo.map((p) => p.cliente_id).filter((c): c is string => Boolean(c))).size;
    realizado = realizadoDaMeta(e.pedidos, { usuario_id: e.usuario_id, periodo: e.periodo, base });
  } else if (e.diarios) {
    realizado = realizadoDosDiarios(e.diarios, { usuario_id: e.usuario_id, periodo: e.periodo });
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

export type IndicadorMeta = 'venda_cents' | 'positivacao' | 'cobertura_pct' | 'visitas';

export interface LinhaDePainel {
  indicador: IndicadorMeta;
  meta: number;
  /** null = ainda sem fonte (ex.: positivação antes dos pedidos chegarem ao servidor). */
  realizado: number | null;
  /** Pontos-base (10000 = 100,00%); null sem realizado ou com meta zero. */
  atingimento_pct: number | null;
}

export interface PainelDeMetas {
  indicadores: IndicadoresCalculados;
  metas: LinhaDePainel[];
}

const ORDEM_INDICADORES: IndicadorMeta[] = ['venda_cents', 'visitas', 'cobertura_pct', 'positivacao'];

/**
 * RN-CORE-20..22: indicadores do mês + cada meta (venda_cents, visitas, cobertura_pct, positivacao) contra o
 * realizado do mesmo indicador. A tela do app (linhas locais) e a API/BKO (linhas do banco) chamam esta função.
 */
export function painelDeMetas(e: Omit<EntradaIndicadores, 'meta_cents'>, metas: ReadonlyArray<{ indicador: IndicadorMeta; valor: number }>): PainelDeMetas {
  const venda = metas.find((m) => m.indicador === 'venda_cents')?.valor ?? null;
  const indicadores = indicadoresDoPeriodo({ ...e, meta_cents: venda });
  const realizadoDe: Record<IndicadorMeta, number | null> = {
    venda_cents: indicadores.realizado_cents,
    visitas: indicadores.visitados,
    cobertura_pct: indicadores.cobertura_pct,
    positivacao: indicadores.positivados,
  };
  const linhas = [...metas]
    .sort((a, b) => ORDEM_INDICADORES.indexOf(a.indicador) - ORDEM_INDICADORES.indexOf(b.indicador))
    .map((m): LinhaDePainel => {
      const realizado = realizadoDe[m.indicador];
      return { indicador: m.indicador, meta: m.valor, realizado, atingimento_pct: realizado !== null && m.valor > 0 ? Math.round((realizado / m.valor) * 10000) : null };
    });
  return { indicadores, metas: linhas };
}

type Removivel = { deleted_at?: string | null };

export interface LinhasDoPainel {
  periodo: string;
  usuario_id: string;
  hoje: string;
  calendario?: CalendarioTenant;
  feriados?: Iterable<string>;
  base?: BaseApuracao;
  paradas: ReadonlyArray<Removivel & { usuario_id: string; cliente_id: string; data: string }>;
  visitas: ReadonlyArray<Removivel & { usuario_id: string; cliente_id: string; data_local: string }>;
  diarios: ReadonlyArray<Removivel & DiarioApuravel>;
  metas: ReadonlyArray<Removivel & { usuario_id: string; periodo: string; indicador: IndicadorMeta; valor: number }>;
  /**
   * T-0065 B (RN-CORE-21): pedidos e faturamentos vindos da consulta pública do Vendedor. Presente = o realizado e a
   * positivação saem de `apuracao.ts` (emissão para meta de pedido, data do faturamento para meta de faturamento);
   * ausente (fonte indisponível) = segue o read-model `indicador_diario`.
   */
  apuracao?: { tipo: TipoMeta; fuso: string; pedidos: readonly PedidoDaMeta[]; faturamentos?: readonly FaturamentoApuravel[] };
}

/**
 * Entrada ÚNICA do painel de metas: recebe as linhas no formato do sync (`rota_parada`, `visita`, `indicador_diario`,
 * `meta`) — as do aparelho no app, as do banco na API/BKO — descarta removidas e de outro usuário/mês e chama
 * `painelDeMetas`. Por isso o app (offline) e o BKO mostram os mesmos números a partir do mesmo dado (critério 2).
 */
export function painelDoUsuario(l: LinhasDoPainel): PainelDeMetas {
  const meu = <T extends Removivel & { usuario_id: string }>(x: T) => !x.deleted_at && x.usuario_id === l.usuario_id;
  const a = l.apuracao;
  const o = a ? { usuario_id: l.usuario_id, periodo: l.periodo, fuso: a.fuso } : null;
  const apurado = a && o ? { realizado_cents: realizadoPorTipo(a.tipo, { pedidos: a.pedidos, faturamentos: a.faturamentos }, o), positivados: positivadosDoPeriodo(a.pedidos, o) } : undefined;
  return painelDeMetas(
    {
      apurado,
      periodo: l.periodo,
      usuario_id: l.usuario_id,
      hoje: l.hoje,
      calendario: l.calendario,
      feriados: l.feriados,
      base: l.base,
      paradas: l.paradas.filter(meu).map((p) => ({ cliente_id: p.cliente_id, data: p.data })),
      visitas: l.visitas.filter(meu).map((v) => ({ cliente_id: v.cliente_id, data_local: v.data_local })),
      diarios: l.diarios.filter(meu),
    },
    l.metas.filter((m) => meu(m) && m.periodo === l.periodo),
  );
}
