/**
 * T-0175 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): vínculo automático do vendedor do ERP por nome (RN-CORE-58).
 * Cada caso roda numa transação desfeita no fim. Pula sem Postgres (roda no CI).
 */
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { consumidorVendedorDoErp } from './consumidores-erp-vendedor';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const NOME = 'Anderson Pereira da Silva';
const CODIGO = 'VEN-N175';
describe.skipIf(semBanco())('Core T-0175 × Postgres: vínculo automático por nome', () => {
    let pool;
    beforeAll(() => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
    });
    afterAll(async () => {
        await pool?.end();
    });
    async function emTransacao(fn) {
        const c = await pool.connect();
        try {
            await c.query('begin');
            await definirTenant(c, A.tenantId);
            const q = async (sql, v = []) => (await c.query(sql, v)).rows;
            const novo = async (nome, email, opc = {}) => (await q("insert into core.usuario (tenant_id, nome, email, perfil, external_id, ativo) values (plataforma.tenant_atual(), $1, $2, $3, $4, $5) returning id", [nome, email, opc.perfil ?? 'vendedor', opc.external ?? null, opc.ativo ?? true]))[0].id;
            const carga = async (nome = NOME, codigo = CODIGO, eventoId = 'ev-fixo-1') => {
                const ctx = {
                    db: c,
                    agora: () => new Date(),
                    fuso: () => 'America/Manaus',
                    parametros: () => ({}),
                    envelope: { evento_id: eventoId, tenant_id: A.tenantId },
                    publicar: vi.fn(async () => ({})),
                    consultar: vi.fn(),
                    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
                };
                const reg = { external_id: codigo, alterado_em: '2026-11-15T10:00:00Z', ativo: true, nome, email: null }; // hora-fixa-ok: carimbo do ERP, nunca comparado com o relógio
                await consumidorVendedorDoErp.executar(consumidorVendedorDoErp.evento.schema.parse({ lote_id: '0e500000-0000-4000-8000-000000000175', entidade: 'vendedor', external_id: codigo, acao: 'atualizado', hash: 'h', registro: reg, ocorrido_em: '2026-11-15T10:00:00Z' }), ctx);
            };
            try {
                await fn({ q, novo, carga, c });
            }
            finally {
                await c.query('rollback').catch(() => undefined);
            }
        }
        finally {
            c.release();
        }
    }
    const provisorios = (t) => t.q("select id from core.usuario where external_id = $1 and email like 'erp-%@sem-email.invalid' and deleted_at is null", [CODIGO]);
    const avisos = (t) => t.q("select corpo, usuario_id from core.notificacao where tipo = 'sistema' and titulo = 'Vendedor do ERP sem vínculo automático'");
    it('RN-CORE-58: a carga com o mesmo nome vincula o usuário, completa as notas e não cria provisório', async () => {
        await emTransacao(async (t) => {
            const id = await t.novo('  ANDERSON pereira da  Silva ', 'anderson.n175@exemplo.com.br');
            await t.q("insert into core.nota_erp (tenant_id, external_id, cliente_id, tipo, numero, emitida_em, ano_mes, total_cents, vendedor_external_id, usuario_id) values (plataforma.tenant_atual(), 'NF-N175', $1, 'faturamento', 'N-N175', now(), '2026-11', 100, $2, null)", [A.clientes.c1, CODIGO]);
            await t.carga();
            expect((await t.q('select external_id from core.usuario where id = $1', [id]))[0]?.external_id).toBe(CODIGO);
            expect((await t.q('select 1 from core.usuario where external_id = $1 and deleted_at is null', [CODIGO])).length).toBe(1);
            expect((await t.q('select 1 from core.nota_erp where numero = $1 and usuario_id = $2', ['N-N175', id])).length).toBe(1);
            expect((await avisos(t)).length).toBe(0);
        });
    });
    it('RN-CORE-58: homônimo cria o provisório e avisa os admins sem nome nem e-mail', async () => {
        await emTransacao(async (t) => {
            const a = await t.novo(NOME, 'h1.n175@exemplo.com.br');
            const b = await t.novo(NOME, 'h2.n175@exemplo.com.br');
            await t.carga();
            expect((await t.q('select 1 from core.usuario where id in ($1, $2) and external_id is not null', [a, b])).length).toBe(0);
            expect((await provisorios(t)).length).toBe(1);
            const av = await avisos(t);
            expect(av.length).toBeGreaterThan(0);
            for (const x of av) {
                expect(x.corpo).toContain(CODIGO);
                expect(x.corpo).not.toContain('Anderson');
                expect(x.corpo).not.toContain('@');
            }
        });
    });
    it('RN-CORE-58: usuário com outro código ERP não vincula: cria o provisório e avisa', async () => {
        await emTransacao(async (t) => {
            const id = await t.novo(NOME, 'outro.n175@exemplo.com.br', { external: 'VEN-OUTRO' });
            await t.carga();
            expect((await t.q('select external_id from core.usuario where id = $1', [id]))[0]?.external_id).toBe('VEN-OUTRO');
            expect((await provisorios(t)).length).toBe(1);
            const av = await avisos(t);
            expect(av.length).toBeGreaterThan(0);
            expect(av[0].corpo).not.toContain('Anderson');
            expect(av[0].corpo).not.toContain('@');
        });
    });
    it('RN-CORE-58 / RN-CORE-57: usuário inativo não vincula (provisório e aviso)', async () => {
        await emTransacao(async (t) => {
            const id = await t.novo(NOME, 'inativo.n175@exemplo.com.br', { ativo: false });
            await t.carga();
            expect((await t.q('select external_id from core.usuario where id = $1', [id]))[0]?.external_id).toBeNull();
            expect((await provisorios(t)).length).toBe(1);
            expect((await avisos(t)).length).toBeGreaterThan(0);
        });
    });
    it('RN-CORE-58: reentrega do mesmo evento é idempotente (um usuário, uma auditoria, sem aviso repetido)', async () => {
        await emTransacao(async (t) => {
            const id = await t.novo(NOME, 'idem.n175@exemplo.com.br');
            await t.carga();
            await t.carga();
            expect((await t.q('select 1 from core.usuario where external_id = $1 and deleted_at is null', [CODIGO])).length).toBe(1);
            expect((await t.q("select 1 from plataforma.auditoria where acao = 'usuario.vincular_erp_por_nome' and entidade_id = $1", [id])).length).toBe(1);
        });
        await emTransacao(async (t) => {
            await t.novo(NOME, 'h1.n175@exemplo.com.br');
            await t.novo(NOME, 'h2.n175@exemplo.com.br');
            await t.carga();
            const antes = (await avisos(t)).length;
            await t.carga();
            expect((await avisos(t)).length).toBe(antes);
            expect((await provisorios(t)).length).toBe(1);
        });
    });
    it('RN-CORE-58: a auditoria registra usuario_id, external_id e a regra, com ator sistema e sem o nome', async () => {
        await emTransacao(async (t) => {
            const id = await t.novo(NOME, 'aud.n175@exemplo.com.br');
            await t.carga();
            const aud = await t.q("select usuario_id, modulo, depois from plataforma.auditoria where acao = 'usuario.vincular_erp_por_nome' and entidade_id = $1", [id]);
            expect(aud.length).toBe(1);
            expect(aud[0].usuario_id).toBeNull();
            expect(aud[0].modulo).toBe('core');
            expect(aud[0].depois).toMatchObject({ usuario_id: id, external_id: CODIGO, regra: 'RN-CORE-58' });
            const texto = JSON.stringify(aud[0]);
            expect(texto).not.toContain('Anderson');
            expect(texto).not.toContain('aud.n175@exemplo.com.br');
        });
    });
    it('RN-CORE-58: RLS: o nome igual em outro tenant não vincula, e a auditoria do tenant A não aparece no B', async () => {
        await emTransacao(async (t) => {
            const idA = await t.novo(NOME, 'rls.n175@exemplo.com.br');
            await definirTenant(t.c, B.tenantId);
            const idB = await t.novo(NOME, 'rls-b.n175@exemplo.com.br');
            await definirTenant(t.c, A.tenantId);
            await t.carga();
            expect((await t.q('select external_id from core.usuario where id = $1', [idA]))[0]?.external_id).toBe(CODIGO);
            await definirTenant(t.c, B.tenantId);
            expect((await t.q('select external_id from core.usuario where id = $1', [idB]))[0]?.external_id).toBeNull();
            expect((await t.q('select 1 from core.usuario where id = $1', [idA])).length).toBe(0);
            expect((await t.q("select 1 from plataforma.auditoria where acao = 'usuario.vincular_erp_por_nome'")).length).toBe(0);
        });
    });
});
