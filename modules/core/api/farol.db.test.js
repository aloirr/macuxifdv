/**
 * Farol de clientes (RN-CORE-28; T-0081) × Postgres real (fixture dois-tenants, papel macuxi_app, RLS). Pula sem Postgres; no CI
 * (`MACUXI_PG_EXIGIR=1`) falha. O escopo vem dos serviços REAIS (`carteiraDoUsuario`, `usuariosVisiveisDoUsuario`).
 * Cobre: supervisor só vê a equipe; tenant B não aparece no A; promotor fora da carteira do farol; positivação pela lista do mês
 * (RN-CORE-20); parâmetros por tenant, PUT auditado e idempotente (2x = 1 linha de auditoria), 422 sem gravar.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FarolSchema } from '../contracts';
import { PARAMETROS_FAROL_PADRAO } from '../domain';
import { carteiraDoUsuario } from './carteira';
import { rotasDeFarol } from './farol';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const U = A.usuarios;
const C = A.clientes;
const CHAVES = ['farol.verde_ate_dias', 'farol.amarelo_ate_dias', 'farol.positivacao_verde_pct', 'farol.positivacao_amarelo_pct'];
describe.skipIf(semBanco())('Core T-0081 x Postgres: farol de clientes (RN-CORE-28)', () => {
    let pool;
    let acesso;
    const usuario = (id, perfil, tenant = A.tenantId) => ({ id, tenant_id: tenant, perfil });
    const supervisor = usuario(U.supervisor, 'supervisor');
    const gerente = usuario(U.gerente, 'gerente');
    const admin = usuario(U.admin, 'admin');
    const adminB = usuario(B.usuarios.admin, 'admin', B.tenantId);
    const ctx = (u, requestId) => ({
        usuario: u,
        requestId,
        agora: () => new Date(),
        fuso: () => 'America/Manaus',
        comTenant: (fn) => comTenant(pool, u.tenant_id, (c) => fn(c, { publicar: async () => ({}) })),
        carteira: () => carteiraDoUsuario(u, acesso),
        usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
    });
    const rota = (metodo, caminho) => rotasDeFarol.find((r) => r.metodo === metodo && r.caminho === caminho);
    const chamar = (metodo, caminho, u, requestId, extra = {}) => {
        const r = rota(metodo, caminho);
        return r.executar({ ...ctx(u, requestId), corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: r.query ? r.query.parse(extra.query ?? {}) : {}, params: {} });
    };
    const farol = async (u, query = {}) => FarolSchema.parse(await chamar('GET', 'farol', u, 'req-farol', { query }));
    const linhasParametro = (tenant) => comTenant(pool, tenant, async (c) => (await c.query("select chave, valor from plataforma.parametro where modulo = 'core' and chave = any($1::text[]) and deleted_at is null order by chave", [CHAVES])).rows);
    const auditorias = (tenant, requestId) => comTenant(pool, tenant, async (c) => (await c.query("select usuario_id, antes, depois from plataforma.auditoria where acao = 'parametro.farol' and request_id = $1", [requestId])).rows);
    const limpar = async () => {
        for (const t of [A.tenantId, B.tenantId])
            await comTenant(pool, t, (c) => c.query("delete from plataforma.parametro where modulo = 'core' and chave = any($1::text[])", [CHAVES]));
    };
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
        acesso = {
            comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c)),
            semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
        };
        await limpar();
    });
    afterAll(async () => {
        if (pool) {
            await limpar();
            await pool.end();
        }
    });
    it('RN-CORE-04 / RN-CORE-28: o supervisor só vê clientes e vendedores da equipe; o gerente e o admin veem o tenant; o promotor não entra no farol', async () => {
        const sup = await farol(supervisor);
        expect(sup.clientes.map((c) => c.cliente_id).sort()).toEqual([C.c1, C.c3].sort());
        expect(sup.vendedores.map((v) => v.usuario_id)).toEqual([U.vendedor1]);
        expect(sup.clientes.every((c) => c.usuario_id === U.vendedor1)).toBe(true);
        for (const u of [gerente, admin]) {
            const f = await farol(u);
            expect(f.clientes.map((c) => c.cliente_id)).toEqual(expect.arrayContaining([C.c1, C.c2, C.c3]));
            expect(f.vendedores.map((v) => v.usuario_id)).not.toContain(U.promotor);
            expect(f.resumo.carteira).toBeLessThanOrEqual(f.clientes.length);
        }
    });
    it('RN-CORE-04: vendedor fora do escopo do supervisor devolve lista vazia, nunca 403', async () => {
        const f = await farol(supervisor, { usuario_id: U.vendedor2 });
        expect(f.clientes).toEqual([]);
        expect(f.vendedores).toEqual([]);
        expect(f.resumo.carteira).toBe(0);
    });
    it('RN-CORE-05: o tenant B só enxerga o que é dele e nenhum cliente do A aparece', async () => {
        const f = await farol(adminB);
        const idsA = Object.values(C);
        expect(f.clientes.every((c) => !idsA.includes(c.cliente_id))).toBe(true);
        expect(f.vendedores.every((v) => v.usuario_id !== U.vendedor1)).toBe(true);
    });
    it('RN-CORE-28: dias sem compra e cor batem com o histórico de compras do cliente (mesma fonte do Cliente 360)', async () => {
        const f = await farol(admin);
        for (const c of f.clientes) {
            if (c.dias_sem_compra === null)
                expect(c.cor).toBe(c.positivado_mes ? 'verde' : 'sem_compra');
            else if (!c.positivado_mes)
                expect(c.cor).toBe(c.dias_sem_compra <= 30 ? 'verde' : c.dias_sem_compra <= 45 ? 'amarelo' : 'vermelho');
        }
    });
    it('RN-CORE-28: sem linha o GET devolve o padrão nos dois tenants', async () => {
        expect(await chamar('GET', 'parametros/farol', admin, 'r-padrao-a')).toEqual(PARAMETROS_FAROL_PADRAO);
        expect(await chamar('GET', 'parametros/farol', adminB, 'r-padrao-b')).toEqual(PARAMETROS_FAROL_PADRAO);
    });
    it('RN-CORE-28 / RN-AUD-01: o A grava (auditado antes/depois), o B segue no padrão e o farol do A usa as faixas novas', async () => {
        const novo = { verde_ate_dias: 10, amarelo_ate_dias: 20, positivacao_verde_pct: 80, positivacao_amarelo_pct: 40 };
        expect(await chamar('PUT', 'parametros/farol', admin, 'r-grava-a', { corpo: novo })).toEqual(novo);
        expect(await chamar('GET', 'parametros/farol', adminB, 'r-get-b')).toEqual(PARAMETROS_FAROL_PADRAO);
        expect(await linhasParametro(B.tenantId)).toEqual([]);
        const aud = await auditorias(A.tenantId, 'r-grava-a');
        expect(aud).toHaveLength(1);
        expect(aud[0]).toMatchObject({ usuario_id: U.admin, antes: PARAMETROS_FAROL_PADRAO, depois: novo });
        expect((await farol(admin)).parametros).toEqual(novo);
        expect((await farol(adminB)).parametros).toEqual(PARAMETROS_FAROL_PADRAO);
    });
    it('RN-AUD-01: PUT repetido não audita de novo (2x = 1 linha de auditoria)', async () => {
        const novo = { verde_ate_dias: 10, amarelo_ate_dias: 20, positivacao_verde_pct: 80, positivacao_amarelo_pct: 40 };
        await chamar('PUT', 'parametros/farol', admin, 'r-repete-a', { corpo: novo });
        expect(await auditorias(A.tenantId, 'r-repete-a')).toEqual([]);
        expect(await linhasParametro(A.tenantId)).toHaveLength(4);
    });
    it('RN-CORE-28: PUT incoerente vira 422 e não grava nem audita', async () => {
        const antes = await linhasParametro(A.tenantId);
        const e = await chamar('PUT', 'parametros/farol', admin, 'r-invalido', { corpo: { verde_ate_dias: 50, amarelo_ate_dias: 40, positivacao_verde_pct: 80, positivacao_amarelo_pct: 40 } }).catch((x) => x);
        expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-28' });
        expect(await linhasParametro(A.tenantId)).toEqual(antes);
        expect(await auditorias(A.tenantId, 'r-invalido')).toEqual([]);
    });
});
