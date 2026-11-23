/**
 * `integracao.cliente.retorno_erp@1` no Core × Postgres real (RN-CORE-78, RN-INT-22; colunas da migração 0095): grava o código do ERP
 * no cliente aprovado, é idempotente, recusa conflito e código em uso, isola por tenant. Transação desfeita no fim. Pula sem Postgres.
 */
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoConsumo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { consumidorClienteRetornoErp } from './consumidores-erp-cliente-retorno';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const C1 = '5b000000-0000-4000-8000-000000000001';
const C2 = '5b000000-0000-4000-8000-000000000002';
const C3 = '5b000000-0000-4000-8000-000000000003';

describe.skipIf(semBanco())('Core × Postgres: retorno do ERP do cliente novo (RN-CORE-78)', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  async function emTransacao(fn: (t: { entregar(p: unknown, eventoId?: string): Promise<void>; q<R = Record<string, unknown>>(s: string, v?: unknown[]): Promise<R[]>; publicar: ReturnType<typeof vi.fn>; tenant(id: string): Promise<void> }) => Promise<void>): Promise<void> {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await definirTenant(c, A.tenantId);
      const publicar = vi.fn(async () => ({}));
      let tenantId = A.tenantId;
      const entregar = async (p: unknown, eventoId = 'ev-1') => {
        const ctx = { db: c, agora: () => new Date('2026-11-23T12:00:00Z'), fuso: () => 'America/Manaus', parametros: () => ({}), envelope: { evento_id: eventoId, tenant_id: tenantId }, publicar, consultar: vi.fn(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as ContextoConsumo;
        await consumidorClienteRetornoErp.executar(consumidorClienteRetornoErp.evento.schema.parse(p), ctx);
      };
      const q = async <R = Record<string, unknown>>(sql: string, v: unknown[] = []) => (await c.query(sql, v)).rows as R[];
      try {
        await fn({ entregar, q, publicar, tenant: async (id) => { tenantId = id; await definirTenant(c, id); } });
      } finally {
        await c.query('rollback').catch(() => undefined);
      }
    } finally {
      c.release();
    }
  }

  const novo = (id: string, aprovado: boolean, externalId: string | null = null) =>
    `insert into core.cliente (id, tenant_id, razao_social, origem_cadastro, status_cadastro, aprovado_em, aprovado_por, external_id) values ('${id}', plataforma.tenant_atual(), 'Cliente ${id.slice(-1)}', 'campo', '${aprovado ? 'aprovado' : 'pendente'}', ${aprovado ? `now(), '${A.usuarios.admin}'` : 'null, null'}, ${externalId ? `'${externalId}'` : 'null'})`;
  const retorno = (id: string, status: 'vinculado' | 'rejeitado_erp', external_id: string | null, motivo: string | null = null) => ({ cliente_id: id, status, external_id, motivo, ocorrido_em: '2026-11-23T12:00:00Z' });
  const codigoDe = async (q: <R>(s: string) => Promise<R[]>, id: string) => (await q<{ external_id: string | null }>(`select external_id from core.cliente where id = '${id}'`))[0]?.external_id;

  it('RN-CORE-78: vinculado grava o código no cliente aprovado, audita, publica uma vez e a reentrega não repete', async () => {
    await emTransacao(async (t) => {
      await t.q(novo(C1, true));
      await t.entregar(retorno(C1, 'vinculado', 'ERP-1'));
      await t.entregar(retorno(C1, 'vinculado', 'ERP-1'), 'ev-2');
      expect(await codigoDe(t.q, C1)).toBe('ERP-1');
      expect(t.publicar).toHaveBeenCalledTimes(1);
      const aud = await t.q<{ acao: string }>("select acao from plataforma.auditoria where entidade_id = $1 and acao like 'cliente.%'", [C1]);
      expect(aud).toEqual([{ acao: 'cliente.vincular_erp' }]);
    });
  });

  it('RN-CORE-78: código diferente do que o cliente já tem é conflito: não grava, audita e não publica', async () => {
    await emTransacao(async (t) => {
      await t.q(novo(C1, true, 'ERP-1'));
      await t.entregar(retorno(C1, 'vinculado', 'ERP-9'));
      expect(await codigoDe(t.q, C1)).toBe('ERP-1');
      expect(t.publicar).not.toHaveBeenCalled();
      const aud = await t.q<{ depois: { resultado: string } }>("select depois from plataforma.auditoria where entidade_id = $1 and acao = 'cliente.vinculo_erp_recusado'", [C1]);
      expect(aud[0]?.depois.resultado).toBe('conflito');
    });
  });

  it('RN-CORE-78: código de outro cliente do tenant é codigo_em_uso: não grava; cliente não aprovado é ignorado', async () => {
    await emTransacao(async (t) => {
      await t.q(novo(C1, true, 'ERP-1'));
      await t.q(novo(C2, true));
      await t.q(novo(C3, false));
      await t.entregar(retorno(C2, 'vinculado', 'ERP-1'));
      await t.entregar(retorno(C3, 'vinculado', 'ERP-3'));
      expect(await codigoDe(t.q, C2)).toBeNull();
      expect(await codigoDe(t.q, C3)).toBeNull();
      expect(t.publicar).not.toHaveBeenCalled();
      const aud = await t.q<{ depois: { resultado: string } }>("select depois from plataforma.auditoria where entidade_id = $1 and acao = 'cliente.vinculo_erp_recusado'", [C2]);
      expect(aud[0]?.depois.resultado).toBe('codigo_em_uso');
    });
  });

  it('RN-CORE-78: rejeitado_erp só audita (sem código e sem dado pessoal)', async () => {
    await emTransacao(async (t) => {
      await t.q(novo(C1, true));
      await t.entregar(retorno(C1, 'rejeitado_erp', null, 'Documento inválido no ERP'));
      expect(await codigoDe(t.q, C1)).toBeNull();
      expect(t.publicar).not.toHaveBeenCalled();
      const aud = await t.q("select depois::text as depois from plataforma.auditoria where entidade_id = $1 and acao = 'cliente.rejeitado_erp'", [C1]);
      expect(aud.length).toBe(1);
      expect(String(aud[0]?.depois)).not.toContain('Documento inválido');
    });
  });

  it('RN-CORE-78: multi-tenant: o retorno do tenant B não toca o cliente do tenant A (RLS)', async () => {
    await emTransacao(async (t) => {
      await t.q(novo(C1, true));
      await t.tenant(B.tenantId);
      await t.entregar(retorno(C1, 'vinculado', 'ERP-1'));
      await t.tenant(A.tenantId);
      expect(await codigoDe(t.q, C1)).toBeNull();
    });
  });
});
