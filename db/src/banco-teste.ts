/**
 * Banco de teste efêmero (dono: banco-dados). Cria `macuxi_teste_<sufixo>` no Postgres DOS TESTES (lerConfigTestes:
 * container macuxi-postgres-testes, 5434, ou MACUXI_PG_TESTES_URL; no CI, o service do workflow) — nunca no da demo,
 * garante os papéis macuxi_app e macuxi_worker, aplica as migrações e (opcional) carrega uma fixture. `apagar()` remove.
 * Usado pelos testes de db/ e pelo agente `testes` (via `@macuxi/db/teste`).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { apagarBancoForcado } from './apagar-banco';
import { lerConfigTestes, urlAdmin, urlApp, urlWorker, validarNomeBanco, type ConfigBanco } from './config';
import { migrarUp } from './migrador';
import { garantirPapelApp, garantirPapelManutencao, garantirPapelWorker } from './papeis';

export interface BancoDeTeste {
  nome: string;
  /** Conexão de administrador (ignora RLS) — só para preparar dados e inspecionar o catálogo. */
  urlAdmin: string;
  /** Conexão do papel macuxi_app (sujeito a RLS) — é a que os testes de vazamento usam. */
  urlApp: string;
  /** Conexão do papel macuxi_worker (despacho da outbox, ADR 0007); null se MACUXI_PG_WORKER_SENHA não existir. */
  urlWorker: string | null;
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
export async function postgresDisponivel(cfg: ConfigBanco = lerConfigTestes(), timeoutMs = 2_000): Promise<Disponibilidade> {
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
export async function comAdmin<T>(banco: string, fn: (c: pg.Client) => Promise<T>, cfg: ConfigBanco = lerConfigTestes()): Promise<T> {
  const c = new pg.Client({ connectionString: urlAdmin(cfg, banco) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export async function criarBanco(nome: string, cfg: ConfigBanco = lerConfigTestes()): Promise<void> {
  validarNomeBanco(nome);
  await comAdmin('postgres', async (c) => {
    await garantirPapelApp(c, cfg.appSenha);
    // Antes da migração 0003: com o papel já criado (e com LOGIN), o "create role" da migração não corre em paralelo.
    if (cfg.workerSenha) await garantirPapelWorker(c, cfg.workerSenha);
    // Idem para a 0031 (B1, T-0075): papel macuxi_manutencao e a filiação do admin prontos antes das migrações paralelas.
    await garantirPapelManutencao(c);
    const existe = await c.query('select 1 from pg_database where datname = $1', [nome]);
    if (existe.rowCount === 0) await c.query(`create database ${nome}`);
  }, cfg);
}

/**
 * Apaga o banco com FORCE; sem superusuário (DBaaS e job do CI que o simula), espera as sessões de outros papéis que
 * estão saindo em vez de falhar com 42501 (db/src/apagar-banco.ts, T-0075).
 */
export async function apagarBanco(nome: string, cfg: ConfigBanco = lerConfigTestes()): Promise<void> {
  validarNomeBanco(nome);
  await comAdmin('postgres', (c) => apagarBancoForcado(c, nome), cfg);
}

/** Bancos de teste esquecidos (execução interrompida). */
export async function listarBancosDeTeste(cfg: ConfigBanco = lerConfigTestes()): Promise<string[]> {
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
  const cfg = opcoes.cfg ?? lerConfigTestes();
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
    urlWorker: cfg.workerSenha ? urlWorker(cfg, nome) : null,
    apagar: () => apagarBanco(nome, cfg),
  };
}
