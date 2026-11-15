/**
 * `catalogo.estoque_filial@1` × Postgres real (T-0149; RN-VEN-20, RN-CORE-39): soma por filial, fallback sem filial, RLS
 * entre tenants. Pula sem Postgres (roda no CI).
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consultaEstoqueFilial } from './estoque-filial';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n) => `0ca00000-0000-4000-8000-${String(950000 + n).padStart(12, '0')}`;
const [D1, D2, D3, D_B] = [id(1), id(2), id(3), id(4)];
const [F1, F2] = [id(31), id(32)];
const [P1, P2, P_SEM] = [id(21), id(22), id(23)];
const IDS = [D1, D2, D3, D_B, id(11), id(12), id(13), id(14)];
const impl = consultaEstoqueFilial;
describe.skipIf(semBanco())('Catálogo × Postgres: catalogo.estoque_filial@1', () => {
    let pool;
    const consultar = (tenant, entrada) => comTenant(pool, tenant, (db) => impl.executar(entrada, { db }));
    async function limpar() {
        for (const t of [A.tenantId, B.tenantId]) {
            await comTenant(pool, t, async (c) => {
                await c.query('delete from catalogo.estoque_saldo where deposito_id = any($1::uuid[])', [IDS]);
                await c.query('delete from catalogo.deposito where id = any($1::uuid[])', [IDS]);
            });
        }
    }
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
        await limpar();
        await comTenant(pool, A.tenantId, async (c) => {
            for (const [d, f, cod] of [[D1, F1, 'EF-1'], [D2, F1, 'EF-2'], [D3, F2, 'EF-3']]) {
                await c.query('insert into catalogo.deposito (id, tenant_id, codigo, nome, filial_id) values ($1, $2, $3, $3, $4)', [d, A.tenantId, cod, f]);
            }
            const s = (n, d, p, q) => c.query('insert into catalogo.estoque_saldo (id, tenant_id, deposito_id, produto_id, quantidade) values ($1, $2, $3, $4, $5)', [id(n), A.tenantId, d, p, q]);
            await s(11, D1, P1, 4);
            await s(12, D2, P1, 6.5);
            await s(13, D3, P1, 100);
            await s(14, D3, P2, 7);
        });
        await comTenant(pool, B.tenantId, async (c) => {
            await c.query("insert into catalogo.deposito (id, tenant_id, codigo, nome, filial_id) values ($1, $2, 'EF-B', 'B', $3)", [D_B, B.tenantId, F1]);
            await c.query('insert into catalogo.estoque_saldo (id, tenant_id, deposito_id, produto_id, quantidade) values ($1, $2, $3, $4, 999)', [id(15), B.tenantId, D_B, P1]);
        });
    });
    afterAll(async () => {
        await limpar();
        await comTenant(pool, B.tenantId, (c) => c.query('delete from catalogo.estoque_saldo where id = $1', [id(15)])).catch(() => undefined);
        await pool?.end();
    });
    it('RN-VEN-20: soma só os depósitos da filial; saldo só em outra filial vale 0; sem linha de saldo fica de fora', async () => {
        const r = await consultar(A.tenantId, { produto_ids: [P1, P2, P_SEM], filial_id: F1 });
        expect(r.itens).toEqual([{ produto_id: P1, quantidade_base: 10.5 }, { produto_id: P2, quantidade_base: 0 }]);
    });
    it('RN-VEN-20: filial sem depósito num tenant com filiais tem disponível 0; o saldo de outro tenant nunca entra (RLS)', async () => {
        const r = await consultar(A.tenantId, { produto_ids: [P1], filial_id: id(99) });
        expect(r.itens).toEqual([{ produto_id: P1, quantidade_base: 0 }]);
        const b = await consultar(B.tenantId, { produto_ids: [P1], filial_id: F1 });
        expect(b.itens).toEqual([{ produto_id: P1, quantidade_base: 999 }]);
    });
    it('RN-CORE-39: pedido sem filial soma todos os depósitos do tenant', async () => {
        const r = await consultar(A.tenantId, { produto_ids: [P1] });
        expect(r.itens).toEqual([{ produto_id: P1, quantidade_base: 110.5 }]);
    });
});
