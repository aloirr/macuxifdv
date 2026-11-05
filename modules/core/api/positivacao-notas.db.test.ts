/**
 * T-0080 × Postgres real (fixture dois-tenants, RLS): positivação do mês pelas notas do ERP com o Vendedor desligado (RN-CORE-27).
 * Cobre nota antes do vendedor (completada pelo consumidor do vendedor), reenvio idempotente, cancelamento posterior,
 * Vendedor ligado ignorando as notas, Integração desligada caindo no ramo antigo e isolamento por tenant. Pula sem Postgres.
 * Depende da migração 0025 (core.nota_erp.vendedor_external_id e usuario_id).
 */
import { completarCnpj } from '@macuxi/comum/documento';
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ConsumidorEvento, ContextoConsumo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { consumidoresDoErp } from './consumidores-erp';
import { calcularInicio } from './inicio';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const AGORA = new Date('2026-11-10T16:00:00Z'); // 10/11 12h em Manaus
let poolDoTeste: pg.Pool | undefined;

const consumidor = (evento: string): ConsumidorEvento => {
  const c = consumidoresDoErp.find((x) => x.evento.nome === evento);
  if (!c) throw new Error(`sem consumidor de ${evento}`);
  return c;
};

describe.skipIf(semBanco())('Core T-0080 × Postgres: positivação pelas notas do ERP (RN-CORE-27)', () => {
  beforeAll(() => {
    poolDoTeste = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
  });
  afterAll(async () => {
    await poolDoTeste?.end();
  });

  interface Teste {
    entregar(evento: string, payload: unknown): Promise<void>;
    q<R = Record<string, unknown>>(sql: string, v?: unknown[]): Promise<R[]>;
    inicio(modulos: string[], vendedorId: string, comVendedor?: boolean): Promise<{ ate_ontem: number; hoje: number } | null>;
  }
  async function emTransacao(tenant: string, fn: (t: Teste) => Promise<void>): Promise<void> {
    const c = await poolDoTeste!.connect();
    try {
      await c.query('begin');
      await definirTenant(c, tenant);
      const t: Teste = {
        entregar: async (evento, payload) => {
          const cons = consumidor(evento);
          const ctx = { db: c, agora: () => AGORA, fuso: () => 'America/Manaus', parametros: () => ({}), envelope: { evento_id: 'x', tenant_id: tenant }, publicar: vi.fn(async () => ({})), consultar: vi.fn(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as ContextoConsumo;
          await cons.executar(cons.evento.schema.parse(payload), ctx);
        },
        q: async <R>(sql: string, v: unknown[] = []) => (await c.query(sql, v)).rows as R[],
        inicio: async (modulos, vendedorId, comVendedor = false) => {
          const r = await calcularInicio(c, {}, { usuarioId: vendedorId, integracaoNoTenant: modulos.includes('integracao'), perfil: 'vendedor', visiveis: new Set([vendedorId]), agora: AGORA, fuso: 'America/Manaus' }, async () => (comVendedor ? { pedidos: [], faturamentos: [] } : null));
          return r.usuarios[0]?.positivacao ?? null;
        },
      };
      await fn(t);
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  }

  const envelope = (entidade: string, id: string, registro: Record<string, unknown>, acao = 'criado') => ({
    lote_id: '0e500000-0000-4000-8000-000000000003', entidade, external_id: id, acao, hash: 'h',
    registro: { external_id: id, alterado_em: '2026-11-04T10:00:00Z', ativo: true, ...registro }, ocorrido_em: '2026-11-04T10:00:00Z',
  });
  const nota = (id: string, cliente: string, extra: Record<string, unknown> = {}) =>
    envelope('nota', id, { cliente_external_id: cliente, vendedor_external_id: 'V-80', tipo: 'faturamento', numero: `NF-${id}`, serie: '1', emitida_em: '2026-11-05T14:00:00Z', total_cents: 10_000, quantidade_itens: 1, cancelada: false, ...extra });
  const vendedor = () => envelope('vendedor', 'V-80', { nome: 'Vera ERP', email: 'vera80@exemplo.com' });
  const cliente = (t: Teste, ext: string, doc: string) =>
    t.q("insert into core.cliente (tenant_id, external_id, razao_social, documento) values (plataforma.tenant_atual(), $1, $2, $3)", [ext, `Mercado ${ext}`, completarCnpj(doc)]);
  const usuarioId = async (t: Teste) => (await t.q<{ id: string }>("select id from core.usuario where external_id = 'V-80'"))[0]!.id;
  const EV_NOTA = 'integracao.nota.atualizado@1';
  const EV_VEND = 'integracao.vendedor.atualizado@1';

  it('RN-CORE-27: nota antes do vendedor fica órfã e o consumidor do vendedor completa; reenvio não duplica; cancelamento retira', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await cliente(t, 'C-80-1', '990000080001');
      await cliente(t, 'C-80-2', '990000080002');
      await t.entregar(EV_NOTA, nota('N-80-1', 'C-80-1'));
      await t.entregar(EV_NOTA, nota('N-80-1', 'C-80-1'));
      expect((await t.q<{ usuario_id: string | null; vendedor_external_id: string }>("select usuario_id, vendedor_external_id from core.nota_erp where external_id = 'N-80-1'"))).toEqual([{ usuario_id: null, vendedor_external_id: 'V-80' }]);
      await t.entregar(EV_VEND, vendedor());
      await t.entregar(EV_VEND, vendedor());
      const uid = await usuarioId(t);
      expect((await t.q("select 1 from core.nota_erp where external_id = 'N-80-1' and usuario_id = $1", [uid])).length).toBe(1);
      await t.entregar(EV_NOTA, nota('N-80-2', 'C-80-1', { emitida_em: '2026-11-10T14:00:00Z' }));
      await t.entregar(EV_NOTA, nota('N-80-3', 'C-80-2', { emitida_em: '2026-11-10T15:00:00Z' }));
      await t.entregar(EV_NOTA, nota('N-80-4', 'C-80-2', { tipo: 'devolucao', emitida_em: '2026-11-10T15:30:00Z' }));
      expect(await t.inicio(['core', 'integracao'], uid)).toEqual({ ate_ontem: 1, hoje: 1 });
      await t.entregar(EV_NOTA, nota('N-80-3', 'C-80-2', { emitida_em: '2026-11-10T15:00:00Z', cancelada: true }));
      expect(await t.inicio(['core', 'integracao'], uid)).toEqual({ ate_ontem: 1, hoje: 0 });
    });
  });

  it('RN-CORE-27: Vendedor ligado ignora as notas; Integração desligada cai no ramo antigo (sem fonte = nula)', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await cliente(t, 'C-80-1', '990000080001');
      await t.entregar(EV_VEND, vendedor());
      await t.entregar(EV_NOTA, nota('N-80-1', 'C-80-1'));
      const uid = await usuarioId(t);
      expect(await t.inicio(['core', 'integracao', 'vendedor'], uid, true)).toEqual({ ate_ontem: 0, hoje: 0 });
      expect(await t.inicio(['core'], uid)).toBeNull();
    });
  });

  it('RN-CORE-27: isolamento por tenant (RLS): nota do tenant A não aparece no B', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await cliente(t, 'C-80-1', '990000080001');
      await t.entregar(EV_VEND, vendedor());
      await t.entregar(EV_NOTA, nota('N-80-1', 'C-80-1'));
    });
    await emTransacao(B.tenantId, async (t) => {
      expect(await t.q("select 1 from core.nota_erp where external_id = 'N-80-1'")).toEqual([]);
    });
  });
});
