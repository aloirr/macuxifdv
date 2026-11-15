/**
 * 0080 — Código FDV do usuário (T-0175, RN-CORE-59). Dicionário: docs/banco/core.md, "0080".
 * - core.usuario.codigo_fdv: FDV-0001… por tenant, gerado pelo gatilho usuario_codigo_fdv_emitir (contador
 *   core.usuario_codigo_fdv_contador, upsert atômico), único entre os vivos, só de leitura (usuario_codigo_fdv_somente_leitura,
 *   23514) e nunca reaproveitado; backfill dos vivos por created_at, id.
 * Estático no PC; banco (fixture, papel de aplicação, ROLLBACK), concorrência e up/down em bancos efêmeros no CI.
 */
import pg from 'pg';
import { setTimeout as esperar } from 'node:timers/promises';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { CODIGOS_FDV_FIXTURE, DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m80 = migracoes.find((m) => m.versao === '0080')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m80.up);
const down = semComentarios(m80.down);
const umaLinha = (s: string) => s.replace(/\s+/g, ' ');
const CONTADOR = 'core.usuario_codigo_fdv_contador';
const SOMENTE_LEITURA = 'usuario_codigo_fdv_somente_leitura';
/** Espelho de formatarCodigoFdv (modules/core/domain/codigo-fdv.ts): FDV- + mínimo de 4 dígitos. */
const fdv = (n: number) => `FDV-${String(n).padStart(4, '0')}`;
const numero = (codigo: string) => Number(codigo.slice(4));

/** Erro do Postgres com o nome da constraint (o pg devolve em `constraint`). */
async function erroCompleto(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; hint?: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { code?: string; constraint?: string; hint?: string };
    return { code: err.code, constraint: err.constraint, hint: err.hint };
  }
}

describe('0080 Código FDV (estático)', () => {
  it('nome e versão: 0080_core_usuario_codigo_fdv; nenhuma migração anterior usa codigo_fdv', () => {
    expect(m80.nome).toBe('core_usuario_codigo_fdv');
    for (const m of migracoes.filter((x) => x.versao < '0080')) expect(`${m.up}\n${m.down}`, m.versao).not.toMatch(/codigo_fdv/);
  });

  it('coluna text, CHECK do formato canônico e único entre os vivos', () => {
    expect(up).toContain('alter table core.usuario add column codigo_fdv text;');
    expect(umaLinha(up)).toContain(
      "add constraint usuario_codigo_fdv_formato check (codigo_fdv is null or codigo_fdv ~ '^FDV-(000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3,})$');",
    );
    expect(umaLinha(up)).toContain(
      'create unique index usuario_codigo_fdv_uk on core.usuario (tenant_id, codigo_fdv) where deleted_at is null and codigo_fdv is not null;',
    );
  });

  it('contador: colunas-padrão, único por tenant, RLS forçado com as 2 políticas, app só lê, fora do sync', () => {
    expect(up).toContain(`create table ${CONTADOR} (`);
    expect(up).toContain('constraint usuario_codigo_fdv_contador_tenant_uk unique (tenant_id)');
    expect(up).toContain('ultimo_sequencial  bigint not null default 0');
    expect(up).toContain(`alter table ${CONTADOR} enable row level security;`);
    expect(up).toContain(`alter table ${CONTADOR} force row level security;`);
    expect(up).toContain(`create policy manutencao on ${CONTADOR} for all to macuxi_manutencao using (true) with check (true);`);
    expect(up).toContain(`grant select on ${CONTADOR} to macuxi_app;`);
    expect(up).not.toMatch(/grant [a-z, ]*(insert|update|delete)[a-z, ]* on core\.usuario_codigo_fdv_contador/);
    expect(TABELAS_FORA_DO_SYNC).toContain(CONTADOR);
  });

  it('gatilhos: emitir (before insert) e somente_leitura (before update), função DEFINER com upsert atômico e lpad que cresce', () => {
    expect(umaLinha(up)).toContain('create trigger usuario_codigo_fdv_emitir before insert on core.usuario for each row execute function core.usuario_codigo_fdv();');
    expect(umaLinha(up)).toContain(`create trigger ${SOMENTE_LEITURA} before update on core.usuario for each row execute function core.usuario_codigo_fdv();`);
    expect(umaLinha(up)).toContain('create function core.usuario_codigo_fdv() returns trigger language plpgsql security definer set search_path = pg_catalog, core, plataforma, pg_temp');
    expect(umaLinha(up)).toContain('on conflict (tenant_id) do update set ultimo_sequencial = c.ultimo_sequencial + 1 returning c.ultimo_sequencial into v_n;');
    expect(up).toContain("new.codigo_fdv := 'FDV-' || lpad(v_n::text, greatest(4, length(v_n::text)), '0');");
    expect(umaLinha(up)).toContain(`using errcode = '23514', constraint = '${SOMENTE_LEITURA}'`);
    expect(up).toContain('revoke all on function core.usuario_codigo_fdv() from public;');
    expect(up).not.toMatch(/grant execute on function core\.usuario_codigo_fdv/);
  });

  it('backfill dos vivos por created_at, id antes dos gatilhos; contador no maior emitido', () => {
    expect(umaLinha(up)).toContain('row_number() over (partition by u.tenant_id order by u.created_at, u.id) as n from core.usuario u where u.deleted_at is null');
    expect(up.indexOf('update core.usuario u')).toBeLessThan(up.indexOf('create trigger usuario_codigo_fdv_emitir'));
    expect(up.indexOf('update core.usuario u')).toBeLessThan(up.indexOf(`create trigger ${SOMENTE_LEITURA}`));
    expect(umaLinha(up)).toContain('count(*) from core.usuario u where u.codigo_fdv is not null group by u.tenant_id;');
  });

  it('down idempotente desfaz tudo', () => {
    for (const t of ['usuario_codigo_fdv_emitir', SOMENTE_LEITURA]) expect(down).toContain(`drop trigger if exists ${t} on core.usuario;`);
    expect(down).toContain('drop function if exists core.usuario_codigo_fdv();');
    expect(down).toContain(`drop table if exists ${CONTADOR};`);
    expect(down).toContain('drop function if exists core.usuario_codigo_fdv_contador_nao_diminui();');
    expect(down).toContain('drop index if exists core.usuario_codigo_fdv_uk;');
    expect(down).toContain('alter table core.usuario drop constraint if exists usuario_codigo_fdv_formato;');
    expect(down).toContain('alter table core.usuario drop column if exists codigo_fdv;');
    expect(down).not.toMatch(/\b(add|create)\b/i);
  });

  it('espelho Drizzle (snake_case): usuario.codigo_fdv e o contador', () => {
    const col = getTableConfig(nuvemCore.usuario).columns.find((c) => c.name === 'codigo_fdv');
    expect([col?.getSQLType(), col?.notNull]).toEqual(['text', false]);
    const cfg = getTableConfig(nuvemCore.usuarioCodigoFdvContador);
    expect(`${cfg.schema}.${cfg.name}`).toBe(CONTADOR);
    const u = cfg.columns.find((c) => c.name === 'ultimo_sequencial');
    expect([u?.getSQLType(), u?.notNull, u?.default]).toEqual(['bigint', true, 0]);
  });
});

describe.skipIf(semBanco())('0080 Código FDV (banco, papel de aplicação sobre a fixture)', () => {
  let app: pg.Client;
  let admin: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await app.connect();
    await admin.connect();
  });
  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);
  const novo = async (tenant: string, email: string) =>
    ((await q("insert into core.usuario (tenant_id, nome, email, perfil) values ($1, 'Novo 0080', $2, 'vendedor') returning id, codigo_fdv", [tenant, email])).rows[0]) as {
      id: string;
      codigo_fdv: string;
    };
  const ultimo = async () => Number((await q(`select ultimo_sequencial from ${CONTADOR}`)).rows[0]!.ultimo_sequencial);

  it('fixture: cada usuário com o código da ordem de carga; contador de A e de B no maior emitido (ou acima)', async () => {
    for (const [t, codigos, usuarios] of [
      [A.tenantId, CODIGOS_FDV_FIXTURE.A, A.usuarios],
      [B.tenantId, CODIGOS_FDV_FIXTURE.B, B.usuarios],
    ] as const) {
      await emTransacao(app, t, async () => {
        for (const [papel, codigo] of Object.entries(codigos)) {
          const r = await q('select codigo_fdv from core.usuario where id = $1', [(usuarios as Record<string, string>)[papel]]);
          expect(r.rows, papel).toEqual([{ codigo_fdv: codigo }]);
        }
        expect((await q(`select count(*)::int as n from ${CONTADOR}`)).rows[0]!.n).toBe(1);
        expect(await ultimo()).toBeGreaterThanOrEqual(Object.keys(codigos).length);
      });
    }
  });

  it('sequência por tenant: o app insere e ganha contador + 1, depois + 2; B não anda', async () => {
    const ultimoB = await emTransacao(app, B.tenantId, ultimo);
    await emTransacao(app, A.tenantId, async () => {
      const n = await ultimo();
      expect((await novo(A.tenantId, 'fdv1@exemplo.com.br')).codigo_fdv).toBe(fdv(n + 1));
      expect((await novo(A.tenantId, 'fdv2@exemplo.com.br')).codigo_fdv).toBe(fdv(n + 2));
      expect(await ultimo()).toBe(n + 2);
    });
    expect(await emTransacao(app, B.tenantId, ultimo)).toBe(ultimoB);
  });

  it('só de leitura: trocar, apagar ou repetir o código = 23514 usuario_codigo_fdv_somente_leitura; outras colunas e o mesmo valor passam', async () => {
    await emTransacao(app, A.tenantId, async () => {
      for (const valor of ['FDV-9000', null]) {
        await q('savepoint s');
        expect(await erroCompleto(q('update core.usuario set codigo_fdv = $2 where id = $1', [A.usuarios.vendedor1, valor]))).toEqual({
          code: '23514',
          constraint: SOMENTE_LEITURA,
          hint: 'RN-CORE-59',
        });
        await q('rollback to savepoint s');
      }
      const r = await q("update core.usuario set nome = 'Vendedor Um (editado)', codigo_fdv = codigo_fdv where id = $1 returning codigo_fdv", [A.usuarios.vendedor1]);
      expect(r.rows).toEqual([{ codigo_fdv: CODIGOS_FDV_FIXTURE.A.vendedor1 }]);
    });
  });

  it('apagado mantém o código e o número não volta; único entre os vivos (23505); formato fora do canônico (23514)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const u = await novo(A.tenantId, 'fdv3@exemplo.com.br');
      await q('update core.usuario set deleted_at = now() where id = $1', [u.id]); // hora-fixa-ok: só apaga; o instante não é comparado
      expect((await q('select codigo_fdv from core.usuario where id = $1', [u.id])).rows).toEqual([{ codigo_fdv: u.codigo_fdv }]);
      const outro = await novo(A.tenantId, 'fdv4@exemplo.com.br');
      expect(numero(outro.codigo_fdv)).toBe(numero(u.codigo_fdv) + 1);
      for (const [codigo, sqlstate] of [[CODIGOS_FDV_FIXTURE.A.admin, '23505'], ['FDV-001', '23514'], ['FDV-00012', '23514'], ['FDV-0000', '23514']] as const) {
        await q('savepoint s');
        const e = await erroDe(q("insert into core.usuario (tenant_id, nome, email, perfil, codigo_fdv) values ($1, 'X', 'fdvx@exemplo.com.br', 'vendedor', $2)", [A.tenantId, codigo]));
        expect(e?.code, codigo).toBe(sqlstate);
        await q('rollback to savepoint s');
      }
    });
  });

  it('o app não escreve no contador (42501); B não vê o contador de A', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await q('savepoint s');
      expect((await erroDe(q(`update ${CONTADOR} set ultimo_sequencial = 0`)))?.code).toBe('42501');
      await q('rollback to savepoint s');
      expect((await erroDe(q(`insert into ${CONTADOR} (tenant_id) values ($1)`, [A.tenantId])))?.code).toBe('42501');
    });
    await emTransacao(app, B.tenantId, async () => {
      expect((await q(`select tenant_id from ${CONTADOR}`)).rows).toEqual([{ tenant_id: B.tenantId }]);
    });
  });

  it('passa de FDV-9999 para FDV-10000; o contador nunca diminui (23514)', async () => {
    await emTransacao(admin, null, async () => {
      await admin.query(`update ${CONTADOR} set ultimo_sequencial = 9998 where tenant_id = $1`, [A.tenantId]);
      const ins = (email: string) =>
        admin.query("insert into core.usuario (tenant_id, nome, email, perfil) values ($1, 'Grande', $2, 'vendedor') returning codigo_fdv", [A.tenantId, email]);
      expect((await ins('fdv9999@exemplo.com.br')).rows[0]!.codigo_fdv).toBe('FDV-9999');
      expect((await ins('fdv10000@exemplo.com.br')).rows[0]!.codigo_fdv).toBe('FDV-10000');
      await admin.query('savepoint s');
      expect(await erroCompleto(admin.query(`update ${CONTADOR} set ultimo_sequencial = 5 where tenant_id = $1`, [A.tenantId]))).toMatchObject({
        code: '23514',
        constraint: 'usuario_codigo_fdv_contador_nao_diminui',
      });
      await admin.query('rollback to savepoint s');
    });
  });
});

describe.skipIf(semBanco())('0080 concorrência e up/down (bancos efêmeros)', () => {
  let b: BancoDeTeste;
  const T1 = 'cccccccc-0000-4000-8000-000000000080';
  const T2 = 'cccccccc-0000-4000-8000-000000000081';
  const U = (n: number) => `cccccccc-0000-4000-8000-${String(1080000 + n).padStart(12, '0')}`;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('backfill dos vivos por created_at, id (apagado fica nulo); down volta ao catálogo da 0079; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0079' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 't80-um', 'Um'), ($2, 't80-dois', 'Dois')", [T1, T2]);
      const usuarios: Array<[number, string, string, string | null]> = [
        // id, tenant, created_at, deleted_at
        [1, T1, '2026-01-03T00:00:00Z', null],
        [2, T1, '2026-01-01T00:00:00Z', null],
        [3, T1, '2026-01-02T00:00:00Z', '2026-02-01T00:00:00Z'],
        [5, T1, '2026-01-04T00:00:00Z', null],
        [4, T1, '2026-01-04T00:00:00Z', null],
        [6, T2, '2026-01-09T00:00:00Z', null],
      ];
      for (const [n, t, criado, apagado] of usuarios) {
        await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil, created_at, deleted_at) values ($1, $2, 'U', $3, 'vendedor', $4, $5)", [
          U(n),
          t,
          `u${n}.80@exemplo.com.br`,
          criado,
          apagado,
        ]);
      }
      expect((await migrarUp(c, { ate: '0080' })).aplicadas).toEqual(['0080_core_usuario_codigo_fdv']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col core.usuario.codigo_fdv text nn=false');
      const codigos = async () =>
        Object.fromEntries((await c.query<{ id: string; codigo_fdv: string | null }>('select id, codigo_fdv from core.usuario order by id')).rows.map((r) => [r.id, r.codigo_fdv]));
      expect(await codigos()).toEqual({
        [U(1)]: 'FDV-0002',
        [U(2)]: 'FDV-0001',
        [U(3)]: null,
        [U(4)]: 'FDV-0003',
        [U(5)]: 'FDV-0004',
        [U(6)]: 'FDV-0001',
      });
      const contador = await c.query(`select tenant_id, ultimo_sequencial::int as n from ${CONTADOR} order by tenant_id`);
      expect(contador.rows).toEqual([
        { tenant_id: T1, n: 4 },
        { tenant_id: T2, n: 1 },
      ]);
      // o apagado sem código que volta a vivo ganha o próximo número
      expect((await c.query('update core.usuario set deleted_at = null where id = $1 returning codigo_fdv', [U(3)])).rows[0]!.codigo_fdv).toBe('FDV-0005');

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0080_core_usuario_codigo_fdv']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m80.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0080' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      // reaplicada, renumera os vivos (o 3 agora é vivo, criado em 02/01)
      expect((await codigos())[U(3)]).toBe('FDV-0002');
    });
  });

  it('dois inserts simultâneos do mesmo tenant não repetem número (com e sem a linha do contador)', async () => {
    const c1 = new pg.Client({ connectionString: b.urlAdmin });
    const c2 = new pg.Client({ connectionString: b.urlAdmin });
    await c1.connect();
    await c2.connect();
    try {
      const T3 = 'cccccccc-0000-4000-8000-000000000082';
      await c1.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 't80-tres', 'Tres')", [T3]);
      const ins = (c: pg.Client, email: string) =>
        c.query<{ codigo_fdv: string }>("insert into core.usuario (tenant_id, nome, email, perfil) values ($1, 'C', $2, 'vendedor') returning codigo_fdv", [T3, email]);
      const emitidos: string[] = [];
      for (const rodada of [1, 2]) {
        await c1.query('begin');
        await c2.query('begin');
        emitidos.push((await ins(c1, `a${rodada}.80@exemplo.com.br`)).rows[0]!.codigo_fdv);
        let pronto = false;
        const segundo = ins(c2, `b${rodada}.80@exemplo.com.br`).then((r) => {
          pronto = true;
          return r.rows[0]!.codigo_fdv;
        });
        await esperar(300);
        expect(pronto, `rodada ${rodada}: o 2º espera a linha do contador`).toBe(false);
        await c1.query('commit');
        emitidos.push(await segundo);
        await c2.query('commit');
      }
      expect(emitidos).toEqual(['FDV-0001', 'FDV-0002', 'FDV-0003', 'FDV-0004']);
      const r = await c1.query(`select ultimo_sequencial::int as n from ${CONTADOR} where tenant_id = $1`, [T3]);
      expect(r.rows).toEqual([{ n: 4 }]);
    } finally {
      await c1.end();
      await c2.end();
    }
  });
});
