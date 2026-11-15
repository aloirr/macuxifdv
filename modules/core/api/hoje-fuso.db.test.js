/**
 * C6 (T-0042) × Postgres real: o "hoje" do Core é a data civil no FUSO DO TENANT (CLAUDE.md regra 4; RN-CORE-11), não o
 * `current_date` UTC do banco. Entre 20:00 e 24:00 de Manaus a data UTC já é a do dia seguinte: carteira, rota, sync e
 * metas não podem virar de dia nessa janela. Relógio e fuso são injetados (`ctx.agora`, `ctx.fuso`); as datas são
 * relativas ao relógio real (nenhum instante fixo contra o `now()` do banco). Pula sem Docker; com MACUXI_PG_EXIGIR=1 falha.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dataLocal } from '../domain';
import { carteiraDoUsuario } from './carteira';
import { rotasDeMetas } from './metas';
import { rotasDeRotasEVisitas } from './rotas';
import { provedoresSyncCore } from './sync';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';
const A = DOIS_TENANTS.A;
const U = A.usuarios;
const C = A.clientes;
const MANAUS = 'America/Manaus';
const SAO_PAULO = 'America/Sao_Paulo';
const DIA_MS = 86_400_000;
const id = (n) => `0e500000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const somarDias = (data, n) => new Date(Date.parse(`${data}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
/** Instante `HH:MM` do dia civil `dia` em Manaus (UTC-4, sem horário de verão). */
const emManaus = (dia, hhmm) => new Date(`${dia}T${hhmm}:00-04:00`);
const ultimoDiaDoMes = (anoMes) => {
    const [a, m] = anoMes.split('-').map(Number);
    return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};
describe.skipIf(semBanco())('Core C6 x Postgres: "hoje" no fuso do tenant (rota, carteira, sync e metas)', () => {
    let pool;
    let acesso;
    /** Dia de referência: daqui a 5 dias de Manaus, sempre relativo ao relógio real. */
    const D = somarDias(dataLocal(new Date(), MANAUS), 5);
    const vendedor2 = { id: U.vendedor2, tenant_id: A.tenantId, perfil: 'vendedor' };
    const gerente = { id: U.gerente, tenant_id: A.tenantId, perfil: 'gerente' };
    const analista = { id: U.analista, tenant_id: A.tenantId, perfil: 'analista' };
    let clienteVigencia = '';
    let clienteJanela = '';
    function ctx(u, agora, fuso) {
        return {
            usuario: u,
            requestId: 'req-teste',
            agora: () => agora,
            fuso: () => fuso,
            comTenant: (fn) => comTenant(pool, u.tenant_id, (c) => fn(c, { publicar: async () => ({}) })),
            carteira: () => carteiraDoUsuario(u, acesso, { agora: () => agora, fuso }),
            usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
        };
    }
    const chamar = (rotas, caminho, u, agora, fuso, extra = {}) => {
        const r = rotas.find((x) => x.metodo === 'GET' && x.caminho === caminho);
        return r.executar({ ...ctx(u, agora, fuso), corpo: {}, query: r.query ? r.query.parse(extra.query ?? {}) : {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} }); // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const pedido = () => ({ desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 });
    const idsDoPull = async (nome, u, agora, fuso) => (await provedoresSyncCore.find((p) => p.entidade.nome === nome).puxar(ctx(u, agora, fuso), pedido())).map((l) => l.id);
    const carteiraEm = async (agora, fuso) => [...(await carteiraDoUsuario(vendedor2, acesso, { agora: () => agora, fuso }))];
    async function limpar() {
        await comTenant(pool, A.tenantId, async (c) => {
            await c.query('delete from core.carteira where id = any($1::uuid[])', [[id(1), id(2)]]);
            await c.query('delete from core.rota where id = $1', [id(3)]);
        });
    }
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
        acesso = {
            comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c)),
            semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
        };
        await limpar();
        await comTenant(pool, A.tenantId, async (c) => {
            // clientes que o vendedor-2 e o promotor ainda não têm na carteira (a fixture é de outros testes)
            const livres = async (usuario) => {
                const ocupados = new Set((await c.query('select cliente_id from core.carteira where usuario_id = $1 and papel = $2 and deleted_at is null', [usuario, 'vendedor'])).rows.map((r) => r.cliente_id));
                return Object.values(C).filter((cid) => !ocupados.has(cid));
            };
            clienteVigencia = (await livres(U.vendedor2))[0];
            clienteJanela = (await livres(U.promotor))[0];
            // vigência que termina em D (o último dia vale); e vínculo encerrado em D - 40 (limite da janela do pull)
            await c.query(`insert into core.carteira (id, tenant_id, cliente_id, usuario_id, papel, inicio, fim) values ($1, $2, $3, $4, 'vendedor', $5::date - 100, $5::date)`, [id(1), A.tenantId, clienteVigencia, U.vendedor2, D]);
            await c.query(`insert into core.carteira (id, tenant_id, cliente_id, usuario_id, papel, inicio, fim) values ($1, $2, $3, $4, 'vendedor', $5::date - 200, $5::date - 40)`, [id(2), A.tenantId, clienteJanela, U.promotor, D]);
            await c.query("insert into core.rota (id, tenant_id, usuario_id, data, situacao, origem) values ($1, $2, $3, $4, 'planejada', 'bko')", [id(3), A.tenantId, U.vendedor2, D]);
        });
    });
    afterAll(async () => {
        if (pool)
            await limpar();
        await pool?.end();
    });
    it('o dia D vale D às 21:00 e às 23:59 de Manaus (embora em UTC já seja D+1 às 23:59)', () => {
        expect(dataLocal(emManaus(D, '21:00'), MANAUS)).toBe(D);
        expect(dataLocal(emManaus(D, '23:59'), MANAUS)).toBe(D);
        expect(emManaus(D, '23:59').toISOString().slice(0, 10)).toBe(somarDias(D, 1));
        expect(dataLocal(emManaus(D, '23:59'), SAO_PAULO)).toBe(somarDias(D, 1));
    });
    describe('carteira (RN-CORE-04: vigência no dia do tenant)', () => {
        it.each(['21:00', '23:59'])('RN-CORE-04: vínculo com fim = hoje continua vigente às %s de Manaus', async (hhmm) => {
            expect(await carteiraEm(emManaus(D, hhmm), MANAUS)).toContain(clienteVigencia);
        });
        it('RN-CORE-04: à meia-noite de Manaus o vínculo com fim = ontem deixa de valer', async () => {
            expect(await carteiraEm(emManaus(somarDias(D, 1), '00:00'), MANAUS)).not.toContain(clienteVigencia);
        });
        it('RN-CORE-04: tenant em São Paulo vira o dia 1 h antes: às 23:59 de Manaus (00:59 em SP) o vínculo venceu; às 22:59 ainda vale', async () => {
            expect(await carteiraEm(emManaus(D, '23:59'), SAO_PAULO)).not.toContain(clienteVigencia);
            expect(await carteiraEm(emManaus(D, '22:59'), SAO_PAULO)).toContain(clienteVigencia);
        });
        it('carteira do usuário no BKO (editor de rota) usa o mesmo dia do tenant', async () => {
            const vinculos = async (agora, fuso) => (await chamar(rotasDeRotasEVisitas, 'usuarios/:id/clientes', gerente, agora, fuso, { params: { id: U.vendedor2 } })).itens.map((i) => i.carteira_id);
            expect(await vinculos(emManaus(D, '21:00'), MANAUS)).toContain(id(1));
            expect(await vinculos(emManaus(D, '23:59'), MANAUS)).toContain(id(1));
            expect(await vinculos(emManaus(D, '23:59'), SAO_PAULO)).not.toContain(id(1));
        });
    });
    describe('sync (janela do pull no dia do tenant)', () => {
        it.each(['21:00', '23:59'])('carteira encerrada há 40 dias ainda entra na janela às %s de Manaus (hoje = D)', async (hhmm) => {
            expect(await idsDoPull('carteira', analista, emManaus(D, hhmm), MANAUS)).toContain(id(2));
        });
        it('tenant em São Paulo às 23:59 de Manaus já está em D+1: o vínculo (fim = D - 40) sai da janela (fim >= hoje - 40)', async () => {
            expect(await idsDoPull('carteira', analista, emManaus(D, '23:59'), SAO_PAULO)).not.toContain(id(2));
        });
        it('rota de D entra na janela (data >= hoje - 40) no pull do tenant de Manaus', async () => {
            expect(await idsDoPull('rota', gerente, emManaus(D, '23:59'), MANAUS)).toContain(id(3));
        });
    });
    describe('rota (GET /v1/core/rotas sem período = a partir de hoje)', () => {
        const rotasDe = async (agora, fuso) => (await chamar(rotasDeRotasEVisitas, 'rotas', gerente, agora, fuso, { query: { usuario_id: U.vendedor2 } })).itens.map((i) => i.data);
        it.each(['21:00', '23:59'])('a rota de hoje aparece às %s de Manaus', async (hhmm) => {
            expect(await rotasDe(emManaus(D, hhmm), MANAUS)).toContain(D);
        });
        it('tenant em São Paulo às 23:59 de Manaus já é D+1: a rota de D fica para trás', async () => {
            expect(await rotasDe(emManaus(D, '23:59'), SAO_PAULO)).not.toContain(D);
        });
    });
    describe('metas (período padrão = mês de hoje no fuso do tenant)', () => {
        // último dia de um mês futuro: 23:59 de Manaus ainda é o mês; em UTC e em São Paulo já é o mês seguinte
        const mesDeD = somarDias(D, 40).slice(0, 7);
        const ultimo = ultimoDiaDoMes(mesDeD);
        const proximo = somarDias(ultimo, 1).slice(0, 7);
        it.each(['21:00', '23:59'])('RN-CORE-20: o painel abre no mês corrente às %s do último dia do mês em Manaus', async (hhmm) => {
            expect((await chamar(rotasDeMetas, 'indicadores', gerente, emManaus(ultimo, hhmm), MANAUS)).periodo).toBe(mesDeD);
        });
        it('RN-CORE-20: tenant em São Paulo às 23:59 de Manaus do último dia já está no mês seguinte', async () => {
            expect((await chamar(rotasDeMetas, 'indicadores', gerente, emManaus(ultimo, '23:59'), SAO_PAULO)).periodo).toBe(proximo);
        });
    });
});
