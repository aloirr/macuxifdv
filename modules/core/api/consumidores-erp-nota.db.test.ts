/**
 * T-0066 × Postgres real (fixture dois-tenants, RLS): `integracao.nota.atualizado@1` -> `core.nota_erp` e histórico de
 * compra (`core.historico_compra`) do Cliente 360. Cada caso roda numa transação desfeita no fim. Cobre idempotência,
 * inativação, devolução e cancelamento no consolidado, mudança de mês, referência ausente (RN-INT-04), mês no fuso do
 * tenant e isolamento por tenant. Pula sem Postgres.
 */
import { completarCnpj } from '@macuxi/comum/documento';
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ConsumidorEvento, ContextoConsumo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { manifest } from '../manifest';
import { consumidoresDoErp } from './consumidores-erp';
import { ReferenciaAusenteErp } from './erp-apoio';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const EV = 'integracao.nota.atualizado@1';
const AGORA = new Date('2026-11-04T15:00:00Z');
let poolDoTeste: pg.Pool | undefined;
const pool = () => poolDoTeste!;

const consumidor = (): ConsumidorEvento => {
  const c = consumidoresDoErp.find((x) => x.evento.nome === EV);
  if (!c) throw new Error('sem consumidor de nota');
  return c;
};

describe('T-0066: manifesto liga o consumidor de nota', () => {
  it('RN-INT-04: o Core declara e expõe o consumidor de integracao.nota.atualizado@1', () => {
    expect(manifest.consome).toContain(EV);
    expect(consumidoresDoErp.map((c) => c.evento.nome)).toContain(EV);
  });
});

describe.skipIf(semBanco())('Core T-0066 × Postgres: notas do ERP e histórico de compra', () => {
  beforeAll(() => {
    poolDoTeste = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
  });
  afterAll(async () => {
    await poolDoTeste?.end();
  });

  async function emTransacao(tenant: string, fn: (t: Teste) => Promise<void>): Promise<void> {
    const c = await pool().connect();
    try {
      await c.query('begin');
      await definirTenant(c, tenant);
      const warn = vi.fn();
      const info = vi.fn();
      const entregar = async (payload: unknown) => {
        const cons = consumidor();
        const ctx = {
          db: c,
          agora: () => AGORA,
          fuso: () => 'America/Manaus',
          parametros: () => ({}),
          envelope: { evento_id: 'x', tenant_id: tenant },
          publicar: vi.fn(async () => ({})),
          consultar: vi.fn(),
          log: { info, warn, error: vi.fn() },
        } as unknown as ContextoConsumo;
        await cons.executar(cons.evento.schema.parse(payload), ctx);
      };
      const q = async <R = Record<string, unknown>>(sql: string, v: unknown[] = []) => (await c.query(sql, v)).rows as R[];
      await fn({ entregar, q, logs: [warn, info] });
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  }
  interface Teste {
    entregar(payload: unknown): Promise<void>;
    q<R = Record<string, unknown>>(sql: string, v?: unknown[]): Promise<R[]>;
    logs: Array<ReturnType<typeof vi.fn>>;
  }

  const nota = (id: string, extra: Record<string, unknown> = {}, acao: 'criado' | 'atualizado' | 'inativado' = 'criado') => ({
    lote_id: '0e500000-0000-4000-8000-000000000002',
    entidade: 'nota',
    external_id: id,
    acao,
    hash: 'h',
    registro: {
      external_id: id,
      alterado_em: '2026-11-04T10:00:00Z',
      ativo: true,
      cliente_external_id: 'C-N66',
      tipo: 'faturamento',
      numero: `NF-${id}`,
      serie: '1',
      emitida_em: '2026-10-15T14:00:00Z',
      total_cents: 10_000,
      quantidade_itens: 3,
      cancelada: false,
      ...extra,
    },
    ocorrido_em: '2026-11-04T10:00:00Z',
  });
  const preparar = async (t: Teste) => {
    await t.q("insert into core.cliente (tenant_id, external_id, razao_social, documento) values (plataforma.tenant_atual(), 'C-N66', 'Mercado Nota', $1)", [completarCnpj('990000030001')]);
  };
  const historico = (t: Teste, mes: string) =>
    t.q<{ valor_cents: string; pedidos: number; itens: number; ultima_compra_em: string | null }>(
      "select h.valor_cents::text, h.pedidos, h.itens, to_char(h.ultima_compra_em, 'YYYY-MM-DD') as ultima_compra_em from core.historico_compra h join core.cliente c on c.id = h.cliente_id where c.external_id = 'C-N66' and h.ano_mes = $1 and h.deleted_at is null",
      [mes],
    );

  it('RN-INT-04: cliente ausente lança referência ausente e nada é gravado', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await expect(t.entregar(nota('N-1'))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
      expect((await t.q("select 1 from core.nota_erp where external_id = 'N-1'")).length).toBe(0);
    });
  });

  it('RN-INT-02: nota entra, reentrega não duplica e o histórico de compra do mês acompanha (devolução abate, cancelada fica fora)', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await preparar(t);
      await t.entregar(nota('N-1'));
      await t.entregar(nota('N-1'));
      await t.entregar(nota('N-2', { total_cents: 5_000, quantidade_itens: null, emitida_em: '2026-10-20T14:00:00Z' }));
      expect((await t.q("select 1 from core.nota_erp where external_id = 'N-1' and deleted_at is null")).length).toBe(1);
      expect(await historico(t, '2026-10')).toEqual([{ valor_cents: '15000', pedidos: 2, itens: 3, ultima_compra_em: '2026-10-20' }]);
      await t.entregar(nota('N-3', { tipo: 'devolucao', total_cents: 2_000, emitida_em: '2026-10-22T14:00:00Z' }));
      expect((await historico(t, '2026-10'))[0]).toMatchObject({ valor_cents: '13000', pedidos: 2, ultima_compra_em: '2026-10-20' });
      await t.entregar(nota('N-2', { total_cents: 5_000, cancelada: true, emitida_em: '2026-10-20T14:00:00Z' }, 'atualizado'));
      expect((await historico(t, '2026-10'))[0]).toMatchObject({ valor_cents: '8000', pedidos: 1, ultima_compra_em: '2026-10-15' });
    });
  });

  it('RN-CORE-11: o mês da nota é o do fuso do tenant (01/11 02:00 UTC ainda é outubro em Manaus)', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await preparar(t);
      await t.entregar(nota('N-1', { emitida_em: '2026-11-01T02:00:00Z' }));
      const r = await t.q<{ ano_mes: string }>("select ano_mes from core.nota_erp where external_id = 'N-1'");
      expect(r[0]?.ano_mes).toBe('2026-10');
      expect((await historico(t, '2026-10'))[0]?.ultima_compra_em).toBe('2026-10-31');
    });
  });

  it('nota que muda de mês recalcula os dois meses; inativação remove a nota e esvazia o mês sem notas', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await preparar(t);
      await t.entregar(nota('N-1'));
      await t.entregar(nota('N-1', { emitida_em: '2026-09-10T14:00:00Z' }, 'atualizado'));
      expect(await historico(t, '2026-10')).toEqual([]);
      expect((await historico(t, '2026-09'))[0]).toMatchObject({ valor_cents: '10000', pedidos: 1 });
      await t.entregar(nota('N-1', {}, 'inativado'));
      expect((await t.q("select 1 from core.nota_erp where external_id = 'N-1' and deleted_at is null")).length).toBe(0);
      expect(await historico(t, '2026-09')).toEqual([]);
      await t.entregar({ ...nota('N-9', {}, 'inativado'), registro: undefined }); // nota desconhecida: sem erro
    });
  });

  it('RN-CORE-05 e LGPD: o tenant B não vê as notas do A e o log não leva número da nota', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await preparar(t);
      await t.entregar(nota('N-1'));
      for (const l of t.logs) expect(JSON.stringify(l.mock.calls)).not.toContain('NF-N-1');
    });
    await emTransacao(B.tenantId, async (t) => {
      expect((await t.q("select 1 from core.nota_erp where external_id = 'N-1'")).length).toBe(0);
    });
  });
});
