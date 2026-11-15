/**
 * T-0066 × Postgres real (fixture dois-tenants, RLS): consumidores de `integracao.preco|estoque.atualizado@1` no Catálogo.
 * Cada caso roda numa transação desfeita no fim. Cobre idempotência, inativação, referência ausente (RN-INT-04) e isolamento
 * por tenant. O produto é resolvido por um resolvedor injetado (a consulta do Core é testada no Core). Pula sem Postgres.
 */
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { manifest } from '../manifest';
import { criarConsumidorTabelaEscalonadaDoErp, criarConsumidorCatalogoNoDoErp, criarConsumidorEstoqueDoErp, criarConsumidorPrecoDoErp, criarConsumidorProdutoNoDoErp, ReferenciaAusenteErp } from './consumidores-erp';
import { moduloApi } from './index';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const PROD = '0ca00000-0000-4000-8000-0000000000f1';
const AGORA = new Date('2026-11-04T15:00:00Z');
describe('T-0066: manifesto e moduloApi ligam os consumidores do ERP no Catálogo', () => {
    it('RN-INT-04: preço e estoque declarados no manifesto têm consumidor registrado no moduloApi', () => {
        for (const n of ['integracao.preco.atualizado@1', 'integracao.estoque.atualizado@1', 'integracao.catalogo_no.atualizado@1', 'integracao.produto.atualizado@1']) {
            expect(manifest.consome).toContain(n);
            expect(moduloApi.consumidores?.map((c) => c.evento.nome)).toContain(n);
        }
    });
});
describe.skipIf(semBanco())('Catálogo T-0066 × Postgres: consumidores de preço e estoque do ERP', () => {
    let pool;
    beforeAll(() => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
    });
    afterAll(async () => {
        await pool.end();
    });
    const resolver = async (_ctx, ids) => new Map(ids.filter((i) => i === 'P-1').map((i) => [i, PROD]));
    async function emTransacao(tenant, fn, concorrentes = []) {
        const c = await pool.connect();
        try {
            await c.query('begin');
            await definirTenant(c, tenant);
            // RN-CAT-13 (0045): as marcas são do próprio Catálogo
            for (const m of concorrentes) {
                await c.query(`insert into catalogo.marca_concorrente (id, tenant_id, nome, ativo, external_id) values ($1, plataforma.tenant_atual(), $2, $3, $4)`, [m.id, m.nome, m.ativo, m.external_id]);
            }
            const entregar = async (cons, payload) => {
                const ctx = {
                    db: c,
                    agora: () => AGORA,
                    fuso: () => 'America/Manaus',
                    parametros: () => ({}),
                    envelope: { evento_id: 'x', tenant_id: tenant },
                    publicar: vi.fn(async () => ({})),
                    consultar: vi.fn(),
                    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
                };
                await cons.executar(cons.evento.schema.parse(payload), ctx);
            };
            const q = async (sql, v = []) => (await c.query(sql, v)).rows;
            await fn({ entregar, q });
        }
        finally {
            await c.query('rollback').catch(() => undefined);
            c.release();
        }
    }
    // core.filiais@1 simulada (T-0149, RN-CORE-39): nulo = a filial padrão do tenant da transação; FIL-2 = Boa Vista; outra chave = ainda não chegou
    const FIL_BVB = '0f000000-0000-4000-8000-0000000000b2';
    const resolverFilial = async (ctx, externalId) => {
        if (externalId === null)
            return (await ctx.db.query('select core.filial_padrao_id(plataforma.tenant_atual()) as id')).rows[0].id;
        if (externalId === 'FIL-2')
            return FIL_BVB;
        throw new ReferenciaAusenteErp('filial');
    };
    const preco = criarConsumidorPrecoDoErp(resolver, undefined, resolverFilial);
    const estoque = criarConsumidorEstoqueDoErp(resolver, resolverFilial);
    const noCons = criarConsumidorCatalogoNoDoErp();
    const produtoNo = criarConsumidorProdutoNoDoErp(resolver);
    // Envelope e registro no formato do contracts do Integracao (T-0024): lote, entidade, hash e alterado_em/external_id do registro.
    const env = (entidade, external_id, acao, registro) => ({
        lote_id: '11111111-1111-4111-8111-111111111111',
        entidade,
        external_id,
        acao,
        hash: 'h',
        ocorrido_em: '2026-11-04T10:00:00Z',
        registro: { external_id, alterado_em: '2026-11-04T10:00:00Z', ...registro },
    });
    const evNo = (id, pai, nivel, extra = {}, acao = 'criado') => env('catalogo_no', id, acao, { codigo: id, nome: `Nó ${id}`, pai_external_id: pai, nivel, ordem: 1, ...extra });
    const evProdutoNo = (no, acao = 'atualizado') => env('produto', 'P-1', acao, { sku: 'SKU-1', nome: 'Produto 1', unidade: 'UN', catalogo_no_external_id: no });
    const evPreco = (extra = {}, acao = 'criado', external_id = 'PR-T66') => env('preco', external_id, acao, { tabela_external_id: 'TAB-T66', tabela_nome: 'Atacado ERP', vigencia_inicio: '2026-11-01', vigencia_fim: null, produto_external_id: 'P-1', preco_cents: 1500, ...extra });
    const evEstoque = (extra = {}, acao = 'criado') => env('estoque', 'ES-T66', acao, { deposito_external_id: 'DEP-T66', deposito_nome: 'Matriz', produto_external_id: 'P-1', saldo: 12.5, ...extra });
    const itens = (t) => t.q("select preco_cents, vigencia_fim from catalogo.tabela_preco_item where external_id = 'PR-T66' and deleted_at is null");
    it('RN-INT-02: preço cria tabela e item; reentrega e atualização não duplicam; inativação faz soft delete', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await t.entregar(preco, evPreco());
            await t.entregar(preco, evPreco());
            await t.entregar(preco, evPreco({ preco_cents: 1700, vigencia_fim: '2026-11-30' }, 'atualizado'));
            expect((await t.q("select 1 from catalogo.tabela_preco where external_id = 'TAB-T66'")).length).toBe(1);
            const i = await itens(t);
            expect(i.length).toBe(1);
            expect(Number(i[0].preco_cents)).toBe(1700);
            expect(i[0].vigencia_fim).not.toBeNull();
            await t.entregar(preco, { lote_id: '11111111-1111-4111-8111-111111111111', entidade: 'preco', external_id: 'PR-T66', acao: 'inativado', hash: 'h2', ocorrido_em: '2026-11-04T11:00:00Z' });
            expect((await itens(t)).length).toBe(0);
            expect((await t.q("select 1 from catalogo.tabela_preco_item where external_id = 'PR-T66'")).length).toBe(1);
        });
    });
    it('RN-CORE-39: preço do ERP com filial_external_id vai para a filial; ausente = padrão; filial desconhecida repete (referencia_ausente)', async () => {
        const filiais = (t) => t.q("select i.filial_id, i.filial_id = core.filial_padrao_id(plataforma.tenant_atual()) as padrao from catalogo.tabela_preco_item i where i.external_id = 'PR-T66' and i.deleted_at is null");
        await emTransacao(A.tenantId, async (t) => {
            await t.entregar(preco, evPreco());
            expect(await filiais(t)).toEqual([expect.objectContaining({ padrao: true })]);
            await t.entregar(preco, evPreco({ filial_external_id: 'FIL-2' }, 'atualizado'));
            expect(await filiais(t)).toEqual([{ filial_id: FIL_BVB, padrao: false }]);
            await expect(t.entregar(preco, evPreco({ filial_external_id: 'FIL-NAO-CHEGOU' }, 'atualizado'))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
        });
    });
    it('RN-CORE-39: item de preço que muda de filial deixa tombstone na filial antiga e linha viva na nova (o pull filtra por filial)', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await t.entregar(preco, evPreco());
            const antiga = (await t.q("select filial_id from catalogo.tabela_preco_item where external_id = 'PR-T66' and deleted_at is null"))[0].filial_id;
            await t.entregar(preco, evPreco({ filial_external_id: 'FIL-2' }, 'atualizado'));
            const todas = await t.q("select filial_id, deleted_at is not null as morta from catalogo.tabela_preco_item where external_id = 'PR-T66' order by morta");
            expect(todas).toEqual([{ filial_id: FIL_BVB, morta: false }, { filial_id: antiga, morta: true }]);
            // mesma filial de novo: nada de tombstone extra
            await t.entregar(preco, evPreco({ filial_external_id: 'FIL-2', preco_cents: 1800 }, 'atualizado'));
            expect((await t.q("select 1 from catalogo.tabela_preco_item where external_id = 'PR-T66'")).length).toBe(2);
        });
    });
    it('RN-CORE-39: depósito que muda de filial apaga o antigo (tombstone com a filial velha) e recria o depósito e os saldos na filial nova', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await t.entregar(estoque, evEstoque());
            const antiga = (await t.q("select filial_id from catalogo.deposito where external_id = 'DEP-T66' and deleted_at is null"))[0].filial_id;
            await t.entregar(estoque, evEstoque({ filial_external_id: 'FIL-2', saldo: 9 }, 'atualizado'));
            const deps = await t.q("select filial_id, deleted_at is not null as morta from catalogo.deposito where external_id = 'DEP-T66' order by morta");
            expect(deps).toEqual([{ filial_id: FIL_BVB, morta: false }, { filial_id: antiga, morta: true }]);
            const saldos = await t.q("select d.filial_id, s.deleted_at is not null as morta, s.quantidade::text as quantidade from catalogo.estoque_saldo s join catalogo.deposito d on d.id = s.deposito_id where d.external_id = 'DEP-T66' order by morta");
            expect(saldos.map((x) => [x.filial_id, x.morta, Number(x.quantidade)])).toEqual([[FIL_BVB, false, 9], [antiga, true, expect.any(Number)]]);
        });
    });
    it('RN-CORE-39: estoque do ERP: depósito novo nasce na padrão; filial informada move o depósito; ausente em depósito conhecido não muda', async () => {
        const dep = (t) => t.q("select filial_id from catalogo.deposito where external_id = 'DEP-T66' and deleted_at is null");
        await emTransacao(A.tenantId, async (t) => {
            await t.entregar(estoque, evEstoque());
            const padrao = (await dep(t))[0].filial_id;
            await t.entregar(estoque, evEstoque({ filial_external_id: 'FIL-2' }, 'atualizado'));
            expect((await dep(t))[0].filial_id).toBe(FIL_BVB);
            await t.entregar(estoque, evEstoque({ saldo: 3 }, 'atualizado'));
            expect((await dep(t))[0].filial_id).toBe(FIL_BVB);
            await t.entregar(estoque, evEstoque({ filial_external_id: null }, 'atualizado'));
            expect((await dep(t))[0].filial_id).toBe(padrao);
        });
    });
    it('RN-CORE-39: escalonada do ERP sem filial vale para todas (filial nula); com filial, a faixa da filial convive com a geral', async () => {
        const esc = criarConsumidorTabelaEscalonadaDoErp(resolver, resolverFilial);
        const base = { produto_external_id: 'P-1', medida: null, quantidade_minima: 10, preco_unidade_cents: 900, vigencia_inicio: '2026-11-01', vigencia_fim: null };
        await emTransacao(A.tenantId, async (t) => {
            await t.entregar(esc, env('tabela_escalonada', 'ESC-GERAL', 'criado', base));
            await t.entregar(esc, env('tabela_escalonada', 'ESC-BVB', 'criado', { ...base, preco_unidade_cents: 950, filial_external_id: 'FIL-2' }));
            const r = await t.q("select external_id, filial_id from catalogo.tabela_escalonada where external_id in ('ESC-GERAL', 'ESC-BVB') and deleted_at is null order by external_id");
            expect(r).toEqual([{ external_id: 'ESC-BVB', filial_id: FIL_BVB }, { external_id: 'ESC-GERAL', filial_id: null }]);
        });
    });
    it('RN-VEN-23: faixa do ERP que colide na chave com outra faixa viva não repete em loop: manual é adotada, a do ERP antigo sai e a nova vale', async () => {
        const esc = criarConsumidorTabelaEscalonadaDoErp(resolver);
        const evEsc = (external_id, extra = {}) => env('tabela_escalonada', external_id, 'criado', { produto_external_id: 'P-1', medida: 'FD', quantidade_minima: 10, preco_unidade_cents: 900, vigencia_inicio: '2026-11-01', vigencia_fim: null, ...extra });
        const vivas = (t) => t.q("select external_id, preco_unidade_cents::text as preco from catalogo.tabela_escalonada where produto_id = $1 and deleted_at is null order by external_id", [PROD]);
        await emTransacao(A.tenantId, async (t) => {
            // 1) faixa manual na mesma chave: adotada (uma linha viva, com o external_id do ERP)
            await t.q("insert into catalogo.tabela_escalonada (tenant_id, produto_id, medida, quantidade_minima, preco_unidade_cents, vigencia_inicio) values ($1, $2, 'FD', 10, 800, '2026-11-01')", [A.tenantId, PROD]);
            await t.entregar(esc, evEsc('ESC-A'));
            expect(await vivas(t)).toEqual([{ external_id: 'ESC-A', preco: '900' }]);
            // 2) outro external_id do ERP na mesma chave: antes era 23505 em loop; agora o novo vale e o antigo sai (soft delete)
            await t.entregar(esc, evEsc('ESC-B', { preco_unidade_cents: 850 }));
            expect(await vivas(t)).toEqual([{ external_id: 'ESC-B', preco: '850' }]);
            // 3) reentrega é idempotente
            await t.entregar(esc, evEsc('ESC-B', { preco_unidade_cents: 850 }));
            expect(await vivas(t)).toHaveLength(1);
            // 4) o ERP muda a chave de ESC-C (mínimo 20 -> 10) para a de ESC-B, ainda viva: ESC-B sai e ESC-C vale
            await t.entregar(esc, evEsc('ESC-C', { quantidade_minima: 20 }));
            await t.entregar(esc, evEsc('ESC-C', { quantidade_minima: 10, preco_unidade_cents: 700 }));
            expect(await vivas(t)).toEqual([{ external_id: 'ESC-C', preco: '700' }]);
        });
    });
    it('RN-VEN-23: faixa do ERP entra só no tenant do evento (o outro tenant não a vê)', async () => {
        const esc = criarConsumidorTabelaEscalonadaDoErp(resolver);
        await emTransacao(A.tenantId, async (t) => {
            await t.entregar(esc, env('tabela_escalonada', 'ESC-ISO', 'criado', { produto_external_id: 'P-1', medida: null, quantidade_minima: 3, preco_unidade_cents: 500, vigencia_inicio: '2026-11-01', vigencia_fim: null }));
            expect((await t.q("select 1 from catalogo.tabela_escalonada where external_id = 'ESC-ISO' and tenant_id = $1", [B.tenantId])).length).toBe(0);
        });
    });
    it('RN-INT-04: produto ainda ausente lança ReferenciaAusenteErp e não grava órfão', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await expect(t.entregar(preco, evPreco({ produto_external_id: 'P-NAO-CHEGOU' }))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
            await expect(t.entregar(estoque, evEstoque({ produto_external_id: 'P-NAO-CHEGOU' }))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
            expect((await t.q("select 1 from catalogo.tabela_preco_item where external_id = 'PR-T66'")).length).toBe(0);
            expect((await t.q("select 1 from catalogo.estoque_saldo where external_id = 'ES-T66'")).length).toBe(0);
        });
    });
    it('RN-INT-02: estoque cria depósito e saldo; reentrega atualiza a quantidade sem duplicar; inativação some o saldo', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await t.entregar(estoque, evEstoque());
            await t.entregar(estoque, evEstoque({ saldo: 3 }, 'atualizado'));
            expect((await t.q("select 1 from catalogo.deposito where external_id = 'DEP-T66'")).length).toBe(1);
            const s = await t.q("select quantidade from catalogo.estoque_saldo where external_id = 'ES-T66' and deleted_at is null");
            expect(s.length).toBe(1);
            expect(Number(s[0].quantidade)).toBe(3);
            await t.entregar(estoque, { lote_id: '11111111-1111-4111-8111-111111111111', entidade: 'estoque', external_id: 'ES-T66', acao: 'inativado', hash: 'h2', ocorrido_em: '2026-11-04T11:00:00Z' });
            expect((await t.q("select 1 from catalogo.estoque_saldo where external_id = 'ES-T66' and deleted_at is null")).length).toBe(0);
        });
    });
    it('RF-CAT-04: árvore do ERP cria nós em cadeia, é idempotente e o pai ausente repete na outbox; inativação faz soft delete', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await expect(t.entregar(noCons, evNo('N-T61-2', 'N-T61-1', 2))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
            await t.entregar(noCons, evNo('N-T61-1', null, 1));
            await t.entregar(noCons, evNo('N-T61-2', 'N-T61-1', 2));
            await t.entregar(noCons, evNo('N-T61-2', 'N-T61-1', 2, { nome: 'Renomeado' }, 'atualizado'));
            const nos = await t.q("select nome, nivel from catalogo.catalogo_no where external_id like 'N-T61-%' and deleted_at is null order by nivel");
            expect(nos.map((n) => n.nome)).toEqual(['Nó N-T61-1', 'Renomeado']);
            await t.entregar(noCons, { lote_id: '11111111-1111-4111-8111-111111111111', entidade: 'catalogo_no', external_id: 'N-T61-2', acao: 'inativado', hash: 'h2', ocorrido_em: '2026-11-04T11:00:00Z' });
            expect((await t.q("select 1 from catalogo.catalogo_no where external_id = 'N-T61-2' and deleted_at is null")).length).toBe(0);
        });
    });
    it('RF-CAT-04: produto vinculado ao nó (um por produto); trocar de nó atualiza; sem nó solta; nó ou produto ausente repete', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await t.entregar(noCons, evNo('N-T61-1', null, 1));
            await t.entregar(noCons, evNo('N-T61-2', 'N-T61-1', 2));
            await expect(t.entregar(produtoNo, evProdutoNo('N-T61-NAO-CHEGOU'))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
            await t.entregar(produtoNo, evProdutoNo('N-T61-1'));
            await t.entregar(produtoNo, evProdutoNo('N-T61-2'));
            const v = await t.q("select n.external_id as no from catalogo.produto_no v join catalogo.catalogo_no n on n.id = v.no_id where v.produto_id = $1 and v.deleted_at is null", [PROD]);
            expect(v.map((x) => x.no)).toEqual(['N-T61-2']);
            await t.entregar(produtoNo, evProdutoNo(null));
            expect((await t.q('select 1 from catalogo.produto_no where produto_id = $1 and deleted_at is null', [PROD])).length).toBe(0);
        });
    });
    it('RN-INT-02: multi-tenant, o que entra no tenant A não aparece no B', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await t.entregar(preco, evPreco());
            await t.entregar(estoque, evEstoque());
        });
        await emTransacao(B.tenantId, async (t) => {
            await t.entregar(preco, evPreco({ preco_cents: 999 }));
            expect(Number((await itens(t))[0].preco_cents)).toBe(999);
            expect((await t.q("select 1 from catalogo.tabela_preco where external_id = 'TAB-T66'")).length).toBe(1);
        });
        await emTransacao(B.tenantId, async (t) => {
            expect((await t.q("select 1 from catalogo.tabela_preco_item where external_id = 'PR-T66'")).length).toBe(0);
        });
    });
    // T-0085 / RN-CAT-09: referência cruzada do produto do ERP; a marca vem de catalogo.marca_concorrente (RN-CAT-13, 0045; linhas inseridas por tenant sob RLS)
    const MARCA_A = '0ca00000-0000-4000-8000-0000000000e1';
    const MARCA_B = '0ca00000-0000-4000-8000-0000000000e2';
    const concA = [
        { id: MARCA_A, nome: 'Freiomax', ativo: true, external_id: 'MC-A' },
        { id: '0ca00000-0000-4000-8000-0000000000e3', nome: 'Velha', ativo: false, external_id: 'MC-VELHA' },
    ];
    const concB = [{ id: MARCA_B, nome: 'Marca do B', ativo: true, external_id: 'MC-B' }];
    const evRefs = (referencias) => env('produto', 'P-1', 'atualizado', { sku: 'SKU-1', nome: 'Produto 1', unidade: 'UN', referencias });
    const refsVivas = (t) => t.q('select marca_id, marca_nome, codigo, ordem from catalogo.produto_referencia where produto_id = $1 and deleted_at is null order by ordem', [PROD]);
    it('RN-CAT-09: referência do ERP com marca conhecida grava o retrato marca_nome; marca desconhecida ou inativa é descartada com aviso', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await t.entregar(produtoNo, evRefs([{ marca_external_id: 'MC-A', codigo: 'CB 3401' }, { marca_external_id: 'MC-NAO-EXISTE', codigo: 'ZZ 1' }, { marca_external_id: 'MC-VELHA', codigo: 'OLD 1' }, { marca_nome: 'freiomax', codigo: 'FR-77.2' }]));
            const r = await refsVivas(t);
            expect(r.map((x) => [x.marca_id, x.marca_nome, x.codigo, Number(x.ordem)])).toEqual([
                [MARCA_A, 'Freiomax', 'CB 3401', 1],
                [MARCA_A, 'Freiomax', 'FR-77.2', 2],
            ]);
        }, concA);
    });
    it('RN-CAT-09: reaplicar o mesmo evento mantém o mesmo conjunto vivo, na ordem 1..N (idempotência)', async () => {
        await emTransacao(A.tenantId, async (t) => {
            const ev = evRefs([{ marca_external_id: 'MC-A', codigo: 'CB 3401' }, { marca_external_id: 'MC-A', codigo: 'FR-77.2' }]);
            await t.entregar(produtoNo, ev);
            await t.entregar(produtoNo, ev);
            expect((await refsVivas(t)).map((x) => [x.codigo, x.marca_nome, Number(x.ordem)])).toEqual([['CB 3401', 'Freiomax', 1], ['FR-77.2', 'Freiomax', 2]]);
        }, concA);
    });
    it('RN-CAT-09: tenant isolado, a marca do B não resolve no A (descartada) e o retrato gravado no A não aparece no B', async () => {
        await emTransacao(A.tenantId, async (t) => {
            await t.entregar(produtoNo, evRefs([{ marca_external_id: 'MC-B', codigo: 'LB 0099' }]));
            expect((await refsVivas(t)).length).toBe(0);
            await t.entregar(produtoNo, evRefs([{ marca_external_id: 'MC-A', codigo: 'CB 3401' }]));
            expect((await refsVivas(t)).length).toBe(1);
            expect((await t.q("select 1 from catalogo.produto_referencia where marca_id = $1", [MARCA_B])).length).toBe(0);
        }, concA);
        await emTransacao(B.tenantId, async (t) => {
            expect((await t.q("select 1 from catalogo.produto_referencia where marca_nome = 'Freiomax'")).length).toBe(0);
        }, concB);
    });
});
