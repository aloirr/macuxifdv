/**
 * RN-CAT-06 (T-0120) × Postgres real (dois tenants, RLS): `tabela_preco_external_id` de `integracao.cliente.atualizado@1` grava
 * `catalogo.cliente_tabela_preco`. Cada caso roda numa transação desfeita. Só no CI (sem Docker local).
 */
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarConsumidorClienteTabelaDoErp, ReferenciaAusenteErp } from './consumidores-erp';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const CLIENTE = '0ca00000-0000-4000-8000-0000000000c9';
describe.skipIf(semBanco())('Catálogo T-0120 × Postgres: vínculo cliente x tabela do ERP', () => {
    let pool;
    beforeAll(() => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
    });
    afterAll(async () => {
        await pool.end();
    });
    const resolver = async (_c, ids) => new Map(ids.filter((i) => i === 'C-T120').map((i) => [i, CLIENTE]));
    const cons = criarConsumidorClienteTabelaDoErp(resolver);
    const ev = (registro, acao = 'atualizado') => ({
        lote_id: '11111111-1111-4111-8111-111111111111',
        entidade: 'cliente',
        external_id: 'C-T120',
        acao,
        hash: 'h',
        ocorrido_em: '2026-11-08T10:00:00Z',
        registro: { external_id: 'C-T120', alterado_em: '2026-11-08T10:00:00Z', ativo: true, razao_social: 'Mercado Sol', ...registro },
    });
    async function emTransacao(tenant, fn) {
        const c = await pool.connect();
        try {
            await c.query('begin');
            await definirTenant(c, tenant);
            const ctx = { db: c, agora: () => new Date('2026-11-08T15:00:00Z'), fuso: () => 'America/Manaus', parametros: () => ({}), envelope: { evento_id: 'x', tenant_id: tenant }, publicar: vi.fn(), consultar: vi.fn(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
            await fn(c, (p) => cons.executar(cons.evento.schema.parse(p), ctx));
        }
        finally {
            await c.query('rollback').catch(() => undefined);
            c.release();
        }
    }
    const tabela = (c, ext) => c.query(`insert into catalogo.tabela_preco (tenant_id, codigo, nome, external_id) values (plataforma.tenant_atual(), $1, $1, $1) returning id`, [ext]).then((r) => r.rows[0].id);
    const vivos = (c) => c.query(`select tabela_preco_id from catalogo.cliente_tabela_preco where cliente_id = $1 and deleted_at is null`, [CLIENTE]).then((r) => r.rows);
    it('RN-CAT-06: tabela existente vincula, reentrega não duplica, troca atualiza e null desvincula', async () => {
        await emTransacao(A.tenantId, async (c, entregar) => {
            const t1 = await tabela(c, 'TAB-T120-1');
            const t2 = await tabela(c, 'TAB-T120-2');
            await entregar(ev({ tabela_preco_external_id: 'TAB-T120-1' }));
            await entregar(ev({ tabela_preco_external_id: 'TAB-T120-1' }));
            expect(await vivos(c)).toEqual([{ tabela_preco_id: t1 }]);
            await entregar(ev({ tabela_preco_external_id: 'TAB-T120-2' }));
            expect(await vivos(c)).toEqual([{ tabela_preco_id: t2 }]);
            await entregar(ev({ tabela_preco_external_id: null }));
            expect(await vivos(c)).toEqual([]);
            await entregar(ev({ tabela_preco_external_id: 'TAB-T120-1' }));
            expect(await vivos(c)).toEqual([{ tabela_preco_id: t1 }]);
        });
    });
    it('RN-INT-04: tabela inexistente repete na outbox sem gravar', async () => {
        await emTransacao(A.tenantId, async (c, entregar) => {
            await expect(entregar(ev({ tabela_preco_external_id: 'NAO-EXISTE' }))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
            expect(await vivos(c)).toEqual([]);
        });
    });
    it('RN-CORE-05: a tabela do tenant A não vincula no tenant B (RLS) e o vínculo de A não aparece em B', async () => {
        await emTransacao(A.tenantId, async (c, entregar) => {
            await tabela(c, 'TAB-T120-A');
            await entregar(ev({ tabela_preco_external_id: 'TAB-T120-A' }));
            expect(await vivos(c)).toHaveLength(1);
        });
        await emTransacao(B.tenantId, async (c, entregar) => {
            expect(await vivos(c)).toEqual([]);
            await expect(entregar(ev({ tabela_preco_external_id: 'TAB-T120-A' }))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
        });
    });
});
