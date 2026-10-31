/**
 * Apoio dos testes de banco do agente `testes` (T-0006 / T-0002).
 *
 * Descoberta pelo catálogo (pg_class/pg_attribute), escrita de forma independente dos utilitários
 * de db/testes: se a consulta do banco-dados tiver um ponto cego, esta não herda o mesmo erro.
 * Conexões: `urlApp` (papel macuxi_app, sujeito a RLS) prova isolamento; `urlAdmin` (ignora RLS)
 * serve só para preparar dados e ler o catálogo.
 */
import pg from 'pg';

/** Schemas de sistema que nunca entram na varredura. `public` só tem o controle de migrações. */
const FORA = `n.nspname not in ('pg_catalog', 'information_schema', 'public') and n.nspname not like 'pg\\_%'`;

export interface Tabela {
  schema: string;
  tabela: string;
  /** Nome qualificado e entre aspas, pronto para SQL. */
  sql: string;
  /** schema.tabela, para mensagens. */
  nome: string;
  temTenant: boolean;
}

/** Toda tabela (comum ou particionada) dos schemas de domínio, com a marca de coluna tenant_id. */
export async function tabelasDoCatalogo(admin: pg.ClientBase): Promise<Tabela[]> {
  const r = await admin.query<{ schema: string; tabela: string; tem_tenant: boolean }>(`
    select n.nspname as schema, c.relname as tabela,
           exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped) as tem_tenant
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and ${FORA}
     order by 1, 2`);
  return r.rows.map((x) => ({
    schema: x.schema,
    tabela: x.tabela,
    sql: `"${x.schema}"."${x.tabela}"`,
    nome: `${x.schema}.${x.tabela}`,
    temTenant: x.tem_tenant,
  }));
}

/** Schemas de domínio existentes (plataforma, core, ... e os que vierem). */
export async function schemasDeDominio(admin: pg.ClientBase): Promise<string[]> {
  const r = await admin.query<{ nspname: string }>(`select n.nspname from pg_namespace n where ${FORA} order by 1`);
  return r.rows.map((x) => x.nspname);
}

export async function conectar(url: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

/**
 * Executa `fn` numa transação com o tenant dado (ou sem contexto, se null) e SEMPRE desfaz.
 * Erros do Postgres viram valor de retorno ({ erro }), para o teste afirmar o código SQLSTATE.
 */
export async function tentar<T>(
  c: pg.ClientBase,
  tenant: string | null,
  fn: () => Promise<T>,
): Promise<{ ok: true; valor: T } | { ok: false; codigo: string; mensagem: string }> {
  await c.query('begin');
  try {
    if (tenant !== null) await c.query("select set_config('app.tenant_id', $1, true)", [tenant]);
    return { ok: true, valor: await fn() };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { ok: false, codigo: err.code ?? '?', mensagem: err.message ?? String(e) };
  } finally {
    await c.query('rollback');
  }
}
