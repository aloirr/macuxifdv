/**
 * 0096 — fila do pré-cadastro de cliente aprovado para o ERP (v1.0.27, RF-CORE-10). Dicionário: docs/banco/integracao.md ("0096").
 * O que o BANCO garante:
 * - integracao.cliente_fila_erp no padrão da pedido_fila_erp: único (tenant_id, cliente_uuid), estado pendente | enviado |
 *   vinculado | rejeitado, 'enviado' com enviado_em, payload objeto, tentativas >= 0, conector do mesmo tenant;
 * - poll pelo índice parcial cliente_fila_erp_poll_ix (pendentes e enviados vencidos, na ordem da aprovação, skip locked);
 * - isolamento: o macuxi_app de um tenant não lê nem grava a fila do outro; macuxi_leitura só lê o próprio tenant;
 * - up/down: a 0096 só acrescenta; o down volta exatamente ao catálogo da anterior.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemIntegracao from '../../modules/integracao/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { comoPapel, emTransacao, erroDe, erroNoSavepoint, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0096';
const m96 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m96) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m96.up);
const down = semComentarios(m96.down);

const TABELA = 'integracao.cliente_fila_erp';
const INDICE = 'cliente_fila_erp_poll_ix';
const COLUNAS = [
  'id', 'tenant_id', 'cliente_uuid', 'payload', 'aprovado_em', 'estado', 'enviado_em', 'tentativas', 'conector_id', 'motivo',
  'created_at', 'updated_at', 'deleted_at', 'external_id',
];
const POLL =
  "select id from integracao.cliente_fila_erp where tenant_id = $1 and deleted_at is null and (estado = 'pendente' or (estado = 'enviado' and enviado_em < now() - interval '10 minutes')) order by aprovado_em limit 50 for update skip locked";
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;

describe('0096 fila do cliente para o ERP (estático)', () => {
  it('nome, CHECK do estado = espelho, índice do poll, RLS, grants, espelho Drizzle e fora do sync', () => {
    expect(m96.nome).toBe('integracao_cliente_fila_erp');
    expect(up).toContain('create table integracao.cliente_fila_erp (');
    expect(up).toContain('constraint cliente_fila_erp_cliente_uk unique (tenant_id, cliente_uuid)');
    const estados = /cliente_fila_erp_estado_valido check \(estado in \(([^)]*)\)\)/.exec(up)![1]!.split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(estados).toEqual([...nuvemIntegracao.ESTADOS_CLIENTE_ERP_BANCO]);
    expect(up).toContain(
      `create index ${INDICE} on ${TABELA} (tenant_id, aprovado_em) where estado in ('pendente', 'enviado') and deleted_at is null;`,
    );
    expect(up).toContain(`alter table ${TABELA} force row level security;`);
    expect(up).toContain(`grant select, insert, update on ${TABELA} to macuxi_app;`);
    expect(up).toContain(`grant select on ${TABELA} to macuxi_leitura;`);
    expect(up).not.toMatch(/grant [^;]*delete|to macuxi_(worker|portal)|\bcore\./);
    expect(Object.keys(nuvemIntegracao.clienteFilaErp).filter((k) => COLUNAS.includes(k)).sort()).toEqual([...COLUNAS].sort());
    expect(TABELAS_FORA_DO_SYNC).toContain(TABELA);
  });

  it('down: só apaga a tabela', () => {
    expect(down.trim()).toBe(`drop table if exists ${TABELA};`);
  });
});

describe.skipIf(semBanco())('0096 fila do cliente para o ERP (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  const comoApp = (t: string, sql: string, p: unknown[] = []) => comoPapel<Record<string, unknown>>(admin, 'macuxi_app', sql, p, t).then((r) => r.rows);
  const comoLeitura = (t: string, sql: string, p: unknown[] = []) => comoPapel<Record<string, unknown>>(admin, 'macuxi_leitura', sql, p, t).then((r) => r.rows);
  const CLI_A = '96000000-0000-4000-8000-00000000000a';
  const CLI_B = '96000000-0000-4000-8000-00000000000b';
  const inserir = 'insert into integracao.cliente_fila_erp (tenant_id, cliente_uuid, payload, aprovado_em) values ($1, $2, $3, now()) returning id';

  it('CHECKs, unique (tenant_id, cliente_uuid) e conector do mesmo tenant', async () => {
    await emTransacao(admin, null, async () => {
      await admin.query(inserir, [A.tenantId, CLI_A, { nome: 'A' }]);
      const ins = (cols: string, vals: string, p: unknown[] = []) =>
        erroNoSavepoint(admin, `insert into integracao.cliente_fila_erp (tenant_id, cliente_uuid, payload, aprovado_em${cols}) values ($1, $2, '{}', now()${vals})`, [A.tenantId, ...p]);
      expect((await ins('', '', [CLI_A]))?.code).toBe('23505');
      expect(await ins('', '', [CLI_B])).toBeNull(); // outro cliente do mesmo tenant entra
      expect((await ins(', estado', ", 'integrado'", [crypto.randomUUID()]))?.code).toBe('23514');
      expect((await ins(', estado', ", 'enviado'", [crypto.randomUUID()]))?.code).toBe('23514'); // enviado sem enviado_em
      expect((await ins(', tentativas', ', -1', [crypto.randomUUID()]))?.code).toBe('23514');
      expect((await erroNoSavepoint(admin, "insert into integracao.cliente_fila_erp (tenant_id, cliente_uuid, payload, aprovado_em) values ($1, $2, '[]', now())", [A.tenantId, crypto.randomUUID()]))?.code).toBe('23514');
      expect((await ins(', conector_id', ', $3', [crypto.randomUUID(), B.integracao.conector]))?.code).toBe('23503');
      for (const e of nuvemIntegracao.ESTADOS_CLIENTE_ERP_BANCO) expect(await ins(', estado, enviado_em', `, '${e}', now()`, [crypto.randomUUID()]), e).toBeNull();
      // o mesmo cliente_uuid em outro tenant não colide
      expect(await erroNoSavepoint(admin, inserir, [B.tenantId, CLI_A, {}])).toBeNull();
    });
  });

  it('RLS: A não lê nem grava a fila de B; poll com skip locked só no próprio tenant; macuxi_leitura só o próprio', async () => {
    await emTransacao(admin, null, async () => {
      const [a] = (await admin.query<{ id: string }>(inserir, [A.tenantId, CLI_A, { nome: 'A' }])).rows;
      const [b] = (await admin.query<{ id: string }>(inserir, [B.tenantId, CLI_B, { nome: 'B' }])).rows;
      expect(await comoApp(A.tenantId, 'select id from integracao.cliente_fila_erp where id = $1', [b!.id])).toEqual([]);
      expect(await comoApp(A.tenantId, "update integracao.cliente_fila_erp set estado = 'rejeitado' where id = $1 returning id", [b!.id])).toEqual([]);
      expect((await erroDe(comoApp(A.tenantId, "insert into integracao.cliente_fila_erp (tenant_id, cliente_uuid, payload, aprovado_em) values ($1, gen_random_uuid(), '{}', now())", [B.tenantId])))?.code).toBe('42501');
      const poll = async (t: string) => (await comoApp(A.tenantId, POLL, [t])).map((r) => r['id']);
      expect(await poll(A.tenantId)).toContain(a!.id);
      expect(await poll(B.tenantId)).toEqual([]);
      expect(
        await comoApp(A.tenantId, "update integracao.cliente_fila_erp set estado = 'enviado', enviado_em = now(), tentativas = tentativas + 1 where id = $1 returning estado, tentativas", [a!.id]),
      ).toEqual([{ estado: 'enviado', tentativas: 1 }]);
      expect(await poll(A.tenantId)).not.toContain(a!.id); // enviado há pouco não volta
      await admin.query("update integracao.cliente_fila_erp set enviado_em = now() - interval '1 hour' where id = $1", [a!.id]);
      expect(await poll(A.tenantId)).toContain(a!.id); // enviado vencido volta (reentrega)
      expect(await comoLeitura(A.tenantId, 'select id from integracao.cliente_fila_erp where id in ($1, $2)', [a!.id, b!.id])).toEqual([{ id: a!.id }]);
      expect((await erroDe(comoApp(A.tenantId, 'delete from integracao.cliente_fila_erp where id = $1', [a!.id])))?.code).toBe('42501');
    });
  });
});

describe.skipIf(semBanco())('0096 fila do cliente para o ERP (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up só acrescenta; o poll usa o índice; down volta ao catálogo da anterior; up de novo = igual', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual([`${VERSAO}_${m96.nome}`]);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((x) => !depois.includes(x))).toEqual([]);
      const novos = depois.filter((x) => !antes.includes(x));
      expect(novos.filter((x) => x.startsWith('col ')).map((x) => x.split(' ')[1]!.split('.')[2]).sort()).toEqual([...COLUNAS].sort());
      expect(novos.filter((x) => x.startsWith('pol ')).map((x) => x.split(' ')[1]).sort()).toEqual(
        [`${TABELA}.isolamento_tenant`, `${TABELA}.leitura`, `${TABELA}.manutencao`],
      );
      expect(novos).toContain(`rel ${TABELA} r rls=true force=true`);
      expect(novos.filter((x) => x.startsWith('idx ')).some((x) => x.includes(INDICE))).toBe(true);
      await c.query('set enable_seqscan = off');
      const plano = await c.query(`explain ${POLL.replace('$1', "'00000000-0000-0000-0000-000000000001'")}`);
      expect(plano.rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n')).toContain(INDICE);
      await c.query('reset enable_seqscan');
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${VERSAO}_${m96.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
