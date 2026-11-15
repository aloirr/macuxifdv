/**
 * 0080 — Código FDV do usuário (T-0175, RN-CORE-59). Dicionário: docs/banco/core.md, "0080".
 * - core.usuario.codigo_fdv: 00001… por tenant (só número, 5 dígitos ou mais, R-20261115-110000), gerado pelo gatilho usuario_codigo_fdv_emitir (contador
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
/** Formato do Código FDV (R-20261115-110000): só número, mínimo de 5 dígitos, sem prefixo. */
const fdv = (n: number) => String(n).padStart(5, '0');
const numero = (codigo: string) => Number(codigo);

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
      "add constraint usuario_codigo_fdv_formato check (codigo_fdv is null or codigo_fdv ~ '^(0000[1-9]|000[1-9][0-9]|00[1-9][0-9]{2}|0[1-9][0-9]{3}|[1-9][0-9]{4,})$');",
    );
    expect(umaLinha(up)).toContain(
      'create unique index usuario_codigo_fdv_uk on core.usuario (tenant_id, codigo_fdv) where deleted_at is null and codigo_fdv is not null;',
    );
  });

  it('CHECK do formato = só o que o gatilho gera: 00001..99999 e, acima, sem zero à esquerda', () => {
    const re = new RegExp(/codigo_fdv ~ '([^']+)'\);/.exec(up)![1]!);
    for (const ok of ['00001', '00010', '09999', '99999', '100000', '100001', '1234567']) expect(re.test(ok), ok).toBe(true);
    for (const nao of ['00000', '000001', '0100000', '0001', '1234', 'FDV-0001', '1234a', '']) expect(re.test(nao), nao).toBe(false);
    for (let n = 1; n <= 120000; n += 997) expect(re.test(fdv(n)), fdv(n)).toBe(true);
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
    expect(umaLinha(up)).toContain(
      'update core.usuario_codigo_fdv_contador c set ultimo_sequencial = c.ultimo_sequencial + 1 where c.tenant_id = new.tenant_id returning c.ultimo_sequencial into v_n;',
    );
    expect(umaLinha(up)).toContain(
      "values (plataforma.uuid_de_chave(new.tenant_id::text || ':core.usuario_codigo_fdv_contador'), new.tenant_id, 0) on conflict (tenant_id) do nothing;",
    );
    expect(up).toContain("new.codigo_fdv := lpad(v_n::text, greatest(5, length(v_n::text)), '0');");
    expect(up).not.toContain('FDV-');
    expect(umaLinha(up)).toContain(`using errcode = '23514', constraint = '${SOMENTE_LEITURA}'`);
    expect(up).toContain('revoke all on function core.usuario_codigo_fdv() from public;');
    expect(up).not.toMatch(/grant execute on function core\.usuario_codigo_fdv/);
  });

  it('restauração em qualquer ordem: código informado só sobe o contador que existe; a linha nova do contador nasce no piso', () => {
    // usuário com código (restauração, carga técnica) não cria a linha: o contador do backup restaurado depois é insert, não update
    expect(umaLinha(up)).toContain(
      'update core.usuario_codigo_fdv_contador c set ultimo_sequencial = new.codigo_fdv::bigint where c.tenant_id = new.tenant_id and c.ultimo_sequencial < new.codigo_fdv::bigint;',
    );
    expect(up).not.toMatch(/greatest\(c\.ultimo_sequencial, excluded\.ultimo_sequencial\)/);
    // piso: maior código numérico do tenant (vivo ou apagado), não o maior texto
    expect(umaLinha(up)).toContain(
      "new.ultimo_sequencial := greatest(new.ultimo_sequencial, (select max(u.codigo_fdv::bigint) from core.usuario u where u.tenant_id = new.tenant_id and u.codigo_fdv ~ '^[0-9]{5,18}$'));",
    );
    expect(umaLinha(up)).toContain(`create trigger usuario_codigo_fdv_contador_piso before insert on ${CONTADOR} for each row execute function core.usuario_codigo_fdv_contador_piso();`);
    expect(up).toContain('revoke all on function core.usuario_codigo_fdv_contador_piso() from public;');
    expect(down).toContain('drop function if exists core.usuario_codigo_fdv_contador_piso();');
  });

  it('ordem do backup (0072, ordem_do_backup): o contador só tem FK para plataforma.tenant (1ª leva); core.usuario espera core.equipe', () => {
    const corpo = up.slice(up.indexOf(`create table ${CONTADOR} (`), up.indexOf(');', up.indexOf(`create table ${CONTADOR} (`)));
    expect([...corpo.matchAll(/references ([a-z_.]+)/g)].map((m) => m[1])).toEqual(['plataforma.tenant']);
    expect(up).not.toMatch(/alter table core\.usuario_codigo_fdv_contador add constraint [a-z_]+ foreign key/);
    const m02 = semComentarios(migracoes.find((m) => m.versao === '0002')!.up);
    expect(umaLinha(m02)).toContain('constraint usuario_equipe_fk foreign key (tenant_id, equipe_id) references core.equipe (tenant_id, id)');
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
      for (const valor of ['09000', null]) {
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
      for (const [codigo, sqlstate] of [
        [CODIGOS_FDV_FIXTURE.A.admin, '23505'],
        ['00000', '23514'],
        ['000001', '23514'],
        ['0100000', '23514'],
        ['0001', '23514'],
        ['FDV-00012', '23514'],
        ['1234a', '23514'],
      ] as const) {
        await q('savepoint s');
        const e = await erroDe(q("insert into core.usuario (tenant_id, nome, email, perfil, codigo_fdv) values ($1, 'X', 'fdvx@exemplo.com.br', 'vendedor', $2)", [A.tenantId, codigo]));
        expect(e?.code, codigo).toBe(sqlstate);
        await q('rollback to savepoint s');
      }
      // o CHECK aceita o que o gatilho gera (apagados: fora da unicidade dos vivos)
      for (const codigo of ['00001', '99999', '100000']) {
        const r = await q(
          "insert into core.usuario (tenant_id, nome, email, perfil, codigo_fdv, deleted_at) values ($1, 'Ok', $2, 'vendedor', $3, now()) returning codigo_fdv", // hora-fixa-ok: só apaga
          [A.tenantId, `fdvok${codigo}@exemplo.com.br`, codigo],
        );
        expect(r.rows, codigo).toEqual([{ codigo_fdv: codigo }]);
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

  it('passa de 99999 para 100000; o contador nunca diminui (23514)', async () => {
    await emTransacao(admin, null, async () => {
      await admin.query(`update ${CONTADOR} set ultimo_sequencial = 99998 where tenant_id = $1`, [A.tenantId]);
      const ins = (email: string) =>
        admin.query("insert into core.usuario (tenant_id, nome, email, perfil) values ($1, 'Grande', $2, 'vendedor') returning codigo_fdv", [A.tenantId, email]);
      expect((await ins('fdv99999@exemplo.com.br')).rows[0]!.codigo_fdv).toBe('99999');
      expect((await ins('fdv100000@exemplo.com.br')).rows[0]!.codigo_fdv).toBe('100000');
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
        [U(1)]: '00002',
        [U(2)]: '00001',
        [U(3)]: null,
        [U(4)]: '00003',
        [U(5)]: '00004',
        [U(6)]: '00001',
      });
      const contador = await c.query(`select tenant_id, ultimo_sequencial::int as n from ${CONTADOR} order by tenant_id`);
      expect(contador.rows).toEqual([
        { tenant_id: T1, n: 4 },
        { tenant_id: T2, n: 1 },
      ]);
      // o apagado sem código que volta a vivo ganha o próximo número
      expect((await c.query('update core.usuario set deleted_at = null where id = $1 returning codigo_fdv', [U(3)])).rows[0]!.codigo_fdv).toBe('00005');

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0080_core_usuario_codigo_fdv']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m80.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0080' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      // reaplicada, renumera os vivos (o 3 agora é vivo, criado em 02/01)
      expect((await codigos())[U(3)]).toBe('00002');
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
      expect(emitidos).toEqual(['00001', '00002', '00003', '00004']);
      const r = await c1.query(`select ultimo_sequencial::int as n from ${CONTADOR} where tenant_id = $1`, [T3]);
      expect(r.rows).toEqual([{ n: 4 }]);
    } finally {
      await c1.end();
      await c2.end();
    }
  });
  it('backup e restauração da empresa nas duas ordens (contador antes ou depois dos usuários): o próximo continua sem repetir', async () => {
    const T4 = 'cccccccc-0000-4000-8000-000000000083';
    await comAdmin(b.nome, async (c) => {
      // ordem_do_backup (0072): o contador sai antes de core.usuario
      const ordem = new Map(
        (await c.query<{ tabela: string; ordem: number }>('select tabela, ordem from plataforma.ordem_do_backup()')).rows.map((r) => [r.tabela, r.ordem]),
      );
      expect(ordem.get(CONTADOR)!).toBeLessThan(ordem.get('core.usuario')!);

      // origem: 00001..00003 (o 00002 apagado) e o 4 consumido sem usuário (insert que caiu no on conflict): contador 4
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 't80-quatro', 'Quatro')", [T4]);
      const ins = async (id: string | null, email: string) =>
        (await c.query<{ codigo_fdv: string }>(
          "insert into core.usuario (id, tenant_id, nome, email, perfil) values (coalesce($1::uuid, gen_random_uuid()), $2, 'R', $3, 'vendedor') on conflict (id) do nothing returning codigo_fdv",
          [id, T4, email],
        )).rows[0]?.codigo_fdv;
      expect([await ins(U(41), 'r1.80@exemplo.com.br'), await ins(U(42), 'r2.80@exemplo.com.br'), await ins(U(43), 'r3.80@exemplo.com.br')]).toEqual([
        '00001',
        '00002',
        '00003',
      ]);
      await c.query('update core.usuario set deleted_at = now() where id = $1', [U(42)]); // hora-fixa-ok: só apaga
      expect(await ins(U(41), 'r1b.80@exemplo.com.br')).toBeUndefined();
      const lerContador = async () => (await c.query<{ n: number }>(`select ultimo_sequencial::int as n from ${CONTADOR} where tenant_id = $1`, [T4])).rows;
      expect(await lerContador()).toEqual([{ n: 4 }]);

      // backup: as linhas do tenant como o exportar_backup_pagina (to_jsonb da linha inteira)
      const tenant = (await c.query<{ j: unknown }>('select to_jsonb(t) as j from plataforma.tenant t where id = $1', [T4])).rows[0]!.j;
      const usuarios = (await c.query<{ j: unknown }>('select to_jsonb(u) as j from core.usuario u where tenant_id = $1 order by id', [T4])).rows.map((r) => r.j);
      const contador = (await c.query<{ j: Record<string, unknown> }>(`select to_jsonb(x) as j from ${CONTADOR} x where tenant_id = $1`, [T4])).rows[0]!.j;
      const codigosAntes = (await c.query('select id, codigo_fdv, deleted_at from core.usuario where tenant_id = $1 order by id', [T4])).rows;
      await c.query("update plataforma.tenant set status = 'encerrado' where id = $1", [T4]);
      const tenantEncerrado = (await c.query<{ j: unknown }>('select to_jsonb(t) as j from plataforma.tenant t where id = $1', [T4])).rows[0]!.j;
      expect(tenant).toBeTruthy();

      const restaurar = async (tabela: string, linha: unknown) =>
        c.query(`insert into ${tabela} select * from jsonb_populate_record(null::${tabela}, $1::jsonb)`, [JSON.stringify(linha)]);
      const cenarios: Array<[string, 'contador-antes' | 'usuarios-antes', number, string]> = [
        // contador do backup como saiu (4: o buraco fica) e atrás dos códigos (1: backup inconsistente) -> nunca repete
        ['contador antes, como saiu', 'contador-antes', 4, '00005'],
        ['usuários antes, como saiu', 'usuarios-antes', 4, '00005'],
        ['contador antes, atrás dos códigos', 'contador-antes', 1, '00004'],
        ['usuários antes, atrás dos códigos', 'usuarios-antes', 1, '00004'],
      ];
      for (const [nome, ordemRestauracao, valorContador, proximo] of cenarios) {
        await c.query('begin');
        try {
          await c.query("select * from plataforma.excluir_tenant($1, 't80-quatro')", [T4]);
          expect(await lerContador(), nome).toEqual([]);
          await restaurar('plataforma.tenant', tenantEncerrado);
          const linhaContador = { ...contador, ultimo_sequencial: valorContador };
          if (ordemRestauracao === 'contador-antes') await restaurar(CONTADOR, linhaContador);
          for (const u of usuarios) await restaurar('core.usuario', u);
          if (ordemRestauracao === 'usuarios-antes') {
            expect(await lerContador(), `${nome}: usuário com código não cria a linha`).toEqual([]);
            await restaurar(CONTADOR, linhaContador);
          }
          expect((await c.query('select id, codigo_fdv, deleted_at from core.usuario where tenant_id = $1 order by id', [T4])).rows, nome).toEqual(codigosAntes);
          expect(await lerContador(), nome).toEqual([{ n: Math.max(valorContador, 3) }]);
          expect((await c.query<{ id: string }>(`select id from ${CONTADOR} where tenant_id = $1`, [T4])).rows[0]!.id, nome).toBe(contador.id);
          await c.query("update plataforma.tenant set status = 'ativo' where id = $1", [T4]);
          expect(await ins(null, 'r4.80@exemplo.com.br'), nome).toBe(proximo);
          expect(await ins(null, 'r5.80@exemplo.com.br'), nome).toBe(fdv(numero(proximo) + 1));
          const todos = (await c.query<{ codigo_fdv: string }>('select codigo_fdv from core.usuario where tenant_id = $1', [T4])).rows.map((r) => r.codigo_fdv);
          expect(new Set(todos).size, `${nome}: nenhum número repetido (vivos e apagados)`).toBe(todos.length);
        } finally {
          await c.query('rollback');
        }
      }
      // sem usuário vivo nem contador (carga técnica com código, contador ausente): o 1º insert sem código parte do maior
      await c.query('begin');
      try {
        await c.query(`delete from ${CONTADOR} where tenant_id = $1`, [T4]);
        await c.query("update plataforma.tenant set status = 'ativo' where id = $1", [T4]);
        expect(await ins(null, 'r6.80@exemplo.com.br')).toBe('00004');
      } finally {
        await c.query('rollback');
      }
    });
  });
});
