/**
 * Pull de `produto_relacao` e consulta `catalogo.sugestoes_pedido@1` × Postgres de testes (5434; fixture dois-tenants,
 * papel macuxi_app, RLS) — T-0071 (migração 0020). Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProdutoRelacaoSyncSchema, SugestoesPedidoEntradaSchema } from '../contracts';
import { consultaSugestoesPedido } from './sugestoes';
import { consultarFiliaisDeTeste } from './filiais-teste';
import { provedoresSyncCatalogo } from './sync';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n) => `0ca71000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IDS = Array.from({ length: 80 }, (_, i) => id(i + 1));
const TAB = id(1);
const CL = id(101);
const CL_SEM_TABELA = id(102);
const [CAFE, AGUA, ACUCAR, FILTRO, SEM_PRECO, SEM_ESTOQUE, AGUA15] = [11, 12, 13, 14, 15, 16, 17].map(id);
const DEP = id(60);
const AGORA = new Date('2026-11-03T12:00:00.000Z');
describe.skipIf(semBanco())('Catálogo × Postgres: produto_relacao e catalogo.sugestoes_pedido@1', () => {
    let pool;
    const consultar = (tenant, perfil, entrada, parametros = {}) => comTenant(pool, tenant, (c) => consultaSugestoesPedido.executar(SugestoesPedidoEntradaSchema.parse(entrada), {
        db: c,
        usuario: { perfil },
        // core.filiais@1 simulada (T-0149): todo cliente na filial padrão do tenant
        consultar: consultarFiliaisDeTeste(c),
        agora: () => AGORA,
        parametros: () => parametros,
    }));
    const ctxPull = (tenant, perfil, parametros = {}) => ({
        usuario: { perfil, tenant_id: tenant },
        // T-0149: o pull de preço e estoque pergunta as filiais da carteira ao Core (core.filiais@1); aqui, todas
        comTenant: (fn) => comTenant(pool, tenant, (c) => fn(c, { consultar: consultarFiliaisDeTeste(c, { daCarteira: null }) })),
        carteira: async () => 'tenant',
        parametros: () => parametros,
    });
    const pedido = () => ({ ate: '2099-01-01T00:00:00.000Z', desde: null, limite: 100 });
    const puxar = (ctx) => provedoresSyncCatalogo.find((p) => p.entidade.nome === 'produto_relacao').puxar(ctx, pedido());
    async function limpar() {
        for (const t of [A.tenantId, B.tenantId]) {
            await comTenant(pool, t, async (c) => {
                await c.query('delete from catalogo.produto_relacao where id = any($1::uuid[])', [IDS]);
                await c.query('delete from catalogo.estoque_saldo where id = any($1::uuid[])', [IDS]);
                await c.query('delete from catalogo.deposito where id = any($1::uuid[])', [IDS]);
                await c.query('delete from catalogo.cliente_tabela_preco where id = any($1::uuid[])', [IDS]);
                await c.query('delete from catalogo.tabela_preco_item where id = any($1::uuid[])', [IDS]);
                await c.query('delete from catalogo.tabela_preco where id = any($1::uuid[])', [IDS]);
            });
        }
    }
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
        await limpar();
        await comTenant(pool, A.tenantId, async (c) => {
            await c.query("insert into catalogo.tabela_preco (id, tenant_id, codigo, nome) values ($1, $2, 'T71-TAB', 'T71')", [TAB, A.tenantId]);
            await c.query('insert into catalogo.cliente_tabela_preco (id, tenant_id, cliente_id, tabela_preco_id) values ($1, $2, $3, $4)', [id(2), A.tenantId, CL, TAB]);
            const item = (n, produto, cents, unidade = null) => c.query('insert into catalogo.tabela_preco_item (id, tenant_id, tabela_preco_id, produto_id, preco_cents, unidade) values ($1, $2, $3, $4, $5, $6)', [id(n), A.tenantId, TAB, produto, cents, unidade]);
            await item(3, ACUCAR, 499);
            await item(4, ACUCAR, 5000, 'CX');
            await item(5, FILTRO, 549);
            await item(6, SEM_ESTOQUE, 100);
            await item(7, AGUA15, 1990);
            await c.query("insert into catalogo.deposito (id, tenant_id, codigo, nome) values ($1, $2, 'T71-D', 'T71')", [DEP, A.tenantId]);
            const saldo = (n, produto, q) => c.query('insert into catalogo.estoque_saldo (id, tenant_id, deposito_id, produto_id, quantidade) values ($1, $2, $3, $4, $5)', [id(n), A.tenantId, DEP, produto, q]);
            await saldo(20, ACUCAR, 40);
            await saldo(21, FILTRO, 5);
            await saldo(22, SEM_PRECO, 9);
            await saldo(23, SEM_ESTOQUE, 0);
            await saldo(24, AGUA15, 3);
            const rel = (n, de, para, tipo, ordem) => c.query('insert into catalogo.produto_relacao (id, tenant_id, produto_id, relacionado_id, tipo, ordem) values ($1, $2, $3, $4, $5, $6)', [id(n), A.tenantId, de, para, tipo, ordem]);
            await rel(40, CAFE, FILTRO, 'complementar', 2);
            await rel(41, CAFE, ACUCAR, 'complementar', 1);
            await rel(42, CAFE, SEM_PRECO, 'complementar', 3);
            await rel(43, CAFE, SEM_ESTOQUE, 'complementar', 4);
            await rel(44, AGUA, AGUA15, 'superior', 1);
            await rel(45, AGUA, CAFE, 'substituto', 1);
        });
        await comTenant(pool, B.tenantId, async (c) => {
            await c.query('insert into catalogo.produto_relacao (id, tenant_id, produto_id, relacionado_id, tipo, ordem) values ($1, $2, $3, $4, $5, $6)', [id(50), B.tenantId, CAFE, AGUA15, 'complementar', 1]);
        });
    });
    afterAll(async () => {
        await limpar();
        await pool?.end();
    });
    const entrada = (produtos, cliente = CL) => ({ cliente_id: cliente, produto_ids: produtos, em: AGORA.toISOString() });
    it('pull: entrega as relações do tenant (com o formato do contrato) e nunca as de outro tenant', async () => {
        const linhas = await puxar(ctxPull(A.tenantId, 'vendedor'));
        const minhas = linhas.filter((l) => IDS.includes(l.id));
        expect(minhas).toHaveLength(6);
        for (const l of minhas)
            expect(() => ProdutoRelacaoSyncSchema.parse(l)).not.toThrow();
        expect(linhas.some((l) => l.id === id(50))).toBe(false);
    });
    it('RF-CAT-03: complementares na ordem da relação, sem preço e sem estoque ficam de fora; superior da água; preço da UN', async () => {
        const r = await consultar(A.tenantId, 'vendedor', entrada([CAFE, AGUA]));
        expect(r.complementares.map((s) => [s.produto_id, s.preco_cents, s.origem_produto_id])).toEqual([
            [ACUCAR, 499, CAFE],
            [FILTRO, 549, CAFE],
        ]);
        expect(r.superiores.map((s) => [s.produto_id, s.preco_cents])).toEqual([[AGUA15, 1990]]);
    });
    it('RF-CAT-03: o que já está no pedido não é sugerido', async () => {
        const r = await consultar(A.tenantId, 'vendedor', entrada([CAFE, ACUCAR]));
        expect(r.complementares.map((s) => s.produto_id)).toEqual([FILTRO]);
    });
    it('RN-CAT-06: cliente sem tabela não recebe sugestões', async () => {
        expect(await consultar(A.tenantId, 'vendedor', entrada([CAFE], CL_SEM_TABELA))).toEqual({ complementares: [], superiores: [] });
    });
    it('RN-CAT-05: promotor recebe saída vazia (e o outro tenant não enxerga as relações do A)', async () => {
        expect(await consultar(A.tenantId, 'promotor', entrada([CAFE]))).toEqual({ complementares: [], superiores: [] });
        expect(await consultar(B.tenantId, 'vendedor', entrada([CAFE]))).toEqual({ complementares: [], superiores: [] });
    });
});
