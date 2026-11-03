/**
 * 0019 — core.nota_erp (T-0066, pedido R-20261102-132945-modulo-core) e core.meta.tipo (T-0065, RN-CORE-21; pedido
 * R-20261103-005803-modulo-core). O que o BANCO garante: nota por tenant com RLS forçado, idempotência pela chave do ERP
 * (único vivo (tenant_id, external_id), external_id obrigatório), cliente do PRÓPRIO tenant (FK composta), tipo e
 * números válidos, sem DELETE para a aplicação; meta com tipo 'pedido' | 'faturamento', padrão 'pedido' (as metas
 * existentes ficam 'pedido' sem mexer em updated_at). Migração aditiva com down que volta exatamente ao catálogo da 0018.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const migracoes = lerMigracoes();
const m19 = migracoes.find((m) => m.versao === '0019')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const lista = (trecho: string) => [...trecho.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);

describe('0019 nota_erp e meta.tipo (estático)', () => {
  it('nome e posição: 0019_core_nota_erp_meta_tipo logo depois da 0018_medidas', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0018_medidas') + 1]).toBe('0019_core_nota_erp_meta_tipo');
  });

  it('nota_erp: FK composta do cliente, único vivo pela chave do ERP, índices por cliente/mês e por mês, sem DELETE', () => {
    expect(m19.up).toContain('constraint nota_erp_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),');
    expect(m19.up).toContain('create unique index nota_erp_external_uk on core.nota_erp (tenant_id, external_id) where deleted_at is null;');
    expect(m19.up).toContain('create index nota_erp_cliente_mes_ix on core.nota_erp (tenant_id, cliente_id, ano_mes);');
    expect(m19.up).toContain('create index nota_erp_mes_ix on core.nota_erp (tenant_id, ano_mes);');
    expect(m19.up).toContain("constraint nota_erp_external_id_preenchido check (nullif(btrim(external_id), '') is not null)");
    expect(m19.up).toContain('grant select, insert, update on core.nota_erp to macuxi_app;');
    // fronteira: pedido_uuid é retrato, sem FK para vendedor.*
    expect(semComentarios(m19.up)).not.toMatch(/references vendedor\./);
    // fora do pull do app: sem índice de sync e declarada em TABELAS_FORA_DO_SYNC
    expect(m19.up).not.toContain('on core.nota_erp (tenant_id, updated_at, id)');
    expect(TABELAS_FORA_DO_SYNC).toContain('core.nota_erp');
  });

  it('listas fechadas do SQL = espelho Drizzle (nota_erp.tipo e meta.tipo)', () => {
    const tipoNota = /constraint nota_erp_tipo_valido check \(tipo in \(([^)]*)\)\)/.exec(m19.up)?.[1] ?? '';
    expect(lista(tipoNota)).toEqual([...nuvemCore.TIPOS_NOTA_ERP_BANCO]);
    expect([...(nuvemCore.notaErp.tipo.enumValues ?? [])]).toEqual([...nuvemCore.TIPOS_NOTA_ERP_BANCO]);
    const tipoMeta = /add constraint meta_tipo_valido check \(tipo in \(([^)]*)\)\);/.exec(m19.up)?.[1] ?? '';
    expect(lista(tipoMeta)).toEqual(['pedido', 'faturamento']);
    expect([...nuvemCore.TIPOS_META_BANCO]).toEqual(['pedido', 'faturamento']);
    expect([...(nuvemCore.meta.tipo.enumValues ?? [])]).toEqual(['pedido', 'faturamento']);
  });

  it("meta.tipo aditiva: not null com default constante 'pedido' (sem reescrever dado existente)", () => {
    expect(m19.up).toContain("alter table core.meta add column tipo text not null default 'pedido';");
    expect(semComentarios(m19.up)).not.toMatch(/update core\.meta/);
  });

  it('down desfaz tudo o que o up cria (idempotente)', () => {
    for (const trecho of [
      'alter table core.meta drop constraint if exists meta_tipo_valido;',
      'alter table core.meta drop column if exists tipo;',
      'drop table if exists core.nota_erp;',
    ]) expect(m19.down).toContain(trecho);
  });
});

describe.skipIf(semBanco())('0019 nota_erp e meta.tipo (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const cA = DOIS_TENANTS.A.clientes.c1;
  const cB = DOIS_TENANTS.B.clientes.c1;
  const inserirNota = (tenant: string, cliente: string, external: string | null, extra: { tipo?: string; total?: number; numero?: string } = {}) =>
    q(
      `insert into core.nota_erp (tenant_id, cliente_id, tipo, numero, emitida_em, ano_mes, total_cents, external_id)
       values ($1, $2, $3, $4, '2026-10-15T15:00:00Z', '2026-10', $5, $6)`,
      [tenant, cliente, extra.tipo ?? 'faturamento', extra.numero ?? '1', extra.total ?? 100, external],
    );

  it('RLS: cada tenant só vê as próprias notas; sem contexto, nenhuma', async () => {
    const contar = (ctx: string | null) => emTransacao(app, ctx, () => q<{ n: number; alheias: number }>(
      `select count(*)::int as n, count(*) filter (where tenant_id <> coalesce(nullif(current_setting('app.tenant_id', true), ''), '00000000-0000-4000-8000-000000000000')::uuid)::int as alheias from core.nota_erp`,
    ));
    const rA = (await contar(A)).rows[0]!;
    const rB = (await contar(B)).rows[0]!;
    expect(rA).toEqual({ n: 3, alheias: 0 });
    expect(rB).toEqual({ n: 1, alheias: 0 });
    expect((await contar(null)).rows[0]!.n).toBe(0);
    // escrever no tenant alheio: recusado pela política
    expect((await erroDe(emTransacao(app, A, () => inserirNota(B, cB, 'X-1'))))?.code).toBe('42501');
    const upd = await emTransacao(app, A, () => q('update core.nota_erp set cancelada = true where tenant_id = $1', [B]));
    expect(upd.rowCount).toBe(0);
  });

  it('idempotência pela chave do ERP: reentrega com on conflict atualiza a MESMA linha', async () => {
    await emTransacao(app, A, async () => {
      const upsert = (total: number, cancelada: boolean) =>
        q<{ id: string }>(
          `insert into core.nota_erp (tenant_id, cliente_id, tipo, numero, emitida_em, ano_mes, total_cents, cancelada, external_id)
           values ($1, $2, 'faturamento', '9001', '2026-10-15T15:00:00Z', '2026-10', $3, $4, 'NF-1-9001')
           on conflict (tenant_id, external_id) where deleted_at is null
           do update set total_cents = excluded.total_cents, cancelada = excluded.cancelada
           returning id`,
          [A, cA, total, cancelada],
        );
      const p1 = (await upsert(1000, false)).rows[0]!.id;
      const p2 = (await upsert(1500, true)).rows[0]!.id;
      expect(p2).toBe(p1);
      const r = await q<{ n: number; total: string; cancelada: boolean }>(
        "select count(*)::int as n, max(total_cents)::text as total, bool_and(cancelada) as cancelada from core.nota_erp where external_id = 'NF-1-9001'",
      );
      expect(r.rows[0]).toEqual({ n: 1, total: '1500', cancelada: true });
      // a mesma chave em B é outra nota (único por tenant)
    });
    await emTransacao(app, B, async () => {
      await inserirNota(B, cB, 'NF-1-5001');
      expect((await q<{ n: number }>("select count(*)::int as n from core.nota_erp where external_id = 'NF-1-5001'")).rows[0]!.n).toBe(1);
    });
    // duplicata viva no mesmo tenant: 23505; depois de soft delete, a chave volta a valer
    expect((await erroDe(emTransacao(app, A, () => inserirNota(A, cA, 'NF-1-5001'))))?.code).toBe('23505');
    await emTransacao(app, A, async () => {
      await q("update core.nota_erp set deleted_at = emitida_em where external_id = 'NF-1-5001'");
      await inserirNota(A, cA, 'NF-1-5001');
    });
  });

  it('checks: tipo, número, ano_mes, total, chave do ERP obrigatória; cliente de outro tenant recusado pela FK; sem DELETE', async () => {
    const codigo = async (fn: () => Promise<unknown>) => (await erroDe(emTransacao(app, A, fn)))?.code;
    expect(await codigo(() => inserirNota(A, cA, 'K-1', { tipo: 'outro' }))).toBe('23514');
    expect(await codigo(() => inserirNota(A, cA, 'K-2', { numero: '  ' }))).toBe('23514');
    expect(await codigo(() => inserirNota(A, cA, 'K-3', { total: -1 }))).toBe('23514');
    expect(await codigo(() => inserirNota(A, cA, null))).toBe('23514');
    expect(await codigo(() => inserirNota(A, cA, '  '))).toBe('23514');
    expect(await codigo(() => q("update core.nota_erp set ano_mes = '2026-13'"))).toBe('23514');
    expect(await codigo(() => q('update core.nota_erp set quantidade_itens = -1'))).toBe('23514');
    expect(await codigo(() => inserirNota(A, cB, 'K-4'))).toBe('23503');
    expect(await codigo(() => q('delete from core.nota_erp'))).toBe('42501');
    // devolução e pedido_uuid sem FK (retrato) passam
    expect(await codigo(() => q(
      `insert into core.nota_erp (tenant_id, cliente_id, tipo, numero, emitida_em, ano_mes, total_cents, pedido_uuid, external_id)
       values ($1, $2, 'devolucao', '1', '2026-10-15T15:00:00Z', '2026-10', 10, gen_random_uuid(), 'K-5')`,
      [A, cA],
    ))).toBeUndefined();
  });

  it('soma do mês por cliente (consulta do recálculo): faturamento − devolução, sem canceladas', async () => {
    const r = await emTransacao(app, A, () =>
      q<{ ano_mes: string; liquido: string }>(
        `select ano_mes, sum(case tipo when 'faturamento' then total_cents else -total_cents end)::text as liquido
           from core.nota_erp where cliente_id = $1 and not cancelada and deleted_at is null group by ano_mes order by ano_mes`,
        [cA],
      ),
    );
    expect(r.rows.map((x) => x.liquido)).toEqual(['-30000', '285000']);
  });

  it("meta.tipo: fixture com 'pedido' (padrão); grava 'faturamento'; valor fora da lista recusado", async () => {
    await emTransacao(app, A, async () => {
      const tipos = await q<{ tipo: string; n: number }>('select tipo, count(*)::int as n from core.meta group by tipo');
      expect(tipos.rows).toEqual([{ tipo: 'pedido', n: 6 }]);
      const r = await q("update core.meta set tipo = 'faturamento' where indicador = 'venda_cents' returning tipo");
      expect(r.rowCount).toBe(2);
    });
    expect((await erroDe(emTransacao(app, A, () => q("update core.meta set tipo = 'outro'"))))?.code).toBe('23514');
    expect((await erroDe(emTransacao(app, A, () => q('update core.meta set tipo = null'))))?.code).toBe('23502');
  });
});

describe.skipIf(semBanco())('0019 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000019';
  const U = 'cccccccc-0019-4000-8000-000000000001';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0019_core_nota_erp_meta_tipo') - 1]!.slice(0, 4);
  const desde0019 = nomes.filter((n) => n >= '0019');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it("meta existente fica 'pedido' sem mexer em updated_at; down volta ao catálogo da 0018 com a meta intacta; up de novo igual", async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo19', 'Antigo')", [T]);
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'V', 'v@exemplo.com.br', 'vendedor')", [U, T]);
      await c.query("insert into core.meta (tenant_id, usuario_id, periodo, indicador, valor) values ($1, $2, '2026-10', 'venda_cents', 1000)", [T, U]);
      const metaAntes = (await c.query('select id, valor, updated_at from core.meta where tenant_id = $1', [T])).rows;
      expect((await migrarUp(c)).aplicadas).toEqual(desde0019);
      const depois = await retratoDoCatalogo(c);
      expect((await c.query('select id, valor, updated_at from core.meta where tenant_id = $1', [T])).rows).toEqual(metaAntes);
      expect((await c.query('select tipo from core.meta where tenant_id = $1', [T])).rows).toEqual([{ tipo: 'pedido' }]);
      expect(depois).toContain('rel core.nota_erp r rls=true force=true');
      expect((await migrarDown(c, { passos: desde0019.length })).aplicadas).toEqual([...desde0019].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select id, valor, updated_at from core.meta where tenant_id = $1', [T])).rows).toEqual(metaAntes);
      await c.query(m19.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
