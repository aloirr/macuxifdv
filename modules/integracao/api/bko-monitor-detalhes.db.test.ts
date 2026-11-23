/**
 * `GET /v1/integracao/monitor/detalhes` × Postgres real (desenho `empresa-zerar.md` §6.4): cursor, `registro_atual`, erros por
 * código e lotes reprocessáveis só com o conteúdo no staging; o RLS separa os tenants. Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MonitorDetalhes } from '../contracts';
import { rotaMonitorDetalhes } from './bko-monitor';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const P = `ZERDET${randomUUID().slice(0, 6)}`;

describe.skipIf(semBanco())('Monitor detalhado × Postgres (empresa-zerar §6.4)', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  let conectorId = '';
  const lotes: Record<string, string> = {};

  const ctx = (tenantId: string) =>
    ({
      usuario: { id: tenantId === A.tenantId ? A.usuarios.admin : B.usuarios.admin, tenant_id: tenantId, perfil: 'admin' },
      superAdmin: { id: randomUUID(), sessao_id: randomUUID() },
      parametros: () => ({}),
      agora: () => new Date('2099-12-31T00:00:00Z'),
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      comTenant: (fn: (db: pg.PoolClient, t: unknown) => Promise<unknown>) => comTenant(pool, tenantId, (db) => fn(db, {})),
    }) as never;
  const detalhes = async (tenantId: string) => MonitorDetalhes.parse(await rotaMonitorDetalhes.executar(ctx(tenantId)));

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    const { rows } = await admin.query<{ id: string }>(
      "insert into integracao.conector (tenant_id, identificador, nome, tipo, recebe_pedidos, entidades) values ($1, $2, 'Detalhe', 'conector', false, array['rota']) returning id",
      [A.tenantId, `${P}-a`],
    );
    conectorId = rows[0]!.id;
    const lote = async (nome: string, status: string, recebidoEm: string, conteudo: boolean) => {
      const r = await admin.query<{ id: string }>(
        `insert into integracao.lote (tenant_id, conector_id, entidade, modo, versao_contrato, chave_idempotencia, hash_conteudo, recebidas, com_erro, recebido_em, status)
         values ($1, $2, 'rota', 'delta', '1', $3, encode(sha256($3::text::bytea), 'hex'), 2, 2, $4, $5) returning id`,
        [A.tenantId, conectorId, `${P}-${nome}`, recebidoEm, status],
      );
      lotes[nome] = r.rows[0]!.id;
      await admin.query('insert into integracao.lote_staging (tenant_id, lote_id, corpo) values ($1, $2, $3::jsonb)', [A.tenantId, lotes[nome], conteudo ? '{"registros":[]}' : null]);
    };
    await lote('velho', 'falhou', '2099-01-01T10:00:00Z', true);
    await lote('expirado', 'falhou', '2099-01-02T10:00:00Z', false);
    await lote('novo', 'concluido_com_erros', '2099-01-03T10:00:00Z', true);
    for (const [i, codigo, reprocessavel] of [
      [0, 'referencia_ausente', true],
      [1, 'referencia_ausente', true],
      [2, 'campo_obrigatorio', false],
    ] as const) {
      await admin.query(
        "insert into integracao.lote_linha_erro (tenant_id, lote_id, indice, origem, codigo, mensagem, reprocessavel, external_id) values ($1, $2, $3, 'hub', $4, 'Mensagem', $5, $6)",
        [A.tenantId, lotes.novo, i, codigo, reprocessavel, `${P}-r${i}`],
      );
    }
    await admin.query(
      "insert into integracao.cursor_entidade (tenant_id, conector_id, entidade, cursor_alterado_em, cursor_external_id) values ($1, $2, 'rota', '2099-01-03T09:00:00.123Z', $3)",
      [A.tenantId, conectorId, `${P}-r9`],
    );
    for (const [i, ativo] of [
      [1, true],
      [2, true],
      [3, false],
    ] as const) {
      await admin.query(
        "insert into integracao.registro_atual (tenant_id, entidade, conector_id, hash, alterado_em, ativo, external_id) values ($1, 'rota', $2, encode(sha256($4::text::bytea), 'hex'), $5, $3, $4)",
        [A.tenantId, conectorId, ativo, `${P}-reg${i}`, '2099-01-03T08:00:00Z'],
      );
    }
  });
  afterAll(async () => {
    if (admin && conectorId) {
      await admin.query('delete from integracao.registro_atual where tenant_id = $1 and conector_id = $2', [A.tenantId, conectorId]);
      await admin.query('delete from integracao.cursor_entidade where tenant_id = $1 and conector_id = $2', [A.tenantId, conectorId]);
      await admin.query('delete from integracao.lote_linha_erro where tenant_id = $1 and lote_id = any($2::uuid[])', [A.tenantId, Object.values(lotes)]);
      await admin.query('delete from integracao.lote_staging where tenant_id = $1 and lote_id = any($2::uuid[])', [A.tenantId, Object.values(lotes)]);
      await admin.query('delete from integracao.lote where tenant_id = $1 and conector_id = $2', [A.tenantId, conectorId]);
      await admin.query('delete from integracao.conector where id = $1', [conectorId]);
    }
    await admin?.end();
    await pool?.end();
  });

  it('RF-INT-04: cursor, registros, último lote e erros por código e classe da entidade', async () => {
    const rota = (await detalhes(A.tenantId)).entidades.find((e) => e.entidade === 'rota')!;
    expect(rota.cursores).toContainEqual({ conector_id: `${P}-a`, alterado_em: '2099-01-03T09:00:00.123Z', external_id: `${P}-r9`, atualizado_em: expect.any(String) });
    expect(rota.registros.ativos).toBeGreaterThanOrEqual(2);
    expect(rota.registros.inativos).toBeGreaterThanOrEqual(1);
    expect(rota.ultimo_lote?.lote_id).toBe(lotes.novo);
    expect(rota.erros).toEqual(
      expect.arrayContaining([
        { codigo: 'referencia_ausente', classe: 'reprocessavel', linhas: 2 },
        { codigo: 'campo_obrigatorio', classe: 'corrigir_no_erp', linhas: 1 },
      ]),
    );
  });

  it('RN-INT-15: reprocessáveis só com o conteúdo no staging, do mais antigo ao mais recente', async () => {
    const rota = (await detalhes(A.tenantId)).entidades.find((e) => e.entidade === 'rota')!;
    expect(rota.lotes_reprocessaveis).toEqual([lotes.velho, lotes.novo]);
  });

  it('RLS: o outro tenant não vê o Conector, os lotes nem o cursor do tenant A', async () => {
    const r = await detalhes(B.tenantId);
    expect(r.conectores.some((c) => c.conector_id === `${P}-a`)).toBe(false);
    expect(r.entidades.flatMap((e) => e.lotes_reprocessaveis).some((id) => Object.values(lotes).includes(id))).toBe(false);
    expect(r.entidades.flatMap((e) => e.cursores).some((c) => c.conector_id === `${P}-a`)).toBe(false);
  });
});
