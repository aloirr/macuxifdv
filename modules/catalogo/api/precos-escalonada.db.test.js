/**
 * Consulta `catalogo.precos_cliente@1` com faixas (RN-VEN-23, T-0089) × Postgres real (fixture dois-tenants, papel macuxi_app, RLS).
 * Cobre: só faixas vigentes, tabela do cliente vence a geral na mesma (medida, mínimo), sem faixa quando não há preço visível
 * (RN-CAT-05/06) e tenant isolado. Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrecosClienteEntradaSchema } from '../contracts';
import { consultaPrecosCliente } from './consultas';
import { consultarFiliaisDeTeste } from './filiais-teste';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n) => `0ca00000-0000-4000-8000-0000000e${String(n).padStart(4, '0')}`;
const TAB = id(1);
const TAB_B = id(2);
const P_COM = id(11); // com preço na tabela e com faixas
const P_SEM_PRECO = id(12); // sem preço na tabela: faixa existe, mas não aparece
const CL = id(101);
const CL_SEM_TABELA = id(102);
const AGORA = new Date('2026-11-10T15:00:00.000Z');
const IDS = Array.from({ length: 50 }, (_, i) => id(i + 1));
describe.skipIf(semBanco())('Catálogo × Postgres: precos_cliente@1 com faixas da escalonada (RN-VEN-23)', () => {
    let pool;
    const consultar = (tenant, perfil, cliente, produtos) => comTenant(pool, tenant, (c) => consultaPrecosCliente.executar(PrecosClienteEntradaSchema.parse({ cliente_id: cliente, produto_ids: produtos, em: AGORA.toISOString() }), {
        db: c,
        usuario: { perfil },
        // core.filiais@1 simulada (T-0149): todo cliente na filial padrão do tenant
        consultar: consultarFiliaisDeTeste(c),
        agora: () => AGORA,
        fuso: () => 'America/Manaus',
        parametros: () => ({}),
    }));
    async function limpar() {
        for (const t of [A.tenantId, B.tenantId]) {
            await comTenant(pool, t, async (c) => {
                await c.query('delete from catalogo.tabela_escalonada where id = any($1::uuid[]) or tabela_preco_id = any($1::uuid[])', [IDS]);
                await c.query('delete from catalogo.cliente_tabela_preco where tabela_preco_id = any($1::uuid[])', [IDS]);
                await c.query('delete from catalogo.tabela_preco_item where tabela_preco_id = any($1::uuid[])', [IDS]);
                await c.query('delete from catalogo.tabela_preco where id = any($1::uuid[])', [IDS]);
            });
        }
    }
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
        await limpar();
        await comTenant(pool, A.tenantId, async (c) => {
            await c.query("insert into catalogo.tabela_preco (id, tenant_id, codigo, nome) values ($1, $2, 'T89-ATACADO', 'T89 Atacado')", [TAB, A.tenantId]);
            await c.query('insert into catalogo.tabela_preco_item (id, tenant_id, tabela_preco_id, produto_id, preco_cents) values ($1, $2, $3, $4, 1000)', [id(20), A.tenantId, TAB, P_COM]);
            await c.query('insert into catalogo.cliente_tabela_preco (id, tenant_id, cliente_id, tabela_preco_id) values ($1, $2, $3, $4)', [id(21), A.tenantId, CL, TAB]);
            const faixa = (n, produto, medida, min, preco, ini, fim, tabela) => c.query(`insert into catalogo.tabela_escalonada (id, tenant_id, produto_id, medida, quantidade_minima, preco_unidade_cents, vigencia_inicio, vigencia_fim, tabela_preco_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [id(30 + n), A.tenantId, produto, medida, min, preco, ini, fim, tabela]);
            await faixa(1, P_COM, 'FD', 10, 900, '2026-01-01', null, null); // geral
            await faixa(2, P_COM, 'FD', 10, 850, '2026-01-01', null, TAB); // da tabela: vence a geral na mesma (medida, mínimo)
            await faixa(3, P_COM, null, 5, 950, '2026-01-01', '2026-11-10', null); // fim = hoje (fechada nas duas pontas): vigente
            await faixa(4, P_COM, null, 20, 800, '2026-01-01', '2026-11-09', null); // venceu ontem: fora
            await faixa(5, P_COM, null, 30, 700, '2026-11-11', null, null); // começa amanhã: fora
            await faixa(6, P_SEM_PRECO, null, 5, 100, '2026-01-01', null, null); // produto sem preço na tabela
        });
        await comTenant(pool, B.tenantId, async (c) => {
            await c.query("insert into catalogo.tabela_preco (id, tenant_id, codigo, nome) values ($1, $2, 'T89-B', 'B')", [TAB_B, B.tenantId]);
            await c.query('insert into catalogo.tabela_escalonada (id, tenant_id, produto_id, medida, quantidade_minima, preco_unidade_cents, vigencia_inicio) values ($1, $2, $3, null, 2, 1, \'2026-01-01\')', [id(40), B.tenantId, P_COM]);
        });
    });
    afterAll(async () => {
        await limpar();
        await pool?.end();
    });
    it('RN-VEN-23: devolve só as faixas vigentes; a da tabela do cliente vence a geral na mesma (medida, mínimo)', async () => {
        const r = await consultar(A.tenantId, 'vendedor', CL, [P_COM]);
        const f = r.itens[0].faixas ?? [];
        expect(f).toHaveLength(2);
        expect(f).toEqual(expect.arrayContaining([
            { medida: 'FD', quantidade_minima: 10, preco_unidade_cents: 850 },
            { medida: null, quantidade_minima: 5, preco_unidade_cents: 950 },
        ]));
    });
    it('RN-CAT-06: produto sem preço na tabela do cliente não leva faixa, e cliente sem tabela não recebe faixa nenhuma', async () => {
        const r = await consultar(A.tenantId, 'vendedor', CL, [P_COM, P_SEM_PRECO]);
        expect(r.itens[1]).toMatchObject({ produto_id: P_SEM_PRECO, preco_cents: null });
        expect(r.itens[1].faixas ?? []).toEqual([]);
        const sem = await consultar(A.tenantId, 'vendedor', CL_SEM_TABELA, [P_COM]);
        expect(sem.itens[0].faixas ?? []).toEqual([]);
    });
    it('RN-CAT-05: promotor (sem direito a ver preço) não recebe faixas', async () => {
        const r = await consultar(A.tenantId, 'promotor', CL, [P_COM]);
        expect(r.itens[0].preco_cents).toBeNull();
        expect(r.itens[0].faixas ?? []).toEqual([]);
    });
    it('RN-CORE-05: a faixa de B não aparece em A (mesmo produto), e A não aparece em B', async () => {
        const a = await consultar(A.tenantId, 'vendedor', CL, [P_COM]);
        expect((a.itens[0].faixas ?? []).some((x) => x.preco_unidade_cents === 1)).toBe(false);
        const b = await consultar(B.tenantId, 'vendedor', CL, [P_COM]);
        expect(b.itens[0].faixas ?? []).toEqual([]);
    });
});
