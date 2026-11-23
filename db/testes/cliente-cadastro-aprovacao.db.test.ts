/**
 * 0095 — origem, status e aprovação do cadastro do cliente (v1.0.27, RF-CORE-10). Dicionário: docs/banco/core.md ("0095").
 * O que o BANCO garante:
 * - core.cliente ganha origem_cadastro ('erp' | 'campo' | 'bko', not null default 'erp'), status_cadastro ('pendente' |
 *   'aprovado' | 'recusado', nulo se e só se a origem é 'erp'), aprovado_em e aprovado_por (juntos, só com 'aprovado');
 * - índice parcial cliente_aprovado_sem_erp_ix (fila do Hub); a unicidade do external_id vivo por tenant é a de sempre;
 * - isolamento: o macuxi_app de um tenant não lê nem grava a aprovação do outro; macuxi_leitura lê as 4 colunas;
 * - up/down: a 0095 só acrescenta; o down volta exatamente ao catálogo da anterior.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { comoPapel, emTransacao, erroNoSavepoint, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0095';
const m95 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m95) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m95.up);
const down = semComentarios(m95.down);

const COLUNAS = ['origem_cadastro', 'status_cadastro', 'aprovado_em', 'aprovado_por'];
const CHECKS = [
  'cliente_origem_cadastro_valida', 'cliente_status_cadastro_valido', 'cliente_status_cadastro_origem', 'cliente_aprovacao_par',
  'cliente_aprovacao_status',
];
const INDICE = 'cliente_aprovado_sem_erp_ix';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;

describe('0095 cadastro e aprovação do cliente (estático)', () => {
  it('nome, colunas, CHECKs, índice, grant do macuxi_leitura e espelho Drizzle', () => {
    expect(m95.nome).toBe('core_cliente_cadastro_aprovacao');
    expect(up).toContain("alter table core.cliente add column origem_cadastro text not null default 'erp';");
    expect(up).toContain('alter table core.cliente add column status_cadastro text;');
    expect(up).toContain('alter table core.cliente add column aprovado_em timestamptz;');
    expect(up).toContain('alter table core.cliente add column aprovado_por uuid;');
    for (const c of COLUNAS) expect(Object.keys(nuvemCore.cliente), c).toContain(c);
    for (const k of CHECKS) expect(up, k).toContain(`add constraint ${k}`);
    expect(up.replace(/\s+/g, ' ')).toContain(
      `create index ${INDICE} on core.cliente (tenant_id, aprovado_em, id) where external_id is null and aprovado_em is not null and deleted_at is null;`,
    );
    expect(up).toContain('grant select (origem_cadastro, status_cadastro, aprovado_em, aprovado_por) on core.cliente to macuxi_leitura;');
    expect(up).not.toMatch(/create unique index|create table|create policy|alter policy|row level security|\bupdate\b|\bdelete\b/i);
    expect(up).not.toMatch(/to macuxi_(app|worker|portal)/);
    // a unicidade do external_id vivo já é da 0002
    expect(migracoes.find((m) => m.versao === '0002')!.up).toContain(
      'create unique index cliente_external_uk on core.cliente (tenant_id, external_id) where external_id is not null and deleted_at is null;',
    );
  });

  it('down: apaga índice, CHECKs e colunas', () => {
    expect(down).toContain(`drop index if exists core.${INDICE};`);
    for (const k of CHECKS) expect(down).toContain(`alter table core.cliente drop constraint if exists ${k};`);
    for (const c of COLUNAS) expect(down).toContain(`alter table core.cliente drop column if exists ${c};`);
    expect(down).not.toMatch(/create |update |grant /);
  });
});

describe.skipIf(semBanco())('0095 cadastro e aprovação do cliente (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const comoApp = (t: string, sql: string, p: unknown[] = []) => comoPapel<Record<string, unknown>>(admin, 'macuxi_app', sql, p, t).then((r) => r.rows);
  const cliente = (set: string, p: unknown[] = []) => erroNoSavepoint(admin, `update core.cliente set ${set} where id = '${A.clientes.c1}'`, p);
  const APROVADOR = A.usuarios.vendedor1;

  it('quem já existe é do ERP, sem status nem aprovação', async () => {
    const r = await q<{ n: number }>(
      "select count(*)::int as n from core.cliente where origem_cadastro <> 'erp' or status_cadastro is not null or aprovado_em is not null or aprovado_por is not null",
    );
    expect(r[0]!.n).toBe(0);
  });

  it('CHECKs: valores, status x origem, par e status da aprovação', async () => {
    await emTransacao(admin, null, async () => {
      expect((await cliente("origem_cadastro = 'csv'"))?.code).toBe('23514');
      expect((await cliente('origem_cadastro = null'))?.code).toBe('23502');
      expect((await cliente("origem_cadastro = 'campo', status_cadastro = 'rascunho'"))?.code).toBe('23514');
      expect((await cliente("status_cadastro = 'pendente'"))?.code).toBe('23514'); // origem erp com status
      expect((await cliente("origem_cadastro = 'bko'"))?.code).toBe('23514'); // pré-cadastro sem status
      expect((await cliente("origem_cadastro = 'campo', status_cadastro = 'pendente', aprovado_em = now(), aprovado_por = $1", [APROVADOR]))?.code).toBe('23514');
      expect((await cliente("origem_cadastro = 'campo', status_cadastro = 'aprovado', aprovado_em = now()"))?.code).toBe('23514');
      expect((await cliente("origem_cadastro = 'campo', status_cadastro = 'aprovado', aprovado_por = $1", [APROVADOR]))?.code).toBe('23514');
      for (const o of ['campo', 'bko']) for (const s of ['pendente', 'recusado', 'aprovado']) expect(await cliente(`origem_cadastro = '${o}', status_cadastro = '${s}'`), `${o} ${s}`).toBeNull();
      expect(await cliente("origem_cadastro = 'campo', status_cadastro = 'aprovado', aprovado_em = now(), aprovado_por = $1", [APROVADOR])).toBeNull();
      expect(await cliente("origem_cadastro = 'erp', status_cadastro = null, aprovado_em = null, aprovado_por = null")).toBeNull();
    });
  });

  it('isolamento: o macuxi_app de B não lê nem grava a aprovação de A; A grava; external_id repetido dá 23505', async () => {
    await emTransacao(admin, null, async () => {
      await q("update core.cliente set origem_cadastro = 'campo', status_cadastro = 'pendente', external_id = null where id = $1", [A.clientes.c1]);
      const aprovar = "update core.cliente set status_cadastro = 'aprovado', aprovado_em = now(), aprovado_por = $2 where id = $1 returning status_cadastro";
      expect(await comoApp(B.tenantId, aprovar, [A.clientes.c1, APROVADOR])).toEqual([]);
      expect(await comoApp(B.tenantId, 'select origem_cadastro from core.cliente where id = $1', [A.clientes.c1])).toEqual([]);
      expect(await comoApp(A.tenantId, aprovar, [A.clientes.c1, APROVADOR])).toEqual([{ status_cadastro: 'aprovado' }]);
      const fila = await comoApp(
        A.tenantId,
        'select id from core.cliente where external_id is null and aprovado_em is not null and deleted_at is null order by aprovado_em, id',
      );
      expect(fila).toEqual([{ id: A.clientes.c1 }]);
      const outro = await q<{ external_id: string | null }>('select external_id from core.cliente where tenant_id = $1 and external_id is not null and deleted_at is null limit 1', [A.tenantId]);
      if (outro[0]) expect((await cliente('external_id = $1', [outro[0].external_id]))?.code).toBe('23505');
    });
  });

  it('macuxi_leitura lê as 4 colunas', async () => {
    const r = await q<{ c: string; ok: boolean }>(
      "select c, has_column_privilege('macuxi_leitura', 'core.cliente', c, 'SELECT') as ok from unnest($1::text[]) c",
      [COLUNAS],
    );
    expect(r.every((x) => x.ok)).toBe(true);
  });
});

describe.skipIf(semBanco())('0095 cadastro e aprovação do cliente (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up só acrescenta; o índice é usado na fila; down volta ao catálogo da anterior; up de novo = igual', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual([`${VERSAO}_${m95.nome}`]);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((x) => !depois.includes(x))).toEqual([]);
      const novos = depois.filter((x) => !antes.includes(x));
      expect(novos.filter((x) => x.startsWith('col ')).sort()).toEqual(
        [
          'col core.cliente.aprovado_em timestamp with time zone nn=false',
          'col core.cliente.aprovado_por uuid nn=false',
          'col core.cliente.origem_cadastro text nn=true',
          'col core.cliente.status_cadastro text nn=false',
        ],
      );
      expect(novos.filter((x) => x.startsWith('con ')).map((x) => x.split(' ')[1]).sort()).toEqual(CHECKS.map((k) => `core.${k}`).sort());
      expect(novos.filter((x) => x.startsWith('idx '))).toHaveLength(1);
      expect(novos.filter((x) => x.startsWith('idx '))[0]).toContain(INDICE);
      expect(novos.filter((x) => x.startsWith('rel '))).toEqual([`rel core.${INDICE} i rls=false force=false`]);
      expect(novos.filter((x) => !/^(col|con|idx|rel) /.test(x))).toEqual([]);
      await c.query('set enable_seqscan = off');
      const plano = await c.query(
        "explain select id from core.cliente where tenant_id = '00000000-0000-0000-0000-000000000001' and external_id is null and aprovado_em is not null and deleted_at is null order by aprovado_em, id limit 50",
      );
      expect(plano.rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n')).toContain(INDICE);
      await c.query('reset enable_seqscan');
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${VERSAO}_${m95.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
