/**
 * RN-CORE-42: Resultados da Performance (T-0170 §2). Função pura: o aparelho (offline, com a cópia do servidor), a API e o
 * BKO chamam a mesma conta, e os números batem nos três lugares.
 *
 * - Faturamento, Positivação e Itens por pedido: o realizado vem do servidor (`RealizadoServidor`, RN-CORE-21/27); nulo =
 *   fonte indisponível (`sem_dado`). Visitas: das visitas que o chamador passa (as locais, no aparelho), D3.
 * - Mês: Gap = máx(0, meta − real); Meta/dia = ⌈Gap ÷ restantes⌉ e Real/dia = round(real ÷ decorridos), com o calendário da
 *   RN-CORE-41 (D1). Meta/dia e Meta/pedido só no mês de hoje.
 * - Hoje: a meta é a meta do dia da RN-CORE-26. Período menor que o mês: meta proporcional aos dias úteis. Vários meses: soma
 *   das metas e das positivações mensais (D7, §2.3).
 * - Itens por pedido: sem pedido no período e com a fonte, realizado 0 (A-3). Em Hoje e em Esta semana com hoje útil, a meta
 *   é a meta do dia de itens, a Meta/pedido sobre o realizado até ontem (A-4, §2.3).
 * Unidades da §1.5: centavos, inteiros e centésimos (itens). Divisão por zero = nulo, nunca 0.
 */
import { somarDiasCivis } from '@macuxi/comum/relogio';
import { necessidadeDiaria } from '../../contracts/necessidade-diaria';
import {
  INDICADORES_RESULTADO,
  type IndicadorResultado,
  type RealizadoServidor,
  type ResultadoIndicador,
} from '../../contracts/performance';
import type { CalendarioTenant } from '../meta-do-dia';
import { calendarioDoPeriodo, diasUteisDoIntervalo } from './calendario';
import { maiorData, menorData, mesesDoIntervalo, ultimoDiaDoMes } from './tempo';

/** Meta do mês do usuário (linha de `core.meta`). `itens_por_pedido` em centésimos. */
export interface MetaDoMes {
  periodo: string;
  indicador: string;
  valor: number;
  deleted_at?: string | null;
}

/** O mínimo da visita para contar (RN-CORE-20): cliente e `data_local` (gravada pelo servidor no check-in). */
export interface VisitaContavel {
  cliente_id: string;
  data_local: string;
  deleted_at?: string | null;
}

export interface EntradaResultados {
  /** Período `[de, ate]`, datas civis no fuso do tenant. */
  de: string;
  ate: string;
  /** Hoje no fuso do tenant (quem chama passa; aqui não se lê o relógio). */
  hoje: string;
  calendario: CalendarioTenant;
  /** Promotor não vende (RN-PRO-01): só Visitas. */
  perfil: 'vendedor' | 'promotor';
  /** Metas do usuário (pull `meta` ou `core.meta`); as removidas são ignoradas. */
  metas: readonly MetaDoMes[];
  /** Cópia da resposta do servidor para o mesmo período; nula = ainda sem base (cards de venda `sem_dado`). */
  realizado: RealizadoServidor | null;
  /** Visitas do usuário que cobrem o período (e o mês de hoje, para a meta do dia de "Hoje"). */
  visitas: readonly VisitaContavel[];
}

/** RN-CORE-20/42: visitas contadas = pares (cliente, `data_local`) com ao menos um check-in, entre `de` e `ate` inclusive. */
export function visitasContadas(visitas: readonly VisitaContavel[], de: string, ate: string): number {
  const pares = new Set<string>();
  for (const v of visitas)
    if (!v.deleted_at && v.data_local >= de && v.data_local <= ate)
      pares.add(`${v.cliente_id}|${v.data_local}`);
  return pares.size;
}

type TipoPeriodo = 'hoje' | 'meses' | 'parcial';

function tipoDoPeriodo(de: string, ate: string, hoje: string): TipoPeriodo {
  if (de === hoje && ate === hoje) return 'hoje';
  if (de.endsWith('-01') && ate === ultimoDiaDoMes(ate.slice(0, 7))) return 'meses';
  return 'parcial';
}

const divisao = (a: number, b: number): number | null => (b > 0 ? Math.round(a / b) : null);

/** Meta/pedido (§2.1): meta + (meta − real) × decorridos ÷ restantes, para cima em décimos (centésimos múltiplos de 10). */
function metaPorPedido(
  meta: number,
  real: number | null,
  decorridos: number,
  restantes: number,
): number | null {
  if (restantes <= 0) return null;
  if (real === null) return Math.ceil(meta / 10) * 10;
  const gap = meta - real;
  if (gap <= 0) return null;
  return Math.ceil((meta * restantes + gap * decorridos) / (restantes * 10)) * 10;
}

interface Contexto {
  e: EntradaResultados;
  tipo: TipoPeriodo;
  fimEfetivo: string;
  metaDe: (mes: string, indicador: IndicadorResultado) => number | null;
}

/**
 * A-4 (§2.3): meta do dia de Itens por pedido = Meta/pedido calculada no começo do dia, com o realizado até ontem do mês,
 * os DU antes de hoje e os restantes contando hoje. Sem pedido até ontem ou real até ontem ≥ meta: a meta do mês. Hoje não
 * útil: nula (RN-CORE-26).
 */
function metaDoDiaDeItens(c: Contexto): number | null {
  const { e } = c;
  const mes = e.hoje.slice(0, 7);
  const metaMes = c.metaDe(mes, 'itens_por_pedido');
  if (metaMes === null) return null;
  const cal = calendarioDoPeriodo(`${mes}-01`, ultimoDiaDoMes(mes), e.hoje, e.calendario);
  if (cal.du_hoje === null) return null;
  const pedidos = e.realizado?.pedidos_ate_ontem ?? 0;
  const itens = e.realizado?.itens_distintos_ate_ontem ?? null;
  if (pedidos <= 0 || itens === null) return metaMes;
  return metaPorPedido(metaMes, Math.round((100 * itens) / pedidos), cal.du_decorridos - 1, cal.du_restantes) ?? metaMes;
}

/** "Esta semana" (ou outro período parcial) com hoje dentro e útil: Itens usa a meta do dia de hoje (A-4). */
function parcialComHojeUtil(c: Contexto): boolean {
  const { e } = c;
  if (c.tipo !== 'parcial' || e.hoje < e.de || e.hoje > e.ate) return false;
  return diasUteisDoIntervalo(e.hoje, e.hoje, e.calendario).length === 1;
}

/** Meta do período por indicador (§2.3). */
function metaDoPeriodo(c: Contexto, indicador: IndicadorResultado, ateOntem: number | null): number | null {
  const { e } = c;
  if (indicador === 'itens_por_pedido' && (c.tipo === 'hoje' || parcialComHojeUtil(c))) return metaDoDiaDeItens(c);
  if (c.tipo === 'hoje') {
    const mes = e.hoje.slice(0, 7);
    const metaMes = c.metaDe(mes, indicador);
    if (metaMes === null) return null;
    if (ateOntem === null) return null;
    if (ateOntem >= metaMes) return 0;
    const cal = calendarioDoPeriodo(`${mes}-01`, ultimoDiaDoMes(mes), e.hoje, e.calendario);
    if (cal.du_hoje === null) return null; // dia não útil: não há meta do dia (RN-CORE-26)
    return necessidadeDiaria(metaMes, ateOntem, cal.du_restantes);
  }
  const meses = mesesDoIntervalo(e.de, e.ate);
  if (c.tipo === 'meses') {
    const ateHoje = meses.filter((m) => m <= e.hoje.slice(0, 7));
    const incluidos = ateHoje.length > 0 ? ateHoje : meses;
    const comMeta = incluidos.flatMap((m) => {
      const valor = c.metaDe(m, indicador);
      return valor === null ? [] : [{ m, valor }];
    });
    if (comMeta.length === 0) return null;
    if (indicador !== 'itens_por_pedido') return comMeta.reduce((s, x) => s + x.valor, 0);
    // Itens: média das metas mensais ponderada pelos pedidos de cada mês; sem pedido, média simples.
    const pedidos = (m: string) => e.realizado?.por_mes.find((p) => p.periodo === m)?.pedidos ?? 0;
    const peso = comMeta.reduce((s, x) => s + pedidos(x.m), 0);
    if (peso > 0) return Math.round(comMeta.reduce((s, x) => s + x.valor * pedidos(x.m), 0) / peso);
    return Math.round(comMeta.reduce((s, x) => s + x.valor, 0) / comMeta.length);
  }
  // Parcial: Σ por mês round(meta_mês × du(P ∩ mês) ÷ du(mês)); sem dia útil no período, sem meta.
  let soma = 0;
  let ponderada = 0;
  let diasComMeta = 0;
  for (const m of meses) {
    const valor = c.metaDe(m, indicador);
    if (valor === null) continue;
    const inicioMes = `${m}-01`;
    const fimMes = ultimoDiaDoMes(m);
    const duMes = diasUteisDoIntervalo(inicioMes, fimMes, e.calendario).length;
    const duInter = diasUteisDoIntervalo(
      maiorData(e.de, inicioMes),
      menorData(e.ate, fimMes),
      e.calendario,
    ).length;
    if (duMes === 0 || duInter === 0) continue;
    soma += Math.round((valor * duInter) / duMes);
    ponderada += valor * duInter;
    diasComMeta += duInter;
  }
  if (diasComMeta === 0) return null;
  return indicador === 'itens_por_pedido' ? Math.round(ponderada / diasComMeta) : soma;
}

/**
 * Realizado do período (§2.1/§2.3); nulo = fonte indisponível. `pedidos` nulo em itens = sem dado; 0 = sem pedido, que dá
 * realizado 0 (A-3) e `semPedido` para a Meta/pedido ficar a própria meta.
 */
function realizadoDoPeriodo(
  c: Contexto,
  indicador: IndicadorResultado,
): { fonte: boolean; real: number | null; ateOntem: number | null; semPedido?: boolean } {
  const { e } = c;
  if (indicador === 'visitas') {
    const real = visitasContadas(e.visitas, e.de, c.fimEfetivo);
    const ateOntem = visitasContadas(e.visitas, `${e.hoje.slice(0, 7)}-01`, somarDiasCivis(e.hoje, -1));
    return { fonte: true, real, ateOntem };
  }
  const r = e.realizado;
  if (e.perfil === 'promotor' || r === null) return { fonte: false, real: null, ateOntem: null };
  if (indicador === 'venda_cents')
    return { fonte: r.venda_cents !== null, real: r.venda_cents, ateOntem: r.venda_ate_ontem_cents };
  if (indicador === 'positivacao') {
    if (r.positivacao === null) return { fonte: false, real: null, ateOntem: null };
    const mensal = r.por_mes.filter((p) => p.positivacao !== null);
    const real =
      c.tipo === 'meses' && mesesDoIntervalo(e.de, e.ate).length > 1 && mensal.length > 0
        ? mensal.reduce((s, p) => s + (p.positivacao ?? 0), 0)
        : r.positivacao;
    return { fonte: true, real, ateOntem: r.positivacao_ate_ontem };
  }
  if (r.pedidos === null || r.itens_distintos === null) return { fonte: false, real: null, ateOntem: null };
  if (r.pedidos === 0) return { fonte: true, real: 0, ateOntem: null, semPedido: true };
  return { fonte: true, real: Math.round((100 * r.itens_distintos) / r.pedidos), ateOntem: null };
}

function resultadoDe(c: Contexto, indicador: IndicadorResultado): ResultadoIndicador {
  const vazio = {
    indicador,
    meta: null,
    realizado: null,
    atingimento_pb: null,
    gap: null,
    meta_dia: null,
    real_dia: null,
  };
  const { fonte, real, ateOntem, semPedido } = realizadoDoPeriodo(c, indicador);
  if (!fonte) return { ...vazio, situacao: 'sem_dado' };
  const { e } = c;
  const cal = calendarioDoPeriodo(e.de, e.ate, e.hoje, e.calendario);
  const realDia = indicador === 'itens_por_pedido' || real === null ? null : divisao(real, cal.du_decorridos);
  const meta = metaDoPeriodo(c, indicador, ateOntem);
  if (meta === null) return { ...vazio, situacao: 'sem_meta', realizado: real, real_dia: realDia };
  const gap = real === null ? null : Math.max(0, meta - real);
  const atingimento = real === null || meta <= 0 ? null : Math.round((10_000 * real) / meta);
  const mesDeHoje =
    c.tipo === 'meses' && e.de.slice(0, 7) === e.ate.slice(0, 7) && e.de <= e.hoje && e.hoje <= e.ate;
  let metaDia: number | null = null;
  if (mesDeHoje && indicador === 'itens_por_pedido')
    metaDia = metaPorPedido(meta, semPedido ? null : real, cal.du_decorridos, cal.du_restantes);
  else if (mesDeHoje && real !== null && real < meta)
    metaDia = necessidadeDiaria(meta, real, cal.du_restantes);
  const batida = real !== null && real >= meta;
  return {
    indicador,
    situacao: batida ? 'batida' : 'a_cumprir',
    meta,
    realizado: real,
    atingimento_pb: atingimento,
    gap,
    meta_dia: metaDia,
    real_dia: realDia,
  };
}

/** RN-CORE-42: os 4 cards de Resultados, na ordem de `INDICADORES_RESULTADO`. */
export function resultadosDoPeriodo(e: EntradaResultados): ResultadoIndicador[] {
  if (e.ate < e.de) throw new RangeError(`Período invertido: ${e.de} a ${e.ate}.`);
  const metas = new Map<string, number>();
  for (const m of e.metas) {
    const chave = `${m.periodo}|${m.indicador}`;
    if (!m.deleted_at && !metas.has(chave)) metas.set(chave, m.valor);
  }
  const c: Contexto = {
    e,
    tipo: tipoDoPeriodo(e.de, e.ate, e.hoje),
    fimEfetivo: menorData(e.ate, e.hoje),
    metaDe: (mes, indicador) => metas.get(`${mes}|${indicador}`) ?? null,
  };
  return INDICADORES_RESULTADO.map((i) => resultadoDe(c, i));
}
