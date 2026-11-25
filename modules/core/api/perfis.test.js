import { catalogoDePermissoes, criarPermissoes, matrizDeFabrica, PERFIS, verificarAcao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CriarPerfilRequestSchema, PerfilDetalheSchema, PerfilListaRespostaSchema } from '../contracts';
import { perfisDeFabrica } from '../domain';
import { manifest } from '../manifest';
import { rotasDePerfis } from './perfis';
const TENANT = '0a000000-0000-4000-8000-0000000000aa';
const ADMIN = { id: '0b000000-0000-4000-8000-0000000000ad', tenant_id: TENANT, perfil: 'admin', modulos: ['core'], perfis: perfisDeFabrica('admin') };
const idDe = (b) => `0d000000-0000-4000-8000-00000000000${PERFIS.indexOf(b)}`;
/** Banco falso: a primeira regra que casa responde; guarda tudo o que foi executado. */
function fakeDb(respostas = []) {
    const chamadas = [];
    const db = {
        query: async (sql, valores = []) => {
            chamadas.push({ sql, valores });
            const rows = (respostas.find(([re]) => re.test(sql))?.[1] ?? []);
            return { rows, rowCount: rows.length };
        },
    };
    return { db, chamadas };
}
/** O tenant como a 0041 deixa: 7 perfis de fábrica, sem sobreposição, um admin ativo. */
const tenant = (extra = [], admins = [{ id: ADMIN.id, ativo: true, perfis: ['admin'] }]) => [
    ...extra,
    [/select id, codigo, nome, descricao, base, fabrica, ativo, cargo from plataforma.perfil/, PERFIS.map((b) => ({ id: idDe(b), codigo: b, nome: b, descricao: null, base: b, fabrica: true, ativo: true }))],
    [/from plataforma.perfil_permissao/, []],
    [/coalesce\(array_agg/, admins],
    [/select codigo from plataforma.perfil$/, PERFIS.map((codigo) => ({ codigo }))],
    [/select id from plataforma.perfil where codigo/, [{ id: idDe('vendedor') }]],
];
function contexto(db, usuario = ADMIN) {
    const tx = { publicar: async () => ({}) };
    return {
        usuario,
        requestId: 'req',
        agora: () => new Date('2026-11-08T12:00:00Z'),
        comTenant: (fn) => fn(db, tx),
        permissoes: { catalogo: [...catalogoDePermissoes([manifest]), { chave: 'pedido.criar', area: 'pedidos', modulo: 'vendedor', descricao: 'Criar pedido' }], matriz: matrizDeFabrica([manifest]) },
        log: { info() { }, warn() { }, error() { } },
    };
}
const rota = (metodo, caminho) => rotasDePerfis.find((r) => r.metodo === metodo && r.caminho === caminho);
const executar = (r, ctx, extra) => r.executar({ ...ctx, corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: r.query ? r.query.parse(extra.query ?? {}) : {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} });
const escritas = (c) => c.filter((x) => /^\s*(insert|update|delete)/i.test(x.sql));
describe('T-0111: permissões das rotas de perfis (RN-CORE-35)', () => {
    const permissoes = criarPermissoes([manifest]);
    it('RN-CORE-35: toda rota de gestão exige perfil.gerir e só o admin da fábrica passa; as opções do cadastro seguem usuario.ver', () => {
        for (const r of rotasDePerfis) {
            const esperado = r.caminho === 'perfis/opcoes' ? 'usuario.ver' : 'perfil.gerir';
            expect(r.acao, `${r.metodo} ${r.caminho}`).toBe(esperado);
            expect(r.superficie).toBe('bko');
        }
        for (const perfil of PERFIS.filter((p) => p !== 'admin')) {
            expect(verificarAcao({ id: 'x', tenant_id: 'y', perfil, modulos: ['core'], perfis: perfisDeFabrica(perfil) }, permissoes, 'perfil.gerir').ok, perfil).toBe(false);
        }
        expect(verificarAcao(ADMIN, permissoes, 'perfil.gerir').ok).toBe(true);
    });
});
describe('T-0111: lista, detalhe e multi-tenant (RN-CORE-05)', () => {
    it('lista os 7 perfis de fábrica na ordem da tela, com "onde entra" pelo motor', async () => {
        const { db } = fakeDb(tenant());
        const r = PerfilListaRespostaSchema.parse(await executar(rota('GET', 'perfis'), contexto(db), {}));
        expect(r.itens.map((p) => p.codigo)).toEqual(PERFIS.map(String).sort((a, b) => PERFIS.indexOf(a) - PERFIS.indexOf(b)));
        expect(r.itens.find((p) => p.codigo === 'vendedor')?.onde_entra).not.toContain('bko');
        expect(r.itens.find((p) => p.codigo === 'admin')?.onde_entra).toContain('bko');
    });
    it('RN-CORE-33: o detalhe do vendedor traz o cadeado do BKO e o escopo máximo da base', async () => {
        const { db } = fakeDb(tenant());
        const d = PerfilDetalheSchema.parse(await executar(rota('GET', 'perfis/:codigo'), contexto(db), { params: { codigo: 'vendedor' } }));
        expect(d.chaves.find((c) => c.chave === 'acesso.bko')?.trava?.regra).toBe('RN-CORE-33');
        expect(d.escopo_maximo).toBe('carteira');
        expect(d.chaves.some((c) => c.chave === 'notificacao.ler')).toBe(false);
    });
    it('RN-CORE-05: perfil de outro tenant (o RLS esconde) responde 404 e nada é gravado', async () => {
        const { db, chamadas } = fakeDb(tenant());
        await expect(executar(rota('GET', 'perfis/:codigo'), contexto(db), { params: { codigo: 'perfil_de_outra_empresa' } })).rejects.toMatchObject({ status: 404 });
        await expect(executar(rota('PUT', 'perfis/:codigo'), contexto(db), { params: { codigo: 'perfil_de_outra_empresa' }, corpo: { permissoes: [] } })).rejects.toMatchObject({ status: 404 });
        expect(escritas(chamadas)).toHaveLength(0);
    });
    it('RN-CORE-05: nenhuma consulta nomeia tenant por parâmetro (o isolamento é do RLS dentro de comTenant)', async () => {
        const { db, chamadas } = fakeDb(tenant());
        await executar(rota('GET', 'perfis'), contexto(db), {});
        for (const c of chamadas)
            expect(c.valores).not.toContain(TENANT);
    });
});
describe('T-0111: limites na escrita (RN-CORE-33, RN-PRO-01, RN-CORE-04, RN-CORE-35)', () => {
    const ler = async (codigo) => {
        const { db } = fakeDb(tenant());
        return PerfilDetalheSchema.parse(await executar(rota('GET', 'perfis/:codigo'), contexto(db), { params: { codigo } }));
    };
    const corpoDe = (d, ajuste) => ({ permissoes: ajuste(d.chaves.filter((c) => c.atual.concedida).map((c) => ({ chave: c.chave, nivel: c.atual.nivel, alvos: c.atual.alvos }))) });
    it('RN-CORE-33: vendedor com acesso ao BKO é 422 TRAVA_DO_PERFIL e não grava', async () => {
        const d = await ler('vendedor');
        const { db, chamadas } = fakeDb(tenant());
        const corpo = corpoDe(d, (c) => [...c, { chave: 'acesso.bko' }]);
        await expect(executar(rota('PUT', 'perfis/:codigo'), contexto(db), { params: { codigo: 'vendedor' }, corpo })).rejects.toMatchObject({ codigo: 'TRAVA_DO_PERFIL', detalhes: { regra: 'RN-CORE-33' } });
        expect(escritas(chamadas)).toHaveLength(0);
    });
    it('RN-PRO-01: promotor com escrita de pedido é 422', async () => {
        const d = await ler('promotor');
        const { db, chamadas } = fakeDb(tenant());
        const corpo = corpoDe(d, (c) => [...c, { chave: 'pedido.criar' }]);
        await expect(executar(rota('PUT', 'perfis/:codigo'), contexto(db), { params: { codigo: 'promotor' }, corpo })).rejects.toMatchObject({ codigo: 'TRAVA_DO_PERFIL', detalhes: { regra: 'RN-PRO-01' } });
        expect(escritas(chamadas)).toHaveLength(0);
    });
    it('RN-CORE-04: escopo de dados acima da base é 422 ESCOPO_ACIMA_DA_BASE', async () => {
        const d = await ler('vendedor');
        const { db } = fakeDb(tenant());
        const corpo = corpoDe(d, (c) => c.map((x) => (x.chave === 'dados.escopo' ? { chave: x.chave, nivel: 'tenant' } : x)));
        await expect(executar(rota('PUT', 'perfis/:codigo'), contexto(db), { params: { codigo: 'vendedor' }, corpo })).rejects.toMatchObject({ codigo: 'ESCOPO_ACIMA_DA_BASE' });
    });
    it('RN-CORE-35: o admin não tira de si a gestão de perfis (AUTOGESTAO) nem deixa a empresa sem admin (ULTIMO_ADMIN)', async () => {
        const d = await ler('admin');
        const outro = { id: '0b000000-0000-4000-8000-0000000000a2', ativo: true, perfis: ['admin'] };
        const corpo = corpoDe(d, (c) => c.filter((x) => x.chave !== 'perfil.gerir'));
        const a = fakeDb(tenant([], [{ id: ADMIN.id, ativo: true, perfis: ['admin'] }, outro]));
        await expect(executar(rota('PUT', 'perfis/:codigo'), contexto(a.db), { params: { codigo: 'admin' }, corpo })).rejects.toMatchObject({ codigo: expect.stringMatching(/AUTOGESTAO|ULTIMO_ADMIN/) });
        const b = fakeDb(tenant());
        await expect(executar(rota('PUT', 'perfis/:codigo'), contexto(b.db), { params: { codigo: 'admin' }, corpo })).rejects.toMatchObject({ codigo: 'ULTIMO_ADMIN' });
        expect(escritas(a.chamadas)).toHaveLength(0);
        expect(escritas(b.chamadas)).toHaveLength(0);
    });
    it('RN-CORE-35: perfil de fábrica não é desativado nem muda de nome (o pedido é ignorado e nada é gravado)', async () => {
        const d = await ler('vendedor');
        const { db, chamadas } = fakeDb(tenant());
        await executar(rota('PUT', 'perfis/:codigo'), contexto(db), { params: { codigo: 'vendedor' }, corpo: { ...corpoDe(d, (c) => c), nome: 'Outro', ativo: false } });
        expect(escritas(chamadas)).toHaveLength(0);
    });
    it('RN-AUD-01: a mudança válida grava só a diferença da fábrica e audita perfil.alterar com antes/depois, sem dado pessoal', async () => {
        const d = await ler('vendedor');
        const { db, chamadas } = fakeDb(tenant());
        const corpo = corpoDe(d, (c) => c.filter((x) => x.chave !== 'acesso.campo'));
        await executar(rota('PUT', 'perfis/:codigo'), contexto(db), { params: { codigo: 'vendedor' }, corpo });
        const inserts = chamadas.filter((c) => /insert into plataforma.perfil_permissao/.test(c.sql));
        expect(inserts.map((c) => c.valores.slice(1, 3))).toEqual([['acesso.campo', false]]);
        const aud = chamadas.filter((c) => /insert into plataforma.auditoria/.test(c.sql));
        expect(aud).toHaveLength(1);
        expect(aud[0].valores[1]).toBe('perfil.alterar');
        expect(String(aud[0].valores[5])).toContain('acesso.campo');
    });
    it('RN-CORE-35: criar com nome repetido é 422 CODIGO_REPETIDO; criar a partir de um perfil exige a mesma base', async () => {
        const { db } = fakeDb(tenant());
        await expect(executar(rota('POST', 'perfis'), contexto(db), { corpo: { nome: 'vendedor', base: 'vendedor', cargo: 'vendedor' } })).rejects.toMatchObject({ codigo: 'CODIGO_REPETIDO' });
        await expect(executar(rota('POST', 'perfis'), contexto(db), { corpo: { nome: 'Norte', base: 'promotor', cargo: 'promotor', copiar_de: 'vendedor' } })).rejects.toMatchObject({ codigo: 'PERFIL_DADOS_INVALIDOS' });
    });
    it('R-20261114-153500: o perfil novo exige o cargo (lista fixa) e a lista devolve o cargo de cada perfil', async () => {
        expect(CriarPerfilRequestSchema.safeParse({ nome: 'X', base: 'vendedor' }).success).toBe(false);
        expect(CriarPerfilRequestSchema.safeParse({ nome: 'X', base: 'vendedor', cargo: 'diretor' }).success).toBe(false);
        const { db } = fakeDb(tenant());
        const r = PerfilListaRespostaSchema.parse(await executar(rota('GET', 'perfis'), contexto(db), {}));
        expect(r.itens.find((p) => p.codigo === 'admin')?.cargo).toBe('administrativo');
        expect(r.itens.find((p) => p.codigo === 'promotor')?.cargo).toBe('promotor');
    });
    it('RN-AUD-01: criar grava o perfil, copia os módulos da base e audita perfil.criar', async () => {
        const { db, chamadas } = fakeDb(tenant());
        await executar(rota('POST', 'perfis'), contexto(db), { corpo: { nome: 'Vendedor Norte', base: 'vendedor', descricao: 'Zona norte', cargo: 'vendedor' } }).catch(() => undefined);
        expect(chamadas.some((c) => /insert into plataforma.perfil \(/.test(c.sql) && c.valores.includes('vendedor_norte'))).toBe(true);
        // 0069: o cargo informado vai junto no insert (R-20261114-153500)
        expect(chamadas.find((c) => /insert into plataforma.perfil \(.*cargo\)/.test(c.sql))?.valores.at(-1)).toBe('vendedor');
        expect(chamadas.some((c) => /insert into plataforma.perfil_modulo/.test(c.sql))).toBe(true);
        expect(chamadas.filter((c) => /insert into plataforma.auditoria/.test(c.sql)).map((c) => c.valores[1])).toEqual(['perfil.criar']);
    });
});
