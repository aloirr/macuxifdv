/**
 * 0025 — vendedor da nota do ERP (T-0080, RN-CORE-27; pedido R-20261105-021312-engenheiro-software; desenho
 * docs/desenho/T-0080.md §2). O que o BANCO garante: core.nota_erp.vendedor_external_id (null ou não vazio, até 200) e
 * usuario_id (null ou usuário do PRÓPRIO tenant, FK composta nota_erp_usuario_fk); nota com vendedor conhecido entra na
 * consulta do mês por usuário (índice nota_erp_usuario_mes_ix); nota com vendedor ainda desconhecido fica órfã
 * (usuario_id null) e é completada depois pelo vendedor_external_id (índice parcial nota_erp_vendedor_orfa_ix), de forma
 * idempotente; dois tenants isolados (RLS da 0019). Migração aditiva e idempotente, sem backfill (as notas anteriores
 * ficam com as colunas nulas, sem mexer em updated_at), com down que volta exatamente ao catálogo da 0024.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * Datas: mês literal sem dado da fixture (2030-03).
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const UA = DOIS_TENANTS.A.usuarios;
const UB = DOIS_TENANTS.B.usuarios;
const CA = DOIS_TENANTS.A.clientes;
const CB = DOIS_TENANTS.B.clientes;
const migracoes = lerMigracoes();
const m25 = migracoes.find((m) => m.versao === '0025')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const MES = '2030-03';

describe('0025 vendedor da nota do ERP (estático)', () => {
  it('nome e posição: 0025_core_nota_erp_vendedor logo depois da 0024', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0024_plataforma_resumo_outbox_lgpd') + 1]).toBe('0025_core_nota_erp_vendedor');
  });

  it('colunas nulas e idempotentes, CHECK do vazio, FK composta para core.usuario e os 2 índices parciais', () => {
    for (const trecho of [
      'alter table core.nota_erp add column if not exists vendedor_external_id text;',
      'alter table core.nota_erp add column if not exists usuario_id uuid;',
      "check (vendedor_external_id is null or (btrim(vendedor_external_id) <> '' and char_length(vendedor_external_id) <= 200));",
      'foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id);',
      'create index if not exists nota_erp_usuario_mes_ix on core.nota_erp (tenant_id, usuario_id, ano_mes)\n  where deleted_at is null and usuario_id is not null;',
      'create index if not exists nota_erp_vendedor_orfa_ix on core.nota_erp (tenant_id, vendedor_external_id)\n  where usuario_id is null and deleted_at is null and vendedor_external_id is not null;',
    ]) expect(m25.up).toContain(trecho);
    // cada constraint nova é recriada (drop if exists antes do add): rodar o up de novo não falha
    expect(m25.up).toContain('alter table core.nota_erp drop constraint if exists nota_erp_vendedor_external_id_preenchido;');
    expect(m25.up).toContain('alter table core.nota_erp drop constraint if exists nota_erp_usuario_fk;');
  });

  it('aditiva: sem backfill, sem mudança de RLS/grants, sem tocar indicador_diario nem positivacao_do_mes, sem schema alheio', () => {
    const sql = semComentarios(m25.up);
    expect(sql).not.toMatch(/\bupdate\b|\bdelete\b|\binsert\b/i);
    expect(sql).not.toMatch(/create policy|alter policy|drop policy|grant |revoke |row level security/);
    expect(sql).not.toMatch(/indicador_diario|positivacao_do_mes/);
    expect(sql).not.toMatch(/references (vendedor|integracao|catalogo|gestor|promotor|pesquisa|treinamento)\./);
    expect(sql).not.toMatch(/not null default|set not null/);
  });

  it('down desfaz tudo o que o up cria (idempotente)', () => {
    for (const trecho of [
      'drop index if exists core.nota_erp_vendedor_orfa_ix;',
      'drop index if exists core.nota_erp_usuario_mes_ix;',
      'alter table core.nota_erp drop constraint if exists nota_erp_usuario_fk;',
      'alter table core.nota_erp drop constraint if exists nota_erp_vendedor_external_id_preenchido;',
      'alter table core.nota_erp drop column if exists usuario_id;',
      'alter table core.nota_erp drop column if exists vendedor_external_id;',
    ]) expect(m25.down).toContain(trecho);
  });

  it('espelho Drizzle: notaErp.vendedor_external_id text e usuario_id uuid, ambos nulos', () => {
    const cols = getTableConfig(nuvemCore.notaErp).columns;
    const ext = cols.find((c) => c.name === 'vendedor_external_id');
    const usu = cols.find((c) => c.name === 'usuario_id');
    expect(ext?.getSQLType()).toBe('text');
    expect(ext?.notNull).toBe(false);
    expect(usu?.getSQLType()).toBe('uuid');
    expect(usu?.notNull).toBe(false);
  });
});

describe.skipIf(semBanco())('0025 vendedor da nota do ERP (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const codigo = async (tenant: string, fn: () => Promise<unknown>) => (await erroDe(emTransacao(app, tenant, fn)))?.code;
  const nota = (
    tenant: string,
    cliente: string,
    external: string,
    v: { ext?: string | null; usuario?: string | null; dia?: string; tipo?: string; cancelada?: boolean } = {},
  ) =>
    q(
      `insert into core.nota_erp (tenant_id, cliente_id, tipo, numero, emitida_em, ano_mes, total_cents, cancelada, external_id, vendedor_external_id, usuario_id)
       values ($1, $2, $3, $4, $5::timestamptz, $6, 1000, $7, $4, $8, $9)`,
      [tenant, cliente, v.tipo ?? 'faturamento', external, `${v.dia ?? `${MES}-10`}T15:00:00Z`, MES, v.cancelada ?? false, v.ext ?? null, v.usuario ?? null],
    );
  /** Consulta do Início (desenho T-0080 §1.3): clientes distintos do mês por usuário, 1ª nota válida. */
  const doMes = (usuarios: string[]) =>
    q<{ usuario_id: string; cliente_id: string; primeira_em: Date }>(
      `select usuario_id, cliente_id, min(emitida_em) as primeira_em
         from core.nota_erp
        where deleted_at is null and usuario_id = any($1::uuid[]) and ano_mes = $2
          and tipo = 'faturamento' and not cancelada
        group by usuario_id, cliente_id
        order by usuario_id, cliente_id`,
      [usuarios, MES],
    );

  it('fixture (notas anteriores à 0025): as duas colunas nulas em todos os tenants', async () => {
    for (const t of [A, B]) {
      const r = await emTransacao(app, t, () =>
        q<{ n: number; com: number }>('select count(*)::int as n, count(*) filter (where vendedor_external_id is not null or usuario_id is not null)::int as com from core.nota_erp'),
      );
      expect(r.rows[0]!.n).toBeGreaterThan(0);
      expect(r.rows[0]!.com).toBe(0);
    }
  });

  it('nota com vendedor conhecido entra no mês do usuário; cada cliente uma vez, sem cancelada nem devolução', async () => {
    await emTransacao(app, A, async () => {
      await nota(A, CA.c1, 'NF-V-1', { ext: 'V-1', usuario: UA.vendedor1, dia: `${MES}-05` });
      await nota(A, CA.c1, 'NF-V-2', { ext: 'V-1', usuario: UA.vendedor1, dia: `${MES}-12` });
      await nota(A, CA.c2, 'NF-V-3', { ext: 'V-1', usuario: UA.vendedor1, cancelada: true });
      await nota(A, CA.c3, 'ND-V-4', { ext: 'V-1', usuario: UA.vendedor1, tipo: 'devolucao' });
      await nota(A, CA.c2, 'NF-V-5', { ext: 'V-2', usuario: UA.vendedor2 });
      const r = (await doMes([UA.vendedor1, UA.vendedor2])).rows;
      expect(r.map((x) => [x.usuario_id, x.cliente_id])).toEqual(
        [[UA.vendedor1, CA.c1], [UA.vendedor2, CA.c2]].sort((x, y) => (x[0]! < y[0]! ? -1 : 1)),
      );
      expect(r.find((x) => x.cliente_id === CA.c1)!.primeira_em.toISOString()).toBe(`${MES}-05T15:00:00.000Z`);
    });
  });

  it('nota com vendedor desconhecido fica órfã e não conta; o vendedor chega e completa, idempotente', async () => {
    await emTransacao(app, A, async () => {
      await nota(A, CA.c1, 'NF-O-1', { ext: 'V-NOVO' });
      await nota(A, CA.c2, 'NF-O-2', { ext: 'V-NOVO' });
      await nota(A, CA.c3, 'NF-O-3'); // nota sem vendedor nenhum: fica nula e nunca é completada
      expect((await doMes([UA.vendedor2])).rows).toEqual([]);
      const completar = () =>
        q('update core.nota_erp set usuario_id = $1 where vendedor_external_id = $2 and usuario_id is null and deleted_at is null', [UA.vendedor2, 'V-NOVO']);
      expect((await completar()).rowCount).toBe(2);
      expect((await completar()).rowCount).toBe(0);
      expect((await doMes([UA.vendedor2])).rows.map((x) => x.cliente_id).sort()).toEqual([CA.c1, CA.c2].sort());
      const semVendedor = await q<{ v: string | null; u: string | null }>("select vendedor_external_id as v, usuario_id as u from core.nota_erp where external_id = 'NF-O-3'");
      expect(semVendedor.rows).toEqual([{ v: null, u: null }]);
      // reentrega da nota (upsert pela chave do ERP) mantém a linha e a atribuição
      const r = await q<{ u: string }>(
        `insert into core.nota_erp (tenant_id, cliente_id, tipo, numero, emitida_em, ano_mes, total_cents, external_id, vendedor_external_id, usuario_id)
         values ($1, $2, 'faturamento', 'NF-O-1', '${MES}-10T15:00:00Z', $3, 2000, 'NF-O-1', 'V-NOVO', $4)
         on conflict (tenant_id, external_id) where deleted_at is null
         do update set total_cents = excluded.total_cents, vendedor_external_id = excluded.vendedor_external_id, usuario_id = excluded.usuario_id
         returning usuario_id as u`,
        [A, CA.c1, MES, UA.vendedor2],
      );
      expect(r.rows).toEqual([{ u: UA.vendedor2 }]);
      expect((await q<{ n: number }>("select count(*)::int as n from core.nota_erp where external_id = 'NF-O-1'")).rows[0]!.n).toBe(1);
    });
  });

  it('checks: vendedor_external_id vazio, só espaços ou acima de 200 recusado; usuário de outro tenant ou inexistente recusado pela FK', async () => {
    expect(await codigo(A, () => nota(A, CA.c1, 'K-1', { ext: '' }))).toBe('23514');
    expect(await codigo(A, () => nota(A, CA.c1, 'K-2', { ext: '   ' }))).toBe('23514');
    expect(await codigo(A, () => nota(A, CA.c1, 'K-3', { ext: 'x'.repeat(201) }))).toBe('23514');
    expect(await codigo(A, () => nota(A, CA.c1, 'K-4', { ext: 'x'.repeat(200) }))).toBeUndefined();
    expect(await codigo(A, () => nota(A, CA.c1, 'K-5', { ext: 'V-B', usuario: UB.vendedor }))).toBe('23503');
    expect(await codigo(A, () => nota(A, CA.c1, 'K-6', { usuario: '00000000-0000-4000-8000-000000000000' }))).toBe('23503');
    expect(await codigo(A, () => q('update core.nota_erp set usuario_id = $1', [UB.vendedor]))).toBe('23503');
    // usuario_id sem vendedor_external_id é aceito (o banco não exige o par; a chave serve só para completar órfãs)
    expect(await codigo(A, () => nota(A, CA.c1, 'K-7', { usuario: UA.vendedor1 }))).toBeUndefined();
  });

  it('isolamento: o tenant B não vê nem completa as notas do A; cada um só conta as próprias', async () => {
    await emTransacao(app, A, async () => {
      await nota(A, CA.c1, 'NF-ISO-A', { ext: 'V-COMUM' });
      // outro tenant no meio da mesma transação: troca o contexto (set_config local)
      await q("select set_config('app.tenant_id', $1, true)", [B]);
      await nota(B, CB.c1, 'NF-ISO-B', { ext: 'V-COMUM', usuario: UB.vendedor });
      const completouB = await q("update core.nota_erp set usuario_id = $1 where vendedor_external_id = 'V-COMUM' and usuario_id is null and deleted_at is null", [UB.vendedor]);
      expect(completouB.rowCount).toBe(0);
      expect((await q<{ n: number }>("select count(*)::int as n from core.nota_erp where external_id = 'NF-ISO-A'")).rows[0]!.n).toBe(0);
      expect((await doMes([UB.vendedor, UA.vendedor1])).rows.map((x) => x.cliente_id)).toEqual([CB.c1]);
      // escrever no A pelo B: recusado pela política
      expect((await erroDe(nota(A, CA.c1, 'NF-ISO-X')))?.code).toBe('42501');
    });
    await emTransacao(app, A, async () => {
      await nota(A, CA.c1, 'NF-ISO-A', { ext: 'V-COMUM', usuario: UA.vendedor1 });
      expect((await doMes([UB.vendedor, UA.vendedor1])).rows.map((x) => [x.usuario_id, x.cliente_id])).toEqual([[UA.vendedor1, CA.c1]]);
    });
    // sem contexto: nada
    const semCtx = await emTransacao(app, null, () => q<{ n: number }>('select count(*)::int as n from core.nota_erp where usuario_id is not null or vendedor_external_id is not null'));
    expect(semCtx.rows[0]!.n).toBe(0);
  });

  it('EXPLAIN: mês do usuário pelo nota_erp_usuario_mes_ix e órfãs do vendedor pelo nota_erp_vendedor_orfa_ix', async () => {
    const plano = (sql: string, params: unknown[]) =>
      emTransacao(app, A, async () => {
        await q('set local enable_seqscan = off');
        const r = await q<{ 'QUERY PLAN': string }>(`explain ${sql}`, params);
        return r.rows.map((x) => x['QUERY PLAN']).join('\n');
      });
    expect(
      await plano(
        "select cliente_id, min(emitida_em) from core.nota_erp where deleted_at is null and usuario_id = $1 and ano_mes = $2 and tipo = 'faturamento' and not cancelada group by cliente_id",
        [UA.vendedor1, MES],
      ),
    ).toContain('nota_erp_usuario_mes_ix');
    expect(
      await plano('update core.nota_erp set usuario_id = $1 where vendedor_external_id = $2 and usuario_id is null and deleted_at is null', [UA.vendedor1, 'V-NOVO']),
    ).toContain('nota_erp_vendedor_orfa_ix');
  });
});

describe.skipIf(semBanco())('0025 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000025';
  const U = 'cccccccc-0025-4000-8000-000000000001';
  const C = 'cccccccc-0025-4000-8000-000000000002';
  const N = 'cccccccc-0025-4000-8000-000000000003';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0025_core_nota_erp_vendedor') - 1]!.slice(0, 4);
  const desde0025 = nomes.filter((n) => n >= '0025');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('nota existente intacta (sem backfill, sem mexer em updated_at); up de novo é idempotente; down volta ao catálogo da 0024', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo25', 'Antigo')", [T]);
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'V', 'v25@exemplo.com.br', 'vendedor')", [U, T]);
      await c.query("insert into core.cliente (id, tenant_id, razao_social) values ($1, $2, 'Cliente 25')", [C, T]);
      await c.query(
        `insert into core.nota_erp (id, tenant_id, cliente_id, tipo, numero, emitida_em, ano_mes, total_cents, external_id)
         values ($1, $2, $3, 'faturamento', '25', '2026-11-03T15:00:00Z', '2026-11', 5000, 'NF-25')`,
        [N, T, C],
      );
      const linha = () => c.query('select id, cliente_id, tipo, total_cents, cancelada, updated_at from core.nota_erp where id = $1', [N]).then((r) => r.rows);
      const linhaAntes = await linha();
      expect((await migrarUp(c)).aplicadas).toEqual(desde0025);
      const depois = await retratoDoCatalogo(c);
      expect(await linha()).toEqual(linhaAntes);
      expect((await c.query('select vendedor_external_id, usuario_id from core.nota_erp where id = $1', [N])).rows).toEqual([{ vendedor_external_id: null, usuario_id: null }]);
      expect(depois).toContain('col core.nota_erp.vendedor_external_id text nn=false');
      expect(depois).toContain('col core.nota_erp.usuario_id uuid nn=false');
      expect(depois.some((l) => l.startsWith('con core.nota_erp_usuario_fk FOREIGN KEY (tenant_id, usuario_id) REFERENCES ') && l.endsWith('usuario(tenant_id, id)'))).toBe(true);
      expect(depois.some((l) => l.startsWith('idx core CREATE INDEX nota_erp_usuario_mes_ix '))).toBe(true);
      expect(depois.some((l) => l.startsWith('idx core CREATE INDEX nota_erp_vendedor_orfa_ix '))).toBe(true);
      expect(depois.filter((l) => l.includes('core.nota_erp') && l.startsWith('pol '))).toEqual(antes.filter((l) => l.includes('core.nota_erp') && l.startsWith('pol ')));
      expect(depois).toContain('rel core.nota_erp r rls=true force=true');
      // idempotente: rodar o up de novo não muda o catálogo nem a nota
      await c.query(m25.up);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      await c.query("update core.nota_erp set vendedor_external_id = 'V-25', usuario_id = $2 where id = $1", [N, U]);
      // down: apaga colunas e índices; a nota fica
      expect((await migrarDown(c, { passos: desde0025.length })).aplicadas).toEqual([...desde0025].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select id, total_cents from core.nota_erp where id = $1', [N])).rows).toEqual([{ id: N, total_cents: '5000' }]);
      await c.query(m25.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
