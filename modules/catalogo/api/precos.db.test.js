/**
 * Pull de preço e consulta `catalogo.precos_cliente@1` × Postgres real (fixture dois-tenants, papel macuxi_app, RLS) — T-0029.
 * Cobre: isolamento entre tenants, escopo de carteira, promotor sem preço (RN-CAT-05), item fora da tabela do cliente
 * (RN-CAT-06) e vigência com limite de 7 dias (P-4). Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClienteTabelaPrecoSyncSchema, PrecosClienteEntradaSchema, TabelaPrecoItemSyncSchema, TabelaPrecoSyncSchema } from '../contracts';
import { consultaPrecosCliente } from './consultas';
import { consultarFiliaisDeTeste } from './filiais-teste';
import { provedoresSyncCatalogo } from './sync';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n) => `0ca00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TAB_VAREJO = id(1);
const TAB_ATACADO = id(2);
const TAB_INATIVA = id(3);
const TAB_B = id(4);
const P_COM = id(11); // preço no Atacado
const P_FORA = id(12); // só no Varejo
const P_VIGENCIA = id(13); // dois preços: antigo até 10 dias atrás, novo desde então
// clientes próprios do teste (a fixture já liga c1 e c2 à tabela PADRAO; cliente_id não tem FK)
const CL1 = id(101);
const CL2 = id(102);
const CL3 = id(103);
const IDS = Array.from({ length: 40 }, (_, i) => id(i + 1));
const AGORA = new Date('2026-11-01T12:00:00.000Z');
const DIA = 86_400_000;
const iso = (dias) => new Date(AGORA.getTime() + dias * DIA).toISOString();
describe.skipIf(semBanco())('Catálogo × Postgres: pull de preço e catalogo.precos_cliente@1', () => {
    let pool;
    const consultar = (tenant, perfil, entrada, parametros = {}) => comTenant(pool, tenant, (c) => consultaPrecosCliente.executar(PrecosClienteEntradaSchema.parse(entrada), {
        db: c,
        usuario: { perfil },
        // core.filiais@1 simulada (T-0149): todo cliente na filial padrão do tenant
        consultar: consultarFiliaisDeTeste(c),
        agora: () => AGORA,
        fuso: () => 'America/Manaus',
        parametros: () => parametros,
    }));
    function ctxPull(tenant, perfil, carteira, parametros = {}) {
        return {
            usuario: { perfil, tenant_id: tenant },
            // T-0149: o pull de preço e estoque pergunta as filiais da carteira ao Core (core.filiais@1); aqui, todas
            comTenant: (fn) => comTenant(pool, tenant, (c) => fn(c, { consultar: consultarFiliaisDeTeste(c, { daCarteira: null }) })),
            carteira: async () => carteira,
            parametros: () => parametros,
        };
    }
    const pedido = () => ({ ate: '2099-01-01T00:00:00.000Z', desde: null, limite: 100 });
    const puxar = (nome, ctx) => provedoresSyncCatalogo.find((p) => p.entidade.nome === nome).puxar(ctx, pedido());
    async function limpar() {
        for (const t of [A.tenantId, B.tenantId]) {
            await comTenant(pool, t, async (c) => {
                await c.query('delete from catalogo.cliente_tabela_preco where tabela_preco_id = any($1::uuid[])', [IDS]);
                await c.query('delete from catalogo.tabela_preco_item where tabela_preco_id = any($1::uuid[])', [IDS]);
                await c.query('delete from catalogo.tabela_preco where id = any($1::uuid[])', [IDS]);
            });
        }
    }
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
        await limpar();
        await comTenant(pool, A.tenantId, async (c) => {
            const tab = (i, cod, ativo = true) => c.query('insert into catalogo.tabela_preco (id, tenant_id, codigo, nome, ativo) values ($1, $2, $3, $3, $4)', [i, A.tenantId, cod, ativo]);
            await tab(TAB_VAREJO, 'T29-VAREJO');
            await tab(TAB_ATACADO, 'T29-ATACADO');
            await tab(TAB_INATIVA, 'T29-INATIVA', false);
            const item = (t, p, cents, ini, fim, n) => c.query('insert into catalogo.tabela_preco_item (id, tenant_id, tabela_preco_id, produto_id, preco_cents, vigencia_inicio, vigencia_fim) values ($1, $2, $3, $4, $5, $6, $7)', [id(20 + n), A.tenantId, t, p, cents, ini, fim]);
            await item(TAB_ATACADO, P_COM, 930, null, null, 1);
            await item(TAB_VAREJO, P_COM, 1000, null, null, 2);
            await item(TAB_VAREJO, P_FORA, 500, null, null, 3);
            await item(TAB_ATACADO, P_VIGENCIA, 800, null, iso(-10), 4);
            await item(TAB_ATACADO, P_VIGENCIA, 900, iso(-10), null, 5);
            const liga = (n, cliente, t) => c.query('insert into catalogo.cliente_tabela_preco (id, tenant_id, cliente_id, tabela_preco_id) values ($1, $2, $3, $4)', [id(30 + n), A.tenantId, cliente, t]);
            await liga(1, CL1, TAB_ATACADO);
            await liga(2, CL2, TAB_INATIVA);
        });
        await comTenant(pool, B.tenantId, async (c) => {
            await c.query("insert into catalogo.tabela_preco (id, tenant_id, codigo, nome) values ($1, $2, 'T29-B', 'B')", [TAB_B, B.tenantId]);
            await c.query('insert into catalogo.tabela_preco_item (id, tenant_id, tabela_preco_id, produto_id, preco_cents) values ($1, $2, $3, $4, 111)', [id(39), B.tenantId, TAB_B, P_COM]);
        });
    });
    afterAll(async () => {
        await limpar();
        await pool?.end();
    });
    const entrada = (produtos, cliente = CL1, em = AGORA.toISOString()) => ({ cliente_id: cliente, produto_ids: produtos, em });
    it('RN-CAT-06: preço vem da tabela do cliente, não da outra tabela do tenant', async () => {
        const r = await consultar(A.tenantId, 'vendedor', entrada([P_COM]));
        expect(r).toMatchObject({ filial_origem: 'cliente', tabela_preco_id: TAB_ATACADO, tabela_preco_nome: 'T29-ATACADO', itens: [{ produto_id: P_COM, preco_cents: 930, motivo_sem_preco: null }] });
    });
    it('RN-CAT-06: produto fora da tabela do cliente = sem preço (não cai no Varejo)', async () => {
        const r = await consultar(A.tenantId, 'vendedor', entrada([P_COM, P_FORA]));
        expect(r.itens[1]).toEqual({ produto_id: P_FORA, preco_cents: null, motivo_sem_preco: 'Sem preço para este cliente.' });
    });
    it('RN-CAT-06: cliente sem tabela, ou com tabela inativa, fica sem preço', async () => {
        for (const cliente of [CL3, CL2]) {
            const r = await consultar(A.tenantId, 'vendedor', entrada([P_COM], cliente));
            expect(r).toEqual({ tabela_preco_id: null, itens: [{ produto_id: P_COM, preco_cents: null, motivo_sem_preco: 'Sem preço para este cliente.' }] });
            expect(r).not.toHaveProperty('tabela_preco_nome');
        }
    });
    it('RN-CAT-05: promotor não recebe preço; com o parâmetro ligado recebe', async () => {
        const sem = await consultar(A.tenantId, 'promotor', entrada([P_COM]));
        expect(sem).toEqual({ tabela_preco_id: null, itens: [{ produto_id: P_COM, preco_cents: null, motivo_sem_preco: 'Preço não disponível para o seu perfil.' }] });
        expect(sem).not.toHaveProperty('tabela_preco_nome');
        const com = await consultar(A.tenantId, 'promotor', entrada([P_COM]), { promotor_ve_preco_estoque: true });
        expect(com.itens[0].preco_cents).toBe(930);
    });
    it('RN-CORE-05: nada cruza o tenant (cliente de A consultado como B não tem tabela; preço de B não aparece em A)', async () => {
        const r = await consultar(B.tenantId, 'vendedor', entrada([P_COM], CL1));
        expect(r).toMatchObject({ tabela_preco_id: null, itens: [{ preco_cents: null }] });
        const rA = await consultar(A.tenantId, 'vendedor', entrada([P_COM]));
        expect(rA.itens[0].preco_cents).toBe(930);
    });
    it('P-4: vale o preço da data informada, até 7 dias para trás; antes disso usa o limite', async () => {
        // há 10 dias o preço era 800, mas o limite é 7 dias: vale 900
        const antigo = await consultar(A.tenantId, 'vendedor', entrada([P_VIGENCIA], CL1, iso(-10)));
        expect(antigo.itens[0].preco_cents).toBe(900);
        const futuro = await consultar(A.tenantId, 'vendedor', entrada([P_VIGENCIA], CL1, iso(5)));
        expect(futuro.itens[0].preco_cents).toBe(900);
    });
    it('pull: tabela_preco, tabela_preco_item e cliente_tabela_preco do tenant, sem vazar o de B, e as linhas validam o contrato', async () => {
        const ctx = ctxPull(A.tenantId, 'vendedor', 'tenant');
        const tabelas = await puxar('tabela_preco', ctx);
        expect(tabelas.map((t) => t.id)).toEqual(expect.arrayContaining([TAB_VAREJO, TAB_ATACADO, TAB_INATIVA]));
        expect(tabelas.map((t) => t.id)).not.toContain(TAB_B);
        for (const t of tabelas)
            TabelaPrecoSyncSchema.parse(t);
        const itens = await puxar('tabela_preco_item', ctx);
        expect(itens.filter((i) => IDS.includes(i.id)).length).toBe(5);
        expect(itens.map((i) => i.id)).not.toContain(id(39));
        for (const i of itens)
            TabelaPrecoItemSyncSchema.parse(i);
        expect(itens.find((i) => i.id === id(21))).toMatchObject({ preco_cents: 930, vigencia_inicio: null });
        for (const l of await puxar('cliente_tabela_preco', ctx))
            ClienteTabelaPrecoSyncSchema.parse(l);
    });
    it('RN-CORE-04: cliente_tabela_preco respeita a carteira; carteira vazia não recebe nada', async () => {
        const so1 = await puxar('cliente_tabela_preco', ctxPull(A.tenantId, 'vendedor', new Set([CL1])));
        expect(so1.map((l) => l.cliente_id)).toEqual([CL1]);
        expect(await puxar('cliente_tabela_preco', ctxPull(A.tenantId, 'vendedor', new Set()))).toEqual([]);
        const todos = await puxar('cliente_tabela_preco', ctxPull(A.tenantId, 'analista', 'tenant'));
        expect(todos.map((l) => l.cliente_id)).toEqual(expect.arrayContaining([CL1, CL2]));
    });
    it('RN-CAT-05: o pull de preço não chega ao promotor (sem o parâmetro)', async () => {
        for (const nome of ['tabela_preco', 'tabela_preco_item', 'cliente_tabela_preco']) {
            expect(await puxar(nome, ctxPull(A.tenantId, 'promotor', 'tenant')), nome).toEqual([]);
        }
        expect((await puxar('tabela_preco_item', ctxPull(A.tenantId, 'promotor', 'tenant', { promotor_ve_preco_estoque: true }))).length).toBeGreaterThan(0);
    });
    it('pull: cursor (updated_at, id) pagina sem repetir e `updated_at >= ate` fica de fora', async () => {
        const ctx = ctxPull(A.tenantId, 'analista', 'tenant');
        const p1 = await provedoresSyncCatalogo[0].puxar(ctx, { ...pedido(), limite: 1 });
        expect(p1).toHaveLength(1);
        const p2 = await provedoresSyncCatalogo[0].puxar(ctx, { ...pedido(), limite: 1, desde: { updated_at: p1[0].updated_at, id: p1[0].id } });
        expect(p2[0].id).not.toBe(p1[0].id);
        expect(await provedoresSyncCatalogo[0].puxar(ctx, { ...pedido(), ate: '2000-01-01T00:00:00.000Z' })).toEqual([]);
    });
});
