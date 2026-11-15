/**
 * T-0061 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): endereços de entrega (RF-CORE-12, RN-VEN-17) e
 * unidades de venda (RN-VEN-15) do Core. Cobre (1) os consumidores `integracao.produto_unidade/cliente_endereco.atualizado@1`
 * (idempotência, inativação, referência ausente, invariantes de uma padrão / um principal, isolamento por tenant),
 * (2) o pull por escopo de carteira, (3) o Cliente 360 da API (404 fora da carteira, só endereços ativos, padrão primeiro),
 * (4) as unidades no cadastro do BKO e (5) a consulta `core.cadastro_resumo@1`. Pula sem Postgres.
 */
import { definirTenant, comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ErroNaoEncontrado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Cliente360Schema, CadastroResumoEntradaSchema, ClienteEnderecoSyncSchema, ProdutoUnidadeSyncSchema, ProdutosPrecoListaSchema } from '../contracts';
import { manifest } from '../manifest';
import { carteiraDoUsuario } from './carteira';
import { rotasDeClientes } from './clientes';
import { consultaCadastroResumo } from './consultas';
import { consumidoresDoErp } from './consumidores-erp';
import { ReferenciaAusenteErp } from './erp-apoio';
import { moduloApi } from './index';
import { rotasDeProdutos } from './produtos';
import { provedoresSyncCore } from './sync';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const U = A.usuarios;
const C = A.clientes;
const id = (n) => `0e700000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Dados committed deste arquivo (limpos no fim): endereços de c2/c3 (A) e produtos com unidades (A e B).
const E_C2 = id(1); // c2 (vendedor-2): principal
const E_C3_PRINCIPAL = id(2); // c3 (vendedor-1): principal
const E_C3_INATIVO = id(3); // c3: entrega inativa — não aparece no Cliente 360
const E_C3_REMOVIDO = id(4); // c3: removido — não aparece
const P_A = id(10); // produto A: UN (padrão) + CX 12
const P_A_SEM = id(11); // produto A sem unidade cadastrada
const P_B = id(12); // produto B: UN + FD 24 padrão
const consumidor = (evento) => {
    const c = consumidoresDoErp.find((x) => x.evento.nome === evento);
    if (!c)
        throw new Error(`sem consumidor para ${evento}`);
    return c;
};
describe('T-0061: manifesto e moduloApi ligam os consumidores de unidade e endereço', () => {
    it('RN-INT-04: o Core declara e expõe o consumidor de produto_unidade e de cliente_endereco', () => {
        for (const n of ['integracao.produto_unidade.atualizado@1', 'integracao.cliente_endereco.atualizado@1']) {
            expect(manifest.consome).toContain(n);
            expect(moduloApi.consumidores?.map((c) => c.evento.nome)).toContain(n);
        }
    });
});
describe.skipIf(semBanco())('Core T-0061 × Postgres: endereços de entrega e unidades de venda', () => {
    let pool;
    let acesso;
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
        acesso = {
            comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c)),
            semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
        };
        await limpar();
        await comTenant(pool, A.tenantId, async (c) => {
            const end = `insert into core.cliente_endereco (id, tenant_id, cliente_id, tipo, descricao, logradouro, numero, cidade, uf, cep, principal, ativo, deleted_at)
                   values ($1, $2, $3, $4, $5, $6, '10', 'Manaus', 'AM', '69000000', $7, $8, $9)`;
            await c.query(end, [E_C2, A.tenantId, C.c2, 'principal', 'Matriz C2', 'Rua do C2', true, true, null]);
            await c.query(end, [E_C3_PRINCIPAL, A.tenantId, C.c3, 'principal', 'Matriz C3', 'Rua do C3', true, true, null]);
            await c.query(end, [E_C3_INATIVO, A.tenantId, C.c3, 'entrega', 'Antigo', 'Rua Antiga', false, false, null]);
            await c.query(end, [E_C3_REMOVIDO, A.tenantId, C.c3, 'entrega', 'Removido', 'Rua Removida', false, true, new Date().toISOString()]);
            await c.query("insert into core.produto (id, tenant_id, sku, nome, unidade) values ($1, $3, 'T61-A', 'Produto A', 'UN'), ($2, $3, 'T61-A-SEM', 'Produto A sem unidade', 'KG')", [P_A, P_A_SEM, A.tenantId]);
            await c.query(`insert into core.produto_unidade (id, tenant_id, produto_id, unidade, fator, padrao) values ($1, $3, $2, 'UN', 1, true), ($4, $3, $2, 'CX', 12, false)`, [id(20), P_A, A.tenantId, id(21)]);
        });
        await comTenant(pool, B.tenantId, async (c) => {
            await c.query("insert into core.produto (id, tenant_id, sku, nome, unidade) values ($1, $2, 'T61-B', 'Produto B', 'UN')", [P_B, B.tenantId]);
            await c.query("insert into core.produto_unidade (id, tenant_id, produto_id, unidade, fator, padrao) values ($1, $3, $2, 'UN', 1, false), ($4, $3, $2, 'FD', 24, true)", [id(22), P_B, B.tenantId, id(23)]);
        });
    });
    async function limpar() {
        await comTenant(pool, A.tenantId, async (c) => {
            await c.query('delete from core.cliente_endereco where id = any($1::uuid[])', [[E_C2, E_C3_PRINCIPAL, E_C3_INATIVO, E_C3_REMOVIDO]]);
            await c.query('delete from core.produto_unidade where produto_id = any($1::uuid[])', [[P_A, P_A_SEM]]);
            await c.query('delete from core.produto where id = any($1::uuid[])', [[P_A, P_A_SEM]]);
        });
        await comTenant(pool, B.tenantId, async (c) => {
            await c.query('delete from core.produto_unidade where produto_id = $1', [P_B]);
            await c.query('delete from core.produto where id = $1', [P_B]);
        });
    }
    afterAll(async () => {
        if (pool)
            await limpar();
        await pool?.end();
    });
    // ---------- consumidores do ERP ----------
    describe('consumidores do ERP (transação desfeita no fim)', () => {
        async function emTransacao(tenant, fn) {
            const c = await pool.connect();
            try {
                await c.query('begin');
                await definirTenant(c, tenant);
                let atual = tenant;
                const warn = vi.fn();
                const entregar = async (evento, payload) => {
                    const cons = consumidor(evento);
                    const ctx = {
                        db: c,
                        agora: () => new Date(),
                        fuso: () => 'America/Manaus',
                        parametros: () => ({}),
                        envelope: { evento_id: 'x', tenant_id: atual },
                        publicar: vi.fn(async () => ({})),
                        consultar: vi.fn(),
                        log: { info: vi.fn(), warn, error: vi.fn() },
                    };
                    await cons.executar(cons.evento.schema.parse(payload), ctx);
                };
                const trocarTenant = async (t) => {
                    atual = t;
                    await definirTenant(c, t);
                };
                const q = async (sql, v = []) => (await c.query(sql, v)).rows;
                await fn({ entregar, trocarTenant, q, warn });
            }
            finally {
                await c.query('rollback').catch(() => undefined);
                c.release();
            }
        }
        const instanteErp = () => new Date().toISOString(); // o instante do ERP no payload não é comparado em teste algum
        const ev = (entidade, external_id, registro, acao = 'criado') => ({
            lote_id: '0e700000-0000-4000-8000-0000000000a1',
            entidade,
            external_id,
            acao,
            hash: 'h',
            ...(registro ? { registro: { external_id, alterado_em: instanteErp(), ativo: true, ...registro } } : {}),
            ocorrido_em: instanteErp(),
        });
        const EV_UN = 'integracao.produto_unidade.atualizado@1';
        const EV_END = 'integracao.cliente_endereco.atualizado@1';
        const produto = (extra = {}) => ev('produto', 'P-T61', { sku: 'SKU-T61', nome: 'Arroz 5kg', unidade: 'UN', ...extra });
        const un = (ext, unidade, fator, extra = {}) => ev('produto_unidade', ext, { produto_external_id: 'P-T61', unidade, fator, ...extra });
        const cliente = () => ev('cliente', 'C-T61', { razao_social: 'Mercado T61', documento: '99000030000106', inscricao_estadual: 'ISENTO', endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', cep: '69301000' } });
        const end = (ext, extra = {}) => ev('cliente_endereco', ext, { cliente_external_id: 'C-T61', tipo: 'entrega', descricao: 'Depósito', logradouro: 'Av. do Depósito', numero: '100', bairro: 'Industrial', cidade: 'Boa Vista', uf: 'RR', cep: '69301-000', latitude: 2.82, longitude: -60.67, principal: false, ...extra });
        const unidades = (t) => t.q("select external_id, unidade, fator, padrao, ativo from core.produto_unidade where external_id like 'PU-T61%' and deleted_at is null order by unidade");
        const enderecos = (t) => t.q("select external_id, principal, ativo, uf, cep from core.cliente_endereco where external_id like 'E-T61%' and deleted_at is null order by external_id");
        describe('produto_unidade', () => {
            it('RN-INT-04: produto ainda ausente lança referência ausente e não grava a unidade', async () => {
                await emTransacao(A.tenantId, async (t) => {
                    await expect(t.entregar(EV_UN, un('PU-T61-1', 'CX', 12))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
                    expect(await unidades(t)).toEqual([]);
                });
            });
            it('RN-INT-02/RN-VEN-15: upsert idempotente por external_id; reentrega não duplica; atualização muda o fator', async () => {
                await emTransacao(A.tenantId, async (t) => {
                    await t.entregar('integracao.produto.atualizado@1', produto());
                    await t.entregar(EV_UN, un('PU-T61-1', 'cx', 12));
                    await t.entregar(EV_UN, un('PU-T61-1', 'cx', 12));
                    expect(await unidades(t)).toEqual([{ external_id: 'PU-T61-1', unidade: 'CX', fator: 12, padrao: false, ativo: true }]);
                    await t.entregar(EV_UN, un('PU-T61-1', 'CX', 24));
                    expect((await unidades(t))[0]).toMatchObject({ fator: 24 });
                    expect(await unidades(t)).toHaveLength(1);
                });
            });
            it('RN-VEN-15: no máximo uma padrão viva por produto — marcar a CX desmarca a UN na mesma transação', async () => {
                await emTransacao(A.tenantId, async (t) => {
                    await t.entregar('integracao.produto.atualizado@1', produto());
                    await t.entregar(EV_UN, un('PU-T61-1', 'UN', 1, { padrao: true }));
                    await t.entregar(EV_UN, un('PU-T61-2', 'CX', 12, { padrao: true }));
                    expect((await unidades(t)).map((u) => [u.unidade, u.padrao])).toEqual([['CX', true], ['UN', false]]);
                    expect((await t.q("select 1 from core.produto_unidade where padrao and deleted_at is null and produto_id = (select id from core.produto where external_id = 'P-T61')")).length).toBe(1);
                    // reentrega da UN padrão devolve a marca à UN e desmarca a CX
                    await t.entregar(EV_UN, un('PU-T61-1', 'UN', 1, { padrao: true }));
                    expect((await unidades(t)).map((u) => [u.unidade, u.padrao])).toEqual([['CX', false], ['UN', true]]);
                });
            });
            it('RN-INT-06: inativação marca ativo=false e padrao=false (nunca apaga); unidade inativa vinda como padrão não vira padrão', async () => {
                await emTransacao(A.tenantId, async (t) => {
                    await t.entregar('integracao.produto.atualizado@1', produto());
                    await t.entregar(EV_UN, un('PU-T61-1', 'UN', 1, { padrao: true }));
                    await t.entregar(EV_UN, ev('produto_unidade', 'PU-T61-1', undefined, 'inativado'));
                    expect(await unidades(t)).toEqual([{ external_id: 'PU-T61-1', unidade: 'UN', fator: 1, padrao: false, ativo: false }]);
                    await t.entregar(EV_UN, un('PU-T61-2', 'CX', 12, { padrao: true, ativo: false }));
                    expect((await unidades(t)).find((u) => u.unidade === 'CX')).toMatchObject({ padrao: false, ativo: false });
                });
            });
            it('RN-INT-02: unidade de cadastro anterior (sem external_id) é adotada; a de outro external_id é ignorada com aviso', async () => {
                await emTransacao(A.tenantId, async (t) => {
                    await t.entregar('integracao.produto.atualizado@1', produto());
                    await t.q("insert into core.produto_unidade (tenant_id, produto_id, unidade, fator) values (plataforma.tenant_atual(), (select id from core.produto where external_id = 'P-T61'), 'CX', 6)");
                    await t.entregar(EV_UN, un('PU-T61-1', 'CX', 12));
                    expect(await unidades(t)).toEqual([{ external_id: 'PU-T61-1', unidade: 'CX', fator: 12, padrao: false, ativo: true }]);
                    await t.entregar(EV_UN, un('PU-T61-9', 'CX', 99));
                    expect(t.warn).toHaveBeenCalled();
                    expect((await unidades(t)).map((u) => u.external_id)).toEqual(['PU-T61-1']);
                });
            });
            it('RN-CORE-05: tenant B não vê nem altera a unidade do A, e unidade para produto do A é referência ausente no B', async () => {
                await emTransacao(A.tenantId, async (t) => {
                    await t.entregar('integracao.produto.atualizado@1', produto());
                    await t.entregar(EV_UN, un('PU-T61-1', 'CX', 12, { padrao: true }));
                    await t.trocarTenant(B.tenantId);
                    expect(await unidades(t)).toEqual([]);
                    await t.entregar(EV_UN, ev('produto_unidade', 'PU-T61-1', undefined, 'inativado')); // não toca na linha do A
                    await expect(t.entregar(EV_UN, un('PU-T61-3', 'UN', 1))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
                    await t.trocarTenant(A.tenantId);
                    expect(await unidades(t)).toEqual([{ external_id: 'PU-T61-1', unidade: 'CX', fator: 12, padrao: true, ativo: true }]);
                });
            });
        });
        describe('cliente_endereco', () => {
            const preparar = async (t) => {
                await t.entregar('integracao.vendedor.atualizado@1', ev('vendedor', 'V-T61', { nome: 'Vendedor T61', email: 'v.t61@erp.exemplo.com.br' }));
                await t.entregar('integracao.cliente.atualizado@1', cliente());
            };
            it('RN-INT-04: cliente ainda ausente lança referência ausente e não grava o endereço', async () => {
                await emTransacao(A.tenantId, async (t) => {
                    await expect(t.entregar(EV_END, end('E-T61-1'))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
                    expect(await enderecos(t)).toEqual([]);
                });
            });
            it('RN-INT-02/RN-VEN-17: upsert idempotente; UF em maiúsculas e CEP só com dígitos; reentrega não duplica', async () => {
                await emTransacao(A.tenantId, async (t) => {
                    await preparar(t);
                    await t.entregar(EV_END, end('E-T61-1', { uf: 'rr' }));
                    await t.entregar(EV_END, end('E-T61-1', { uf: 'rr' }));
                    expect(await enderecos(t)).toEqual([{ external_id: 'E-T61-1', principal: false, ativo: true, uf: 'RR', cep: '69301000' }]);
                    await t.entregar(EV_END, end('E-T61-1', { logradouro: 'Av. Nova' }));
                    expect((await t.q("select logradouro from core.cliente_endereco where external_id = 'E-T61-1'"))[0]?.logradouro).toBe('Av. Nova');
                });
            });
            it('RN-VEN-17: no máximo um principal vivo por cliente — marcar o novo desmarca o anterior na mesma transação', async () => {
                await emTransacao(A.tenantId, async (t) => {
                    await preparar(t);
                    await t.entregar(EV_END, end('E-T61-1', { tipo: 'principal', principal: true }));
                    await t.entregar(EV_END, end('E-T61-2', { principal: true }));
                    expect((await enderecos(t)).map((e) => [e.external_id, e.principal])).toEqual([['E-T61-1', false], ['E-T61-2', true]]);
                    expect((await t.q("select 1 from core.cliente_endereco where principal and deleted_at is null and cliente_id = (select id from core.cliente where external_id = 'C-T61')")).length).toBe(1);
                });
            });
            it('RN-INT-06: inativação marca ativo=false e principal=false (nunca apaga) e libera a vaga do principal', async () => {
                await emTransacao(A.tenantId, async (t) => {
                    await preparar(t);
                    await t.entregar(EV_END, end('E-T61-1', { principal: true }));
                    await t.entregar(EV_END, ev('cliente_endereco', 'E-T61-1', undefined, 'inativado'));
                    expect(await enderecos(t)).toEqual([{ external_id: 'E-T61-1', principal: false, ativo: false, uf: 'RR', cep: '69301000' }]);
                    await t.entregar(EV_END, end('E-T61-2', { principal: true }));
                    expect((await enderecos(t)).find((e) => e.external_id === 'E-T61-2')?.principal).toBe(true);
                });
            });
            it('RN-CORE-05: tenant B não vê nem altera o endereço do A, e endereço para cliente do A é referência ausente no B', async () => {
                await emTransacao(A.tenantId, async (t) => {
                    await preparar(t);
                    await t.entregar(EV_END, end('E-T61-1', { principal: true }));
                    await t.trocarTenant(B.tenantId);
                    expect(await enderecos(t)).toEqual([]);
                    await t.entregar(EV_END, ev('cliente_endereco', 'E-T61-1', undefined, 'inativado')); // não toca na linha do A
                    await expect(t.entregar(EV_END, end('E-T61-3'))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
                    await t.trocarTenant(A.tenantId);
                    expect(await enderecos(t)).toEqual([{ external_id: 'E-T61-1', principal: true, ativo: true, uf: 'RR', cep: '69301000' }]);
                });
            });
        });
    });
    // ---------- pull por escopo de carteira ----------
    describe('pull: escopo de carteira e tenant', () => {
        const usuario = (uid, perfil, tenant = A.tenantId) => ({ id: uid, tenant_id: tenant, perfil });
        const vendedor1 = usuario(U.vendedor1, 'vendedor');
        const vendedor2 = usuario(U.vendedor2, 'vendedor');
        const promotor = usuario(U.promotor, 'promotor');
        const analista = usuario(U.analista, 'analista');
        const vendedorB = usuario(B.usuarios.vendedor, 'vendedor', B.tenantId);
        function ctx(u) {
            return {
                usuario: u,
                requestId: 'req-teste',
                agora: () => new Date(),
                fuso: () => 'America/Manaus',
                comTenant: (fn) => comTenant(pool, u.tenant_id, (c) => fn(c, { publicar: async () => ({}) })),
                carteira: () => carteiraDoUsuario(u, acesso),
                usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
            };
        }
        const pedido = () => ({ desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 });
        const provedor = (nome) => provedoresSyncCore.find((p) => p.entidade.nome === nome);
        const puxar = (nome, u) => provedor(nome).puxar(ctx(u), pedido());
        const clientesDe = (l) => [...new Set(l.map((x) => x.cliente_id))].sort();
        it('RN-VEN-17: cliente_endereco tem escopo carteira; produto_unidade, tenant', () => {
            expect(provedor('cliente_endereco').escopo).toBe('carteira');
            expect(provedor('produto_unidade').escopo).toBe('tenant');
        });
        it('RN-CORE-04: vendedor-1 recebe endereço de c1 e c3 — nunca de c2 nem do tenant B', async () => {
            const l = await puxar('cliente_endereco', vendedor1);
            expect(clientesDe(l)).toEqual([C.c1, C.c3].sort());
            expect(l.map((x) => x.id)).not.toContain(E_C2);
            expect(l.map((x) => x.id)).toEqual(expect.arrayContaining([E_C3_PRINCIPAL, E_C3_INATIVO]));
        });
        it('RN-CORE-04: vendedor-2 (só c2) recebe só o endereço de c2; promotor só o de c1', async () => {
            expect((await puxar('cliente_endereco', vendedor2)).map((x) => x.id)).toEqual([E_C2]);
            expect(clientesDe(await puxar('cliente_endereco', promotor))).toEqual([C.c1]);
        });
        it('RN-CORE-04/05: analista (escopo tenant) vê todo o tenant A e nada do B; vendedor do B só o do B', async () => {
            const a = clientesDe(await puxar('cliente_endereco', analista));
            expect(a).toEqual(expect.arrayContaining([C.c1, C.c2, C.c3]));
            expect(a).not.toContain(B.clientes.c1);
            expect(clientesDe(await puxar('cliente_endereco', vendedorB))).toEqual([B.clientes.c1]);
        });
        it('as linhas de endereço e de unidade validam o schema do contrato (coordenada como texto, instantes UTC)', async () => {
            for (const l of await puxar('cliente_endereco', analista))
                expect(() => ClienteEnderecoSyncSchema.parse(l), l.id).not.toThrow();
            const un = await puxar('produto_unidade', analista);
            expect(un.length).toBeGreaterThan(0);
            for (const l of un)
                expect(() => ProdutoUnidadeSyncSchema.parse(l), l.id).not.toThrow();
        });
        it('RN-CORE-05: produto_unidade é do tenant — o vendedor do A vê a UN/CX do A e nada do B (e vice-versa)', async () => {
            const a = (await puxar('produto_unidade', vendedor1)).map((x) => x.id);
            expect(a).toEqual(expect.arrayContaining([id(20), id(21)]));
            expect(a).not.toContain(id(22));
            const b = (await puxar('produto_unidade', vendedorB)).map((x) => x.id);
            expect(b).toEqual(expect.arrayContaining([id(22), id(23)]));
            expect(b).not.toContain(id(20));
        });
    });
    // ---------- Cliente 360 ----------
    describe('Cliente 360 da API', () => {
        const usuario = (uid, perfil, tenant = A.tenantId) => ({ id: uid, tenant_id: tenant, perfil });
        function ctx(u) {
            return {
                usuario: u,
                requestId: 'req-teste',
                agora: () => new Date(),
                fuso: () => 'America/Manaus',
                comTenant: (fn) => comTenant(pool, u.tenant_id, (c) => fn(c, { publicar: async () => ({}) })),
                carteira: () => carteiraDoUsuario(u, acesso),
                usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
            };
        }
        const cliente360 = (u, clienteId) => {
            const r = rotasDeClientes.find((x) => x.metodo === 'GET' && x.caminho === 'clientes/:id');
            return r.executar({ ...ctx(u), params: { id: clienteId }, query: {}, corpo: {} });
        };
        it('RN-VEN-17: Cliente 360 traz os endereços ativos, o principal primeiro e endereco_padrao_id (c1: Rua Um + Depósito)', async () => {
            const r = Cliente360Schema.parse(await cliente360(usuario(U.vendedor1, 'vendedor'), C.c1));
            expect(r.enderecos?.map((e) => e.logradouro)).toEqual(['Rua Um', 'Av. do Depósito']);
            expect(r.enderecos?.[0]?.principal).toBe(true);
            expect(r.endereco_padrao_id).toBe(r.enderecos?.[0]?.id);
        });
        it('RN-VEN-17: endereço inativo e removido não aparecem; c3 mostra só o principal ativo', async () => {
            const r = Cliente360Schema.parse(await cliente360(usuario(U.vendedor1, 'vendedor'), C.c3));
            expect(r.enderecos?.map((e) => e.id)).toEqual([E_C3_PRINCIPAL]);
            expect(r.endereco_padrao_id).toBe(E_C3_PRINCIPAL);
        });
        it('RN-CORE-04: cliente fora da carteira é 404 — vendedor-1 não vê o endereço de c2; vendedor-2 não vê o de c1', async () => {
            await expect(cliente360(usuario(U.vendedor1, 'vendedor'), C.c2)).rejects.toBeInstanceOf(ErroNaoEncontrado);
            await expect(cliente360(usuario(U.vendedor2, 'vendedor'), C.c1)).rejects.toBeInstanceOf(ErroNaoEncontrado);
            expect(Cliente360Schema.parse(await cliente360(usuario(U.vendedor2, 'vendedor'), C.c2)).enderecos?.map((e) => e.id)).toEqual([E_C2]);
        });
        it('RN-CORE-05: usuário do tenant B não abre cliente do A (404) e vê só o endereço do B no cliente dele', async () => {
            const vb = usuario(B.usuarios.vendedor, 'vendedor', B.tenantId);
            await expect(cliente360(vb, C.c1)).rejects.toBeInstanceOf(ErroNaoEncontrado);
            const r = Cliente360Schema.parse(await cliente360(vb, B.clientes.c1));
            expect(r.enderecos?.map((e) => e.logradouro)).toEqual(['Rua Beta']);
        });
        it('RN-VEN-17: cliente sem endereço devolve lista vazia e padrão nulo (não quebra)', async () => {
            await comTenant(pool, A.tenantId, (c) => c.query('update core.cliente_endereco set deleted_at = now() where id = $1', [E_C2]));
            try {
                const r = Cliente360Schema.parse(await cliente360(usuario(U.vendedor2, 'vendedor'), C.c2));
                expect(r.enderecos).toEqual([]);
                expect(r.endereco_padrao_id).toBeNull();
            }
            finally {
                await comTenant(pool, A.tenantId, (c) => c.query('update core.cliente_endereco set deleted_at = null where id = $1', [E_C2]));
            }
        });
    });
    // ---------- BKO de produtos ----------
    describe('BKO de produtos: unidades de venda', () => {
        const lista = async (tenant, perfil, uid) => {
            const r = rotasDeProdutos.find((x) => x.metodo === 'GET' && x.caminho === 'produtos');
            const c = { usuario: { id: uid, tenant_id: tenant, perfil }, comTenant: (fn) => comTenant(pool, tenant, (db) => fn(db)) };
            return ProdutosPrecoListaSchema.parse(await r.executar({ ...c, query: r.query.parse({ limite: 500 }) }));
        };
        it('RN-VEN-15: o cadastro mostra UN e CX c/ 12 com a padrão primeiro; produto sem unidade mostra a unidade base', async () => {
            const r = await lista(A.tenantId, 'analista', U.analista);
            const a = r.itens.find((p) => p.id === P_A);
            expect(a?.unidades?.map((u) => [u.rotulo, u.padrao])).toEqual([['UN', true], ['CX c/ 12', false]]);
            expect(a?.unidades?.[1]).toMatchObject({ unidade: 'CX', fator: 12 });
            const sem = r.itens.find((p) => p.id === P_A_SEM);
            expect(sem?.unidades?.map((u) => [u.rotulo, u.padrao])).toEqual([['KG', true]]);
        });
        it('RN-CORE-05: o BKO do tenant B vê as unidades do B (FD c/ 24 padrão) e nunca as do A', async () => {
            const r = await lista(B.tenantId, 'admin', B.usuarios.admin);
            expect(r.itens.map((p) => p.id)).not.toContain(P_A);
            expect(r.itens.find((p) => p.id === P_B)?.unidades?.map((u) => [u.rotulo, u.padrao])).toEqual([['FD c/ 24', true], ['UN', false]]);
        });
    });
    // ---------- core.cadastro_resumo@1 ----------
    describe('consulta core.cadastro_resumo@1', () => {
        const consultar = (tenant, entrada) => comTenant(pool, tenant, (c) => consultaCadastroResumo.executar(CadastroResumoEntradaSchema.parse(entrada), { db: c }));
        it('RN-VEN-15/17: devolve as unidades do produto e o principal do cliente (mais o endereço pedido por id)', async () => {
            const r = await consultar(A.tenantId, { cliente_ids: [C.c3], produto_ids: [P_A], endereco_ids: [E_C3_INATIVO] });
            expect(r.produtos[0]?.unidades?.map((u) => [u.unidade, u.fator, u.padrao])).toEqual([['CX', 12, false], ['UN', 1, true]]);
            expect(r.enderecos?.map((e) => e.id).sort()).toEqual([E_C3_PRINCIPAL, E_C3_INATIVO].sort());
        });
        it('RN-CORE-05: id de endereço e de produto do A consultado pelo B não vaza nada', async () => {
            const r = await consultar(B.tenantId, { cliente_ids: [C.c3], produto_ids: [P_A], endereco_ids: [E_C3_PRINCIPAL, E_C2] });
            expect(r).toEqual({ clientes: [], produtos: [], usuarios: [], enderecos: [] });
        });
    });
});
