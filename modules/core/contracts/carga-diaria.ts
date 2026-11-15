/**
 * Carga diária do estoque (ADR 0057, RN-CORE-61): a entidade de cadência `diaria` vem ao aparelho 1x por dia, na hora
 * configurada (padrão 06:00) no fuso do tenant. Funções puras, sem estado; o motor de sync (`cargaDiariaDevida`) e o
 * Catálogo ("Estoque desatualizado") usam as mesmas marcas. A regra fica aqui (contracts) e `domain/carga-diaria.ts`
 * reexporta, para a regra continuar testada no domain.
 */
import { fusoDoTenantOuPadrao } from '@macuxi/platform-sdk';

export const HORA_CARGA_DIARIA_PADRAO = '06:00';

export interface ParametrosCargaDiaria {
  /** Instante (ISO UTC) em que a última carga diária terminou; nulo = nunca houve. */
  ultima: string | null;
  agora: Date;
  /** Fuso IANA do tenant; inválido cai em `America/Manaus`. */
  fuso: string;
  /** `HH:MM` (00:00–23:59); inválida cai em 06:00. */
  hora: string;
}

/** `HH:MM` válido → `[h, m]`; qualquer outra coisa → 06:00. */
function horaMinuto(hora: unknown): [number, number] {
  const m = typeof hora === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora) : null;
  return m ? [Number(m[1]), Number(m[2])] : [6, 0];
}

/** Deslocamento do fuso (ms, local − UTC) no instante `t`. */
function deslocamento(t: number, fuso: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const n = (tipo: string) => Number(p.find((x) => x.type === tipo)?.value);
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return local - Math.floor(t / 1000) * 1000;
}

/** Instante UTC (ms) em que o relógio do fuso marca o dia (ano, mês 0-11, dia) às `h:m`. */
function instanteLocal(ano: number, mes: number, dia: number, h: number, m: number, fuso: string): number {
  const nominal = Date.UTC(ano, mes, dia, h, m);
  const t = nominal - deslocamento(nominal, fuso);
  return nominal - deslocamento(t, fuso);
}

/** Último marco "hoje às hora" (no fuso) que já passou: antes da hora, é o de ontem. Instante UTC (ms). */
function ultimoMarco(agora: Date, fuso: string, hora: string): number {
  const f = fusoDoTenantOuPadrao(fuso);
  const [h, m] = horaMinuto(hora);
  const loc = new Date(agora.getTime() + deslocamento(agora.getTime(), f));
  const ano = loc.getUTCFullYear();
  const mes = loc.getUTCMonth();
  const dia = loc.getUTCDate();
  const hoje = instanteLocal(ano, mes, dia, h, m, f);
  return hoje <= agora.getTime() ? hoje : instanteLocal(ano, mes, dia - 1, h, m, f);
}

/** RN-CORE-61: marca (ISO UTC) da carga diária mais recente que já devia ter ocorrido. */
export function marcaCargaDiaria(p: Pick<ParametrosCargaDiaria, 'agora' | 'fuso' | 'hora'>): string {
  return new Date(ultimoMarco(p.agora, p.fuso, p.hora)).toISOString();
}

/**
 * RN-CORE-61: a carga diária está devida quando nunca houve (`ultima` nula/inválida) ou a última é anterior ao
 * último marco "hoje às hora" no fuso do tenant que já passou (antes da hora, vale o marco de ontem).
 */
export function cargaDiariaDevida(p: ParametrosCargaDiaria): boolean {
  if (p.ultima === null) return true;
  const u = Date.parse(p.ultima);
  if (Number.isNaN(u)) return true;
  return u < ultimoMarco(p.agora, p.fuso, p.hora);
}

/** RN-CORE-61: a carga de hoje já veio (inverso de `cargaDiariaDevida`); o Catálogo usa para "Estoque desatualizado". */
export function cargaDeHoje(p: ParametrosCargaDiaria): boolean {
  return !cargaDiariaDevida(p);
}
