/**
 * Faixas das curvas ABC × Postgres real (fixture dois-tenants, RLS): RN-CORE-49, RN-AUD-01.
 * Dois tenants isolados; PUT repetido sem auditoria nova; 422 sem gravar; o pull do aparelho leva as 3 chaves. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PARAMETROS_CURVA_ABC_PADRAO } from '../domain';
import { rotasDeParametrosCurvaAbc } from './parametros-curvas-abc';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const F = { a_min_pct: 20, b_min_pct: 0 };
const valido = { faturamento: { a_min_pct: 30, b_min_pct: 5 }, volume: F, frequencia: { a_min_pct: 10, b_min_pct: -20 } };
const CHAVES = ['cliente.curva_abc.faturamento', 'cliente.curva_abc.volume', 'cliente.curva_abc.frequencia'];
describe.skipIf(semBanco())('Core RN-CORE-49 × Postgres: faixas das curvas ABC', () => {
    let pool;
    const usuario = (id, tenant) => ({ id, tenant_id: tenant, perfil: 'admin' });
    const adminA = usuario(A.usuarios.admin, A.tenantId);
    const adminB = usuario(B.usuarios.admin, B.tenantId);
    const ctx = (u, requestId) => ({
        usuario: u,
        requestId,
        agora: () => new Date(),
        fuso: () => 'America/Manaus',
        comTenant: (fn) => comTenant(pool, u.tenant_id, (c) => fn(c)),
    });
    const chamar = (metodo, u, requestId, corpo) => {
        const r = rotasDeParametrosCurvaAbc.find((x) => x.metodo === metodo);
        return r.executar({ ...ctx(u, requestId), corpo: r.corpo ? r.corpo.parse(corpo ?? {}) : {}, query: {}, params: {} });
    };
    const linhas = (tenant) => comTenant(pool, tenant, async (c) => (await c.query("select chave, valor from plataforma.parametro where modulo = 'core' and chave = any($1::text[]) and deleted_at is null order by chave", [CHAVES])).rows);
    const auditorias = (tenant, requestId) => comTenant(pool, tenant, async (c) => (await c.query("select antes, depois from plataforma.auditoria where acao = 'parametro.curva_abc' and request_id = $1", [requestId])).rows);
    const limpar = async () => {
        for (const t of [A.tenantId, B.tenantId])
            await comTenant(pool, t, (c) => c.query("delete from plataforma.parametro where modulo = 'core' and chave = any($1::text[])", [CHAVES]));
    };
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
    it('RN-CORE-49: sem linha o GET devolve o padrão, nos dois tenants', async () => {
        expect(await chamar('GET', adminA, 'c-padrao-a')).toEqual(PARAMETROS_CURVA_ABC_PADRAO);
        expect(await chamar('GET', adminB, 'c-padrao-b')).toEqual(PARAMETROS_CURVA_ABC_PADRAO);
    });
    it('RN-CORE-49 / RN-AUD-01: o tenant A grava (auditado) e o B segue no padrão; repetir não audita de novo', async () => {
        expect(await chamar('PUT', adminA, 'c-grava-a', valido)).toEqual(valido);
        expect(await chamar('GET', adminB, 'c-get-b')).toEqual(PARAMETROS_CURVA_ABC_PADRAO);
        expect(await linhas(B.tenantId)).toEqual([]);
        expect(await linhas(A.tenantId)).toHaveLength(3);
        expect(await auditorias(A.tenantId, 'c-grava-a')).toEqual([{ antes: PARAMETROS_CURVA_ABC_PADRAO, depois: valido }]);
        await chamar('PUT', adminA, 'c-repete-a', valido);
        expect(await auditorias(A.tenantId, 'c-repete-a')).toEqual([]);
    });
    it('RN-CORE-49: A ≤ B vira 422 e nada é gravado', async () => {
        await expect(chamar('PUT', adminB, 'c-422-b', { ...valido, volume: { a_min_pct: 0, b_min_pct: 10 } })).rejects.toMatchObject({ status: 422 });
        expect(await linhas(B.tenantId)).toEqual([]);
    });
});
