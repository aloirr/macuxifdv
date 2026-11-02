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
import { criarConsumidorEstoqueDoErp, criarConsumidorPrecoDoErp, ReferenciaAusenteErp, type ResolverProdutos } from './consumidores-erp';
import { moduloApi } from './index';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const PROD = '0ca00000-0000-4000-8000-0000000000f1';
const AGORA = new Date('2026-11-04T15:00:00Z');

describe('T-0066: manifesto e moduloApi ligam os consumidores do ERP no Catálogo', () => {
  it('RN-INT-04: preço e estoque declarados no manifesto têm consumidor registrado no moduloApi', () => {
    for (const n of ['integracao.preco.atualizado@1', 'integracao.estoque.atualizado@1']) {
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

  async function emTransacao(tenant: string, fn: (t: Teste) => Promise<void>): Promise<void> {
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
          consultar: vi.fn(),
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
  const evPreco = (extra: Record<string, unknown> = {}, acao = 'criado', external_id = 'PR-T66') => ({
    external_id,
    acao,
    ocorrido_em: '2026-11-04T10:00:00Z',
    registro: { tabela_external_id: 'TAB-T66', tabela_nome: 'Atacado ERP', vigencia_inicio: '2026-11-01', vigencia_fim: null, produto_external_id: 'P-1', preco_cents: 1500, ...extra },
  });
  const evEstoque = (extra: Record<string, unknown> = {}, acao = 'criado') => ({
    external_id: 'ES-T66',
    acao,
    ocorrido_em: '2026-11-04T10:00:00Z',
    registro: { deposito_external_id: 'DEP-T66', deposito_nome: 'Matriz', produto_external_id: 'P-1', saldo: 12.5, ...extra },
  });
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
      await t.entregar(preco, { external_id: 'PR-T66', acao: 'inativado', ocorrido_em: '2026-11-04T11:00:00Z' });
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
      await t.entregar(estoque, { external_id: 'ES-T66', acao: 'inativado', ocorrido_em: '2026-11-04T11:00:00Z' });
      expect((await t.q("select 1 from catalogo.estoque_saldo where external_id = 'ES-T66' and deleted_at is null")).length).toBe(0);
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
});
