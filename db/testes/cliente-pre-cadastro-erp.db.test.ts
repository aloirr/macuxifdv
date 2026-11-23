/**
 * 0097 — pré-cadastro de cliente sem aprovação no BKO (v1.0.28, RN-CORE-78, RN-INT-22). Dicionários: docs/banco/core.md e
 * docs/banco/integracao.md ("0097"). O que o BANCO garante:
 * - core.cliente sem aprovado_por (e sem o CHECK cliente_aprovacao_par); aprovado_em (quando o ERP aprovou) só com 'aprovado';
 * - core.cliente.motivo_recusa: até 500 caracteres (cliente_motivo_recusa_tamanho) e só com 'recusado'
 *   (cliente_motivo_recusa_status); sem SELECT do macuxi_leitura;
 * - fila do ERP pelo índice parcial cliente_pre_cadastro_fila_ix (pendentes sem external_id, ordem (created_at, id)); o
 *   cliente_aprovado_sem_erp_ix saiu;
 * - integracao.cliente_fila_erp.aprovado_em virou recebido_em (o índice do poll acompanha);
 * - isolamento: o macuxi_app de um tenant não lê nem grava o motivo do outro;
 * - up/down: o down volta exatamente ao catálogo da 0096 (aprovado_por com o UUID nulo nas linhas aprovadas) e às ACLs.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import * as nuvemIntegracao from '../../modules/integracao/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { comoPapel, emTransacao, erroDe, erroNoSavepoint, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0097';
const m97 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m97) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m97.up);
const down = semComentarios(m97.down);
const umaLinha = (sql: string) => sql.replace(/\s+/g, ' ');

const INDICE = 'cliente_pre_cadastro_fila_ix';
const INDICE_ANTIGO = 'cliente_aprovado_sem_erp_ix';
const CHECKS = ['cliente_motivo_recusa_tamanho', 'cliente_motivo_recusa_status'];
const FILA =
  "select id from core.cliente where tenant_id = $1 and status_cadastro = 'pendente' and external_id is null and deleted_at is null order by created_at, id limit 50";
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;

describe('0097 pré-cadastro para o ERP (estático)', () => {
  it('nome, colunas, CHECKs, índice, rename da fila, sem grant e espelho Drizzle', () => {
    expect(m97.nome).toBe('core_cliente_pre_cadastro_erp');
    expect(ANTERIOR).toBe('0096');
    expect(up).toContain(`drop index core.${INDICE_ANTIGO};`);
    expect(up).toContain('alter table core.cliente drop constraint cliente_aprovacao_par;');
    expect(up).toContain('alter table core.cliente drop column aprovado_por;');
    expect(up).toContain('alter table core.cliente add column motivo_recusa text;');
    const u = umaLinha(up);
    expect(u).toContain('add constraint cliente_motivo_recusa_tamanho check (motivo_recusa is null or char_length(motivo_recusa) <= 500);');
    expect(u).toContain("add constraint cliente_motivo_recusa_status check (motivo_recusa is null or status_cadastro = 'recusado');");
    expect(u).toContain(
      `create index ${INDICE} on core.cliente (tenant_id, created_at, id) where status_cadastro = 'pendente' and external_id is null and deleted_at is null;`,
    );
    expect(up).toContain("update core.cliente set updated_at = now() where origem_cadastro <> 'erp' and deleted_at is null;");
    expect(up).toContain('alter table integracao.cliente_fila_erp rename column aprovado_em to recebido_em;');
    // nada de grant (motivo_recusa fora do macuxi_leitura), política ou tabela nova
    expect(up).not.toMatch(/\bgrant\b|\brevoke\b|create table|create policy|alter policy|row level security/i);
    const colunasCore = Object.keys(nuvemCore.cliente);
    expect(colunasCore).toContain('motivo_recusa');
    expect(colunasCore).toContain('aprovado_em');
    expect(colunasCore).not.toContain('aprovado_por');
    const colunasFila = Object.keys(nuvemIntegracao.clienteFilaErp);
    expect(colunasFila).toContain('recebido_em');
    expect(colunasFila).not.toContain('aprovado_em');
  });

  it('down: desfaz na ordem inversa e devolve aprovado_por com o UUID nulo, o CHECK par, o índice antigo e o grant', () => {
    const d = umaLinha(down);
    expect(d).toContain('alter table integracao.cliente_fila_erp rename column recebido_em to aprovado_em;');
    expect(down).toContain(`drop index if exists core.${INDICE};`);
    for (const k of CHECKS) expect(down).toContain(`alter table core.cliente drop constraint if exists ${k};`);
    expect(down).toContain('alter table core.cliente drop column if exists motivo_recusa;');
    expect(down).toContain('alter table core.cliente add column if not exists aprovado_por uuid;');
    expect(d).toContain("update core.cliente set aprovado_por = '00000000-0000-0000-0000-000000000000' where aprovado_em is not null and aprovado_por is null;");
    expect(d).toContain('add constraint cliente_aprovacao_par check ((aprovado_em is null) = (aprovado_por is null));');
    expect(d).toContain(
      `create index if not exists ${INDICE_ANTIGO} on core.cliente (tenant_id, aprovado_em, id) where external_id is null and aprovado_em is not null and deleted_at is null;`,
    );
    expect(down).toContain('grant select (aprovado_por) on core.cliente to macuxi_leitura;');
  });
});

describe.skipIf(semBanco())('0097 pré-cadastro para o ERP (banco, fixture dois-tenants)', () => {
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

  it('catálogo atual: aprovado_por, o CHECK par e o índice antigo sumiram; recebido_em na fila', async () => {
    const r = await q<{ por: boolean; par: boolean; antigo: boolean; novo: boolean; recebido: boolean; aprovado: boolean }>(`
      select exists (select 1 from pg_attribute where attrelid = 'core.cliente'::regclass and attname = 'aprovado_por' and not attisdropped) as por,
             exists (select 1 from pg_constraint where conname = 'cliente_aprovacao_par') as par,
             to_regclass('core.${INDICE_ANTIGO}') is not null as antigo,
             to_regclass('core.${INDICE}') is not null as novo,
             exists (select 1 from pg_attribute where attrelid = 'integracao.cliente_fila_erp'::regclass and attname = 'recebido_em' and not attisdropped) as recebido,
             exists (select 1 from pg_attribute where attrelid = 'integracao.cliente_fila_erp'::regclass and attname = 'aprovado_em' and not attisdropped) as aprovado`);
    expect(r[0]).toEqual({ por: false, par: false, antigo: false, novo: true, recebido: true, aprovado: false });
    const idx = await q<{ d: string }>("select indexdef as d from pg_indexes where indexname = 'cliente_fila_erp_poll_ix'");
    expect(idx[0]!.d).toContain('(tenant_id, recebido_em)');
  });

  it('CHECKs: motivo só com recusado e até 500 caracteres; aprovado_em só com aprovado', async () => {
    await emTransacao(admin, null, async () => {
      await q("update core.cliente set origem_cadastro = 'campo', status_cadastro = 'pendente', external_id = null where id = $1", [A.clientes.c1]);
      expect((await cliente("motivo_recusa = 'CNPJ inválido'"))?.code).toBe('23514'); // pendente com motivo
      expect((await cliente("status_cadastro = 'aprovado', motivo_recusa = 'x'"))?.code).toBe('23514');
      expect((await cliente("status_cadastro = 'recusado', motivo_recusa = repeat('a', 501)"))?.code).toBe('23514');
      expect(await cliente("status_cadastro = 'recusado', motivo_recusa = repeat('é', 500)")).toBeNull(); // conta caracteres, não bytes
      expect(await cliente("status_cadastro = 'recusado', motivo_recusa = null")).toBeNull(); // recusa legada do BKO, sem motivo
      expect((await cliente("status_cadastro = 'pendente', aprovado_em = now()"))?.code).toBe('23514');
      expect(await cliente("status_cadastro = 'aprovado', aprovado_em = now(), external_id = 'ERP-97'")).toBeNull(); // sem aprovador
    });
  });

  it('fila do ERP: pendentes sem código, ordem de chegada, só do tenant; o app de B não lê nem grava o motivo de A', async () => {
    await emTransacao(admin, null, async () => {
      await q("update core.cliente set origem_cadastro = 'campo', status_cadastro = 'pendente', external_id = null where id = $1", [A.clientes.c1]);
      await q("update core.cliente set origem_cadastro = 'bko', status_cadastro = 'pendente', external_id = null where id = $1", [A.clientes.c2]);
      const ordem = await q<{ id: string }>('select id from core.cliente where id = any($1) order by created_at, id', [[A.clientes.c1, A.clientes.c2]]);
      expect((await comoApp(A.tenantId, FILA, [A.tenantId])).map((r) => r['id'])).toEqual(ordem.map((r) => r.id));
      expect(await comoApp(B.tenantId, FILA, [A.tenantId])).toEqual([]);
      const recusar = "update core.cliente set status_cadastro = 'recusado', motivo_recusa = 'CNPJ já cadastrado' where id = $1 returning id";
      expect(await comoApp(B.tenantId, recusar, [A.clientes.c1])).toEqual([]);
      expect(await comoApp(B.tenantId, 'select motivo_recusa from core.cliente where id = $1', [A.clientes.c1])).toEqual([]);
      expect(await comoApp(A.tenantId, recusar, [A.clientes.c1])).toEqual([{ id: A.clientes.c1 }]);
      expect(await comoApp(A.tenantId, 'select motivo_recusa from core.cliente where id = $1', [A.clientes.c1])).toEqual([{ motivo_recusa: 'CNPJ já cadastrado' }]);
      expect((await comoApp(A.tenantId, FILA, [A.tenantId])).map((r) => r['id'])).toEqual([A.clientes.c2]);
    });
  });

  it('macuxi_leitura: sem SELECT em motivo_recusa; segue lendo status_cadastro e aprovado_em', async () => {
    const r = await q<{ c: string; ok: boolean }>(
      "select c, has_column_privilege('macuxi_leitura', 'core.cliente', c, 'SELECT') as ok from unnest($1::text[]) c order by c",
      [['aprovado_em', 'motivo_recusa', 'status_cadastro']],
    );
    expect(r).toEqual([
      { c: 'aprovado_em', ok: true },
      { c: 'motivo_recusa', ok: false },
      { c: 'status_cadastro', ok: true },
    ]);
    await emTransacao(admin, null, async () => {
      expect((await erroDe(comoPapel(admin, 'macuxi_leitura', 'select motivo_recusa from core.cliente limit 1', [], A.tenantId)))?.code).toBe('42501');
    });
    const fila = await q<{ ok: boolean }>("select has_column_privilege('macuxi_leitura', 'integracao.cliente_fila_erp', 'recebido_em', 'SELECT') as ok");
    expect(fila[0]!.ok).toBe(true);
  });
});

describe.skipIf(semBanco())('0097 pré-cadastro para o ERP (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  const ACL = `
    select a.attname as c, has_column_privilege('macuxi_leitura', a.attrelid, a.attnum, 'SELECT') as leitura
      from pg_attribute a where a.attrelid in ('core.cliente'::regclass, 'integracao.cliente_fila_erp'::regclass) and a.attnum > 0 and not a.attisdropped
     order by a.attrelid::regclass::text, a.attname`;

  it('up troca colunas, CHECKs e índice e anda o updated_at dos pré-cadastros; a fila usa o índice; down volta ao catálogo e às ACLs da 0096', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      const aclAntes = (await c.query(ACL)).rows;
      // um tenant com um cliente do ERP e um pré-cadastro aprovado no BKO (v1.0.27), para o backfill do up e o do down
      const t = '97000000-0000-4000-8000-000000000001';
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo97', 'Antigo')", [t]);
      const ins = "insert into core.cliente (tenant_id, razao_social, origem_cadastro, status_cadastro, aprovado_em, aprovado_por, updated_at) values ($1, $2, $3, $4, case when $5 then now() - interval '1 day' end, $6, now() - interval '30 days') returning id";
      const erp = (await c.query<{ id: string }>(ins, [t, 'ERP', 'erp', null, false, null])).rows[0]!.id;
      const pre = (await c.query<{ id: string }>(ins, [t, 'Pré', 'campo', 'aprovado', true, crypto.randomUUID()])).rows[0]!.id;

      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual([`${VERSAO}_${m97.nome}`]);
      const depois = await retratoDoCatalogo(c);
      const sairam = antes.filter((x) => !depois.includes(x));
      const novos = depois.filter((x) => !antes.includes(x));
      expect(sairam.filter((x) => x.startsWith('col ')).sort()).toEqual([
        'col core.cliente.aprovado_por uuid nn=false',
        'col integracao.cliente_fila_erp.aprovado_em timestamp with time zone nn=true',
      ]);
      expect(novos.filter((x) => x.startsWith('col ')).sort()).toEqual([
        'col core.cliente.motivo_recusa text nn=false',
        'col integracao.cliente_fila_erp.recebido_em timestamp with time zone nn=true',
      ]);
      expect(sairam.filter((x) => x.startsWith('con ')).map((x) => x.split(' ')[1])).toEqual(['core.cliente_aprovacao_par']);
      expect(novos.filter((x) => x.startsWith('con ')).map((x) => x.split(' ')[1]).sort()).toEqual(CHECKS.map((k) => `core.${k}`).sort());
      expect(sairam.filter((x) => x.startsWith('idx ')).map((x) => x.includes(INDICE_ANTIGO) || x.includes('cliente_fila_erp_poll_ix'))).toEqual([true, true]);
      expect(novos.filter((x) => x.startsWith('idx ')).map((x) => x.includes(INDICE) || x.includes('(tenant_id, recebido_em)'))).toEqual([true, true]);
      expect(sairam.filter((x) => !/^(col|con|idx|rel) /.test(x))).toEqual([]);
      expect(novos.filter((x) => !/^(col|con|idx|rel) /.test(x))).toEqual([]);
      expect(novos.filter((x) => x.startsWith('rel '))).toEqual([`rel core.${INDICE} i rls=false force=false`]);

      // backfill do pull: só o pré-cadastro andou
      const datas = (await c.query<{ id: string; andou: boolean }>("select id, updated_at > now() - interval '1 day' as andou from core.cliente where tenant_id = $1", [t])).rows;
      expect(Object.fromEntries(datas.map((r) => [r.id, r.andou]))).toEqual({ [erp]: false, [pre]: true });

      await c.query('set enable_seqscan = off');
      const plano = await c.query(`explain ${FILA.replace('$1', `'${t}'`)}`);
      expect(plano.rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n')).toContain(INDICE);
      await c.query('reset enable_seqscan');

      // aprovado depois da 0097 (sem aprovador) e o do BKO (o aprovador sumiu no up): o down preenche o UUID nulo nos dois
      const pre2 = (await c.query<{ id: string }>(
        "insert into core.cliente (tenant_id, razao_social, origem_cadastro, status_cadastro, aprovado_em, external_id) values ($1, 'Pré 2', 'bko', 'aprovado', now(), 'ERP-1') returning id",
        [t],
      )).rows[0]!.id;
      await c.query("insert into core.cliente (tenant_id, razao_social, origem_cadastro, status_cadastro, motivo_recusa) values ($1, 'Pré 3', 'campo', 'recusado', 'CNPJ inválido')", [t]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${VERSAO}_${m97.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query(ACL)).rows).toEqual(aclAntes);
      const por = (await c.query<{ id: string; aprovado_por: string | null }>('select id, aprovado_por from core.cliente where tenant_id = $1', [t])).rows;
      const NULO = '00000000-0000-0000-0000-000000000000';
      expect(Object.fromEntries(por.map((r) => [r.id, r.aprovado_por]))).toEqual({ [erp]: null, [pre]: NULO, [pre2]: NULO, [por.find((r) => ![erp, pre, pre2].includes(r.id))!.id]: null });
      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect((await c.query(ACL)).rows.find((r: { c: string }) => r.c === 'motivo_recusa')).toEqual({ c: 'motivo_recusa', leitura: false });
    });
  });
});
