/**
 * Apoio dos testes de banco do Core (`*.db.test.ts`, Postgres real só no CI). Não é importado pelo código de produção.
 */
import { comTenant } from '@macuxi/db/teste';
/** A filial padrão viva do tenant em vigor (RLS); serve também dentro de uma transação já aberta. */
export const SQL_FILIAL_PADRAO = 'select id, codigo from core.filial where padrao and deleted_at is null';
/**
 * Filial padrão viva do tenant (RN-CORE-39). O tenant A da fixture tem 2 filiais, então a filial de cadastro é obrigatória
 * para quem é criado: os testes leem a padrão aqui e a mandam no cadastro (id) ou na coluna `filial` do CSV (código).
 */
export async function filialPadraoDoTenant(pool, tenantId) {
    return comTenant(pool, tenantId, async (c) => (await c.query(SQL_FILIAL_PADRAO)).rows[0]);
}
/**
 * RN-CORE-05: ids que vieram do outro tenant (o esperado é `[]`). Os arquivos de banco do pacote dividem o mesmo banco e alguns
 * criam usuários (ex.: `usuarios.db.test`), então o isolamento se confere contra os ids do outro tenant, não contra a lista fixa da fixture.
 */
export const idsDoOutroTenant = (ids, doOutro) => {
    const outro = new Set(Object.values(doOutro));
    return ids.filter((id) => outro.has(id));
};
