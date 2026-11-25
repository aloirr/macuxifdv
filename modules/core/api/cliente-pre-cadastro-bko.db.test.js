/**
 * BKO dos pré-cadastros recusados × Postgres real (fixture dois-tenants, papel macuxi_app, RLS; migração 0098; ADR 0069 §7;
 * RN-CORE-78): perfil e licença pelo motor de permissões do SDK, escopo de carteira, multi-tenant, lista (situação, ordem, cursor,
 * documento mascarado), dados atuais, histórico, correção pelo BKO e o alias do recusado substituído pelo APK v1.0.28.
 * Cada caso roda numa transação desfeita no fim. Pula sem Postgres.
 */
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { criarPermissoes, verificarAcao } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENTO_CLIENTE_PRE_CADASTRO_REVISADO } from '../contracts';
import { manifest } from '../manifest';
import { A, B, emTransacao, ENDERECO_COMPLETO, recusar } from './apoio-teste-pre-cadastro';
import { rotasDeClienteCadastro } from './cliente-cadastro';
import { ACAO_PRE_CADASTRO_CORRIGIR, ACAO_PRE_CADASTRO_RECUSADOS, listarRecusados, rotasDePreCadastroBko } from './cliente-pre-cadastro-bko';
import { receberPreCadastros } from './pre-cadastro-receber';
const ID1 = '5b000000-0000-4000-8000-000000000001';
const ID2 = '5b000000-0000-4000-8000-000000000002';
const ID3 = '5b000000-0000-4000-8000-000000000003';
const ID4 = '5b000000-0000-4000-8000-000000000004';
const DOCS = { [ID1]: '11222333000181', [ID2]: '11444777000161', [ID3]: '12345678909', [ID4]: '11222333000181' };
const VENDEDOR = { id: A.usuarios.vendedor1, perfil: 'vendedor' };
const ANALISTA = { id: A.usuarios.analista, perfil: 'analista' };
const ADMIN = { id: A.usuarios.admin, perfil: 'admin' };
const pre = (id, extra = {}) => ({ id, origem: 'campo', razao_social: `Mercado ${id.slice(-1)}`, documento: DOCS[id], ...ENDERECO_COMPLETO, ...extra });
const criar = (t, id, u = VENDEDOR) => t.rota(rotasDeClienteCadastro, 'POST', 'clientes/pre-cadastro', u, { corpo: pre(id) });
const bko = (t, metodo, caminho, u = ANALISTA, extra = {}) => t.rota(rotasDePreCadastroBko, metodo, caminho, u, extra);
const correcao = (id, revisao_base, extra = {}) => {
    const { id: _id, origem: _o, ...dados } = pre(id, extra);
    return { ...dados, revisao_base };
};
describe('RN-CORE-78: permissões das rotas dos recusados (perfil e licença do Core)', () => {
    const permissoes = criarPermissoes([manifest]);
    const quem = (acao, modulos = ['core']) => ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'].filter((perfil) => verificarAcao({ id: 'x', tenant_id: A.tenantId, perfil, modulos }, permissoes, acao).ok);
    it('RN-CORE-78: só analista e admin listam, veem e corrigem; o vendedor recebe PERFIL_SEM_ACESSO', () => {
        expect(quem(ACAO_PRE_CADASTRO_RECUSADOS)).toEqual(['analista', 'admin']);
        expect(quem(ACAO_PRE_CADASTRO_CORRIGIR)).toEqual(['analista', 'admin']);
        expect(verificarAcao({ id: 'x', tenant_id: A.tenantId, perfil: 'vendedor', modulos: ['core'] }, permissoes, ACAO_PRE_CADASTRO_CORRIGIR)).toMatchObject({ ok: false, codigo: 'PERFIL_SEM_ACESSO' });
    });
    it('RN-CORE-03: sem a licença do Core, MODULO_INATIVO mesmo para o admin', () => {
        expect(quem(ACAO_PRE_CADASTRO_RECUSADOS, [])).toEqual([]);
        expect(verificarAcao({ id: 'x', tenant_id: A.tenantId, perfil: 'admin', modulos: [] }, permissoes, ACAO_PRE_CADASTRO_CORRIGIR)).toMatchObject({ ok: false, codigo: 'MODULO_INATIVO' });
    });
    it('RN-CORE-04: a lista filtra no domínio e as rotas por id entregam o cliente do caminho à conferência da carteira', () => {
        const [lista, ...porId] = rotasDePreCadastroBko;
        expect(lista.carteira).toBe('filtrar_no_dominio');
        for (const r of porId)
            expect(r.carteira({ params: { id: ID1 } })).toBe(ID1);
    });
});
describe.skipIf(semBanco())('Core × Postgres: BKO dos pré-cadastros recusados (RN-CORE-78, ADR 0069 §7)', () => {
    let pool;
    beforeAll(() => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
    });
    afterAll(async () => {
        await pool?.end();
    });
    it('RN-CORE-78: a lista traz só os recusados da situação pedida, recusa mais recente primeiro, documento mascarado, motivo, erros e vendedor', async () => {
        await emTransacao(pool, async (t) => {
            for (const id of [ID1, ID2, ID3])
                await criar(t, id);
            await recusar(t, ID1, 'IE inválida.');
            await recusar(t, ID2, 'CNPJ bloqueado.', []);
            await t.q("update core.cliente_pre_cadastro_tentativa set respondido_em = now() - interval '1 hour' where cliente_id = $1", [ID1]);
            const r = await bko(t, 'GET', 'clientes/pre-cadastro/recusados');
            expect(r.itens.map((i) => i.cliente_id)).toEqual([ID2, ID1]);
            expect(r.itens[1]).toMatchObject({
                revisao: 1,
                documento_mascarado: '11.222.333/****-**',
                razao_social: 'Mercado 1',
                vendedor: { id: A.usuarios.vendedor1, nome: expect.any(String) },
                motivo: 'IE inválida.',
                erros: [{ campo: 'inscricao_estadual', codigo: 'IE_INVALIDA', mensagem: 'IE não confere.' }],
                situacao: 'recusado',
                codigo_fdv: expect.stringMatching(/^\d{5,}$/),
                external_id: null,
            });
            expect(JSON.stringify(r)).not.toContain(DOCS[ID1]);
            expect(r.proximo_cursor).toBeNull();
            // cursor: uma por página
            const p1 = await bko(t, 'GET', 'clientes/pre-cadastro/recusados', ANALISTA, { query: { limite: '1' } });
            expect(p1.itens.map((i) => i.cliente_id)).toEqual([ID2]);
            const p2 = await bko(t, 'GET', 'clientes/pre-cadastro/recusados', ANALISTA, { query: { limite: '1', cursor: p1.proximo_cursor } });
            expect(p2.itens.map((i) => i.cliente_id)).toEqual([ID1]);
            expect(p2.proximo_cursor).toBeNull();
            // busca por razão social e pelo prefixo do documento
            expect((await bko(t, 'GET', 'clientes/pre-cadastro/recusados', ANALISTA, { query: { busca: 'cado 2' } })).itens).toHaveLength(1);
            expect((await bko(t, 'GET', 'clientes/pre-cadastro/recusados', ANALISTA, { query: { busca: '11.222' } })).itens.map((i) => i.cliente_id)).toEqual([ID1]);
            // corrigido = reenviado (com o motivo e os erros da última recusa); sai da lista dos recusados
            await bko(t, 'PUT', 'clientes/:id/pre-cadastro', ADMIN, { params: { id: ID1 }, corpo: correcao(ID1, 1, { inscricao_estadual: '041234567' }) });
            expect((await bko(t, 'GET', 'clientes/pre-cadastro/recusados')).itens.map((i) => i.cliente_id)).toEqual([ID2]);
            const reenviados = await bko(t, 'GET', 'clientes/pre-cadastro/recusados', ANALISTA, { query: { situacao: 'reenviado' } });
            expect(reenviados.itens).toMatchObject([{ cliente_id: ID1, revisao: 2, situacao: 'reenviado', motivo: 'IE inválida.' }]);
            // aprovado pelo ERP depois de recusado = aceito
            await t.q("update core.cliente set status_cadastro = 'aprovado', aprovado_em = now(), external_id = 'ERP-9' where id = $1", [ID1]);
            await t.q("update core.cliente_pre_cadastro_tentativa set resultado = 'aceito', respondido_em = now() where cliente_id = $1 and revisao = 2", [ID1]);
            expect((await bko(t, 'GET', 'clientes/pre-cadastro/recusados', ANALISTA, { query: { situacao: 'aceito' } })).itens).toMatchObject([{ cliente_id: ID1, external_id: 'ERP-9' }]);
            // o histórico mostra o Código ERP só na tentativa aceita
            const h = await bko(t, 'GET', 'clientes/:id/pre-cadastro/historico', ANALISTA, { params: { id: ID1 } });
            expect(h.tentativas.map((x) => [x.revisao, x.resultado, x.external_id])).toEqual([
                [2, 'aceito', 'ERP-9'],
                [1, 'recusado', null],
            ]);
        });
    });
    it('RN-CORE-04: a lista respeita a carteira quando o escopo não é o tenant', async () => {
        await emTransacao(pool, async (t) => {
            await criar(t, ID1);
            await criar(t, ID2, ADMIN);
            await recusar(t, ID1);
            await recusar(t, ID2);
            const soVendedor = await listarRecusados(t.c, { situacao: 'recusado', limite: 50 }, new Set([ID1]));
            expect(soVendedor.itens.map((i) => i.cliente_id)).toEqual([ID1]);
            expect((await listarRecusados(t.c, { situacao: 'recusado', limite: 50 }, new Set())).itens).toEqual([]);
        });
    });
    it('RN-CORE-78: dados atuais e histórico; a correção do BKO grava origem bko, quem corrigiu, publica a revisão e recusa a base velha', async () => {
        await emTransacao(pool, async (t) => {
            await criar(t, ID1);
            await recusar(t, ID1);
            const atual = await bko(t, 'GET', 'clientes/:id/pre-cadastro', ANALISTA, { params: { id: ID1 } });
            expect(atual).toMatchObject({ id: ID1, revisao: 1, status_cadastro: 'recusado', documento: DOCS[ID1], motivo: 'CNPJ com cadastro bloqueado no ERP.', erros: [{ campo: 'inscricao_estadual' }] });
            // ADR 0069 item 10: os dois códigos, só de leitura (Código ERP vazio até o vínculo)
            expect(atual).toMatchObject({ codigo_fdv: expect.stringMatching(/^\d{5,}$/), external_id: null });
            await expect(bko(t, 'PUT', 'clientes/:id/pre-cadastro', ANALISTA, { params: { id: ID1 }, corpo: { ...correcao(ID1, 1), codigo_fdv: atual.codigo_fdv } })).rejects.toMatchObject({
                status: 422,
                codigo: 'CODIGO_FDV_SOMENTE_LEITURA',
            });
            t.publicar.mockClear();
            const r = await bko(t, 'PUT', 'clientes/:id/pre-cadastro', ANALISTA, { params: { id: ID1 }, corpo: correcao(ID1, 1, { inscricao_estadual: '041234567' }) });
            expect(r).toEqual({ id: ID1, status_cadastro: 'pendente', revisao: 2, ja_existia: false, codigo_fdv: expect.stringMatching(/^\d{5,}$/) });
            expect(t.publicar.mock.calls.filter((c) => c[0].nome === EVENTO_CLIENTE_PRE_CADASTRO_REVISADO.nome)[0][1]).toMatchObject({ cliente_id: ID1, revisao: 2, origem: 'bko' });
            const h = await bko(t, 'GET', 'clientes/:id/pre-cadastro/historico', ANALISTA, { params: { id: ID1 } });
            expect(h.revisao_atual).toBe(2);
            expect(h.tentativas.map((x) => [x.revisao, x.origem, x.resultado])).toEqual([
                [2, 'bko', 'aguardando'],
                [1, 'campo', 'recusado'],
            ]);
            expect(h.tentativas[0]).toMatchObject({ corrigido_por: { id: A.usuarios.analista, perfil: 'analista', nome: expect.any(String) }, campos_alterados: ['inscricao_estadual'], motivo: null, erros: [] });
            expect(h.tentativas[1]).toMatchObject({ motivo: 'CNPJ com cadastro bloqueado no ERP.', erros: [{ campo: 'inscricao_estadual', codigo: 'IE_INVALIDA', mensagem: 'IE não confere.' }] });
            // o vendedor corrigiu ao mesmo tempo, na revisão 1 com outros dados: chega depois e recarrega
            expect(await t.push(receberPreCadastros, VENDEDOR, [pre(ID1, { revisao_base: 1, numero: '77' })])).toMatchObject([{ id: ID1, status: 'rejeitado', codigo: 'REVISAO_DESATUALIZADA' }]);
            // sem estar recusado: 422; campos faltando: 422 CAMPOS_OBRIGATORIOS
            await expect(bko(t, 'PUT', 'clientes/:id/pre-cadastro', ADMIN, { params: { id: ID1 }, corpo: correcao(ID1, 2) })).rejects.toMatchObject({ status: 422, codigo: 'CADASTRO_NAO_RECUSADO' });
            await recusar(t, ID1);
            await expect(bko(t, 'PUT', 'clientes/:id/pre-cadastro', ADMIN, { params: { id: ID1 }, corpo: correcao(ID1, 2, { numero: null }) })).rejects.toMatchObject({ status: 422, codigo: 'CAMPOS_OBRIGATORIOS' });
            const aud = await t.q("select depois from plataforma.auditoria where acao = 'cliente.pre_cadastro_corrigir' and entidade_id = $1", [ID1]);
            expect(aud.map((a) => a.depois)).toEqual([{ revisao: 2, campos_alterados: ['inscricao_estadual'], origem: 'bko' }]);
        });
    });
    it('RN-CORE-78 (ADR 0069 §4): o id do recusado substituído pelo APK v1.0.28 resolve para o cliente vivo; o que não é pré-cadastro dá 404', async () => {
        await emTransacao(pool, async (t) => {
            await criar(t, ID1);
            await recusar(t, ID1);
            expect(await t.push(receberPreCadastros, VENDEDOR, [pre(ID4)])).toEqual([{ id: ID4, status: 'aceito' }]);
            expect(await bko(t, 'GET', 'clientes/:id/pre-cadastro', ANALISTA, { params: { id: ID1 } })).toMatchObject({ id: ID4, revisao: 2, status_cadastro: 'pendente' });
            const h = await bko(t, 'GET', 'clientes/:id/pre-cadastro/historico', ANALISTA, { params: { id: ID1 } });
            expect(h).toMatchObject({ cliente_id: ID4, revisao_atual: 2 });
            expect(h.tentativas.map((x) => [x.revisao, x.cliente_id_original])).toEqual([
                [2, null],
                [1, ID1],
            ]);
            // cliente do ERP (sem revisão de pré-cadastro) não é pré-cadastro
            await expect(bko(t, 'GET', 'clientes/:id/pre-cadastro', ANALISTA, { params: { id: A.clientes.c1 } })).rejects.toMatchObject({ status: 404, codigo: 'NAO_ENCONTRADO' });
            await expect(bko(t, 'PUT', 'clientes/:id/pre-cadastro', ADMIN, { params: { id: A.clientes.c1 }, corpo: correcao(ID3, 1) })).rejects.toMatchObject({ status: 404 });
        });
    });
    it('RN-CORE-05: o tenant B não vê nem corrige o recusado do tenant A (RLS)', async () => {
        await emTransacao(pool, async (t) => {
            await criar(t, ID1);
            await recusar(t, ID1);
            await t.trocarTenant(B.tenantId);
            const deB = { id: B.usuarios.admin, perfil: 'admin', tenant: B.tenantId };
            const lista = await bko(t, 'GET', 'clientes/pre-cadastro/recusados', deB);
            expect(lista.itens.map((i) => i.cliente_id)).not.toContain(ID1);
            await expect(bko(t, 'GET', 'clientes/:id/pre-cadastro', deB, { params: { id: ID1 } })).rejects.toMatchObject({ status: 404 });
            await expect(bko(t, 'GET', 'clientes/:id/pre-cadastro/historico', deB, { params: { id: ID1 } })).rejects.toMatchObject({ status: 404 });
            await expect(bko(t, 'PUT', 'clientes/:id/pre-cadastro', deB, { params: { id: ID1 }, corpo: correcao(ID1, 1) })).rejects.toMatchObject({ status: 404 });
            await t.trocarTenant(A.tenantId);
            expect((await t.q('select revisao_cadastro from core.cliente where id = $1', [ID1]))[0].revisao_cadastro).toBe(1);
        });
    });
});
