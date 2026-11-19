/** Utilitários dos testes de banco. */
import pg from 'pg';

export async function comCliente<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/**
 * Roda `fn` SEM a marca MACUXI_AMBIENTE (devolvida no fim, mesmo com erro). Para os casos que provam a recusa de banco que
 * não é local: no servidor da demo e no DBaaS (db/dbaas/teste-compatibilidade.ts) a suíte roda com MACUXI_AMBIENTE=demo,
 * que libera o seed da demo (exigirBancoDemo) e fazia o caso cair na checagem seguinte em vez da trava (3ª execução).
 */
export async function semMarcaDeAmbiente<T>(fn: () => Promise<T>): Promise<T> {
  const antes = process.env.MACUXI_AMBIENTE;
  delete process.env.MACUXI_AMBIENTE;
  try {
    return await fn();
  } finally {
    if (antes !== undefined) process.env.MACUXI_AMBIENTE = antes;
  }
}

/**
 * Roda `fn` numa transação com o contexto dado e SEMPRE faz ROLLBACK (não suja a fixture).
 * contexto: UUID do tenant | '' (vazio) | qualquer texto (inválido) | null (sem set_config).
 */
export async function emTransacao<T>(c: pg.ClientBase, contexto: string | null, fn: () => Promise<T>): Promise<T> {
  await c.query('begin');
  try {
    if (contexto !== null) await c.query("select set_config('app.tenant_id', $1, true)", [contexto]);
    return await fn();
  } finally {
    await c.query('rollback');
  }
}

/** Erro do Postgres (código SQLSTATE) ou null se a operação passou. */
export async function erroDe(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: err.code ?? '?', message: err.message ?? String(e) };
  }
}

/**
 * Roda `sql` como o papel dado, dentro da transação aberta no `admin`, num savepoint: um erro desfaz só o comando (não aborta
 * o caso com 25P02) e sobe para quem chamou. `tenant` (opcional) vira o app.tenant_id local da transação.
 */
export async function comoPapel<T extends pg.QueryResultRow = Record<string, unknown>>(
  admin: pg.ClientBase,
  papel: string,
  sql: string,
  params: unknown[] = [],
  tenant?: string,
): Promise<pg.QueryResult<T>> {
  await admin.query('savepoint como_papel');
  try {
    await admin.query(`set local role ${papel}`);
    if (tenant !== undefined) await admin.query("select set_config('app.tenant_id', $1, true)", [tenant]);
    const r = await admin.query<T>(sql, params);
    await admin.query('reset role');
    await admin.query('release savepoint como_papel');
    return r;
  } catch (e) {
    await admin.query('rollback to savepoint como_papel');
    throw e;
  }
}

/** Erro (como o erroDe) de um comando do próprio `admin` num savepoint: o erro esperado (CHECK, único) não aborta o caso. */
export async function erroNoSavepoint(admin: pg.ClientBase, sql: string, params: unknown[] = []): Promise<{ code: string; message: string } | null> {
  await admin.query('savepoint erro');
  const e = await erroDe(admin.query(sql, params));
  await admin.query(e ? 'rollback to savepoint erro' : 'release savepoint erro');
  return e;
}

export interface TabelaInfo {
  schema: string;
  tabela: string;
  nome: string;
}

const SCHEMAS_SISTEMA = "('pg_catalog', 'information_schema', 'pg_toast')";

/** Descobre dinamicamente toda tabela com coluna tenant_id (tabela nova fica coberta sem editar teste). */
export async function tabelasComTenant(admin: pg.ClientBase): Promise<TabelaInfo[]> {
  const r = await admin.query<{ schema: string; tabela: string }>(`
    select c.table_schema as schema, c.table_name as tabela
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE'
       and c.table_schema not in ${SCHEMAS_SISTEMA}
     order by 1, 2`);
  return r.rows.map((x) => ({ ...x, nome: `${x.schema}.${x.tabela}` }));
}

/** Todas as tabelas comuns dos schemas de domínio (tudo menos sistema e public). */
export async function tabelasDeDominio(admin: pg.ClientBase): Promise<TabelaInfo[]> {
  const r = await admin.query<{ schema: string; tabela: string }>(`
    select n.nspname as schema, c.relname as tabela
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname not in ${SCHEMAS_SISTEMA} and n.nspname <> 'public'
       and n.nspname not like 'pg\\_%'
     order by 1, 2`);
  return r.rows.map((x) => ({ ...x, nome: `${x.schema}.${x.tabela}` }));
}

/** Retrato do catálogo (objetos fora de pg_catalog/information_schema), sem o controle de migrações. */
export async function retratoDoCatalogo(admin: pg.ClientBase): Promise<string[]> {
  const filtro = `not in ${SCHEMAS_SISTEMA} and nsp not like 'pg\\_temp%' and nsp not like 'pg\\_toast\\_temp%'`;
  const r = await admin.query<{ item: string }>(`
    with objetos as (
      select 'schema ' || nspname as item, nspname as nsp from pg_namespace
      union all
      select 'rel ' || n.nspname || '.' || c.relname || ' ' || c.relkind::text || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity, n.nspname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where not (n.nspname = 'public' and c.relname like 'macuxi\\_migracao%')
      union all
      select 'col ' || n.nspname || '.' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull, n.nspname
        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p', 'v')
         and not (n.nspname = 'public' and c.relname = 'macuxi_migracao')
      union all
      select 'con ' || n.nspname || '.' || conname || ' ' || pg_get_constraintdef(k.oid), n.nspname
        from pg_constraint k join pg_namespace n on n.oid = k.connamespace
       where not (n.nspname = 'public' and conname like 'macuxi\\_migracao%')
      union all
      select 'idx ' || schemaname || ' ' || indexdef, schemaname from pg_indexes
       where not (schemaname = 'public' and tablename = 'macuxi_migracao')
      union all
      select 'pol ' || schemaname || '.' || tablename || '.' || policyname || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, ''), schemaname
        from pg_policies
      union all
      select 'fn ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', n.nspname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      union all
      select 'trg ' || n.nspname || '.' || c.relname || '.' || t.tgname, n.nspname
        from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where not t.tgisinternal
    )
    select item from objetos where nsp ${filtro} order by item`);
  return r.rows.map((x) => x.item);
}

/** Hash argon2id de teste (formato PHC exigido pelo CHECK de core.usuario.senha_hash; sem senha nenhuma por trás). */
export const HASH_TESTE = '$argon2id$v=19$m=1,t=1,p=1$b3V0cm8$b3V0cm9oYXNo';

/** Códigos dos perfis com vínculo vivo do usuário (plataforma.usuario_perfil), em ordem. */
export async function vivos(c: pg.ClientBase, usuario: string): Promise<string[]> {
  const r = await c.query<{ codigo: string }>(
    `select p.codigo from plataforma.usuario_perfil up join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
      where up.usuario_id = $1 and up.deleted_at is null order by p.codigo`,
    [usuario],
  );
  return r.rows.map((x) => x.codigo);
}

/**
 * 0088 (T-0184, RN-VEN-30): confere as aprovações dos pedidos de um tenant de seed. Devolve os desvios (vazio = ok): pedido
 * vivo em `pending_approval` sem a linha `pendente` do ciclo 1 de cada motivo (vazio = `desconto`) com o nível do pedido, e
 * pedido fora de `pending_approval` com alguma linha `pendente`. Também devolve as contagens (pedidos em aprovação e linhas).
 */
export async function conferirAprovacoesDoSeed(admin: pg.ClientBase, tenantId: string): Promise<{ desvios: string[]; emAprovacao: number; linhas: number }> {
  const r = await admin.query<{ id: string; status: string; nivel: string | null; motivos: string[]; aprovacoes: Array<{ ciclo: number; motivo: string; nivel: string; estado: string }> }>(
    `select p.id::text as id, p.status, p.nivel_aprovacao as nivel, p.motivos_aprovacao as motivos,
            coalesce(json_agg(json_build_object('ciclo', a.ciclo, 'motivo', a.motivo, 'nivel', a.nivel, 'estado', a.estado)) filter (where a.id is not null), '[]') as aprovacoes
       from vendedor.pedido p
       left join vendedor.pedido_aprovacao a on a.tenant_id = p.tenant_id and a.pedido_id = p.id and a.deleted_at is null
      where p.tenant_id = $1 and p.deleted_at is null
      group by p.id`,
    [tenantId],
  );
  const desvios: string[] = [];
  let emAprovacao = 0;
  let linhas = 0;
  for (const p of r.rows) {
    linhas += p.aprovacoes.length;
    if (p.status !== 'pending_approval') {
      if (p.aprovacoes.some((a) => a.estado === 'pendente')) desvios.push(`${p.id} (${p.status}) com aprovação pendente`);
      continue;
    }
    emAprovacao += 1;
    for (const motivo of p.motivos.length > 0 ? p.motivos : ['desconto']) {
      if (!p.aprovacoes.some((a) => a.ciclo === 1 && a.estado === 'pendente' && a.motivo === motivo && a.nivel === p.nivel)) {
        desvios.push(`${p.id} sem a aprovação pendente de ${motivo} (${String(p.nivel)}) no ciclo 1`);
      }
    }
  }
  return { desvios, emAprovacao, linhas };
}
