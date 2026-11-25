/**
 * T-0170 × Postgres real (fixture dois-tenants, RLS): metas de produtividade do BKO (RN-CORE-45; desenho
 * `performance-produtividade.md` §6 e §7.3). Lote idempotente, validação do domain com 422 `META_PRODUTIVIDADE_INVALIDA`
 * (campo no detalhe), escopo de quem edita (empresa só tenant; equipe e usuário abaixo), "voltar a herdar" e isolamento do
 * tenant B (RN-CORE-05). A vigência dos testes é o mês seguinte (só ela é limpa no fim). Pula sem Postgres.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { somarDiasCivis } from '@macuxi/comum/relogio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dataLocal } from '../domain';
import { metasProdutividadeVigentes } from '../domain/performance/metas-produtividade';
import { A, AmbienteBanco, B, U } from './apoio-teste-t0170';
import { rotasDeMetasProdutividade } from './metas-produtividade';
import { provedoresSyncT0170 } from './sync-t0170';
const hoje = dataLocal(new Date(), 'America/Manaus'); // hora-fixa-ok: o banco real grava com now()
const MES = hoje.slice(0, 7);
const VIGENCIA = somarDiasCivis(`${MES}-01`, 40).slice(0, 7); // um ou dois meses à frente: ≥ mês de hoje e fora da fixture
describe.skipIf(semBanco())('Core T-0170 × Postgres: metas de produtividade', () => {
    const amb = new AmbienteBanco();
    const admin = amb.usuario(U.admin, 'admin');
    const analista = amb.usuario(U.analista, 'analista');
    const gerente = amb.usuario(U.gerente, 'gerente');
    const adminB = amb.usuario(B.usuarios.admin, 'admin', B.tenantId);
    const chamar = (metodo, caminho, u = admin, extra = {}) => amb.chamar(rotasDeMetasProdutividade, metodo, caminho, u, extra);
    const salvar = (u, corpo) => chamar('PUT', 'metas-produtividade', u, { corpo: { vigencia_inicio: VIGENCIA, ...corpo } });
    const limpar = () => amb.limpar('delete from core.meta_produtividade where vigencia_inicio = $1', [VIGENCIA]);
    const doAlvo = async (u = admin) => (await chamar('GET', 'metas-produtividade', u)).itens.filter((m) => m.vigencia_inicio === VIGENCIA);
    beforeAll(async () => {
        await amb.abrir();
        await limpar();
    });
    afterAll(async () => {
        await limpar();
        await amb.fechar();
    });
    it('RN-CORE-45: o admin define a meta da empresa em lote; repetir o mesmo corpo não muda nada e mudar um valor grava só ele', async () => {
        const r = await salvar(admin, { escopo: 'tenant', metas: [{ indicador: 'tma', valor: 20 }, { indicador: 'almoco', valor: 60 }] });
        expect(r).toMatchObject({ gravadas: 2, inalteradas: 0 });
        expect(r.itens.map((m) => [m.indicador, m.valor])).toEqual([['almoco', 60], ['tma', 20]]);
        expect(await salvar(admin, { escopo: 'tenant', metas: [{ indicador: 'tma', valor: 20 }, { indicador: 'almoco', valor: 60 }] })).toMatchObject({ gravadas: 0, inalteradas: 2 });
        expect(await salvar(analista, { escopo: 'tenant', metas: [{ indicador: 'tma', valor: 25 }] })).toMatchObject({ gravadas: 1, inalteradas: 0 });
        const linhas = await doAlvo();
        expect(linhas.filter((m) => m.escopo === 'tenant')).toHaveLength(2);
        expect(linhas.find((m) => m.indicador === 'tma').valor).toBe(25);
    });
    it('RN-CORE-45: a tela resolve "Vale hoje" com as linhas da API: usuário vence equipe, que vence a empresa, que vence o padrão do FDV', async () => {
        await salvar(admin, { escopo: 'equipe', equipe_id: A.equipes.equipe2, metas: [{ indicador: 'tma', valor: 15 }] });
        await salvar(gerente, { escopo: 'usuario', usuario_id: U.vendedor2, metas: [{ indicador: 'tma', valor: 10 }] });
        const todas = (await chamar('GET', 'metas-produtividade')).itens;
        const equipes = [{ id: A.equipes.equipe2, equipe_pai_id: A.equipes.regional }, { id: A.equipes.regional, equipe_pai_id: null }];
        const resolve = (alvo) => metasProdutividadeVigentes({ linhas: todas, equipes, alvo, mes: VIGENCIA });
        expect(resolve({ usuario_id: U.vendedor2, equipe_id: A.equipes.equipe2 }).tma).toEqual({ valor: 10, origem: 'usuario' });
        expect(resolve({ usuario_id: U.promotor, equipe_id: A.equipes.equipe2 }).tma).toEqual({ valor: 15, origem: 'equipe' });
        expect(resolve({ usuario_id: U.vendedor1, equipe_id: A.equipes.equipe1 }).tma).toEqual({ valor: 25, origem: 'tenant' });
        expect(resolve({ usuario_id: U.vendedor1, equipe_id: A.equipes.equipe1 }).tmd).toEqual({ valor: 25, origem: 'padrao_fdv' });
    });
    it('RN-CORE-45: vigência anterior ao mês de hoje, fora da faixa e último check-in antes do 1º são 422 com o campo no detalhe', async () => {
        const anterior = somarDiasCivis(`${MES}-01`, -5).slice(0, 7);
        await expect(chamar('PUT', 'metas-produtividade', admin, { corpo: { escopo: 'tenant', vigencia_inicio: anterior, metas: [{ indicador: 'tma', valor: 20 }] } })).rejects.toMatchObject({ status: 422, codigo: 'META_PRODUTIVIDADE_INVALIDA', detalhes: { campo: 'vigencia_inicio' } });
        // fora da faixa: barrado já pelo schema do corpo (a API revalida pelo domain nas duas camadas)
        await expect(salvar(admin, { escopo: 'tenant', metas: [{ indicador: 'tma', valor: 481 }] })).rejects.toThrow();
        await expect(salvar(admin, { escopo: 'tenant', metas: [{ indicador: 'primeiro_checkin', valor: 600 }, { indicador: 'ultimo_checkin', valor: 540 }] })).rejects.toMatchObject({ status: 422, codigo: 'META_PRODUTIVIDADE_INVALIDA', detalhes: { campo: 'ultimo_checkin' } });
        expect((await doAlvo()).some((m) => m.indicador === 'primeiro_checkin')).toBe(false);
    });
    it('RN-CORE-04: o gerente não define a meta da empresa (403), define a das equipes abaixo e a de usuário do escopo; usuário de outro perfil ou de outro tenant não recebe', async () => {
        await expect(salvar(gerente, { escopo: 'tenant', metas: [{ indicador: 'tma', valor: 20 }] })).rejects.toMatchObject({ status: 403, codigo: 'FORA_DO_ESCOPO' });
        expect(await salvar(gerente, { escopo: 'equipe', equipe_id: A.equipes.equipe1, metas: [{ indicador: 'visitas_dia', valor: 100 }] })).toMatchObject({ gravadas: 1 });
        await expect(salvar(gerente, { escopo: 'usuario', usuario_id: U.supervisor, metas: [{ indicador: 'tma', valor: 20 }] })).rejects.toMatchObject({ status: 422, codigo: 'META_PRODUTIVIDADE_INVALIDA', detalhes: { campo: 'usuario_id' } });
        await expect(salvar(admin, { escopo: 'usuario', usuario_id: B.usuarios.vendedor, metas: [{ indicador: 'tma', valor: 20 }] })).rejects.toMatchObject({ status: 404, codigo: 'USUARIO_NAO_ENCONTRADO' });
        await expect(salvar(admin, { escopo: 'equipe', equipe_id: B.equipes.equipe, metas: [{ indicador: 'tma', valor: 20 }] })).rejects.toMatchObject({ status: 404, codigo: 'EQUIPE_NAO_ENCONTRADA' });
        // a equipe da empresa que o gerente responde (regional) também é dele
        expect(await salvar(gerente, { escopo: 'equipe', equipe_id: A.equipes.regional, metas: [{ indicador: 'raio_checkin', valor: 150 }] })).toMatchObject({ gravadas: 1 });
    });
    it('a leitura é recortada pelo escopo: o gerente vê a empresa, as equipes de quem enxerga (e as de cima) e os usuários dele; o admin vê tudo do tenant, nunca o B', async () => {
        const doGerente = await doAlvo(gerente);
        expect(doGerente.some((m) => m.escopo === 'tenant')).toBe(true);
        expect(doGerente.some((m) => m.escopo === 'equipe' && m.equipe_id === A.equipes.equipe1)).toBe(true);
        const todas = (await chamar('GET', 'metas-produtividade', admin)).itens;
        expect(todas.some((m) => m.escopo === 'tenant' && m.indicador === 'km_dia' && m.valor === 150_000)).toBe(false); // linha da fixture do tenant B
        const doB = (await chamar('GET', 'metas-produtividade', adminB)).itens;
        expect(doB.some((m) => m.vigencia_inicio === VIGENCIA)).toBe(false);
        const supervisorLeitura = await chamar('GET', 'metas-produtividade', amb.usuario(U.supervisor, 'supervisor'));
        expect(supervisorLeitura.itens.some((m) => m.escopo === 'equipe' && m.equipe_id === A.equipes.equipe2)).toBe(false);
    });
    it('voltar a herdar apaga a linha do alvo (deleted_at), repetir responde igual, o pull leva a removida e o nível de cima volta a valer', async () => {
        const equipe2 = (await doAlvo()).find((m) => m.escopo === 'equipe' && m.equipe_id === A.equipes.equipe2 && m.indicador === 'tma');
        expect(await chamar('DELETE', 'metas-produtividade/:id', admin, { params: { id: equipe2.id } })).toEqual({ id: equipe2.id, removida: true });
        expect(await chamar('DELETE', 'metas-produtividade/:id', admin, { params: { id: equipe2.id } })).toEqual({ id: equipe2.id, removida: true });
        expect((await doAlvo()).some((m) => m.id === equipe2.id)).toBe(false);
        const pull = await amb.puxar(provedoresSyncT0170, 'meta_produtividade', amb.usuario(U.vendedor1, 'vendedor'));
        expect(pull.find((l) => l.id === equipe2.id)).toMatchObject({ deleted_at: expect.any(String) });
        await expect(chamar('DELETE', 'metas-produtividade/:id', admin, { params: { id: '0e600000-0000-4000-8000-000000000997' } })).rejects.toMatchObject({ status: 404, codigo: 'META_NAO_ENCONTRADA' });
        // o gerente não apaga a linha da empresa (403) e o tenant B não alcança a do A (404)
        const empresa = (await doAlvo()).find((m) => m.escopo === 'tenant');
        await expect(chamar('DELETE', 'metas-produtividade/:id', gerente, { params: { id: empresa.id } })).rejects.toMatchObject({ status: 403 });
        await expect(chamar('DELETE', 'metas-produtividade/:id', adminB, { params: { id: empresa.id } })).rejects.toMatchObject({ status: 404 });
    });
    it('auditoria meta_produtividade.editar com antes e depois, sem nome de pessoa', async () => {
        const aud = await amb.noTenant(A.tenantId, async (db) => (await db.query("select antes, depois from plataforma.auditoria where acao = 'meta_produtividade.editar' order by created_at desc limit 30")).rows);
        expect(aud.length).toBeGreaterThanOrEqual(5);
        expect(JSON.stringify(aud)).not.toMatch(/Vendedor|Gerente|@exemplo/);
        expect(aud.some((x) => JSON.stringify(x.antes).includes('"valor":20') && JSON.stringify(x.depois).includes('"valor":25'))).toBe(true);
    });
});
