/**
 * T-0066 × Postgres real (fixture dois-tenants, RLS): consumidores de `integracao.preco|estoque.atualizado@1` no Catálogo.
 * Cada caso roda numa transação desfeita no fim. Cobre idempotência, inativação, referência ausente (RN-INT-04) e isolamento
 * por tenant. O produto é resolvido por um resolvedor injetado (a consulta do Core é testada no Core). Pula sem Postgres.
 */
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ConsumidorEvento, ContextoConsumo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { manifest } from '../manifest';
import { criarConsumidorCatalogoNoDoErp, criarConsumidorEstoqueDoErp, criarConsumidorPrecoDoErp, criarConsumidorProdutoNoDoErp, ReferenciaAusenteErp, type ResolverProdutos } from './consumidores-erp';
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
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
  });
  afterAll(async () => {
    await pool.end();
  });

  const resolver: ResolverProdutos = async (_ctx, ids) => new Map(ids.filter((i) => i === 'P-1').map((i) => [i, PROD]));

  async function emTransacao(tenant: string, fn: (t: Teste) => Promise<void>, concorrentes: { id: string; nome: string; ativo: boolean; external_id: string | null }[] = []): Promise<void> {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await definirTenant(c, tenant);
      const entregar = async (cons: ConsumidorEvento, payload: unknown) => {
        const ctx = {
          db: c,
          agora: () => AGORA,
          fuso: () => 'America/Manaus',
          parametros: () => ({}),
          envelope: { evento_id: 'x', tenant_id: tenant },
          publicar: vi.fn(async () => ({})),
          consultar: vi.fn(async () => ({ concorrentes })),
          log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        } as unknown as ContextoConsumo;
        await cons.executar(cons.evento.schema.parse(payload), ctx);
      };
      const q = async <R = Record<string, unknown>>(sql: string, v: unknown[] = []) => (await c.query(sql, v)).rows as R[];
      await fn({ entregar, q });
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  }
  interface Teste {
    entregar(cons: ConsumidorEvento, payload: unknown): Promise<void>;
    q<R = Record<string, unknown>>(sql: string, v?: unknown[]): Promise<R[]>;
  }

  const preco = criarConsumidorPrecoDoErp(resolver);
  const estoque = criarConsumidorEstoqueDoErp(resolver);
  const noCons = criarConsumidorCatalogoNoDoErp();
  const produtoNo = criarConsumidorProdutoNoDoErp(resolver);
  // Envelope e registro no formato do contracts do Integracao (T-0024): lote, entidade, hash e alterado_em/external_id do registro.
  const env = (entidade: string, external_id: string, acao: string, registro: Record<string, unknown>) => ({
    lote_id: '11111111-1111-4111-8111-111111111111',
    entidade,
    external_id,
    acao,
    hash: 'h',
    ocorrido_em: '2026-11-04T10:00:00Z',
    registro: { external_id, alterado_em: '2026-11-04T10:00:00Z', ...registro },
  });
  const evNo = (id: string, pai: string | null, nivel: number, extra: Record<string, unknown> = {}, acao = 'criado') => env('catalogo_no', id, acao, { codigo: id, nome: `Nó ${id}`, pai_external_id: pai, nivel, ordem: 1, ...extra });
  const evProdutoNo = (no: string | null, acao = 'atualizado') => env('produto', 'P-1', acao, { sku: 'SKU-1', nome: 'Produto 1', unidade: 'UN', catalogo_no_external_id: no });
  const evPreco = (extra: Record<string, unknown> = {}, acao = 'criado', external_id = 'PR-T66') => env('preco', external_id, acao, { tabela_external_id: 'TAB-T66', tabela_nome: 'Atacado ERP', vigencia_inicio: '2026-11-01', vigencia_fim: null, produto_external_id: 'P-1', preco_cents: 1500, ...extra });
  const evEstoque = (extra: Record<string, unknown> = {}, acao = 'criado') => env('estoque', 'ES-T66', acao, { deposito_external_id: 'DEP-T66', deposito_nome: 'Matriz', produto_external_id: 'P-1', saldo: 12.5, ...extra });
  const itens = (t: Teste) => t.q<{ preco_cents: string; vigencia_fim: string | null }>("select preco_cents, vigencia_fim from catalogo.tabela_preco_item where external_id = 'PR-T66' and deleted_at is null");

  it('RN-INT-02: preço cria tabela e item; reentrega e atualização não duplicam; inativação faz soft delete', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await t.entregar(preco, evPreco());
      await t.entregar(preco, evPreco());
      await t.entregar(preco, evPreco({ preco_cents: 1700, vigencia_fim: '2026-11-30' }, 'atualizado'));
      expect((await t.q("select 1 from catalogo.tabela_preco where external_id = 'TAB-T66'")).length).toBe(1);
      const i = await itens(t);
      expect(i.length).toBe(1);
      expect(Number(i[0]!.preco_cents)).toBe(1700);
      expect(i[0]!.vigencia_fim).not.toBeNull();
      await t.entregar(preco, { lote_id: '11111111-1111-4111-8111-111111111111', entidade: 'preco', external_id: 'PR-T66', acao: 'inativado', hash: 'h2', ocorrido_em: '2026-11-04T11:00:00Z' });
      expect((await itens(t)).length).toBe(0);
      expect((await t.q("select 1 from catalogo.tabela_preco_item where external_id = 'PR-T66'")).length).toBe(1);
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
      const s = await t.q<{ quantidade: string }>("select quantidade from catalogo.estoque_saldo where external_id = 'ES-T66' and deleted_at is null");
      expect(s.length).toBe(1);
      expect(Number(s[0]!.quantidade)).toBe(3);
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
      const nos = await t.q<{ nome: string; nivel: number }>("select nome, nivel from catalogo.catalogo_no where external_id like 'N-T61-%' and deleted_at is null order by nivel");
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
      const v = await t.q<{ no: string }>("select n.external_id as no from catalogo.produto_no v join catalogo.catalogo_no n on n.id = v.no_id where v.produto_id = $1 and v.deleted_at is null", [PROD]);
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
      expect(Number((await itens(t))[0]!.preco_cents)).toBe(999);
      expect((await t.q("select 1 from catalogo.tabela_preco where external_id = 'TAB-T66'")).length).toBe(1);
    });
    await emTransacao(B.tenantId, async (t) => {
      expect((await t.q("select 1 from catalogo.tabela_preco_item where external_id = 'PR-T66'")).length).toBe(0);
    });
  });

  // T-0085 / RN-CAT-09: referência cruzada do produto do ERP; a marca vem de promotor.concorrentes@1 (mock por tenant, como o Promotor devolveria sob RLS)
  const MARCA_A = '0ca00000-0000-4000-8000-0000000000e1';
  const MARCA_B = '0ca00000-0000-4000-8000-0000000000e2';
  const concA = [
    { id: MARCA_A, nome: 'Freiomax', ativo: true, external_id: 'MC-A' },
    { id: '0ca00000-0000-4000-8000-0000000000e3', nome: 'Velha', ativo: false, external_id: 'MC-VELHA' },
  ];
  const concB = [{ id: MARCA_B, nome: 'Marca do B', ativo: true, external_id: 'MC-B' }];
  const evRefs = (referencias: unknown[]) => env('produto', 'P-1', 'atualizado', { sku: 'SKU-1', nome: 'Produto 1', unidade: 'UN', referencias });
  const refsVivas = (t: Teste) =>
    t.q<{ marca_id: string; marca_nome: string | null; codigo: string; ordem: number }>('select marca_id, marca_nome, codigo, ordem from catalogo.produto_referencia where produto_id = $1 and deleted_at is null order by ordem', [PROD]);

  it('RN-CAT-09: referência do ERP com marca conhecida grava o retrato marca_nome; marca desconhecida ou inativa é descartada com aviso', async () => {
    await emTransacao(
      A.tenantId,
      async (t) => {
        await t.entregar(produtoNo, evRefs([{ marca_external_id: 'MC-A', codigo: 'CB 3401' }, { marca_external_id: 'MC-NAO-EXISTE', codigo: 'ZZ 1' }, { marca_external_id: 'MC-VELHA', codigo: 'OLD 1' }, { marca_nome: 'freiomax', codigo: 'FR-77.2' }]));
        const r = await refsVivas(t);
        expect(r.map((x) => [x.marca_id, x.marca_nome, x.codigo, Number(x.ordem)])).toEqual([
          [MARCA_A, 'Freiomax', 'CB 3401', 1],
          [MARCA_A, 'Freiomax', 'FR-77.2', 2],
        ]);
      },
      concA,
    );
  });

  it('RN-CAT-09: reaplicar o mesmo evento mantém o mesmo conjunto vivo, na ordem 1..N (idempotência)', async () => {
    await emTransacao(
      A.tenantId,
      async (t) => {
        const ev = evRefs([{ marca_external_id: 'MC-A', codigo: 'CB 3401' }, { marca_external_id: 'MC-A', codigo: 'FR-77.2' }]);
        await t.entregar(produtoNo, ev);
        await t.entregar(produtoNo, ev);
        expect((await refsVivas(t)).map((x) => [x.codigo, x.marca_nome, Number(x.ordem)])).toEqual([['CB 3401', 'Freiomax', 1], ['FR-77.2', 'Freiomax', 2]]);
      },
      concA,
    );
  });

  it('RN-CAT-09: tenant isolado, a marca do B não resolve no A (descartada) e o retrato gravado no A não aparece no B', async () => {
    await emTransacao(
      A.tenantId,
      async (t) => {
        await t.entregar(produtoNo, evRefs([{ marca_external_id: 'MC-B', codigo: 'LB 0099' }]));
        expect((await refsVivas(t)).length).toBe(0);
        await t.entregar(produtoNo, evRefs([{ marca_external_id: 'MC-A', codigo: 'CB 3401' }]));
        expect((await refsVivas(t)).length).toBe(1);
        expect((await t.q("select 1 from catalogo.produto_referencia where marca_id = $1", [MARCA_B])).length).toBe(0);
      },
      concA,
    );
    await emTransacao(
      B.tenantId,
      async (t) => {
        expect((await t.q("select 1 from catalogo.produto_referencia where marca_nome = 'Freiomax'")).length).toBe(0);
      },
      concB,
    );
  });
});
