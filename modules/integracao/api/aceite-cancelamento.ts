/**
 * Leitura única do aceite de cancelamento do tenant (RD-0027; T-0114): Conector ativo que recebe pedidos e aceita cancelamento.
 * Usada pela consulta `integracao.cancelamento_erp@1` e pelo consumidor de `vendedor.pedido.cancelado@1`. A regra é do domain.
 */
import { erpAceitaCancelamento } from '../domain';

type Consultavel = { query<T>(sql: string, valores: unknown[]): Promise<{ rows: T[] }> };

export async function aceiteDoTenant(db: Consultavel, tenantId: string): Promise<boolean> {
  const { rows } = await db.query<{ ativo: boolean; recebe_pedidos: boolean; aceita_cancelamento: boolean }>(
    'select ativo, recebe_pedidos, aceita_cancelamento from integracao.conector where tenant_id = $1 and deleted_at is null',
    [tenantId],
  );
  return erpAceitaCancelamento(rows);
}
