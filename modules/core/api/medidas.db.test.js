/**
 * T-0063 × Postgres real (fixture dois-tenants, RLS): medidas do produto (RF-CORE-14; RN-CORE-19).
 * Medida por tenant (A não vê nem usa a do B), produto só aceita medida cadastrada e ativa, apagar em uso é recusado,
 * inativar em uso é permitido, o erro de FK do banco vira 422 (nunca 500), a consulta `core.medidas@1` e o pull da
 * entidade `medida`. Perfil sem permissão (403) e módulo sem licença são conferidos com as regras do SDK. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { criarPermissoes, verificarAcao } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MedidasEntradaSchema, MedidasSaidaSchema, MedidaSyncSchema, ProdutoSyncSchema } from '../contracts';
import { manifest } from '../manifest';
import { consultaMedidas, rotasDeMedidas, traduzirErroDeMedida } from './medidas';
import { rotasDeProdutos } from './produtos';
import { provedoresSyncCore } from './sync';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n) => `0e630000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Siglas de teste (fora da lista inicial) e ids dos produtos
const [P1, P2] = [id(901), id(902)];
describe.skipIf(semBanco())('Core T-0063 × Postgres: medidas do produto', () => {
    let pool;
    const usuario = (uid, perfil, tenant = A.tenantId) => ({ id: uid, tenant_id: tenant, perfil });
    const analista = usuario(A.usuarios.analista, 'analista');
    const analistaB = usuario(B.usuarios.admin, 'admin', B.tenantId);
    const ctx = (u) => ({
        usuario: u,
        requestId: 'req-teste',
        agora: () => new Date(),
        fuso: () => 'America/Manaus',
        comTenant: (fn) => comTenant(pool, u.tenant_id, (c) => fn(c, {})),
    });
    const todas = [...rotasDeMedidas, ...rotasDeProdutos];
    const chamar = async (metodo, caminho, u, extra = {}) => {
        const r = todas.find((x) => x.metodo === metodo && x.caminho === caminho);
        if (!r)
            throw new Error(`sem rota ${metodo} ${caminho}`);
        return (await r.executar({
            ...ctx(u),
            corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {},
            query: r.query ? r.query.parse(extra.query ?? {}) : {},
            params: r.params ? r.params.parse(extra.params ?? {}) : {},
        })); // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const criar = (u, medidaId, sigla, descricao = 'Medida de teste') => chamar('POST', 'medidas', u, { corpo: { id: medidaId, sigla, descricao } });
    const listar = async (u) => (await chamar('GET', 'medidas', u)).itens;
    const medidaDe = async (u, sigla) => (await listar(u)).find((m) => m.sigla === sigla);
    const medidasDoProduto = (u, produtoId, corpo) => chamar('PUT', 'produtos/:id/medidas', u, { params: { id: produtoId }, corpo });
    const consultar = (tenant, siglas) => comTenant(pool, tenant, (c) => consultaMedidas.executar(MedidasEntradaSchema.parse({ siglas }), { db: c }));
    const pedido = () => ({ desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 });
    const puxar = (entidade, u) => provedoresSyncCore.find((p) => p.entidade.nome === entidade).puxar(ctx(u), pedido());
    const erro = (p) => p.then(() => null, (e) => e);
    async function limparProdutos() {
        await comTenant(pool, A.tenantId, (c) => c.query('delete from core.produto where id = any($1::uuid[])', [[P1, P2]]));
        await comTenant(pool, B.tenantId, (c) => c.query('delete from core.produto where id = any($1::uuid[])', [[P1, P2]]));
    }
    async function produto(tenant, pid, sku, unidade = 'UN') {
        await comTenant(pool, tenant, (c) => c.query('insert into core.produto (id, tenant_id, sku, nome, unidade) values ($1, $2, $3, $4, $5)', [pid, tenant, sku, `Produto ${sku}`, unidade]));
    }
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
        await limparProdutos();
        await produto(A.tenantId, P1, 'T63-001');
        await produto(A.tenantId, P2, 'T63-002');
    });
    afterAll(async () => {
        if (pool) {
            await limparProdutos();
            await pool.end();
        }
    });
    it('RN-CORE-19: o tenant nasce com a lista inicial de 11 medidas (UN, CX, PCT, FD, LT, BD, TB, GL, KG, DZ, DP)', async () => {
        const siglas = (await listar(analista)).map((m) => m.sigla);
        for (const s of ['UN', 'CX', 'PCT', 'FD', 'LT', 'BD', 'TB', 'GL', 'KG', 'DZ', 'DP'])
            expect(siglas, s).toContain(s);
    });
    it('RN-CORE-19: cria medida (sigla aparada e em maiúsculas), é idempotente pelo id do cliente e recusa sigla repetida', async () => {
        const m = await criar(analista, id(1), ' zq ', ' Caixa de teste ');
        expect(m).toMatchObject({ id: id(1), sigla: 'ZQ', descricao: 'Caixa de teste', ativo: true, em_uso: 0 });
        // repetir o mesmo pedido (mesmo id) devolve a mesma medida, sem erro e sem duplicar
        expect(await criar(analista, id(1), ' zq ', ' Caixa de teste ')).toMatchObject({ id: id(1), sigla: 'ZQ' });
        expect((await listar(analista)).filter((x) => x.sigla === 'ZQ')).toHaveLength(1);
        // outro id com a mesma sigla = duplicada (422); sigla já da lista inicial também
        expect(await erro(criar(analista, id(2), 'ZQ'))).toMatchObject({ status: 422, codigo: 'MEDIDA_DUPLICADA' });
        expect(await erro(criar(analista, id(2), 'un'))).toMatchObject({ status: 422, codigo: 'MEDIDA_DUPLICADA' });
    });
    it('RN-CORE-19: sigla fora de 1 a 4 letras e descrição vazia são recusadas (422 MEDIDA_INVALIDA, mensagem em português)', async () => {
        for (const [sigla, descricao] of [['CAIXA', 'x'], ['C1', 'x'], ['', 'x'], ['ZW', '  ']]) {
            const e = await erro(criar(analista, id(3), sigla, descricao));
            expect(e, sigla).toMatchObject({ status: 422, codigo: 'MEDIDA_INVALIDA' });
            expect(e.message).toMatch(/medida|sigla|descrição/i);
        }
        expect(await medidaDe(analista, 'CAIXA')).toBeUndefined();
    });
    it('RN-CORE-05: o tenant A não vê nem usa a medida do tenant B (e cada tenant tem a sua sigla)', async () => {
        await criar(analistaB, id(10), 'ZB', 'Só do B');
        expect(await medidaDe(analista, 'ZB')).toBeUndefined();
        expect((await consultar(A.tenantId, ['ZB', 'ZQ'])).medidas.map((m) => m.sigla)).toEqual(['ZQ']);
        expect((await consultar(B.tenantId, ['ZB', 'ZQ'])).medidas.map((m) => m.sigla)).toEqual(['ZB']);
        // produto do A não aceita a sigla do B
        expect(await erro(medidasDoProduto(analista, P1, { unidade: 'ZB' }))).toMatchObject({ status: 422, codigo: 'MEDIDA_NAO_CADASTRADA' });
        // a mesma sigla pode existir nos dois tenants
        expect(await criar(analistaB, id(11), 'ZQ', 'ZQ do B')).toMatchObject({ sigla: 'ZQ' });
        // editar/apagar por id de outro tenant = 404
        expect(await erro(chamar('PUT', 'medidas/:id', analistaB, { params: { id: id(1) }, corpo: { descricao: 'invasão' } }))).toMatchObject({ status: 404 });
        expect(await erro(chamar('DELETE', 'medidas/:id', analistaB, { params: { id: id(1) } }))).toMatchObject({ status: 404 });
        expect((await medidaDe(analista, 'ZQ')).descricao).toBe('Caixa de teste');
    });
    it('RN-CORE-19: core.medidas@1 devolve só as que existem (ativas e inativas), com a sigla normalizada', async () => {
        await chamar('PUT', 'medidas/:id', analista, { params: { id: id(1) }, corpo: { ativo: false } });
        const r = MedidasSaidaSchema.parse(await consultar(A.tenantId, ['zq', 'un', 'NAOEXISTE'.slice(0, 4)]));
        expect(r.medidas).toEqual([
            { sigla: 'UN', descricao: 'Unidade', ativo: true },
            { sigla: 'ZQ', descricao: 'Caixa de teste', ativo: false },
        ]);
        await chamar('PUT', 'medidas/:id', analista, { params: { id: id(1) }, corpo: { ativo: true } });
        expect((await consultar(A.tenantId, [])).medidas).toEqual([]);
        expect(() => MedidasEntradaSchema.parse({ siglas: Array.from({ length: 501 }, () => 'UN') })).toThrow();
    });
    it('RN-CORE-19: produto recusa sigla não cadastrada e sigla inativa; aceita ativa com embalagem e grava as colunas', async () => {
        expect(await erro(medidasDoProduto(analista, P1, { unidade: 'XX' }))).toMatchObject({ status: 422, codigo: 'MEDIDA_NAO_CADASTRADA' });
        await criar(analista, id(4), 'ZI', 'Inativa');
        await chamar('PUT', 'medidas/:id', analista, { params: { id: id(4) }, corpo: { ativo: false } });
        expect(await erro(medidasDoProduto(analista, P1, { unidade: 'ZI' }))).toMatchObject({ status: 422, codigo: 'MEDIDA_INATIVA' });
        expect(await erro(medidasDoProduto(analista, P1, { unidade: 'UN', embalagem_medida: 'ZI', embalagem_quantidade: 6 }))).toMatchObject({ status: 422, codigo: 'MEDIDA_INATIVA' });
        const ok = await medidasDoProduto(analista, P1, { unidade: ' un ', embalagem_medida: 'cx', embalagem_quantidade: 12 });
        expect(ok).toMatchObject({ id: P1, unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 });
        const linha = await comTenant(pool, A.tenantId, (c) => c.query('select unidade, embalagem_medida, embalagem_quantidade from core.produto where id = $1', [P1]));
        expect(linha.rows[0]).toEqual({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 });
        // a listagem do BKO traz a medida e a embalagem
        const lista = await chamar('GET', 'produtos', analista, { query: { q: 'T63-001' } });
        expect(lista.itens[0]).toMatchObject({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 });
    });
    it('RN-CORE-19: embalagem é tudo ou nada, inteira > 1 e diferente da unidade (422)', async () => {
        expect(await erro(medidasDoProduto(analista, P2, { unidade: 'UN', embalagem_medida: 'CX' }))).toMatchObject({ status: 422, codigo: 'EMBALAGEM_INCOMPLETA' });
        expect(await erro(medidasDoProduto(analista, P2, { unidade: 'UN', embalagem_quantidade: 12 }))).toMatchObject({ status: 422, codigo: 'EMBALAGEM_INCOMPLETA' });
        expect(await erro(medidasDoProduto(analista, P2, { unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 1 }))).toMatchObject({ status: 422, codigo: 'EMBALAGEM_INVALIDA' });
        expect(await erro(medidasDoProduto(analista, P2, { unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 2.5 }))).toMatchObject({ status: 422, codigo: 'EMBALAGEM_INVALIDA' });
        expect(await erro(medidasDoProduto(analista, P2, { unidade: 'UN', embalagem_medida: 'UN', embalagem_quantidade: 6 }))).toMatchObject({ status: 422, codigo: 'EMBALAGEM_INVALIDA' });
        expect(await medidasDoProduto(analista, P2, { unidade: 'UN', embalagem_medida: null, embalagem_quantidade: null })).toMatchObject({ embalagem_medida: null, embalagem_quantidade: null });
    });
    it('RN-CORE-19: quantidade da embalagem acima de 9999 é recusada com 422 (nunca 500 de integer fora do intervalo)', async () => {
        for (const q of [10_000, 2_147_483_648, 99_999_999_999]) {
            expect(await erro(medidasDoProduto(analista, P2, { unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: q })), String(q)).toMatchObject({ status: 422, codigo: 'EMBALAGEM_INVALIDA' });
        }
        expect(await medidasDoProduto(analista, P2, { unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 9999 })).toMatchObject({ embalagem_quantidade: 9999 });
        await medidasDoProduto(analista, P2, { unidade: 'UN', embalagem_medida: null, embalagem_quantidade: null });
    });
    it('RN-VEN-15: embalagem do produto divergente da unidade de venda do ERP (core.produto_unidade) é recusada com 422; igual ao fator passa', async () => {
        await comTenant(pool, A.tenantId, (c) => c.query("insert into core.produto_unidade (tenant_id, produto_id, unidade, fator) values ($1, $2, 'CX', 6)", [A.tenantId, P2]));
        try {
            const e = await erro(medidasDoProduto(analista, P2, { unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 }));
            expect(e).toMatchObject({ status: 422, codigo: 'EMBALAGEM_DIVERGE_ERP' });
            expect(e.message).toContain('A embalagem CX deste produto já vem do ERP com 6 unidades');
            expect(await medidasDoProduto(analista, P2, { unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 6 })).toMatchObject({ embalagem_medida: 'CX', embalagem_quantidade: 6 });
            // outra sigla de embalagem, sem unidade de venda no ERP, segue livre
            expect(await medidasDoProduto(analista, P2, { unidade: 'UN', embalagem_medida: 'DZ', embalagem_quantidade: 12 })).toMatchObject({ embalagem_medida: 'DZ', embalagem_quantidade: 12 });
        }
        finally {
            await comTenant(pool, A.tenantId, (c) => c.query('delete from core.produto_unidade where produto_id = $1', [P2]));
            await medidasDoProduto(analista, P2, { unidade: 'UN', embalagem_medida: null, embalagem_quantidade: null });
        }
    });
    it('RN-CORE-19: dois POST simultâneos com o mesmo id devolvem a mesma medida (idempotente); com ids diferentes e mesma sigla, um vence e o outro leva 422 MEDIDA_DUPLICADA', async () => {
        const [x, y] = await Promise.all([criar(analista, id(40), 'ZC', 'Concorrente'), criar(analista, id(40), 'ZC', 'Concorrente')]);
        expect(x).toMatchObject({ id: id(40), sigla: 'ZC' });
        expect(y).toMatchObject({ id: id(40), sigla: 'ZC' });
        expect((await listar(analista)).filter((m) => m.sigla === 'ZC')).toHaveLength(1);
        const r = await Promise.all([erro(criar(analista, id(41), 'ZD')), erro(criar(analista, id(42), 'ZD'))]);
        expect(r.filter((e) => e === null)).toHaveLength(1);
        expect(r.find((e) => e !== null)).toMatchObject({ status: 422, codigo: 'MEDIDA_DUPLICADA' });
    });
    it('RN-CORE-19: produto de outro tenant não é editado (404)', async () => {
        expect(await erro(medidasDoProduto(analistaB, P1, { unidade: 'UN' }))).toMatchObject({ status: 404, codigo: 'PRODUTO_NAO_ENCONTRADO' });
    });
    it('RN-CORE-19: apagar medida em uso é recusado com a contagem; embalagem também conta como uso', async () => {
        // CX é a embalagem do P1 e ZQ ainda não é usada: usa ZQ como unidade do P2
        await medidasDoProduto(analista, P2, { unidade: 'ZQ' });
        expect(await medidaDe(analista, 'ZQ')).toMatchObject({ em_uso: 1 });
        const e = await erro(chamar('DELETE', 'medidas/:id', analista, { params: { id: id(1) } }));
        expect(e).toMatchObject({ status: 422, codigo: 'MEDIDA_EM_USO' });
        expect(e.message).toBe('Medida em uso por 1 produto(s): inative em vez de apagar.');
        const cx = await medidaDe(analista, 'CX');
        expect(cx.em_uso).toBeGreaterThanOrEqual(1);
        expect(await erro(chamar('DELETE', 'medidas/:id', analista, { params: { id: cx.id } }))).toMatchObject({ status: 422, codigo: 'MEDIDA_EM_USO' });
        expect(await medidaDe(analista, 'ZQ')).toBeDefined();
    });
    it('RN-CORE-19: a sigla de medida em uso não muda (a descrição sim); sem uso a sigla muda; sigla repetida é recusada', async () => {
        expect(await erro(chamar('PUT', 'medidas/:id', analista, { params: { id: id(1) }, corpo: { sigla: 'ZR' } }))).toMatchObject({ status: 422, codigo: 'MEDIDA_EM_USO' });
        expect(await chamar('PUT', 'medidas/:id', analista, { params: { id: id(1) }, corpo: { descricao: 'Caixa de teste 2' } })).toMatchObject({ sigla: 'ZQ', descricao: 'Caixa de teste 2' });
        await criar(analista, id(5), 'ZS', 'Sem uso');
        expect(await chamar('PUT', 'medidas/:id', analista, { params: { id: id(5) }, corpo: { sigla: 'zt' } })).toMatchObject({ sigla: 'ZT' });
        expect(await erro(chamar('PUT', 'medidas/:id', analista, { params: { id: id(5) }, corpo: { sigla: 'ZQ' } }))).toMatchObject({ status: 422, codigo: 'MEDIDA_DUPLICADA' });
    });
    it('RN-CORE-19: inativar medida em uso é permitido: o produto mantém a sigla e pode editar o resto, mas a medida some das escolhas novas', async () => {
        const m = await chamar('PUT', 'medidas/:id', analista, { params: { id: id(1) }, corpo: { ativo: false } });
        expect(m).toMatchObject({ ativo: false, em_uso: 1 });
        // o P2 continua com ZQ e pode regravar as medidas dele (sigla inalterada)
        expect(await medidasDoProduto(analista, P2, { unidade: 'ZQ', embalagem_medida: 'CX', embalagem_quantidade: 4 })).toMatchObject({ unidade: 'ZQ', embalagem_medida: 'CX' });
        // mas outro produto não escolhe a inativa
        expect(await erro(medidasDoProduto(analista, P1, { unidade: 'ZQ' }))).toMatchObject({ status: 422, codigo: 'MEDIDA_INATIVA' });
        // inativar de novo (repetição) não muda nada; reativar volta
        expect(await chamar('PUT', 'medidas/:id', analista, { params: { id: id(1) }, corpo: { ativo: false } })).toMatchObject({ ativo: false });
        expect(await chamar('PUT', 'medidas/:id', analista, { params: { id: id(1) }, corpo: { ativo: true } })).toMatchObject({ ativo: true });
    });
    it('RN-CORE-19: apagar medida sem uso é permitido (some da lista) e a sigla pode ser cadastrada de novo', async () => {
        await chamar('DELETE', 'medidas/:id', analista, { params: { id: id(5) } }); // ZT, sem uso
        expect(await medidaDe(analista, 'ZT')).toBeUndefined();
        expect(await erro(chamar('DELETE', 'medidas/:id', analista, { params: { id: id(5) } }))).toMatchObject({ status: 404 });
        const nova = await criar(analista, id(6), 'ZT', 'De novo');
        expect(nova).toMatchObject({ id: id(6), sigla: 'ZT', descricao: 'De novo', ativo: true });
        // repetir o POST com o mesmo id continua idempotente
        expect(await criar(analista, id(6), 'ZT', 'De novo')).toMatchObject({ id: id(6) });
    });
    it('RN-CORE-19: erro de FK/gatilho do banco vira 422 amigável, não 500', async () => {
        const tentar = (sql, v = []) => comTenant(pool, A.tenantId, (c) => c.query(sql, v)).then(() => null, (e) => {
            try {
                traduzirErroDeMedida(e);
            }
            catch (t) {
                return t;
            }
            return e;
        });
        // sigla inexistente direto no produto (FK)
        expect(await tentar("update core.produto set unidade = 'QQ' where id = $1", [P1])).toMatchObject({ status: 422, codigo: 'MEDIDA_NAO_CADASTRADA' });
        // sigla repetida (unique)
        expect(await tentar("insert into core.medida (tenant_id, sigla, descricao) values ($1, 'UN', 'Outra')", [A.tenantId])).toMatchObject({ status: 422, codigo: 'MEDIDA_DUPLICADA' });
        // apagar medida em uso direto no banco (gatilho)
        expect(await tentar("update core.medida set deleted_at = now() where tenant_id = $1 and sigla = 'CX'", [A.tenantId])).toMatchObject({ status: 422, codigo: 'MEDIDA_EM_USO' });
        // trocar a sigla de medida em uso direto no banco (FK sem ação)
        expect(await tentar("update core.medida set sigla = 'ZZZ' where tenant_id = $1 and sigla = 'CX'", [A.tenantId])).toMatchObject({ status: 422, codigo: 'MEDIDA_EM_USO' });
        // formato da sigla (check)
        expect(await tentar("insert into core.medida (tenant_id, sigla, descricao) values ($1, 'abc', 'x')", [A.tenantId])).toMatchObject({ status: 422, codigo: 'MEDIDA_INVALIDA' });
    });
    it('RN-CORE-19: o pull leva a entidade medida (ativas, inativas e removidas) só do tenant e a embalagem do produto', async () => {
        const a = (await puxar('medida', analista)).map((l) => MedidaSyncSchema.parse(l));
        expect(a.map((l) => l.sigla)).toEqual(expect.arrayContaining(['UN', 'CX', 'ZQ', 'ZT']));
        expect(a.find((l) => l.sigla === 'UN')).toMatchObject({ descricao: 'Unidade', ativo: true });
        expect(a.map((l) => l.sigla)).not.toContain('ZB');
        const b = (await puxar('medida', analistaB)).map((l) => l.sigla);
        expect(b).toContain('ZB');
        expect(b).not.toContain('ZI');
        const p = (await puxar('produto', analista)).map((l) => ProdutoSyncSchema.parse(l)).find((l) => l.id === P1);
        expect(p).toMatchObject({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 });
    });
    it('RN-CORE-19: a auditoria registra criar, inativar e apagar medida (sem dado pessoal)', async () => {
        const r = await comTenant(pool, A.tenantId, (c) => c.query("select acao from plataforma.auditoria where entidade = 'medida' and modulo = 'core' order by ocorrido_em"));
        const acoes = new Set(r.rows.map((x) => x.acao));
        for (const a of ['medida.criar', 'medida.editar', 'medida.inativar', 'medida.reativar', 'medida.apagar'])
            expect(acoes.has(a), a).toBe(true);
    });
});
describe('RN-CORE-19: permissões das rotas de medida (perfil e licença do módulo)', () => {
    const permissoes = criarPermissoes([manifest]);
    const rotas = [...rotasDeMedidas, ...rotasDeProdutos.filter((r) => r.caminho === 'produtos/:id/medidas')];
    const usuario = (perfil, modulos = ['core']) => ({ id: 'u', tenant_id: 't', perfil, modulos });
    it('RN-CORE-19: toda rota de medida declara uma ação do manifesto (a API exige perfil e licença)', () => {
        expect(rotas.length).toBe(5);
        for (const r of rotas) {
            expect(r.acao, `${r.metodo} ${r.caminho}`).toBeTruthy();
            expect(Object.keys(manifest.acoes ?? {}), r.acao).toContain(r.acao);
        }
    });
    it('RN-CORE-19: só analista e admin cadastram; gerente só consulta; vendedor e promotor recebem 403', () => {
        const escrita = rotas.filter((r) => r.metodo !== 'GET');
        for (const r of escrita) {
            for (const perfil of ['analista', 'admin'])
                expect(verificarAcao(usuario(perfil), permissoes, r.acao).ok, `${perfil} ${r.metodo} ${r.caminho}`).toBe(true);
            for (const perfil of ['vendedor', 'promotor', 'supervisor', 'gerente', 'assistente']) {
                expect(verificarAcao(usuario(perfil), permissoes, r.acao), `${perfil} ${r.metodo} ${r.caminho}`).toMatchObject({ ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO' });
            }
        }
        const leitura = rotas.find((r) => r.metodo === 'GET');
        expect(verificarAcao(usuario('gerente'), permissoes, leitura.acao).ok).toBe(true);
        expect(verificarAcao(usuario('vendedor'), permissoes, leitura.acao)).toMatchObject({ ok: false, status: 403 });
    });
    it('RN-CORE-02: módulo sem licença bloqueia a rota (403 MODULO_INATIVO), como as demais rotas', () => {
        for (const r of rotas)
            expect(verificarAcao(usuario('admin', []), permissoes, r.acao), `${r.metodo} ${r.caminho}`).toMatchObject({ ok: false, status: 403, codigo: 'MODULO_INATIVO' });
    });
    it('RN-CORE-19: o Core oferece core.medidas@1 no manifesto e a entidade medida no sync', () => {
        expect(manifest.ofereceConsultas).toContain('core.medidas@1');
        expect(manifest.sync).toContain('medida');
    });
});
