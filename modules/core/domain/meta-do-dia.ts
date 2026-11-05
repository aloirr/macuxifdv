/**
 * Meta do dia das boas-vindas (RN-CORE-26; T-0073 §2). Funções puras: o aparelho (offline) e a API fazem a mesma conta.
 * Meta do dia = ⌈(meta do mês − realizado até ontem) ÷ dias úteis restantes⌉, contando hoje. Na equipe é a SOMA das metas do
 * dia de cada pessoa (o excesso de quem já bateu não cobre a falta do outro). Cobertura é razão do mês e não se divide por dia.
 * Dinheiro em centavos; datas civis AAAA-MM-DD no fuso do tenant; quem chama passa `hoje` (não lê o relógio).
 */
import { daysInMonth } from '@macuxi/comum';
import type { MetaDoDia } from '../contracts/inicio';
import type { IndicadorMeta } from './metas';

export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** `feriados` fica vazio até existir o cadastro de feriados. */
export interface CalendarioTenant {
  dias_uteis_semana: readonly DiaSemana[];
  feriados?: readonly string[];
}
/** Segunda a sábado, sem feriados (parâmetro `metas.dias_uteis_semana`, 0 = domingo). */
export const CALENDARIO_PADRAO: CalendarioTenant = { dias_uteis_semana: [1, 2, 3, 4, 5, 6] };

const diaDaSemana = (data: string): number => new Date(`${data}T12:00:00Z`).getUTCDay();
const ehDiaSemana = (n: unknown): n is DiaSemana => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 6;

/** Lê `metas.dias_uteis_semana` (módulo core) do pull `parametro`; ausente, removido ou inválido = padrão. */
export function calendarioDoTenant(parametros: ReadonlyArray<{ modulo: string; chave: string; valor: unknown; deleted_at?: string | null }>): CalendarioTenant {
  const p = parametros.find((x) => x.modulo === 'core' && x.chave === 'metas.dias_uteis_semana' && !x.deleted_at);
  const v = p?.valor;
  if (!Array.isArray(v) || v.length === 0 || !v.every(ehDiaSemana)) return CALENDARIO_PADRAO;
  return { dias_uteis_semana: [...new Set(v)].sort() as DiaSemana[] };
}

export function ehDiaUtil(data: string, cal: CalendarioTenant): boolean {
  return (cal.dias_uteis_semana as readonly number[]).includes(diaDaSemana(data)) && !(cal.feriados ?? []).includes(data);
}

/** Dias úteis de `hoje` (inclusive, se for útil) até o fim de `periodo`; hoje antes do período = todos; depois = 0. */
export function diasUteisRestantes(periodo: string, hoje: string, cal: CalendarioTenant): number {
  return daysInMonth(periodo).filter((d) => d >= hoje && ehDiaUtil(d, cal)).length;
}

export interface EntradaMetaDoDia {
  indicador: IndicadorMeta;
  periodo: string;
  hoje: string;
  calendario: CalendarioTenant;
  meta_mes: number;
  realizado_ate_ontem: number;
  realizado_hoje: number;
}

const atingimento = (realizado: number, metaDia: number | null): number | null => (metaDia !== null && metaDia > 0 ? Math.round((realizado / metaDia) * 10_000) : null);

/** RN-CORE-26: meta do dia de uma pessoa em um indicador (regra na ordem do desenho §2). */
export function metaDoDia(e: EntradaMetaDoDia): MetaDoDia {
  const dias = diasUteisRestantes(e.periodo, e.hoje, e.calendario);
  const comum = { indicador: e.indicador, meta_mes: e.meta_mes, realizado_ate_ontem: e.realizado_ate_ontem, realizado_hoje: e.realizado_hoje, dias_uteis_restantes: dias, membros: 1 };
  if (e.indicador === 'cobertura_pct') return { ...comum, situacao: 'do_mes', meta_dia: null, atingimento_hoje_pct: null, membros_mes_batido: e.realizado_ate_ontem >= e.meta_mes ? 1 : 0 };
  if (e.realizado_ate_ontem >= e.meta_mes) return { ...comum, situacao: 'mes_batido', meta_dia: 0, atingimento_hoje_pct: null, membros_mes_batido: 1 };
  if (dias === 0 || !ehDiaUtil(e.hoje, e.calendario)) return { ...comum, situacao: 'dia_nao_util', meta_dia: null, atingimento_hoje_pct: null, membros_mes_batido: 0 };
  const metaDia = Math.ceil((e.meta_mes - e.realizado_ate_ontem) / dias);
  return { ...comum, situacao: e.realizado_hoje >= metaDia ? 'dia_batido' : 'a_cumprir', meta_dia: metaDia, atingimento_hoje_pct: atingimento(e.realizado_hoje, metaDia), membros_mes_batido: 0 };
}

/**
 * RN-CORE-26: meta do dia da equipe = SOMA das metas do dia de cada pessoa COM meta no indicador; null sem ninguém.
 * Cobertura (`do_mes`): `meta_mes` e realizados saem como média PONDERADA pelas paradas planejadas do mês de cada pessoa
 * (`paradas_planejadas`; ausente = 0), arredondada em pontos-base como o resto do módulo; sem nenhuma parada planejada = null
 * (decisão do Alexandre, T-0073: 2 paradas a 100% + 10 a 50% = (2×100 + 10×50)/12 = 58,3%).
 */
export type ItemEquipe = MetaDoDia & { paradas_planejadas?: number };

export function metaDoDiaDaEquipe(indicador: IndicadorMeta, itens: readonly ItemEquipe[]): MetaDoDia | null {
  const l = itens.filter((i) => i.indicador === indicador);
  if (l.length === 0) return null;
  const soma = (f: (i: ItemEquipe) => number) => l.reduce((s, i) => s + f(i), 0);
  const membros = soma((i) => i.membros);
  const membrosBatido = soma((i) => i.membros_mes_batido);
  const dias = Math.max(...l.map((i) => i.dias_uteis_restantes));
  if (indicador === 'cobertura_pct') {
    const peso = (i: ItemEquipe) => Math.max(0, i.paradas_planejadas ?? 0);
    const pesoTotal = soma(peso);
    if (pesoTotal === 0) return null;
    const media = (f: (i: MetaDoDia) => number) => Math.round(soma((i) => f(i) * peso(i)) / pesoTotal);
    return { indicador, situacao: 'do_mes', meta_mes: media((i) => i.meta_mes), realizado_ate_ontem: media((i) => i.realizado_ate_ontem), realizado_hoje: media((i) => i.realizado_hoje), meta_dia: null, atingimento_hoje_pct: null, dias_uteis_restantes: dias, membros, membros_mes_batido: membrosBatido };
  }
  const metaMes = soma((i) => i.meta_mes);
  const ateOntem = soma((i) => i.realizado_ate_ontem);
  const hoje = soma((i) => i.realizado_hoje);
  const somaDia = soma((i) => i.meta_dia ?? 0);
  const comum = { indicador, meta_mes: metaMes, realizado_ate_ontem: ateOntem, realizado_hoje: hoje, dias_uteis_restantes: dias, membros, membros_mes_batido: membrosBatido };
  if (l.every((i) => i.situacao === 'mes_batido')) return { ...comum, situacao: 'mes_batido', meta_dia: 0, atingimento_hoje_pct: null };
  if (l.every((i) => i.situacao === 'mes_batido' || i.situacao === 'dia_nao_util')) return { ...comum, situacao: 'dia_nao_util', meta_dia: null, atingimento_hoje_pct: null };
  return { ...comum, situacao: somaDia > 0 && hoje >= somaDia ? 'dia_batido' : 'a_cumprir', meta_dia: somaDia, atingimento_hoje_pct: atingimento(hoje, somaDia) };
}

/** Resumo para o cartão "Meta de hoje" do Início (T-0076; RN-CORE-22/26). Pontos-base: 10000 = 100%. */
export interface ResumoMetaDeHoje {
  indicador: IndicadorMeta;
  situacao: MetaDoDia['situacao'];
  realizado_hoje: number;
  /** Necessidade diária; null em dia não útil e em indicador do mês. */
  meta_dia: number | null;
  /** max(0, meta_dia − realizado_hoje); null sem meta do dia; 0 com o mês batido. */
  faltam_hoje: number | null;
  /** (realizado até ontem + hoje) ÷ meta do mês; null sem meta do mês. */
  mes_pct: number | null;
}
export function resumoMetaDeHoje(m: MetaDoDia): ResumoMetaDeHoje {
  const faltam = m.meta_dia === null ? null : Math.max(0, m.meta_dia - m.realizado_hoje);
  const mes = m.meta_mes > 0 ? Math.round(((m.realizado_ate_ontem + m.realizado_hoje) / m.meta_mes) * 10_000) : null;
  return { indicador: m.indicador, situacao: m.situacao, realizado_hoje: m.realizado_hoje, meta_dia: m.meta_dia, faltam_hoje: faltam, mes_pct: mes };
}
