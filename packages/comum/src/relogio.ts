/**
 * Relógio injetável e avançável (T-0043, ADR 0015) — uma só linha do tempo por teste.
 *
 * Problema que resolve: teste que mistura um instante FIXO (`const AGORA = new Date('2026-11-01T15:00:00Z')`) com o
 * relógio REAL (`Date.now()`, `new Date()`, `now()`/`current_date` do Postgres) passa num horário e reprova em outro
 * (o main ficou vermelho três vezes assim: db às 14h, sprint1.test.ts, pedido.db.test.ts às 16:00Z).
 * Regra: o teste escolhe UMA linha do tempo — a do relógio do teste (`criarRelogio`) ou a do banco (`relogioDoBanco`) —
 * e deriva dela todas as datas, no fuso do tenant (padrão America/Manaus).
 *
 * Puro (sem Node, sem pg, sem vitest): roda em teste de domain, de API, de banco e no app. `relogioReal()` serve para
 * produção (ex.: `ctx.agora`), com a mesma interface `Relogio`.
 *
 * @example Teste sem banco
 * ```ts
 * import { criarRelogio } from '@macuxi/comum/relogio';
 * const relogio = criarRelogio({ agora: '2026-11-04T03:59:00Z' }); // 23:59 de 03/11 em Manaus
 * expect(relogio.hoje()).toBe('2026-11-03');
 * relogio.avancar({ minutos: 2 });
 * expect(relogio.hoje()).toBe('2026-11-04');
 * const ctx = { agora: () => relogio.agora(), fuso: () => relogio.fuso }; // injeta no contexto da rota
 * ```
 *
 * @example Teste com Postgres (now() do banco × relógio do teste)
 * ```ts
 * import { relogioDoBanco, criarRelogio } from '@macuxi/comum/relogio';
 * // (1) a linha do tempo é a do BANCO: compare colunas gravadas por now()/default com instantes derivados dele
 * const relogio = await relogioDoBanco(cliente);           // select now()
 * const ate = relogio.relativo({ minutos: 1 });            // janela do pull: até now() do banco + 1 min
 * // (2) a linha do tempo é a do TESTE: o banco não usa now(); o instante vai como parâmetro
 * const relogio2 = criarRelogio();                          // MACUXI_AGORA ou o relógio real, congelado aqui
 * await cliente.query('insert into x (id, checkin_em) values ($1, $2)', [id, relogio2.instante({ dias: -1, hora: '23:59' })]);
 * // relógio do Node junto (código que chama new Date() por dentro):
 * vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(relogio2.agora());
 * ```
 */
import { DEFAULT_TZ, localIsoDate, zonedParts } from './fuso';

/** Instante aceito: Date, ISO 8601 ou epoch em ms. */
export type Instante = Date | string | number;

/** Duração somada em ms exatos (1 dia = 24 h; Manaus não tem horário de verão). Para dia CIVIL use `somarDiasCivis`. */
export interface Duracao {
  dias?: number;
  horas?: number;
  minutos?: number;
  segundos?: number;
  ms?: number;
}

/** O mínimo que produção e teste compartilham (mesma forma de `ctx.agora`). */
export interface Relogio {
  agora(): Date;
}

export interface RelogioDeTeste extends Relogio {
  /** Fuso IANA do tenant usado por `hoje`, `dia` e `instante`. */
  readonly fuso: string;
  /** Epoch em ms do "agora" do relógio. */
  ms(): number;
  /** "Agora" em ISO 8601 UTC. */
  iso(): string;
  /** Avança (ou recua, com negativo) o relógio e devolve o novo "agora". */
  avancar(delta: number | Duracao): Date;
  /** Põe o relógio num instante e devolve o novo "agora". */
  definir(instante: Instante): Date;
  /** "Agora" + duração, sem mexer no relógio. */
  relativo(delta: Duracao): Date;
  /** Data civil AAAA-MM-DD de hoje no fuso do relógio. */
  hoje(): string;
  /** Data civil de hoje + n dias no fuso do relógio (n negativo = dias atrás). */
  dia(dias?: number): string;
  /** Instante às HH:MM (padrão 12:00, seguro "mesmo dia") do dia civil hoje + `dias`, no fuso do relógio. */
  instante(opcoes?: { dias?: number; hora?: string }): Date;
}

/** Variável de ambiente que fixa o "agora" dos testes (mesma semântica de `agoraDosTestes` em `@macuxi/db`). */
export const VAR_AGORA = 'MACUXI_AGORA';

const MS = { dias: 86_400_000, horas: 3_600_000, minutos: 60_000, segundos: 1_000, ms: 1 } as const;
const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA = /^(\d{2}):(\d{2})$/;

function paraMs(instante: Instante, origem = 'instante'): number {
  const n = instante instanceof Date ? instante.getTime() : typeof instante === 'number' ? instante : Date.parse(instante);
  if (!Number.isFinite(n)) throw new Error(`${origem} inválido (esperado Date, ISO 8601 ou epoch em ms): ${String(instante)}`);
  return n;
}

function envDoProcesso(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
}

/** Duração em ms (número = ms). */
export function duracaoEmMs(delta: number | Duracao): number {
  if (typeof delta === 'number') return delta;
  let total = 0;
  for (const k of Object.keys(MS) as Array<keyof typeof MS>) total += (delta[k] ?? 0) * MS[k];
  return total;
}

/** base + duração (ms exatos). */
export function relativo(base: Instante, delta: number | Duracao): Date {
  return new Date(paraMs(base) + duracaoEmMs(delta));
}

/** AAAA-MM-DD + n dias de calendário (n pode ser negativo). */
export function somarDiasCivis(data: string, n: number): string {
  const m = DATA.exec(data);
  if (!m) throw new Error(`data inválida (esperado AAAA-MM-DD): ${data}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().slice(0, 10);
}

/** Data civil (AAAA-MM-DD) de `base` + n dias no fuso. */
export function diaCivil(base: Instante, dias = 0, fuso: string = DEFAULT_TZ): string {
  return somarDiasCivis(localIsoDate(paraMs(base), fuso), dias);
}

/**
 * Instante UTC da hora civil `hora` (HH:MM) do dia `data` (AAAA-MM-DD) no fuso. Ex.: 23:59 de 2026-11-03 em Manaus →
 * 2026-11-04T03:59:00Z. Funciona também em fuso com horário de verão (ajusta o deslocamento em duas passadas).
 */
export function instanteNoFuso(data: string, hora = '12:00', fuso: string = DEFAULT_TZ): Date {
  const d = DATA.exec(data);
  if (!d) throw new Error(`data inválida (esperado AAAA-MM-DD): ${data}`);
  const h = HORA.exec(hora);
  if (!h || Number(h[1]) > 23 || Number(h[2]) > 59) throw new Error(`hora inválida (esperado HH:MM): ${hora}`);
  const alvo = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(h[1]), Number(h[2]));
  const deslocamento = (t: number) => {
    const p = zonedParts(t, fuso);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t;
  };
  let t = alvo - deslocamento(alvo);
  const ajuste = deslocamento(t);
  if (alvo - ajuste !== t) t = alvo - ajuste;
  return new Date(t);
}

/** 12:00 do dia civil de `base` no fuso: instante seguro para "mesmo dia" em qualquer fuso do Brasil. */
export function meioDiaNoFuso(base: Instante, fuso: string = DEFAULT_TZ): Date {
  return instanteNoFuso(diaCivil(base, 0, fuso), '12:00', fuso);
}

/** Relógio de produção (lê o relógio do sistema a cada chamada). */
export function relogioReal(): Relogio {
  return { agora: () => new Date() };
}

/**
 * Relógio de teste CONGELADO: só anda com `avancar`/`definir`. Base, em ordem: `opcoes.agora`, a variável
 * `MACUXI_AGORA` (instante ISO; inválida = erro) e, por último, o relógio real lido UMA vez, aqui.
 */
export function criarRelogio(
  opcoes: { agora?: Instante; fuso?: string; env?: Record<string, string | undefined> } = {},
): RelogioDeTeste {
  const fuso = opcoes.fuso ?? DEFAULT_TZ;
  const doEnv = (opcoes.env ?? envDoProcesso())[VAR_AGORA];
  let atual =
    opcoes.agora !== undefined ? paraMs(opcoes.agora) : doEnv ? paraMs(doEnv, VAR_AGORA) : Date.now();
  const relogio: RelogioDeTeste = {
    fuso,
    agora: () => new Date(atual),
    ms: () => atual,
    iso: () => new Date(atual).toISOString(),
    avancar: (delta) => {
      atual += duracaoEmMs(delta);
      return new Date(atual);
    },
    definir: (instante) => {
      atual = paraMs(instante);
      return new Date(atual);
    },
    relativo: (delta) => relativo(atual, delta),
    hoje: () => diaCivil(atual, 0, fuso),
    dia: (dias = 0) => diaCivil(atual, dias, fuso),
    instante: ({ dias = 0, hora = '12:00' } = {}) => instanteNoFuso(diaCivil(atual, dias, fuso), hora, fuso),
  };
  return relogio;
}

/** Qualquer cliente com `query` (pg.Pool, pg.PoolClient, PGlite): sem depender de `pg` aqui. */
export interface ClienteComQuery {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * Relógio de teste com o "agora" do BANCO (`select now()`): use quando o teste compara com colunas gravadas por
 * `now()`/`default now()`. Dentro de uma transação, `now()` é o início dela (fixo), o que mantém a linha do tempo única.
 */
export async function relogioDoBanco(cliente: ClienteComQuery, opcoes: { fuso?: string } = {}): Promise<RelogioDeTeste> {
  const { rows } = await cliente.query('select now() as agora');
  const agora = rows[0]?.agora;
  if (!(agora instanceof Date) && typeof agora !== 'string') throw new Error('select now() não devolveu um instante');
  return criarRelogio({ agora, ...(opcoes.fuso ? { fuso: opcoes.fuso } : {}) });
}
