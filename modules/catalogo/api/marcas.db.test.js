/**
 * T-0113 × Postgres real (fixture dois-tenants, RLS): cadastro de marcas concorrentes do Catálogo (RN-CAT-13, ADR 0034, 0045).
 * Cada caso roda numa transação desfeita no fim. Cobre a rota (criar, renomear com retrato nas referências, inativar com
 * lápide no sync, nome repetido), a consulta `catalogo.marcas@1` e o isolamento por tenant. Pula sem Postgres.
 */
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { manifest } from '../manifest';
import { moduloApi } from './index';
import { criarRepositorioPostgres } from './repositorio-postgres';
import { criarRotasCatalogo } from './rotas';
import { sqlPullPreco } from './sync';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const M1 = '0ca00000-0000-4000-8000-0000000000c1';
const M2 = '0ca00000-0000-4000-8000-0000000000c2';
const PROD = '0ca00000-0000-4000-8000-0000000000c9';
describe('T-0113: manifesto e moduloApi oferecem catalogo.marcas@1 e o provedor marca_concorrente', () => {
    it('RN-CAT-13: a consulta, o evento, a entidade e a ação estão no manifesto e ligados no moduloApi', () => {
        expect(manifest.ofereceConsultas).toContain('catalogo.marcas@1');
        expect(manifest.publica).toContain('catalogo.marca_concorrente.alterada@1');
        expect(manifest.sync).toContain('marca_concorrente');
        expect(manifest.acoes['marca.gerenciar']?.perfis).toEqual(['analista', 'admin']);
        expect(moduloApi.consultas?.map((c) => c.consulta.nome)).toContain('catalogo.marcas@1');
        expect(moduloApi.sync?.map((p) => p.entidade.nome)).toContain('marca_concorrente');
        expect(manifest.usaConsultasOpcionais ?? []).not.toContain('promotor.concorrentes@1');
    });
});
describe.skipIf(semBanco())('Catálogo T-0113 × Postgres: marcas concorrentes', () => {
    let pool;
    beforeAll(() => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
    });
    afterAll(async () => {
        await pool.end();
    });
    async function emTransacao(tenant, fn) {
        const c = await pool.connect();
        try {
            await c.query('begin');
            await definirTenant(c, tenant);
            const eventos = [];
            const tx = {
                publicar: vi.fn(async (def, payload) => {
                    eventos.push({ nome: def.nome, payload });
                    return {};
                }),
                auditar: vi.fn(async () => undefined),
                consultar: vi.fn(),
            };
            const rotas = criarRotasCatalogo({ repositorio: criarRepositorioPostgres() });
            const chamar = async (metodo, caminho, e = {}) => {
                const rota = rotas.find((r) => r.metodo === metodo && r.caminho === caminho);
                const ctx = {
                    usuario: { id: 'u', tenant_id: tenant, perfil: 'analista', modulos: ['core', 'catalogo'] },
                    agora: () => new Date('2026-11-08T12:00:00Z'),
                    fuso: () => 'America/Manaus',
                    parametros: () => ({}),
                    comTenant: async (fn2) => fn2(c, tx),
                    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
                    corpo: rota.corpo ? rota.corpo.parse(e.corpo) : {},
                    query: rota.query ? rota.query.parse(e.query ?? {}) : {},
                    params: rota.params ? rota.params.parse(e.params ?? {}) : {},
                };
                return (await rota.executar(ctx));
            };
            const q = async (sql, v = []) => (await c.query(sql, v)).rows;
            await fn({ chamar, q, eventos, db: c });
        }
        finally {
            await c.query('rollback').catch(() => undefined);
            c.release();
        }
    }
    it('RN-CAT-13: criar grava a marca do tenant e publica "criada"; repetir o mesmo id não duplica', async () => {
        await emTransacao(A.tenantId, async (t) => {
            expect(await t.chamar('POST', 'marcas', { corpo: { id: M1, nome: 'Freiomax Teste', external_id: 'MC-T113' } })).toEqual({ id: M1, criado: true });
            expect(await t.chamar('POST', 'marcas', { corpo: { id: M1, nome: 'Freiomax Teste' } })).toEqual({ id: M1, criado: false });
            const linhas = await t.q('select nome, ativo, external_id from catalogo.marca_concorrente where id = $1', [M1]);
            expect(linhas).toEqual([{ nome: 'Freiomax Teste', ativo: true, external_id: 'MC-T113' }]);
            expect(t.eventos.map((e) => e.payload.fato)).toEqual(['criada']);
        });
    });
    it('RN-CAT-13: POST com o id de marca apagada ou de outro tenant é 409 ID_EM_USO, sem gravar nem publicar "criada"', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await t.chamar('POST', 'marcas', { corpo: { id: M1, nome: 'Apagada T113' } });
            await t.q('update catalogo.marca_concorrente set deleted_at = now() where id = $1', [M1]); // hora-fixa-ok: só marca a linha como apagada, o instante nunca é comparado
            const antes = t.eventos.length;
            await expect(t.chamar('POST', 'marcas', { corpo: { id: M1, nome: 'Outra T113' } })).rejects.toMatchObject({ status: 409, codigo: 'ID_EM_USO' });
            expect(t.eventos).toHaveLength(antes);
            const linhas = await t.q('select nome from catalogo.marca_concorrente where id = $1 and deleted_at is not null', [M1]);
            expect(linhas).toEqual([{ nome: 'Apagada T113' }]);
        });
    });
    it('RN-CAT-13: nome repetido (caixa e acento) é 422 RN-CAT-13 e o índice único do banco também barra', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await t.chamar('POST', 'marcas', { corpo: { id: M1, nome: 'Pneu Máximo T113' } });
            await expect(t.chamar('POST', 'marcas', { corpo: { id: M2, nome: 'pneu maximo t113' } })).rejects.toMatchObject({ status: 422, codigo: 'RN-CAT-13' });
            await expect(t.q(`insert into catalogo.marca_concorrente (id, tenant_id, nome) values ($1, plataforma.tenant_atual(), 'PNEU MÁXIMO T113')`, [M2])).rejects.toMatchObject({ code: '23505' });
        });
    });
    it('RN-CAT-13: renomear regrava marca_nome nas referências e inativar manda a referência como apagada no sync; reativar a traz de volta', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await t.chamar('POST', 'marcas', { corpo: { id: M1, nome: 'Velho Nome T113' } });
            await t.q(`insert into catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem, marca_nome) values (plataforma.tenant_atual(), $1, $2, 'AB-1', 'ab1', 1, 'Velho Nome T113')`, [PROD, M1]);
            await t.chamar('PUT', 'marcas/:id', { params: { id: M1 }, corpo: { nome: 'Novo Nome T113' } });
            expect((await t.q('select marca_nome from catalogo.produto_referencia where marca_id = $1', [M1]))[0]?.marca_nome).toBe('Novo Nome T113');
            expect((await t.chamar('GET', 'marcas', { query: {} })).marcas.find((m) => m.id === M1)?.referencias).toBe(1);
            const pedido = { ate: '2999-01-01T00:00:00.000Z', desde: null, limite: 500 };
            const { sql, valores } = sqlPullPreco('produto_referencia', pedido, null);
            const apagada = async () => (await t.q(sql, valores)).find((r) => r.marca_id === M1)?.deleted_at ?? null;
            expect(await apagada()).toBeNull();
            await t.chamar('PUT', 'marcas/:id', { params: { id: M1 }, corpo: { ativo: false } });
            expect(await apagada()).not.toBeNull();
            await t.chamar('PUT', 'marcas/:id', { params: { id: M1 }, corpo: { ativo: true } });
            expect(await apagada()).toBeNull();
            expect(t.eventos.map((e) => e.payload.fato)).toEqual(['criada', 'alterada', 'inativada', 'reativada']);
        });
    });
    it('RN-CAT-13: o provedor marca_concorrente entrega as marcas do tenant (apagadas incluídas) e nada do outro', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await t.chamar('POST', 'marcas', { corpo: { id: M1, nome: 'Marca A T113' } });
            const { sql, valores } = sqlPullPreco('marca_concorrente', { ate: '2999-01-01T00:00:00.000Z', desde: null, limite: 500 }, null);
            const nomes = (await t.q(sql, valores)).map((r) => r.nome);
            expect(nomes).toContain('Marca A T113');
        });
        await emTransacao(B.tenantId, async (t) => {
            const { sql, valores } = sqlPullPreco('marca_concorrente', { ate: '2999-01-01T00:00:00.000Z', desde: null, limite: 500 }, null);
            expect((await t.q(sql, valores)).map((r) => r.nome)).not.toContain('Marca A T113');
        });
    });
    it('RN-CAT-13: catalogo.marcas@1 ordena por nome, esconde inativas por padrão, filtra por ids e busca, e não vê o outro tenant', async () => {
        const consulta = moduloApi.consultas.find((c) => c.consulta.nome === 'catalogo.marcas@1');
        await emTransacao(A.tenantId, async (t) => {
            await t.chamar('POST', 'marcas', { corpo: { id: M1, nome: 'Zeta T113' } });
            await t.chamar('POST', 'marcas', { corpo: { id: M2, nome: 'Alfa T113' } });
            await t.chamar('PUT', 'marcas/:id', { params: { id: M2 }, corpo: { ativo: false } });
            const ctx = { db: t.db };
            const ativas = (await consulta.executar({ incluir_inativas: false, busca: 'T113' }, ctx));
            expect(ativas.marcas.map((m) => m.nome)).toEqual(['Zeta T113']);
            const todas = (await consulta.executar({ incluir_inativas: true, busca: 't113' }, ctx));
            expect(todas.marcas.map((m) => m.nome)).toEqual(['Alfa T113', 'Zeta T113']);
            const ids = (await consulta.executar({ ids: [M2, '0ca00000-0000-4000-8000-0000000000ff'], incluir_inativas: true }, ctx));
            expect(ids.marcas.map((m) => m.id)).toEqual([M2]);
        });
        await emTransacao(B.tenantId, async (t) => {
            const b = (await consulta.executar({ incluir_inativas: true, busca: 'T113' }, { db: t.db }));
            expect(b.marcas).toEqual([]);
        });
    });
});
