/**
 * Positivação acumulada do mês × Postgres real (0023; RN-CORE-20, RN-CORE-26; T-0073): `gravarPositivadosDoDia` grava lista e contagem
 * juntas só com clientes do próprio tenant e `core.positivacao_do_mes` conta cada cliente uma vez no mês. Usa o mês 2030-02 (sem dado
 * da fixture) e o papel de aplicação sob RLS. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gravarPositivadosDoDia } from './indicador-diario';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const V = A.usuarios.vendedor1;
const C = A.clientes;
describe.skipIf(semBanco())('Core T-0073 × Postgres: positivados do dia e do mês', () => {
    let pool;
    const dentro = (tenant, fn) => comTenant(pool, tenant, (c) => fn(c));
    const mes = (hoje) => dentro(A.tenantId, async (db) => (await db.query("select ate_ontem, hoje, mes from core.positivacao_do_mes($1::uuid[], '2030-02', $2::date)", [[V], hoje])).rows[0]);
    const limpar = () => dentro(A.tenantId, (db) => db.query("delete from core.indicador_diario where data >= '2030-02-01' and data < '2030-03-01'"));
    const grava = (dia, clienteIds) => dentro(A.tenantId, (db) => gravarPositivadosDoDia(db, { usuarioId: V, dia, clienteIds }));
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
        await limpar();
    });
    afterAll(async () => {
        if (pool) {
            await limpar();
            await pool.end();
        }
    });
    it('RN-CORE-26: sem nenhuma lista gravada o mês não tem fonte (nulos)', async () => {
        expect(await mes('2030-02-10')).toEqual({ ate_ontem: null, hoje: null, mes: null });
    });
    it('RN-CORE-20: cliente que comprou em dois dias conta uma vez no mês; novos de hoje separados de até ontem', async () => {
        expect(await grava('2030-02-08', [C.c1, C.c2, C.c1])).toBe(2);
        expect(await grava('2030-02-10', [C.c2, C.c3])).toBe(2);
        expect(await mes('2030-02-10')).toEqual({ ate_ontem: 2, hoje: 1, mes: 3 });
    });
    it('RN-CORE-26: regravar o dia sem o cliente (cancelamento) tira ele da conta; repetir a mesma lista não muda a linha', async () => {
        const lido = () => dentro(A.tenantId, async (db) => (await db.query("select updated_at from core.indicador_diario where usuario_id = $1 and data = '2030-02-10'", [V])).rows[0]);
        const antes = await lido();
        expect(await grava('2030-02-10', [C.c2, C.c3])).toBe(2);
        expect((await lido()).updated_at.getTime()).toBe(antes.updated_at.getTime());
        expect(await grava('2030-02-10', [C.c2])).toBe(1);
        expect(await mes('2030-02-10')).toEqual({ ate_ontem: 2, hoje: 0, mes: 2 });
    });
    it('RN-CORE-20: cliente de outro tenant é descartado na gravação (a lista só leva ids do próprio tenant)', async () => {
        expect(await grava('2030-02-12', [C.c1, B.clientes.c1])).toBe(1);
        expect(await mes('2030-02-12')).toMatchObject({ mes: 2 });
    });
});
