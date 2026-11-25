/**
 * T-0170 × Postgres real (fixture dois-tenants, RLS): provedores de sync `tarefa` (pull, escopo próprio, janela de 30 dias para as
 * concluídas e canceladas), `frase_dia`, `meta_produtividade` (tenant) e `deslocamento_dia` (usuários visíveis, janela do mês
 * passado inteiro). O cursor `(updated_at, id)` pagina sem repetir nem perder linha; nada cruza o tenant (RN-CORE-05). Pula sem Postgres.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { somarDiasCivis } from '@macuxi/comum/relogio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeslocamentoDiaSchema, MetaProdutividadeSchema } from '../contracts/performance';
import { TarefaSyncSchema } from '../contracts/tarefa';
import { dataLocal } from '../domain';
import { A, AmbienteBanco, B, idDe, U } from './apoio-teste-t0170';
import { JANELAS_T0170, provedoresSyncT0170 } from './sync-t0170';
const FAIXA = '0ea00000';
const id = idDe(FAIXA);
const hoje = dataLocal(new Date(), 'America/Manaus'); // hora-fixa-ok: o banco real grava com now()
const instante = (dias) => new Date(Date.now() + dias * 86_400_000).toISOString(); // hora-fixa-ok: janela relativa ao relógio real
describe.skipIf(semBanco())('Core T-0170 × Postgres: sync das tarefas, metas de produtividade e km', () => {
    const amb = new AmbienteBanco();
    const vendedor1 = amb.usuario(U.vendedor1, 'vendedor');
    const vendedor2 = amb.usuario(U.vendedor2, 'vendedor');
    const promotor = amb.usuario(U.promotor, 'promotor');
    const gerente = amb.usuario(U.gerente, 'gerente');
    const adminB = amb.usuario(B.usuarios.admin, 'admin', B.tenantId);
    const tarefa = (n, extra = {}) => ({ id: id(n), autor: U.gerente, titulo: `Sync ${n}`, prazo: hoje, cancelada_em: null, concluida_em: null, destinatario: U.vendedor1, ...extra });
    const semear = async (t) => {
        await amb.admin.query(`insert into core.tarefa (id, tenant_id, autor_id, titulo, prazo, tipo, alvo, cancelada_em, cancelada_por, motivo_cancelamento) values ($1, $2, $3, $4, $5::date, 'simples', 'usuarios', $6::timestamptz, $7, $8)`, [t.id, A.tenantId, t.autor, t.titulo, t.prazo, t.cancelada_em, t.cancelada_em ? t.autor : null, t.cancelada_em ? 'teste' : null]);
        await amb.admin.query(`insert into core.tarefa_destinatario (id, tenant_id, tarefa_id, usuario_id, concluida_em, recebida_em) values ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz)`, [t.id.replace(/^0ea00000-0000-4000-8000-0/, '0ea00000-0000-4000-8000-1'), A.tenantId, t.id, t.destinatario, t.concluida_em]);
    };
    const limpar = async () => {
        await amb.limpar(`delete from core.tarefa_destinatario where tarefa_id::text like '${FAIXA}-%'`);
        await amb.limpar(`delete from core.tarefa where id::text like '${FAIXA}-%'`);
        await amb.limpar(`delete from core.deslocamento_dia where id::text like '${FAIXA}-%'`);
    };
    const tarefas = async (u = vendedor1) => (await amb.puxar(provedoresSyncT0170, 'tarefa', u));
    beforeAll(async () => {
        await amb.abrir();
        await limpar();
        await semear(tarefa(1)); // aberta
        await semear(tarefa(2, { prazo: somarDiasCivis(hoje, -100) })); // aberta e muito atrasada: passa sempre
        await semear(tarefa(3, { concluida_em: instante(-10) })); // concluída há 10 dias: dentro dos 30
        await semear(tarefa(4, { concluida_em: instante(-40) })); // concluída há 40 dias: fora
        await semear(tarefa(5, { cancelada_em: instante(-40) })); // cancelada há 40 dias: fora
        await semear(tarefa(6, { cancelada_em: instante(-5) })); // cancelada há 5 dias: dentro
        await semear(tarefa(7, { destinatario: U.vendedor2 })); // de outro consultor
        const dep = (n, dias) => amb.admin.query('insert into core.deslocamento_dia (id, tenant_id, usuario_id, data, metros, pontos) values ($1, $2, $3, $4::date, 1000, 10)', [id(n), A.tenantId, U.vendedor1, somarDiasCivis(hoje, dias)]);
        await dep(60, -3); // dentro
        await dep(61, -120); // fora (mais antigo que o mês passado inteiro e que hoje − 40)
        await amb.admin.query('insert into core.deslocamento_dia (id, tenant_id, usuario_id, data, metros, pontos) values ($1, $2, $3, $4::date, 1000, 10)', [id(62), A.tenantId, U.vendedor1, `${somarDiasCivis(`${hoje.slice(0, 7)}-01`, -1).slice(0, 7)}-01`]); // 1º dia do mês passado: dentro
    });
    afterAll(async () => {
        await limpar();
        await amb.fechar();
    });
    it('tarefa: pull `proprio` — o consultor recebe só as linhas dele (schema válido); abertas sempre, concluídas e canceladas por 30 dias', async () => {
        const l = await tarefas(vendedor1);
        for (const x of l)
            TarefaSyncSchema.parse(x);
        const meus = l.filter((x) => x.tarefa_id.startsWith(FAIXA)).map((x) => x.titulo).sort();
        expect(meus).toEqual(['Sync 1', 'Sync 2', 'Sync 3', 'Sync 6']);
        const doDois = (await tarefas(vendedor2)).filter((x) => x.tarefa_id.startsWith(FAIXA)).map((x) => x.titulo);
        expect(doDois).toEqual(['Sync 7']);
        expect((await tarefas(promotor)).some((x) => x.tarefa_id.startsWith(FAIXA))).toBe(false);
    });
    it('tarefa: quem enxerga a equipe também só recebe as próprias (escopo proprio); a fixture entrega a do vendedor-2 com o nome do cliente e do autor; o tenant B não vê o A', async () => {
        expect((await tarefas(gerente)).some((x) => x.tarefa_id.startsWith(FAIXA))).toBe(false);
        const fixture = (await tarefas(vendedor2)).find((x) => x.titulo === 'Conferir a vitrine de freios');
        expect(fixture).toMatchObject({ autor_nome: 'Gerente Alfa' });
        expect(fixture.cliente_nome).toEqual(expect.any(String));
        expect((await tarefas(adminB)).some((x) => x.tarefa_id.startsWith(FAIXA) || x.titulo === 'Conferir a vitrine de freios')).toBe(false);
    });
    it('tarefa: a tarefa removida (deleted_at) chega como removida, e a poda local acompanha a janela do servidor', async () => {
        await amb.limpar('update core.tarefa set deleted_at = now() where id = $1', [id(1)]);
        const l = await tarefas(vendedor1);
        expect(l.find((x) => x.tarefa_id === id(1))).toMatchObject({ deleted_at: expect.any(String) });
        await amb.limpar('update core.tarefa set deleted_at = null where id = $1', [id(1)]);
        // a mesma conta da `janela` do SQL, em JavaScript
        expect(JANELAS_T0170.tarefa({ concluida_em: instante(-40), cancelada_em: null }, hoje)).toBe(false);
        expect(JANELAS_T0170.tarefa({ concluida_em: instante(-10), cancelada_em: null }, hoje)).toBe(true);
        expect(JANELAS_T0170.tarefa({ concluida_em: null, cancelada_em: null }, hoje)).toBe(true);
    });
    it('a paginação pelo cursor (updated_at, id) não repete nem perde linha', async () => {
        const p = provedoresSyncT0170.find((x) => x.entidade.nome === 'tarefa');
        const ctx = amb.ctx(vendedor1);
        const todas = [];
        let desde = null;
        for (let i = 0; i < 20; i++) {
            const pagina = await p.puxar(ctx, { desde, ate: new Date(Date.now() + 60_000).toISOString(), limite: 2 }); // hora-fixa-ok: horizonte do pull
            if (pagina.length === 0)
                break;
            todas.push(...pagina);
            const ultima = pagina[pagina.length - 1];
            desde = { updated_at: ultima.updated_at, id: ultima.id };
        }
        const ids = todas.map((l) => l.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBeGreaterThanOrEqual(4);
        expect(ids.length).toBe((await tarefas(vendedor1)).length);
    });
    it('meta_produtividade: pull do tenant (todas as vivas), schema válido, sem as do tenant B', async () => {
        const l = await amb.puxar(provedoresSyncT0170, 'meta_produtividade', vendedor1);
        for (const x of l)
            MetaProdutividadeSchema.parse(x);
        expect(l.some((x) => x.equipe_id === A.equipes.equipe2)).toBe(true);
        expect(l.some((x) => x.indicador === 'km_dia' && x.valor === 150_000)).toBe(false);
    });
    it('deslocamento_dia: usuários visíveis e a janela do mês passado inteiro (o dia antigo fica fora; o 1º dia do mês passado entra)', async () => {
        const l = (await amb.puxar(provedoresSyncT0170, 'deslocamento_dia', vendedor1));
        for (const x of l)
            DeslocamentoDiaSchema.parse(x);
        expect(l.every((x) => x.usuario_id === U.vendedor1)).toBe(true);
        const meus = l.map((x) => x.id).filter((x) => x.startsWith(FAIXA)).sort();
        expect(meus).toEqual([id(60), id(62)]);
        expect((await amb.puxar(provedoresSyncT0170, 'deslocamento_dia', gerente)).some((x) => x.usuario_id === U.promotor)).toBe(true); // fixture: km do promotor, visível ao gerente
        expect((await amb.puxar(provedoresSyncT0170, 'deslocamento_dia', vendedor2)).every((x) => x.usuario_id === U.vendedor2)).toBe(true);
        expect(JANELAS_T0170.deslocamento_dia({ data: somarDiasCivis(hoje, -120) }, hoje)).toBe(false);
        expect(JANELAS_T0170.deslocamento_dia({ data: somarDiasCivis(hoje, -3) }, hoje)).toBe(true);
    });
});
