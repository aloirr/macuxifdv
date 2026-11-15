/**
 * Apoio dos testes de banco do Core (`*.db.test.ts`, Postgres real só no CI). Não é importado pelo código de produção.
 */
import { comTenant } from '@macuxi/db/teste';
import type pg from 'pg';

/**
 * Filial padrão viva do tenant (RN-CORE-39). O tenant A da fixture tem 2 filiais, então a filial de cadastro é obrigatória
 * para quem é criado: os testes leem a padrão aqui e a mandam no cadastro (id) ou na coluna `filial` do CSV (código).
 */
export async function filialPadraoDoTenant(pool: pg.Pool, tenantId: string): Promise<{ id: string; codigo: string }> {
  return comTenant(pool, tenantId, async (c) => (await c.query<{ id: string; codigo: string }>('select id, codigo from core.filial where padrao and deleted_at is null')).rows[0]!);
}

/**
 * RN-CORE-05: ids que vieram do outro tenant (o esperado é `[]`). Os arquivos de banco do pacote dividem o mesmo banco e alguns
 * criam usuários (ex.: `usuarios.db.test`), então o isolamento se confere contra os ids do outro tenant, não contra a lista fixa da fixture.
 */
export const idsDoOutroTenant = (ids: readonly string[], doOutro: Record<string, string>): string[] => {
  const outro = new Set(Object.values(doOutro));
  return ids.filter((id) => outro.has(id));
};
