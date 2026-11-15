/**
 * Pull de deposito e estoque_saldo × Postgres real (T-0071-P4): o aparelho precisa do saldo para as sugestões do pedido
 * offline (RN-CAT-06) e para a ficha sem sinal. Escopo tenant (RN-CORE-05), trava de perfil (RN-CAT-05), cursor
 * (updated_at, id) e linhas válidas no contrato. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DepositoSyncSchema, EstoqueSaldoSyncSchema } from '../contracts';
import { consultarFiliaisDeTeste } from './filiais-teste';
import { provedoresSyncCatalogo } from './sync';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n) => `0ca00000-0000-4000-8000-${String(900000 + n).padStart(12, '0')}`;
const DEP_A = id(1);
const DEP_B = id(2);
const S1 = id(11);
const S2 = id(12);
const S_B = id(13);
const S_REM = id(14);
const P1 = id(21);
const P2 = id(22);
const IDS = [DEP_A, DEP_B, S1, S2, S_B, S_REM];
describe.skipIf(semBanco())('Catálogo × Postgres: pull de deposito e estoque_saldo (T-0071-P4)', () => {
    let pool;
    const ctx = (tenant, perfil, parametros = {}) => ({
        usuario: { perfil, tenant_id: tenant },
        // T-0149: o pull de preço e estoque pergunta as filiais da carteira ao Core (core.filiais@1); aqui, todas
        comTenant: (fn) => comTenant(pool, tenant, (c) => fn(c, { consultar: consultarFiliaisDeTeste(c, { daCarteira: null }) })),
        carteira: async () => 'tenant',
        parametros: () => parametros,
    });
    const pedido = (extra = {}) => ({ ate: '2099-01-01T00:00:00.000Z', desde: null, limite: 100, ...extra });
    const puxar = (nome, c, p = pedido()) => provedoresSyncCatalogo.find((x) => x.entidade.nome === nome).puxar(c, p);
    async function limpar() {
        for (const t of [A.tenantId, B.tenantId]) {
            await comTenant(pool, t, async (c) => {
                await c.query('delete from catalogo.estoque_saldo where id = any($1::uuid[])', [IDS]);
                await c.query('delete from catalogo.deposito where id = any($1::uuid[])', [IDS]);
            });
        }
    }
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
        await limpar();
        await comTenant(pool, A.tenantId, async (c) => {
            await c.query("insert into catalogo.deposito (id, tenant_id, codigo, nome) values ($1, $2, 'T71-DEP', 'Depósito T71')", [DEP_A, A.tenantId]);
            const s = (i, p, q, erp, del = false) => c.query('insert into catalogo.estoque_saldo (id, tenant_id, deposito_id, produto_id, quantidade, atualizado_erp_em, deleted_at) values ($1, $2, $3, $4, $5, $6, $7)', [
                i, A.tenantId, DEP_A, p, q, erp, del ? '2026-11-04T00:00:00Z' : null, // hora-fixa-ok: instante fixo
            ]);
            await s(S1, P1, 12.5, '2026-11-03T10:00:00.123456Z');
            await s(S2, P2, 0, null);
            await s(S_REM, id(23), 3, null, true);
        });
        await comTenant(pool, B.tenantId, async (c) => {
            await c.query("insert into catalogo.deposito (id, tenant_id, codigo, nome) values ($1, $2, 'T71-B', 'B')", [DEP_B, B.tenantId]);
            await c.query('insert into catalogo.estoque_saldo (id, tenant_id, deposito_id, produto_id, quantidade) values ($1, $2, $3, $4, 99)', [S_B, B.tenantId, DEP_B, P1]);
        });
    });
    afterAll(async () => {
        await limpar();
        await pool?.end();
    });
    it('RN-CAT-07: o pull publica o saldo do tenant (com a hora do ERP e removidos), sem vazar o de outro tenant, e valida o contrato', async () => {
        const linhas = await puxar('estoque_saldo', ctx(A.tenantId, 'vendedor'));
        const meus = linhas.filter((l) => IDS.includes(l.id));
        expect(meus.map((l) => l.id).sort()).toEqual([S1, S2, S_REM].sort());
        expect(linhas.map((l) => l.id)).not.toContain(S_B);
        for (const l of linhas)
            EstoqueSaldoSyncSchema.parse(l);
        expect(linhas.find((l) => l.id === S1)).toMatchObject({ produto_id: P1, deposito_id: DEP_A, quantidade: 12.5, atualizado_em: '2026-11-03T10:00:00.123456Z' });
        expect(linhas.find((l) => l.id === S_REM)?.deleted_at).not.toBeNull();
        const deps = await puxar('deposito', ctx(A.tenantId, 'vendedor'));
        expect(deps.map((l) => l.id)).toContain(DEP_A);
        expect(deps.map((l) => l.id)).not.toContain(DEP_B);
        for (const l of deps)
            DepositoSyncSchema.parse(l);
    });
    it('RN-CAT-05: promotor sem o parâmetro não recebe saldo; com o parâmetro recebe', async () => {
        expect(await puxar('estoque_saldo', ctx(A.tenantId, 'promotor'))).toEqual([]);
        expect(await puxar('deposito', ctx(A.tenantId, 'promotor'))).toEqual([]);
        const com = await puxar('estoque_saldo', ctx(A.tenantId, 'promotor', { promotor_ve_preco_estoque: true }));
        expect(com.map((l) => l.id)).toContain(S1);
    });
    it('pull incremental: cursor (updated_at, id) pagina sem repetir e `updated_at >= ate` fica de fora', async () => {
        const c = ctx(A.tenantId, 'vendedor');
        const todos = await puxar('estoque_saldo', c);
        expect(todos.length).toBeGreaterThanOrEqual(3);
        const p1 = await puxar('estoque_saldo', c, pedido({ limite: 1 }));
        expect(p1).toHaveLength(1);
        const p2 = await puxar('estoque_saldo', c, pedido({ limite: 1, desde: { updated_at: p1[0].updated_at, id: p1[0].id } }));
        expect(p2[0].id).not.toBe(p1[0].id);
        expect(p2[0].id).toBe(todos[1].id);
        expect(await puxar('estoque_saldo', c, pedido({ ate: '2000-01-01T00:00:00.000Z' }))).toEqual([]);
    });
});
