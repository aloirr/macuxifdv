/**
 * T-0039 §2 × Postgres real (migração 0026; RN-CORE-12 complemento): pendência gravada no checkout sem rebaixar `concluida`, contagem
 * `core.visita.etapas_pendentes` na mesma transação, baixa por reconsulta, alerta uma vez com notificação ao vendedor e ao supervisor
 * e isolamento por tenant (RLS). Usa a visita v1c3Ontem da fixture e desfaz tudo no fim. Pula sem Postgres; no CI (MACUXI_PG_EXIGIR=1) falha.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { alertarPendenciasVencidas, gravarEtapasDoCheckout, reconsultarEBaixar } from './etapas-pendencia';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const VISITA = A.visitas.v1c3Ontem;
const AGORA = new Date('2031-01-10T12:00:00.000Z');
const CHECKOUT = new Date('2031-01-08T10:00:00.000Z');
const PESQUISA = { modulo: 'pesquisa', etapa: 'pesquisa.obrigatoria', rotulo: 'Pesquisa obrigatória: "Gôndola do mês"' };
describe.skipIf(semBanco())('Core T-0039 × Postgres: pendência de etapa do checkout', () => {
    let pool;
    let concluidaNoModulo = false;
    const consultar = vi.fn(async () => ({ etapas: [{ etapa: PESQUISA.etapa, rotulo: PESQUISA.rotulo, obrigatoria: true, concluida: concluidaNoModulo }] }));
    const noTenant = (tenant, fn) => comTenant(pool, tenant, (c) => fn(c));
    const linha = () => noTenant(A.tenantId, async (c) => (await c.query('select situacao, resolvida_em, alertada_em, pendente_desde from core.visita_etapa where visita_id = $1', [VISITA])).rows[0]);
    const contagem = () => noTenant(A.tenantId, async (c) => Number((await c.query('select etapas_pendentes as n from core.visita where id = $1', [VISITA])).rows[0].n));
    const limpar = () => noTenant(A.tenantId, async (c) => {
        await c.query("delete from core.notificacao where origem_modulo = 'core' and envio_id in (select id from core.visita_etapa where visita_id = $1)", [VISITA]);
        await c.query('delete from core.visita_etapa where visita_id = $1', [VISITA]);
        await c.query('update core.visita set etapas_pendentes = 0 where id = $1', [VISITA]);
    });
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
        await limpar();
    });
    afterAll(async () => {
        if (pool) {
            await limpar();
            await pool.end();
        }
    });
    it('RN-CORE-12: checkout grava a etapa pendente com pendente_desde do servidor e a contagem na mesma transação', async () => {
        await noTenant(A.tenantId, (c) => gravarEtapasDoCheckout(c, VISITA, [{ ...PESQUISA, situacao: 'pendente' }], CHECKOUT));
        expect(await contagem()).toBe(1);
        const l = await linha();
        expect(l.situacao).toBe('pendente');
        expect(new Date(l.pendente_desde).toISOString()).toBe(CHECKOUT.toISOString());
    });
    it('RN-CORE-12: outro tenant não vê a pendência (RLS)', async () => {
        const n = await noTenant(B.tenantId, async (c) => (await c.query('select count(*)::int as n from core.visita_etapa where visita_id = $1', [VISITA])).rows[0].n);
        expect(n).toBe(0);
    });
    it('RN-CORE-12: alerta no prazo notifica vendedor e supervisor uma vez e grava alertada_em; a segunda varredura não repete', async () => {
        const executar = () => noTenant(A.tenantId, (db) => alertarPendenciasVencidas({ db, consultar, publicar: vi.fn(async () => undefined), fuso: () => 'America/Manaus', agora: () => AGORA }));
        const r1 = await executar();
        expect(r1.alertadas).toBe(1);
        expect(r1.notificacoes).toBeGreaterThanOrEqual(1);
        expect((await linha()).alertada_em).not.toBeNull();
        const notificados = await noTenant(A.tenantId, async (c) => (await c.query("select usuario_id from core.notificacao where origem_modulo = 'core' and envio_id in (select id from core.visita_etapa where visita_id = $1)", [VISITA])).rows.map((x) => x.usuario_id));
        expect(notificados).toContain(A.usuarios.vendedor1);
        const subtipos = await noTenant(A.tenantId, async (c) => (await c.query("select distinct subtipo from core.notificacao where origem_modulo = 'core' and envio_id in (select id from core.visita_etapa where visita_id = $1)", [VISITA])).rows.map((x) => x.subtipo));
        expect(subtipos).toEqual(['etapa_pendente_checkout']);
        const r2 = await executar();
        expect(r2.alertadas).toBe(0);
    });
    it('RN-CORE-12: reconsulta concluída baixa (concluida, resolvida_em, referencia) e zera a contagem; repetir não muda nada', async () => {
        concluidaNoModulo = true;
        const resposta = '0e390000-0000-4000-8000-000000000001';
        const baixar = () => noTenant(A.tenantId, (c) => reconsultarEBaixar(c, consultar, { visitaId: VISITA, modulo: 'pesquisa', referenciaId: resposta, agora: AGORA }));
        expect((await baixar()).baixadas).toBe(1);
        expect(await contagem()).toBe(0);
        // a notificação da pendência sai do pull como exclusão (deleted_at + updated_at)
        const restantes = await noTenant(A.tenantId, async (c) => (await c.query("select count(*)::int as n from core.notificacao where origem_modulo = 'core' and envio_id in (select id from core.visita_etapa where visita_id = $1) and deleted_at is null", [VISITA])).rows[0].n);
        expect(restantes).toBe(0);
        const l = await linha();
        expect(l.situacao).toBe('concluida');
        expect(l.resolvida_em).not.toBeNull();
        expect((await baixar()).baixadas).toBe(0);
    });
    it('RN-CORE-12: novo upsert do checkout não rebaixa a linha já concluída', async () => {
        await noTenant(A.tenantId, (c) => gravarEtapasDoCheckout(c, VISITA, [{ ...PESQUISA, situacao: 'pendente' }], AGORA));
        expect((await linha()).situacao).toBe('concluida');
        expect(await contagem()).toBe(0);
    });
});
