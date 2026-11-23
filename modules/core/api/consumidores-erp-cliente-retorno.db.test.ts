/**
 * `integracao.cliente.retorno_erp@1` no Core × Postgres real (RN-CORE-78, RN-INT-22; colunas das migrações 0095, 0097 e 0098): o ERP aprova (grava o
 * código e o status, também sobre o recusado e de revisão anterior) ou recusa (grava o motivo e os erros no cliente e na tentativa da revisão), é
 * idempotente, recusa conflito e código em uso, resolve o alias do APK v1.0.28, isola por tenant. Transação desfeita no fim. Pula sem Postgres.
 */
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoConsumo } from '@macuxi/platform-sdk';
import type { StatusCadastro } from '../contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { consumidorClienteRetornoErp } from './consumidores-erp-cliente-retorno';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const C1 = '5b000000-0000-4000-8000-000000000001';
const C2 = '5b000000-0000-4000-8000-000000000002';

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
        // `revisao` e `erros` são aditivos da @1 (ADR 0069 §9): vão junto mesmo que o contrato do dono ainda não os declare
        const { revisao, erros } = p as { revisao?: number; erros?: unknown };
        const extras = { ...(revisao === undefined ? {} : { revisao }), ...(erros === undefined ? {} : { erros }) };
        await consumidorClienteRetornoErp.executar({ ...consumidorClienteRetornoErp.evento.schema.parse(p), ...extras }, ctx);
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

  const novo = (id: string, status: StatusCadastro, externalId: string | null = null) =>
    `insert into core.cliente (id, tenant_id, razao_social, origem_cadastro, status_cadastro, aprovado_em, motivo_recusa, external_id) values ('${id}', plataforma.tenant_atual(), 'Cliente ${id.slice(-1)}', 'campo', '${status}', ${status === 'aprovado' ? 'now()' : 'null'}, ${status === 'recusado' ? "'recusa antiga'" : 'null'}, ${externalId ? `'${externalId}'` : 'null'})`;
  const retorno = (id: string, status: 'vinculado' | 'rejeitado_erp', external_id: string | null, motivo: string | null = null, extras: { revisao?: number; erros?: unknown } = {}) => ({
    cliente_id: id,
    status,
    external_id,
    motivo,
    ocorrido_em: '2026-11-23T12:00:00Z',
    ...extras,
  });
  /** Pré-cadastro na revisão `rev` (v1.0.30), com uma tentativa por revisão: as anteriores recusadas, a atual conforme o status. */
  const comRevisoes = async (q: (s: string, v?: unknown[]) => Promise<unknown[]>, id: string, status: StatusCadastro, rev: number) => {
    await q(novo(id, status));
    await q(`update core.cliente set revisao_cadastro = ${rev} where id = '${id}'`);
    for (let r = 1; r <= rev; r++) {
      const recusada = r < rev || status === 'recusado';
      await q(
        `insert into core.cliente_pre_cadastro_tentativa (tenant_id, cliente_id, revisao, origem, enviado_em, resultado, respondido_em, motivo)
         values (plataforma.tenant_atual(), $1, $2, 'campo', '2026-11-22T10:00:00Z', $3, $4, $5)`,
        [id, r, recusada ? 'recusado' : 'aguardando', recusada ? '2026-11-22T12:00:00Z' : null, recusada ? 'recusa antiga' : null],
      );
    }
  };
  const tentativas = (q: <R>(s: string, v?: unknown[]) => Promise<R[]>, id: string) =>
    q<{ revisao: number; resultado: string; respondido_em: string | null; motivo: string | null; erros: unknown }>(
      'select revisao, resultado, respondido_em::text, motivo, erros from core.cliente_pre_cadastro_tentativa where cliente_id = $1 order by revisao',
      [id],
    );

  const linha = async (q: <R>(s: string) => Promise<R[]>, id: string) =>
    (await q<{ external_id: string | null; status_cadastro: string; aprovado_em: string | null; motivo_recusa: string | null }>(`select external_id, status_cadastro, aprovado_em::text, motivo_recusa from core.cliente where id = '${id}'`))[0]!;

  it('RN-CORE-78: vinculado grava o código e aprova o cadastro pendente, audita, publica uma vez e a reentrega não repete', async () => {
    await emTransacao(async (t) => {
      await t.q(novo(C1, 'pendente'));
      await t.entregar(retorno(C1, 'vinculado', 'ERP-1'));
      await t.entregar(retorno(C1, 'vinculado', 'ERP-1'), 'ev-2');
      expect(await linha(t.q, C1)).toMatchObject({ external_id: 'ERP-1', status_cadastro: 'aprovado', aprovado_em: expect.any(String) });
      expect(t.publicar).toHaveBeenCalledTimes(1);
      const aud = await t.q<{ acao: string }>("select acao from plataforma.auditoria where entidade_id = $1 and acao like 'cliente.%'", [C1]);
      expect(aud).toEqual([{ acao: 'cliente.vincular_erp' }]);
    });
  });

  it('RN-CORE-78: o legado aprovado sem código também recebe o código do ERP', async () => {
    await emTransacao(async (t) => {
      await t.q(novo(C1, 'aprovado'));
      await t.entregar(retorno(C1, 'vinculado', 'ERP-1'));
      expect(await linha(t.q, C1)).toMatchObject({ external_id: 'ERP-1', status_cadastro: 'aprovado' });
    });
  });

  it('RN-CORE-78: código diferente do que o cliente já tem é conflito: não grava, audita e não publica', async () => {
    await emTransacao(async (t) => {
      await t.q(novo(C1, 'aprovado', 'ERP-1'));
      await t.entregar(retorno(C1, 'vinculado', 'ERP-9'));
      expect((await linha(t.q, C1)).external_id).toBe('ERP-1');
      expect(t.publicar).not.toHaveBeenCalled();
      const aud = await t.q<{ depois: { resultado: string } }>("select depois from plataforma.auditoria where entidade_id = $1 and acao = 'cliente.vinculo_erp_recusado'", [C1]);
      expect(aud[0]?.depois.resultado).toBe('conflito');
    });
  });

  it('RN-CORE-78: código de outro cliente do tenant é codigo_em_uso', async () => {
    await emTransacao(async (t) => {
      await t.q(novo(C1, 'aprovado', 'ERP-1'));
      await t.q(novo(C2, 'pendente'));
      await t.entregar(retorno(C2, 'vinculado', 'ERP-1'));
      expect((await linha(t.q, C2)).external_id).toBeNull();
      expect(t.publicar).not.toHaveBeenCalled();
      const aud = await t.q<{ depois: { resultado: string } }>("select depois from plataforma.auditoria where entidade_id = $1 and acao = 'cliente.vinculo_erp_recusado'", [C2]);
      expect(aud[0]?.depois.resultado).toBe('codigo_em_uso');
    });
  });

  it('RN-CORE-78: rejeitado_erp recusa o cadastro com o motivo cortado em 500, publica uma vez por recusa e o motivo não vai à auditoria', async () => {
    await emTransacao(async (t) => {
      await t.q(novo(C1, 'pendente'));
      const motivo = `Documento inválido no ERP ${'x'.repeat(600)}`;
      await t.entregar(retorno(C1, 'rejeitado_erp', null, motivo));
      await t.entregar(retorno(C1, 'rejeitado_erp', null, motivo), 'ev-2');
      const l = await linha(t.q, C1);
      expect(l).toMatchObject({ external_id: null, status_cadastro: 'recusado' });
      expect(l.motivo_recusa).toHaveLength(500);
      expect(l.motivo_recusa).toContain('Documento inválido no ERP');
      expect(t.publicar).toHaveBeenCalledTimes(1);
      expect(t.publicar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cliente_id: C1, campos: ['status_cadastro'] }), C1);
      const aud = await t.q("select depois::text as depois from plataforma.auditoria where entidade_id = $1 and acao = 'cliente.rejeitado_erp'", [C1]);
      expect(aud.length).toBe(1);
      expect(String(aud[0]?.depois)).not.toContain('Documento inválido');
    });
  });

  it('RN-INT-22: o código do ERP vale sobre o recusado da mesma revisão: aprova, limpa motivo e erros e a tentativa fica aceita', async () => {
    await emTransacao(async (t) => {
      await comRevisoes(t.q, C1, 'recusado', 1);
      await t.q(`update core.cliente set erros_recusa = '[{"campo":"cep","codigo":"X","mensagem":"CEP"}]' where id = '${C1}'`);
      await t.entregar(retorno(C1, 'vinculado', 'ERP-1', null, { revisao: 1 }));
      expect(await linha(t.q, C1)).toMatchObject({ external_id: 'ERP-1', status_cadastro: 'aprovado', motivo_recusa: null });
      expect((await t.q<{ erros_recusa: unknown }>(`select erros_recusa from core.cliente where id = '${C1}'`))[0]!.erros_recusa).toBeNull();
      expect(await tentativas(t.q, C1)).toEqual([{ revisao: 1, resultado: 'aceito', respondido_em: expect.any(String), motivo: null, erros: null }]);
      expect(t.publicar).toHaveBeenCalledTimes(1);
      const aud = await t.q<{ depois: { revisao: number } }>("select depois from plataforma.auditoria where entidade_id = $1 and acao = 'cliente.vincular_erp'", [C1]);
      expect(aud[0]?.depois.revisao).toBe(1);
    });
  });

  it('RN-INT-22: vinculado de revisão anterior vale (o ERP manda): a tentativa dele e a atual aguardando ficam aceitas; revisão desconhecida não grava', async () => {
    await emTransacao(async (t) => {
      await comRevisoes(t.q, C1, 'pendente', 2);
      await t.entregar(retorno(C1, 'vinculado', 'ERP-1', null, { revisao: 3 }));
      expect((await linha(t.q, C1)).external_id).toBeNull();
      await t.entregar(retorno(C1, 'vinculado', 'ERP-1', null, { revisao: 1 }), 'ev-2');
      expect(await linha(t.q, C1)).toMatchObject({ external_id: 'ERP-1', status_cadastro: 'aprovado' });
      expect((await tentativas(t.q, C1)).map((x) => x.resultado)).toEqual(['aceito', 'aceito']);
      expect(t.publicar).toHaveBeenCalledTimes(1);
    });
  });

  it('RN-INT-22: recusa da revisão atual grava motivo e erros seguros no cliente e na tentativa; de revisão anterior não vale; repetida não publica; outra é fato novo', async () => {
    await emTransacao(async (t) => {
      await comRevisoes(t.q, C1, 'pendente', 2);
      await t.entregar(retorno(C1, 'rejeitado_erp', null, 'antiga', { revisao: 1, erros: [] }));
      expect((await linha(t.q, C1)).status_cadastro).toBe('pendente');
      const erros = [{ campo: 'cep', codigo: 'INVALIDO', mensagem: `CEP não existe ${'y'.repeat(400)}` }];
      await t.entregar(retorno(C1, 'rejeitado_erp', null, 'Dados inválidos', { revisao: 2, erros }), 'ev-2');
      await t.entregar(retorno(C1, 'rejeitado_erp', null, 'Dados inválidos', { revisao: 2, erros }), 'ev-3');
      const cli = (await t.q<{ status_cadastro: string; motivo_recusa: string; erros_recusa: Array<{ mensagem: string }> }>(`select status_cadastro, motivo_recusa, erros_recusa from core.cliente where id = '${C1}'`))[0]!;
      expect(cli).toMatchObject({ status_cadastro: 'recusado', motivo_recusa: 'Dados inválidos' });
      expect(cli.erros_recusa[0]!.mensagem.length).toBeLessThanOrEqual(300);
      const [t1, t2] = await tentativas(t.q, C1);
      expect(t1).toMatchObject({ revisao: 1, resultado: 'recusado', motivo: 'recusa antiga' });
      expect(t2).toMatchObject({ revisao: 2, resultado: 'recusado', motivo: 'Dados inválidos', respondido_em: expect.any(String) });
      expect(t2!.erros).toEqual(cli.erros_recusa);
      expect(t.publicar).toHaveBeenCalledTimes(1);
      // fato novo na mesma revisão: outro motivo, sem erros (`[]` = sem erros)
      await t.entregar(retorno(C1, 'rejeitado_erp', null, 'Outro motivo', { revisao: 2, erros: [] }), 'ev-4');
      expect((await t.q<{ erros_recusa: unknown }>(`select erros_recusa from core.cliente where id = '${C1}'`))[0]!.erros_recusa).toBeNull();
      expect((await tentativas(t.q, C1))[1]).toMatchObject({ motivo: 'Outro motivo', erros: null });
      expect(t.publicar).toHaveBeenCalledTimes(2);
      const aud = await t.q("select depois::text as depois from plataforma.auditoria where entidade_id = $1 and acao = 'cliente.rejeitado_erp'", [C1]);
      expect(aud.map((a) => String(a.depois)).join(' ')).not.toMatch(/Dados inválidos|Outro motivo|CEP não existe/);
    });
  });

  it('RN-CORE-78: o retorno pelo id do recusado substituído pelo APK v1.0.28 grava no cliente vivo (alias)', async () => {
    await emTransacao(async (t) => {
      await comRevisoes(t.q, C2, 'pendente', 1);
      await t.q(novo(C1, 'recusado'));
      await t.q(`update core.cliente set deleted_at = '2026-11-23T11:00:00Z', revisao_cadastro = 1 where id = '${C1}'`);
      await t.q(`update core.cliente_pre_cadastro_tentativa set cliente_id_original = '${C1}' where cliente_id = '${C2}'`);
      await t.entregar(retorno(C1, 'vinculado', 'ERP-2', null, { revisao: 1 }));
      expect(await linha(t.q, C2)).toMatchObject({ external_id: 'ERP-2', status_cadastro: 'aprovado' });
      expect(t.publicar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cliente_id: C2 }), C2);
    });
  });

  it('RN-CORE-78: recusa do ERP não derruba cliente que já tem código', async () => {
    await emTransacao(async (t) => {
      await t.q(novo(C1, 'aprovado', 'ERP-1'));
      await t.entregar(retorno(C1, 'rejeitado_erp', null, 'tarde demais'));
      expect(await linha(t.q, C1)).toMatchObject({ external_id: 'ERP-1', status_cadastro: 'aprovado', motivo_recusa: null });
      expect(t.publicar).not.toHaveBeenCalled();
    });
  });

  it('RN-CORE-78: multi-tenant: o retorno do tenant B não toca o cliente do tenant A (RLS)', async () => {
    await emTransacao(async (t) => {
      await t.q(novo(C1, 'pendente'));
      await t.tenant(B.tenantId);
      await t.entregar(retorno(C1, 'vinculado', 'ERP-1'));
      await t.tenant(A.tenantId);
      expect((await linha(t.q, C1)).external_id).toBeNull();
    });
  });
});
