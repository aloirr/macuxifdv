/**
 * 0089 — rastreamento no expediente (T-0156, ADR 0061; desenho docs/desenho/tracking.md §5.1 e §5.4). Dicionário:
 * docs/banco/core.md, "0089".
 * - 2 tabelas do Core (ponto_trajeto e ausencia_usuario) com os campos comuns, RLS forçado, isolamento_tenant e manutencao;
 *   grants mínimos ao macuxi_app (nenhum DELETE). Rastreamento interno: o vendedor não vê nada (ordem do dono do produto,
 *   19/11/2026 05h46);
 * - nenhum grant nem política para o macuxi_leitura (TABELAS_SEM_LEITURA), nada para o worker e o portal;
 * - core.expurgar_rastreamento: só o worker executa; apaga de fato pontos de mais de 90 dias e resumos de mais de 5 anos
 *   (R-20261116-110200-alexandre); devolve só tenant e contagens.
 * Estático sempre; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down + expurgo num banco efêmero.
 * Instantes: todos fixos e passados como parâmetro (p_agora); nenhum relógio real no arquivo.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC, TABELAS_SEM_LEITURA } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { comoPapel, emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m89 = migracoes.find((m) => m.nome === 'core_rastreamento')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m89.up);
const umaLinha = up.replace(/\s+/g, ' ');
const down = semComentarios(m89.down);
const TABELAS = ['core.ponto_trajeto', 'core.ausencia_usuario'] as const;
const GRANTS_APP: Record<(typeof TABELAS)[number], string> = {
  'core.ponto_trajeto': 'select, insert',
  'core.ausencia_usuario': 'select, insert, update',
};
const FUNCAO = 'core.expurgar_rastreamento(timestamptz, integer)';
/** Instante do teste (fixo; passado à função como p_agora). */
const T0 = '2026-11-19T12:00:00Z'; // hora-fixa-ok: instante do teste, sempre passado como parâmetro

describe('0089 rastreamento (estático)', () => {
  it('número e nome: a 0089 vem logo depois da 0088', () => {
    expect(m89.versao).toBe('0089');
    expect(migracoes[migracoes.indexOf(m89) - 1]!.versao).toBe('0088');
  });

  it('2 tabelas com campos comuns, RLS forçado, isolamento_tenant, manutencao e grants mínimos (sem DELETE)', () => {
    for (const t of TABELAS) {
      const bloco = new RegExp(`create table ${t.replace('.', '\\.')} \\(([^;]*)\\);`).exec(umaLinha)?.[1] ?? '';
      for (const c of ['id uuid primary key default gen_random_uuid()', 'tenant_id uuid not null references plataforma.tenant (id)', 'created_at timestamptz not null default now()', 'updated_at timestamptz not null default now()', 'deleted_at timestamptz,', 'external_id text,']) {
        expect(bloco, `${t}: ${c}`).toContain(c);
      }
      expect(umaLinha).toContain(`create trigger ${t.slice(5)}_updated_at before update on ${t} for each row execute function plataforma.definir_updated_at();`);
      expect(umaLinha).toContain(`alter table ${t} enable row level security;`);
      expect(umaLinha).toContain(`alter table ${t} force row level security;`);
      expect(umaLinha).toContain(`create policy isolamento_tenant on ${t} for all to macuxi_app using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());`);
      expect(umaLinha).toContain(`create policy manutencao on ${t} for all to macuxi_manutencao using (true) with check (true);`);
      expect(umaLinha).toContain(`grant ${GRANTS_APP[t]} on ${t} to macuxi_app;`);
      expect(umaLinha).not.toMatch(new RegExp(`grant [a-z, ]*delete[a-z, ]* on ${t.replace('.', '\\.')} `));
      expect(down).toContain(`drop table if exists ${t};`);
    }
  });

  it('macuxi_leitura: nenhum grant nem política nas 2 (ADR 0061 item 7); exceção declarada em TABELAS_SEM_LEITURA', () => {
    expect([...TABELAS_SEM_LEITURA]).toEqual([...TABELAS]);
    expect(up).not.toMatch(/grant [^;]* to [a-z_, ]*macuxi_leitura/);
    expect(up).not.toMatch(/create policy leitura/);
  });

  it('pontos fora do sync; ausência com o índice de sync', () => {
    expect(TABELAS_FORA_DO_SYNC).toEqual(expect.arrayContaining(['core.ponto_trajeto']));
    expect(umaLinha).toContain('create index ausencia_usuario_sync_ix on core.ausencia_usuario (tenant_id, updated_at, id);');
    expect(TABELAS_FORA_DO_SYNC as readonly string[]).not.toContain('core.ausencia_usuario');
  });

  it('só as 2 tabelas: nenhuma outra tabela no up (rastreamento interno, sem tabela de termo, aceite ou pausa)', () => {
    expect([...umaLinha.matchAll(/create table ([a-z_.]+) /g)].map((m) => m[1])).toEqual([...TABELAS]);
  });

  it('índices do desenho: (tenant, usuário, capturado_em), expurgo por capturado_em e por data do resumo', () => {
    expect(umaLinha).toContain('create index ponto_trajeto_usuario_capturado_ix on core.ponto_trajeto (tenant_id, usuario_id, capturado_em);');
    expect(umaLinha).toContain('create index ponto_trajeto_expurgo_ix on core.ponto_trajeto (capturado_em);');
    expect(umaLinha).toContain('create index deslocamento_dia_expurgo_ix on core.deslocamento_dia (data);');
    expect(down).toContain('drop index if exists core.deslocamento_dia_expurgo_ix;');
  });

  it('expurgo: SECURITY DEFINER, search_path com pg_temp por último, prazos de 90 dias e 5 anos, EXECUTE só ao worker', () => {
    expect(umaLinha).toContain('language plpgsql volatile security definer set search_path = pg_catalog, core, pg_temp');
    expect(umaLinha.match(/interval '90 days'/g)).toHaveLength(1);
    expect(umaLinha.match(/interval '5 years'/g)).toHaveLength(1);
    expect(umaLinha).toContain('returns table (tenant_id uuid, pontos integer, resumos integer)');
    expect(umaLinha).toContain(`revoke all on function ${FUNCAO} from public;`);
    expect(umaLinha).toContain(`grant execute on function ${FUNCAO} to macuxi_worker;`);
    expect(up.match(/grant execute/g)).toHaveLength(1);
    // o worker precisa do USAGE no schema para chamar a função (como em integracao, 0010); nenhum grant de tabela
    expect(umaLinha).toContain('grant usage on schema core to macuxi_worker;');
    expect(down).toContain('revoke usage on schema core from macuxi_worker;');
    expect(down).toContain(`drop function if exists ${FUNCAO};`);
  });

  it('espelho Drizzle das 2 tabelas (tipos e nulidade)', () => {
    const tipos = (t: Parameters<typeof getTableConfig>[0]) => Object.fromEntries(getTableConfig(t).columns.map((c) => [c.name, [c.getSQLType(), c.notNull]]));
    expect(getTableConfig(nuvemCore.pontoTrajeto).name).toBe('ponto_trajeto');
    expect(tipos(nuvemCore.pontoTrajeto)).toMatchObject({
      usuario_id: ['uuid', true], aparelho_id: ['uuid', false], capturado_em: ['timestamp with time zone', true],
      latitude: ['numeric(9, 6)', true], longitude: ['numeric(9, 6)', true], precisao_m: ['integer', false], velocidade_ms: ['numeric(6, 2)', false],
    });
    expect(tipos(nuvemCore.ausenciaUsuario)).toMatchObject({ usuario_id: ['uuid', true], de: ['date', true], ate: ['date', true] });
    expect(Object.keys(nuvemCore).filter((k) => /rastreamento|pausa/i.test(k))).toEqual([]);
  });
});

describe.skipIf(semBanco())('0089 rastreamento (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);
  const PONTO = 'insert into core.ponto_trajeto (id, tenant_id, usuario_id, aparelho_id, capturado_em, latitude, longitude, precisao_m, velocidade_ms) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)';
  const P1 = 'dddddddd-0000-4000-8000-000000000088';

  it('ponto: grava com o tenant da sessão, é idempotente pelo id (on conflict do nothing) e não muda nem é apagado pelo app', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const args = [P1, A.tenantId, A.usuarios.vendedor1, A.dispositivos.vendedor1, T0, -3.119028, -60.021731, 12, 1.5];
      expect((await q(PONTO, args)).rowCount).toBe(1);
      expect((await q(`${PONTO} on conflict (id) do nothing`, args)).rowCount).toBe(0);
      const r = await q('select latitude, longitude, velocidade_ms from core.ponto_trajeto where id = $1', [P1]);
      expect(r.rows).toEqual([{ latitude: '-3.119028', longitude: '-60.021731', velocidade_ms: '1.50' }]);
      for (const sql of ['update core.ponto_trajeto set precisao_m = 1 where id = $1', 'delete from core.ponto_trajeto where id = $1']) {
        await q('savepoint s');
        expect(await erroDe(q(sql, [P1])), sql).toMatchObject({ code: '42501' });
        await q('rollback to savepoint s');
      }
    });
  });

  it('ponto: recusa coordenada fora da faixa, precisão e velocidade negativas (23514) e usuário de outro tenant (23503)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const casos: [number, number, number | null, number | null, string][] = [
        [90.000001, 0, null, null, 'ponto_trajeto_latitude_faixa'],
        [0, -180.5, null, null, 'ponto_trajeto_longitude_faixa'],
        [0, 0, -1, null, 'ponto_trajeto_precisao_nao_negativa'],
        [0, 0, null, -0.01, 'ponto_trajeto_velocidade_nao_negativa'],
      ];
      for (const [lat, lon, prec, vel, nome] of casos) {
        await q('savepoint s');
        expect(await erroDe(q(PONTO, [null, A.tenantId, A.usuarios.vendedor1, null, T0, lat, lon, prec, vel].map((v, i) => (i === 0 ? crypto.randomUUID() : v)))), nome).toMatchObject({
          code: '23514', message: expect.stringContaining(nome),
        });
        await q('rollback to savepoint s');
      }
      await q('savepoint s');
      expect(await erroDe(q(PONTO, [crypto.randomUUID(), A.tenantId, B.usuarios.vendedor, null, T0, 0, 0, null, null]))).toMatchObject({ code: '23503' });
      await q('rollback to savepoint s');
    });
  });

  it('multi-tenant: B não vê nem grava ponto ou ausência de A', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await q(PONTO, [P1, A.tenantId, A.usuarios.vendedor1, null, T0, 1, 1, null, null]);
      await q("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
      for (const t of TABELAS) expect((await q(`select count(*)::int as n from ${t} where tenant_id = $1`, [A.tenantId])).rows, t).toEqual([{ n: 0 }]);
      expect(await erroDe(q(PONTO, [crypto.randomUUID(), A.tenantId, A.usuarios.vendedor1, null, T0, 1, 1, null, null]))).toMatchObject({ code: '42501' });
    });
  });

  it('ausência: de <= ate; cancelar = deleted_at; sem DELETE', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const id = crypto.randomUUID();
      await q("insert into core.ausencia_usuario (id, tenant_id, usuario_id, de, ate) values ($1, $2, $3, '2026-12-20', '2026-12-20')", [id, A.tenantId, A.usuarios.vendedor1]);
      await q('savepoint s');
      expect(await erroDe(q("insert into core.ausencia_usuario (tenant_id, usuario_id, de, ate) values ($1, $2, '2026-12-21', '2026-12-20')", [A.tenantId, A.usuarios.vendedor1]))).toMatchObject({
        code: '23514', message: expect.stringContaining('ausencia_usuario_periodo'),
      });
      await q('rollback to savepoint s');
      expect((await q('update core.ausencia_usuario set deleted_at = $2 where id = $1', [id, T0])).rowCount).toBe(1);
      expect(await erroDe(q('delete from core.ausencia_usuario where id = $1', [id]))).toMatchObject({ code: '42501' });
    });
  });

  it('o app não executa o expurgo (42501)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect(await erroDe(q('select * from core.expurgar_rastreamento($1::timestamptz, 10)', [T0]))).toMatchObject({ code: '42501' });
    });
  });
});

describe.skipIf(semBanco())('0089 up/down e expurgo (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T1 = 'cccccccc-0000-4000-8000-000000000088';
  const T2 = 'cccccccc-0000-4000-8000-000000000188';
  const U1 = 'cccccccc-0000-4000-8000-000000001088';
  const U2 = 'cccccccc-0000-4000-8000-000000002088';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up sobre a 0088, down volta ao catálogo da 0088 (idempotente) e up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0088' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: m89.versao })).aplicadas).toEqual([`${m89.versao}_${m89.nome}`]);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col core.ponto_trajeto.latitude numeric(9,6) nn=true');
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${m89.versao}_${m89.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m89.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: m89.versao });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });

  it('expurgo pelo worker: só o vencido sai, contagem por tenant, lote por p_limite, nada de outro dado; parâmetros inválidos = 22023', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c);
      await c.query('begin');
      try {
        for (const [t, cod] of [[T1, 'rastro88a'], [T2, 'rastro88b']] as const) await c.query('insert into plataforma.tenant (id, codigo, nome) values ($1, $2, $2)', [t, cod]);
        await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'U1', 'u1r88@exemplo.com.br', 'vendedor'), ($3, $4, 'U2', 'u2r88@exemplo.com.br', 'vendedor')", [U1, T1, U2, T2]);
        const ponto = (t: string, u: string, dias: number) =>
          c.query("insert into core.ponto_trajeto (tenant_id, usuario_id, capturado_em, latitude, longitude) values ($1, $2, $3::timestamptz - make_interval(days => $4), 1, 1)", [t, u, T0, dias]);
        for (const d of [91, 92, 93]) await ponto(T1, U1, d);
        await ponto(T1, U1, 89);
        await ponto(T2, U2, 120);
        await ponto(T2, U2, 1);
        await c.query(
          "insert into core.deslocamento_dia (tenant_id, usuario_id, data) values ($1, $2, ($3::timestamptz at time zone 'UTC')::date - interval '5 years 1 day'), ($1, $2, ($3::timestamptz at time zone 'UTC')::date - interval '5 years'), ($4, $5, ($3::timestamptz at time zone 'UTC')::date - interval '6 years')",
          [T1, U1, T0, T2, U2],
        );

        const expurgar = (limite: number) => comoPapel(c, 'macuxi_worker', 'select * from core.expurgar_rastreamento($1::timestamptz, $2)', [T0, limite]);
        // lote de 2: o tenant 1 tem 3 pontos vencidos; saem os 2 mais antigos do conjunto
        const r1 = await expurgar(2);
        const soma = (r: typeof r1, k: string) => r.rows.reduce((s, l) => s + (l[k] as number), 0);
        expect(soma(r1, 'pontos')).toBe(2);
        expect(r1.rows.every((l) => Object.keys(l).sort().join() === 'pontos,resumos,tenant_id')).toBe(true);
        const r2 = await expurgar(1000);
        const tudo = [...r1.rows, ...r2.rows];
        const porTenant = (t: string, k: string) => tudo.filter((l) => l.tenant_id === t).reduce((s, l) => s + (l[k] as number), 0);
        expect([porTenant(T1, 'pontos'), porTenant(T2, 'pontos')]).toEqual([3, 1]);
        expect([porTenant(T1, 'resumos'), porTenant(T2, 'resumos')]).toEqual([1, 1]);
        expect((await expurgar(1000)).rows).toEqual([]);
        // o que fica: ponto de 89 dias e de 1 dia e resumo de exatamente 5 anos
        const n = async (sql: string) => ((await c.query(sql)).rows[0] as { n: number }).n;
        expect(await n(`select count(*)::int as n from core.ponto_trajeto where tenant_id in ('${T1}', '${T2}')`)).toBe(2);
        expect(await n(`select count(*)::int as n from core.deslocamento_dia where tenant_id in ('${T1}', '${T2}')`)).toBe(1);
        expect(await n(`select count(*)::int as n from core.usuario where id in ('${U1}', '${U2}')`)).toBe(2);

        for (const [sql, p] of [
          ['select * from core.expurgar_rastreamento(null, 10)', []],
          ['select * from core.expurgar_rastreamento($1::timestamptz, 0)', [T0]],
          ['select * from core.expurgar_rastreamento($1::timestamptz, 50001)', [T0]],
        ] as const) {
          expect(await erroDe(comoPapel(c, 'macuxi_worker', sql, [...p])), sql).toMatchObject({ code: '22023' });
        }
        for (const papel of ['macuxi_app', 'macuxi_portal', 'macuxi_leitura']) {
          expect(await erroDe(comoPapel(c, papel, 'select * from core.expurgar_rastreamento($1::timestamptz, 10)', [T0])), papel).toMatchObject({ code: '42501' });
        }
        for (const t of TABELAS) {
          for (const papel of ['macuxi_worker', 'macuxi_leitura', 'macuxi_portal']) {
            expect(await erroDe(comoPapel(c, papel, `select 1 from ${t} limit 1`)), `${papel} ${t}`).toMatchObject({ code: '42501' });
          }
        }
      } finally {
        await c.query('rollback');
      }
    });
  });
});
