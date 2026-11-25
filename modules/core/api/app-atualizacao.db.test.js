/**
 * T-0195 × Postgres real (fixture dois-tenants, RLS): aviso de versão nova no sininho (RN-CORE-80, ADR 0070 §D7). Uma notificação
 * por (usuário, variante, versão publicada): repetir e chamar em paralelo não duplica; versão nova publicada gera outra; cada
 * usuário só vê a sua no pull; o tenant B nunca a vê (RLS). Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { criarPortaVersaoAppMemoria } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ehAvisoDeVersaoApp, NotificacaoSyncSchema, SUBTIPO_NOTIFICACAO_APP_VERSAO } from '../contracts';
import { rotaAvisoVersaoApp } from './app-atualizacao';
import { provedoresDeNotificacao } from './notificacoes';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
describe.skipIf(semBanco())('Core T-0195 × Postgres: aviso de versão nova do app (RN-CORE-80)', () => {
    let pool;
    const eventos = [];
    const usuario = (uid, perfil, tenant = A.tenantId) => ({ id: uid, tenant_id: tenant, perfil });
    const vendedor1 = usuario(A.usuarios.vendedor1, 'vendedor');
    const vendedor2 = usuario(A.usuarios.vendedor2, 'vendedor');
    const vendedorB = usuario(B.usuarios.vendedor, 'vendedor', B.tenantId);
    // publicada há 1 h: dentro das 24 h, prazo no futuro (o pull só traz notificação não expirada)
    const publicadaHa1h = (versao) => ({ versao, publicada_em: new Date(Date.now() - 3_600_000).toISOString() }); // hora-fixa-ok: o banco real compara expira_em com now()
    function ctx(u, publicada, instalada = '1.0.33') {
        const tx = { publicar: async (def, payload) => { eventos.push({ nome: def.nome, payload }); return {}; } };
        return {
            usuario: u,
            requestId: 'req-teste',
            agora: () => new Date(), // hora-fixa-ok: Postgres real grava com now()
            fuso: () => 'America/Manaus',
            versaoApp: criarPortaVersaoAppMemoria({ campo: publicada }, { variante: 'campo', versao: instalada }),
            comTenant: (fn) => comTenant(pool, u.tenant_id, (c) => fn(c, tx)),
        };
    }
    const avisar = (u, publicada, instalada) => rotaAvisoVersaoApp.executar({ ...ctx(u, publicada, instalada), corpo: {} });
    const pedido = () => ({ desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 }); // hora-fixa-ok: janela do pull cobre linhas gravadas agora
    const puxar = async (u, publicada) => (await provedoresDeNotificacao.find((p) => p.entidade.nome === 'notificacao').puxar(ctx(u, publicada), pedido())).filter((l) => ehAvisoDeVersaoApp(l));
    const limpar = () => Promise.all([A.tenantId, B.tenantId].map((t) => comTenant(pool, t, (c) => c.query('delete from core.notificacao where subtipo = $1', [SUBTIPO_NOTIFICACAO_APP_VERSAO]))));
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
        await limpar();
    });
    afterAll(async () => {
        if (pool)
            await limpar();
        await pool?.end();
    });
    it('RN-CORE-80: repetir e chamar em paralelo cria UMA notificação por usuário e versão, sem link, com o evento uma vez', async () => {
        const pub = publicadaHa1h('1.0.34');
        expect(await avisar(vendedor1, pub)).toMatchObject({ situacao: 'aviso' });
        await Promise.all([avisar(vendedor1, pub), avisar(vendedor1, pub), avisar(vendedor1, pub)]);
        const linhas = await puxar(vendedor1, pub);
        expect(linhas).toHaveLength(1);
        const n = NotificacaoSyncSchema.parse(linhas[0]);
        expect(n).toMatchObject({ usuario_id: vendedor1.id, tipo: 'sistema', subtipo: 'app_versao_nova', titulo: 'Versão 1.0.34 disponível', corpo: 'Instale por cima da versão atual, sem desinstalar o app.', origem_modulo: 'core', prioridade: 'normal', link: null });
        expect(n.expira_em).not.toBeNull();
        expect(eventos.filter((e) => e.nome === 'core.notificacao.criada@1' && e.payload.usuario_id === vendedor1.id)).toHaveLength(1);
    });
    it('RN-CORE-80: versão publicada nova gera outro aviso; app já atualizado não gera', async () => {
        const pub = publicadaHa1h('1.0.35');
        await avisar(vendedor1, pub);
        await avisar(vendedor1, pub, '1.0.35');
        expect((await puxar(vendedor1, pub)).map((l) => l.titulo).sort()).toEqual(['Versão 1.0.34 disponível', 'Versão 1.0.35 disponível']);
    });
    it('RN-CORE-05: outro usuário do tenant e o tenant B não veem o aviso do vendedor-1 (RLS); cada um tem o próprio', async () => {
        const pub = publicadaHa1h('1.0.34');
        expect(await puxar(vendedor2, pub)).toHaveLength(0);
        expect(await puxar(vendedorB, pub)).toHaveLength(0);
        const noB = await comTenant(pool, B.tenantId, (c) => c.query('select count(*)::int as n from core.notificacao where subtipo = $1', [SUBTIPO_NOTIFICACAO_APP_VERSAO]));
        expect(noB.rows[0].n).toBe(0);
        await avisar(vendedorB, pub);
        expect(await puxar(vendedorB, pub)).toHaveLength(1);
        expect((await puxar(vendedor1, pub)).every((l) => l.usuario_id === vendedor1.id)).toBe(true);
    });
    it('RN-CORE-80: publicada v1.0.32 (manifesto) e servidor v1.0.33: sem cabeçalho ou com app 1.0.32 não grava nenhuma notificação', async () => {
        const contar = () => comTenant(pool, A.tenantId, (c) => c.query('select count(*)::int as n from core.notificacao where subtipo = $1 and usuario_id = $2', [SUBTIPO_NOTIFICACAO_APP_VERSAO, A.usuarios.vendedor2]));
        const antes = (await contar()).rows[0].n;
        const pub = publicadaHa1h('1.0.32');
        const semCabecalho = { ...ctx(vendedor2, pub), versaoApp: criarPortaVersaoAppMemoria({ campo: pub }, null) };
        expect(await rotaAvisoVersaoApp.executar({ ...semCabecalho, corpo: {} })).toMatchObject({ situacao: 'atual', versao_publicada: null });
        expect(await avisar(vendedor2, pub, '1.0.32')).toMatchObject({ situacao: 'atual' });
        expect((await contar()).rows[0].n).toBe(antes);
        expect(antes).toBe(0);
    });
});
