/**
 * Contexto de tenant por transação (RN-CORE-05). Dono: banco-dados.
 *
 * A aplicação conecta como macuxi_app e, em CADA transação, define o tenant com
 *   select set_config('app.tenant_id', $1, true)      -- true = SET LOCAL (vale só nesta transação)
 * As políticas comparam tenant_id com plataforma.tenant_atual(). Sem contexto => NULL => 0 linhas
 * (falha fechada); valor que não é UUID => erro. Ao fim da transação o valor some, então uma conexão
 * devolvida ao pool não carrega o tenant da requisição anterior.
 */
import type { ClientBase, Pool, PoolClient } from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Define o tenant da transação corrente. Precisa estar dentro de BEGIN ... COMMIT. */
export async function definirTenant(c: ClientBase, tenantId: string): Promise<void> {
  if (!UUID.test(tenantId)) throw new Error('tenant_id inválido para o contexto do banco');
  await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
}

/**
 * Abre transação no pool, define o tenant, executa `fn` e faz COMMIT (ou ROLLBACK em erro).
 * É o único jeito recomendado de a API tocar dados de tenant.
 */
export async function comTenant<T>(pool: Pool, tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await definirTenant(c, tenantId);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
