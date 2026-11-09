/**
 * Banco modelo dos testes (dono: banco-dados; T-0033, desenho R-20261101-192853, ADR 0013 §6).
 *
 * Em vez de migrar do zero cada banco efêmero (~0,5 s ocioso, bem mais no runner carregado), o 1º `criarBancoDeTeste` do
 * processo garante `macuxi_modelo_<chave>` (todas as migrações aplicadas, IS_TEMPLATE, sem conexões) e os seguintes
 * saem por `create database <nome> template <modelo>` (~0,12 s). Os papéis são do cluster: a cópia já sai com os GRANTs,
 * o RLS e o controle `public.macuxi_migracao`; as migrações não usam ALTER DATABASE (não copiado pelo TEMPLATE).
 *
 * - chave = sha256 (12 hex) de VERSAO_MODELO, do usuário admin e de versão/nome/checksum up/checksum down de cada
 *   migração, em ordem: migração nova ou editada = modelo novo (o antigo sai no `banco apagar-teste --todos`).
 * - garantirModelo: no banco `postgres`, advisory lock próprio (≠ do migrador e dos papéis); modelo pronto = existe e
 *   `datistemplate`. Sem ele: apaga a sobra de uma construção interrompida, cria, migra e só então marca
 *   `is_template true allow_connections false` (a marca é o "pronto"). Seguro com vários processos no mesmo servidor.
 * - Ligado por padrão só em Postgres local (localhost do CI incluído); MACUXI_PG_MODELO=0 desliga, =1 força.
 * - Qualquer falha do modelo (construção ou cópia) volta ao caminho antigo com console.warn: o modelo só acelera, nunca
 *   derruba a suíte.
 */
import { createHash } from 'node:crypto';
import type { ClientBase } from 'pg';
import pg from 'pg';
import { apagarBancoForcado, type ClienteSql } from './apagar-banco';
import { ehBancoLocal, urlAdmin, validarNomeBanco, type ConfigBanco } from './config';
import { lerMigracoes, migrarUp, type Migracao } from './migrador';

/** Sobe quando o jeito de montar o modelo muda (o conteúdo das migrações já entra na chave). */
export const VERSAO_MODELO = 1;
export const PREFIXO_MODELO = 'macuxi_modelo_';
/** Chave do advisory lock da construção do modelo ("macuxm"; o migrador usa "macuxi" e os papéis "macuxp"). */
export const CHAVE_LOCK_MODELO = 0x6d616375786d;
/** Espera máxima pelo lock (outro processo construindo): depois disso, caminho antigo. */
export const PRAZO_LOCK_MODELO_MS = 120_000;

/** Chave do modelo: 12 hex do sha256 das migrações (em ordem), do admin e da versão do modelo. */
export function chaveModelo(adminUsuario: string, migracoes: readonly Migracao[] = lerMigracoes()): string {
  const h = createHash('sha256');
  h.update(`modelo:${VERSAO_MODELO}\nadmin:${adminUsuario}\n`);
  for (const m of migracoes) h.update(`${m.versao}:${m.nome}:${m.checksum}:${m.checksumDown}\n`);
  return h.digest('hex').slice(0, 12);
}

export function nomeModelo(chave: string): string {
  if (!/^[0-9a-f]{4,32}$/.test(chave)) throw new Error(`Chave de modelo inválida: "${chave}"`);
  return validarNomeBanco(`${PREFIXO_MODELO}${chave}`);
}

export function ehNomeModelo(nome: string): boolean {
  return /^macuxi_modelo_[0-9a-f]{4,32}$/.test(nome);
}

/**
 * Usa o modelo? Só quando o banco vai ser migrado; MACUXI_PG_MODELO=0 desliga, =1 liga em qualquer host; sem a variável,
 * só em Postgres local (fora dele, ex.: o DBaaS, não se deixa um banco modelo para trás).
 */
export function usarModelo(cfg: Pick<ConfigBanco, 'host'>, migrar: boolean | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (migrar === false) return false;
  const v = env.MACUXI_PG_MODELO?.trim();
  if (v === '0') return false;
  if (v === '1') return true;
  return ehBancoLocal(cfg.host, env);
}

async function comPostgres<T>(cfg: ConfigBanco, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: urlAdmin(cfg, 'postgres') });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** pg_try_advisory_lock em voltas até o prazo (pg_advisory_lock puro esperaria para sempre um processo travado). */
async function travar(c: ClientBase, prazoMs: number): Promise<void> {
  const limite = Date.now() + prazoMs;
  for (let espera = 50; ; espera = Math.min(espera * 2, 1_000)) {
    const r = await c.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [CHAVE_LOCK_MODELO]);
    if (r.rows[0]?.ok) return;
    if (Date.now() >= limite) throw new Error(`modelo: lock ${CHAVE_LOCK_MODELO} ocupado por mais de ${prazoMs} ms`);
    await new Promise((ok) => setTimeout(ok, espera));
  }
}

/** Apaga um banco modelo (tira o IS_TEMPLATE antes: o Postgres não apaga template). Idempotente. */
export async function apagarModelo(c: ClienteSql, nome: string): Promise<void> {
  if (!ehNomeModelo(nome)) throw new Error(`recusado: "${nome}" não é banco modelo`);
  const r = await c.query('select 1 from pg_database where datname = $1', [nome]);
  if (r.rows.length === 0) return;
  await c.query(`alter database ${nome} with is_template false`);
  await apagarBancoForcado(c, nome);
}

export interface ResultadoModelo {
  nome: string;
  /** true = este chamado construiu; false = já estava pronto. */
  criado: boolean;
}

export interface OpcoesModelo {
  /** Chave diferente da do conteúdo (testes do próprio modelo). */
  chave?: string;
  prazoLockMs?: number;
}

/**
 * Garante o banco modelo pronto (idempotente, seguro com vários processos). Chame com os papéis já garantidos (as
 * migrações 0003/0031/0038 os encontram prontos, como no criarBanco).
 */
export async function garantirModelo(cfg: ConfigBanco, opcoes: OpcoesModelo = {}): Promise<ResultadoModelo> {
  const nome = nomeModelo(opcoes.chave ?? chaveModelo(cfg.adminUsuario));
  return comPostgres(cfg, async (c) => {
    await travar(c, opcoes.prazoLockMs ?? PRAZO_LOCK_MODELO_MS);
    try {
      const r = await c.query<{ datistemplate: boolean }>('select datistemplate from pg_database where datname = $1', [nome]);
      if (r.rows[0]?.datistemplate) return { nome, criado: false };
      // existe sem a marca = construção interrompida (queda no meio da migração): refaz do zero
      if (r.rows.length > 0) await apagarBancoForcado(c, nome);
      await c.query(`create database ${nome}`);
      try {
        const m = new pg.Client({ connectionString: urlAdmin(cfg, nome) });
        await m.connect();
        try {
          await migrarUp(m);
        } finally {
          await m.end();
        }
        await c.query(`alter database ${nome} with is_template true allow_connections false`);
      } catch (e) {
        await apagarBancoForcado(c, nome).catch(() => undefined);
        throw e;
      }
      return { nome, criado: true };
    } finally {
      await c.query('select pg_advisory_unlock($1)', [CHAVE_LOCK_MODELO]).catch(() => undefined);
    }
  });
}

/** Um modelo por servidor e processo (memória); falha vira null (caminho antigo) com um aviso só. */
const doProcesso = new Map<string, Promise<string | null>>();

export function modeloDoProcesso(cfg: ConfigBanco, avisar: (m: string) => void = (m) => console.warn(m)): Promise<string | null> {
  const k = `${cfg.host}:${cfg.porta}:${cfg.adminUsuario}`;
  let p = doProcesso.get(k);
  if (!p) {
    p = garantirModelo(cfg).then(
      (r) => r.nome,
      (e: unknown) => {
        avisar(`[db] banco modelo indisponível, bancos de teste migrados do zero neste processo: ${(e as Error).message}`);
        return null;
      },
    );
    doProcesso.set(k, p);
  }
  return p;
}

/** Cria `nome` copiando o modelo. false (com aviso) se a cópia falhar: o chamador cria e migra do jeito antigo. */
export async function criarDoModelo(nome: string, modelo: string, cfg: ConfigBanco, avisar: (m: string) => void = (m) => console.warn(m)): Promise<boolean> {
  validarNomeBanco(nome);
  if (!ehNomeModelo(modelo)) throw new Error(`recusado: "${modelo}" não é banco modelo`);
  try {
    await comPostgres(cfg, (c) => c.query(`create database ${nome} template ${modelo}`));
    return true;
  } catch (e) {
    avisar(`[db] cópia do modelo ${modelo} falhou, ${nome} será migrado do zero: ${(e as Error).message}`);
    return false;
  }
}

/** Bancos modelo do servidor. */
export async function listarModelos(cfg: ConfigBanco): Promise<string[]> {
  return comPostgres(cfg, async (c) => {
    const r = await c.query<{ datname: string }>("select datname from pg_database where datname like 'macuxi\\_modelo\\_%' order by 1");
    return r.rows.map((x) => x.datname).filter(ehNomeModelo);
  });
}

/** Apaga os modelos de outra chave (migração nova ou editada); fica só o da chave atual. Devolve os apagados. */
export async function apagarModelosAntigos(cfg: ConfigBanco, manter: string = nomeModelo(chaveModelo(cfg.adminUsuario))): Promise<string[]> {
  const alvos = (await listarModelos(cfg)).filter((n) => n !== manter);
  await comPostgres(cfg, async (c) => {
    for (const n of alvos) await apagarModelo(c, n);
  });
  return alvos;
}
