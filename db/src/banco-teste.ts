/**
 * Banco de teste efêmero (dono: banco-dados). Cria `macuxi_teste_<sufixo>` no Postgres do Docker,
 * garante o papel de aplicação, aplica as migrações e (opcional) carrega uma fixture. `apagar()` remove.
 * Usado pelos testes de db/ e pelo agente `testes` (via `@macuxi/db/teste`).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { lerConfig, urlAdmin, urlApp, validarNomeBanco, type ConfigBanco } from './config';
import { migrarUp } from './migrador';
import { garantirPapelApp } from './papeis';

export interface BancoDeTeste {
  nome: string;
  /** Conexão de administrador (ignora RLS) — só para preparar dados e inspecionar o catálogo. */
  urlAdmin: string;
  /** Conexão do papel macuxi_app (sujeito a RLS) — é a que os testes de vazamento usam. */
  urlApp: string;
  apagar(): Promise<void>;
}

export type Disponibilidade = { ok: true; versao: string } | { ok: false; motivo: string };

/** Mensagem legível de erro de conexão (o pg devolve AggregateError sem mensagem quando ::1 e 127.0.0.1 recusam). */
function descreverErro(e: unknown): string {
  const lista = e instanceof AggregateError ? e.errors : [e];
  const partes = lista.map((x) => {
    const err = x as { code?: string; message?: string };
    return [err.code, err.message].filter(Boolean).join(' ') || String(x);
  });
  return [...new Set(partes)].join('; ') || String(e);
}

/** Tenta conectar como admin com timeout curto. Nunca lança. */
export async function postgresDisponivel(cfg: ConfigBanco = lerConfig(), timeoutMs = 2_000): Promise<Disponibilidade> {
  const c = new pg.Client({ connectionString: urlAdmin(cfg, 'postgres'), connectionTimeoutMillis: timeoutMs });
  try {
    await c.connect();
    const r = await c.query<{ server_version: string }>('show server_version');
    return { ok: true, versao: r.rows[0]?.server_version ?? '?' };
  } catch (e) {
    return { ok: false, motivo: descreverErro(e) };
  } finally {
    await c.end().catch(() => undefined);
  }
}

/** Executa `fn` com um cliente admin conectado ao banco `banco`. */
export async function comAdmin<T>(banco: string, fn: (c: pg.Client) => Promise<T>, cfg: ConfigBanco = lerConfig()): Promise<T> {
  const c = new pg.Client({ connectionString: urlAdmin(cfg, banco) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export async function criarBanco(nome: string, cfg: ConfigBanco = lerConfig()): Promise<void> {
  validarNomeBanco(nome);
  await comAdmin('postgres', async (c) => {
    await garantirPapelApp(c, cfg.appSenha);
    const existe = await c.query('select 1 from pg_database where datname = $1', [nome]);
    if (existe.rowCount === 0) await c.query(`create database ${nome}`);
  }, cfg);
}

export async function apagarBanco(nome: string, cfg: ConfigBanco = lerConfig()): Promise<void> {
  validarNomeBanco(nome);
  await comAdmin('postgres', (c) => c.query(`drop database if exists ${nome} with (force)`), cfg);
}

/** Bancos de teste esquecidos (execução interrompida). */
export async function listarBancosDeTeste(cfg: ConfigBanco = lerConfig()): Promise<string[]> {
  return comAdmin('postgres', async (c) => {
    const r = await c.query<{ datname: string }>("select datname from pg_database where datname like 'macuxi\\_teste\\_%' order by 1");
    return r.rows.map((x) => x.datname);
  }, cfg);
}

export interface OpcoesBancoDeTeste {
  /** Aplica todas as migrações (padrão: true). */
  migrar?: boolean;
  /** Prepara dados com o cliente admin já conectado ao banco novo (ex.: carregarDoisTenants). */
  preparar?: (admin: pg.Client) => Promise<void>;
  cfg?: ConfigBanco;
}

export async function criarBancoDeTeste(opcoes: OpcoesBancoDeTeste = {}): Promise<BancoDeTeste> {
  const cfg = opcoes.cfg ?? lerConfig();
  const nome = validarNomeBanco(`macuxi_teste_${Date.now().toString(36)}_${process.pid}_${randomBytes(3).toString('hex')}`);
  await criarBanco(nome, cfg);
  try {
    await comAdmin(nome, async (c) => {
      if (opcoes.migrar !== false) await migrarUp(c);
      if (opcoes.preparar) await opcoes.preparar(c);
    }, cfg);
  } catch (e) {
    await apagarBanco(nome, cfg).catch(() => undefined);
    throw e;
  }
  return {
    nome,
    urlAdmin: urlAdmin(cfg, nome),
    urlApp: urlApp(cfg, nome),
    apagar: () => apagarBanco(nome, cfg),
  };
}
