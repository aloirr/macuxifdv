/**
 * 0088 — rastreamento no expediente (T-0156, ADR 0061; desenho docs/desenho/tracking.md §5.1 e §5.4). Dicionário:
 * docs/banco/core.md, "0088".
 * - 5 tabelas do Core (ponto_trajeto, pausa_trajeto, ausencia_usuario, termo_rastreamento, aceite_termo_rastreamento) com os
 *   campos comuns, RLS forçado, isolamento_tenant e manutencao; grants mínimos ao macuxi_app (nenhum DELETE);
 * - nenhum grant nem política para o macuxi_leitura (TABELAS_SEM_LEITURA), nada para o worker e o portal;
 * - core.expurgar_rastreamento: só o worker executa; apaga de fato pontos e pausas de mais de 90 dias, resumos de mais de
 *   5 anos e aceites de usuário excluído há mais de 5 anos (R-20261116-110200-alexandre); devolve só tenant e contagens.
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
const m88 = migracoes.find((m) => m.nome === 'core_rastreamento')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m88.up);
const umaLinha = up.replace(/\s+/g, ' ');
const down = semComentarios(m88.down);
const TABELAS = ['core.ponto_trajeto', 'core.pausa_trajeto', 'core.ausencia_usuario', 'core.termo_rastreamento', 'core.aceite_termo_rastreamento'] as const;
const GRANTS_APP: Record<(typeof TABELAS)[number], string> = {
  'core.ponto_trajeto': 'select, insert',
  'core.pausa_trajeto': 'select, insert, update',
  'core.ausencia_usuario': 'select, insert, update',
  'core.termo_rastreamento': 'select, insert',
  'core.aceite_termo_rastreamento': 'select, insert',
};
const FUNCAO = 'core.expurgar_rastreamento(timestamptz, integer)';
/** Instante do teste (fixo; passado à função como p_agora). */
const T0 = '2026-11-19T12:00:00Z'; // hora-fixa-ok: instante do teste, sempre passado como parâmetro

describe('0088 rastreamento (estático)', () => {
  it('número e nome: a 0088 vem logo depois da 0087', () => {
    expect(m88.versao).toBe('0088');
    expect(migracoes[migracoes.indexOf(m88) - 1]!.versao).toBe('0087');
  });

  it('5 tabelas com campos comuns, RLS forçado, isolamento_tenant, manutencao e grants mínimos (sem DELETE)', () => {
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

  it('macuxi_leitura: nenhum grant nem política nas 5 (ADR 0061 item 7); exceção declarada em TABELAS_SEM_LEITURA', () => {
    expect([...TABELAS_SEM_LEITURA]).toEqual([...TABELAS]);
    expect(up).not.toMatch(/grant [^;]* to [a-z_, ]*macuxi_leitura/);
    expect(up).not.toMatch(/create policy leitura/);
  });

  it('pontos e pausas fora do sync; ausência, termo e aceite com o índice de sync', () => {
    expect(TABELAS_FORA_DO_SYNC).toEqual(expect.arrayContaining(['core.ponto_trajeto', 'core.pausa_trajeto']));
    for (const t of ['ausencia_usuario', 'termo_rastreamento', 'aceite_termo_rastreamento']) {
      expect(umaLinha).toContain(`create index ${t}_sync_ix on core.${t} (tenant_id, updated_at, id);`);
      expect(TABELAS_FORA_DO_SYNC as readonly string[]).not.toContain(`core.${t}`);
    }
  });

  it('índices do desenho: (tenant, usuário, capturado_em), expurgo por capturado_em e por data do resumo', () => {
    expect(umaLinha).toContain('create index ponto_trajeto_usuario_capturado_ix on core.ponto_trajeto (tenant_id, usuario_id, capturado_em);');
    expect(umaLinha).toContain('create index ponto_trajeto_expurgo_ix on core.ponto_trajeto (capturado_em);');
    expect(umaLinha).toContain('create index deslocamento_dia_expurgo_ix on core.deslocamento_dia (data);');
    expect(umaLinha).toContain('constraint termo_rastreamento_versao_uk unique (tenant_id, versao),');
    expect(umaLinha).toContain('create unique index aceite_termo_rastreamento_uk on core.aceite_termo_rastreamento (tenant_id, usuario_id, termo_versao) where deleted_at is null;');
    expect(down).toContain('drop index if exists core.deslocamento_dia_expurgo_ix;');
  });

  it('expurgo: SECURITY DEFINER, search_path com pg_temp por último, prazos de 90 dias e 5 anos, EXECUTE só ao worker', () => {
    expect(umaLinha).toContain('language plpgsql volatile security definer set search_path = pg_catalog, core, pg_temp');
    expect(umaLinha.match(/interval '90 days'/g)).toHaveLength(2);
    expect(umaLinha.match(/interval '5 years'/g)).toHaveLength(2);
    expect(umaLinha).toContain(`revoke all on function ${FUNCAO} from public;`);
    expect(umaLinha).toContain(`grant execute on function ${FUNCAO} to macuxi_worker;`);
    expect(up.match(/grant execute/g)).toHaveLength(1);
    // o worker precisa do USAGE no schema para chamar a função (como em integracao, 0010); nenhum grant de tabela
    expect(umaLinha).toContain('grant usage on schema core to macuxi_worker;');
    expect(down).toContain('revoke usage on schema core from macuxi_worker;');
    expect(down).toContain(`drop function if exists ${FUNCAO};`);
  });

  it('espelho Drizzle das 5 tabelas (tipos e nulidade)', () => {
    const tipos = (t: Parameters<typeof getTableConfig>[0]) => Object.fromEntries(getTableConfig(t).columns.map((c) => [c.name, [c.getSQLType(), c.notNull]]));
    expect(getTableConfig(nuvemCore.pontoTrajeto).name).toBe('ponto_trajeto');
    expect(tipos(nuvemCore.pontoTrajeto)).toMatchObject({
      usuario_id: ['uuid', true], aparelho_id: ['uuid', false], capturado_em: ['timestamp with time zone', true],
      latitude: ['numeric(9, 6)', true], longitude: ['numeric(9, 6)', true], precisao_m: ['integer', false], velocidade_ms: ['numeric(6, 2)', false],
    });
    expect(tipos(nuvemCore.pausaTrajeto)).toMatchObject({ usuario_id: ['uuid', true], inicio: ['timestamp with time zone', true], fim: ['timestamp with time zone', false] });
    expect(tipos(nuvemCore.ausenciaUsuario)).toMatchObject({ usuario_id: ['uuid', true], de: ['date', true], ate: ['date', true] });
    expect(tipos(nuvemCore.termoRastreamento)).toMatchObject({ versao: ['integer', true], texto: ['text', true], publicado_em: ['timestamp with time zone', true], publicado_por: ['uuid', true] });
    expect(tipos(nuvemCore.aceiteTermoRastreamento)).toMatchObject({ usuario_id: ['uuid', true], termo_versao: ['integer', true], aceito_em: ['timestamp with time zone', true], aparelho_id: ['uuid', false] });
  });
});

describe.skipIf(semBanco())('0088 rastreamento (banco, papel de aplicação)', () => {
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

  it('multi-tenant: B não vê nem grava ponto, pausa, ausência, termo ou aceite de A', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await q(PONTO, [P1, A.tenantId, A.usuarios.vendedor1, null, T0, 1, 1, null, null]);
      await q("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
      for (const t of TABELAS) expect((await q(`select count(*)::int as n from ${t} where tenant_id = $1`, [A.tenantId])).rows, t).toEqual([{ n: 0 }]);
      expect(await erroDe(q(PONTO, [crypto.randomUUID(), A.tenantId, A.usuarios.vendedor1, null, T0, 1, 1, null, null]))).toMatchObject({ code: '42501' });
    });
  });

  it('pausa: fim > início (pausa em curso com fim nulo; o fim chega por update)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const id = crypto.randomUUID();
      await q("insert into core.pausa_trajeto (id, tenant_id, usuario_id, inicio) values ($1, $2, $3, $4)", [id, A.tenantId, A.usuarios.vendedor1, T0]);
      expect((await q("update core.pausa_trajeto set fim = $2::timestamptz + interval '30 minutes' where id = $1", [id, T0])).rowCount).toBe(1);
      await q('savepoint s');
      expect(await erroDe(q('update core.pausa_trajeto set fim = inicio where id = $1', [id]))).toMatchObject({ code: '23514', message: expect.stringContaining('pausa_trajeto_ordem') });
      await q('rollback to savepoint s');
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

  it('termo e aceite: versão única por tenant (mesmo excluída), aceite só de versão existente, único vivo por usuário e versão, sem update', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const TERMO = 'insert into core.termo_rastreamento (tenant_id, versao, texto, publicado_por) values ($1, $2, $3, $4)';
      // a fixture já tem a versão 1 (aceita pelo vendedor-2); o teste publica a 2
      await q(TERMO, [A.tenantId, 2, 'Termo de ciência v2', A.usuarios.admin]);
      for (const [args, codigo, nome] of [
        [[A.tenantId, 1, 'outra', A.usuarios.admin], '23505', 'termo_rastreamento_versao_uk'],
        [[A.tenantId, 2, 'outra', A.usuarios.admin], '23505', 'termo_rastreamento_versao_uk'],
        [[A.tenantId, 0, 'zero', A.usuarios.admin], '23514', 'termo_rastreamento_versao_positiva'],
        [[A.tenantId, 3, '', A.usuarios.admin], '23514', 'termo_rastreamento_texto_tamanho'],
      ] as const) {
        await q('savepoint s');
        expect(await erroDe(q(TERMO, [...args])), nome).toMatchObject({ code: codigo, message: expect.stringContaining(nome) });
        await q('rollback to savepoint s');
      }
      const ACEITE = 'insert into core.aceite_termo_rastreamento (tenant_id, usuario_id, termo_versao, aceito_em, aparelho_id) values ($1, $2, $3, $4, $5)';
      expect((await q(ACEITE, [A.tenantId, A.usuarios.vendedor1, 2, T0, A.dispositivos.vendedor1])).rowCount).toBe(1);
      expect((await q(`${ACEITE} on conflict (tenant_id, usuario_id, termo_versao) where deleted_at is null do nothing`, [A.tenantId, A.usuarios.vendedor1, 2, T0, null])).rowCount).toBe(0);
      for (const [args, codigo] of [
        [[A.tenantId, A.usuarios.vendedor2, 9, T0, null], '23503'],
        [[A.tenantId, A.usuarios.vendedor1, 2, T0, null], '23505'],
      ] as const) {
        await q('savepoint s');
        expect(await erroDe(q(ACEITE, [...args]))).toMatchObject({ code: codigo });
        await q('rollback to savepoint s');
      }
      for (const sql of ['update core.termo_rastreamento set texto = $1', 'update core.aceite_termo_rastreamento set aceito_em = $1::timestamptz']) {
        await q('savepoint s');
        expect(await erroDe(q(sql, [T0])), sql).toMatchObject({ code: '42501' });
        await q('rollback to savepoint s');
      }
    });
  });

  it('o app não executa o expurgo (42501)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect(await erroDe(q('select * from core.expurgar_rastreamento($1::timestamptz, 10)', [T0]))).toMatchObject({ code: '42501' });
    });
  });
});

describe.skipIf(semBanco())('0088 up/down e expurgo (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T1 = 'cccccccc-0000-4000-8000-000000000088';
  const T2 = 'cccccccc-0000-4000-8000-000000000188';
  const U1 = 'cccccccc-0000-4000-8000-000000001088';
  const U2 = 'cccccccc-0000-4000-8000-000000002088';
  const UX = 'cccccccc-0000-4000-8000-000000003088';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up sobre a 0087, down volta ao catálogo da 0087 (idempotente) e up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0087' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: m88.versao })).aplicadas).toEqual([`${m88.versao}_${m88.nome}`]);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col core.ponto_trajeto.latitude numeric(9,6) nn=true');
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${m88.versao}_${m88.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m88.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: m88.versao });
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
        // UX: excluído há mais de 5 anos (o aceite dele sai); U1: excluído há 4 anos (fica)
        await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil, deleted_at) values ($1, $2, 'UX', 'uxr88@exemplo.com.br', 'vendedor', $3::timestamptz - interval '5 years 1 day')", [UX, T1, T0]);
        await c.query("insert into core.termo_rastreamento (tenant_id, versao, texto, publicado_por) values ($1, 1, 'v1', $2), ($3, 1, 'v1', $4)", [T1, U1, T2, U2]);
        const ponto = (t: string, u: string, dias: number) =>
          c.query("insert into core.ponto_trajeto (tenant_id, usuario_id, capturado_em, latitude, longitude) values ($1, $2, $3::timestamptz - make_interval(days => $4), 1, 1)", [t, u, T0, dias]);
        for (const d of [91, 92, 93]) await ponto(T1, U1, d);
        await ponto(T1, U1, 89);
        await ponto(T2, U2, 120);
        await ponto(T2, U2, 1);
        await c.query("insert into core.pausa_trajeto (tenant_id, usuario_id, inicio) values ($1, $2, $3::timestamptz - interval '91 days'), ($1, $2, $3::timestamptz - interval '89 days')", [T1, U1, T0]);
        await c.query(
          "insert into core.deslocamento_dia (tenant_id, usuario_id, data) values ($1, $2, ($3::timestamptz at time zone 'UTC')::date - interval '5 years 1 day'), ($1, $2, ($3::timestamptz at time zone 'UTC')::date - interval '5 years'), ($4, $5, ($3::timestamptz at time zone 'UTC')::date - interval '6 years')",
          [T1, U1, T0, T2, U2],
        );
        await c.query("insert into core.aceite_termo_rastreamento (tenant_id, usuario_id, termo_versao, aceito_em) values ($1, $2, 1, $4), ($1, $3, 1, $4)", [T1, UX, U1, T0]);
        await c.query("update core.usuario set deleted_at = $2::timestamptz - interval '4 years' where id = $1", [U1, T0]);

        const expurgar = (limite: number) => comoPapel(c, 'macuxi_worker', 'select * from core.expurgar_rastreamento($1::timestamptz, $2)', [T0, limite]);
        // lote de 2: o tenant 1 tem 3 pontos vencidos; saem os 2 mais antigos do conjunto
        const r1 = await expurgar(2);
        const soma = (r: typeof r1, k: string) => r.rows.reduce((s, l) => s + (l[k] as number), 0);
        expect(soma(r1, 'pontos')).toBe(2);
        expect(r1.rows.every((l) => Object.keys(l).sort().join() === 'aceites,pausas,pontos,resumos,tenant_id')).toBe(true);
        const r2 = await expurgar(1000);
        const tudo = [...r1.rows, ...r2.rows];
        const porTenant = (t: string, k: string) => tudo.filter((l) => l.tenant_id === t).reduce((s, l) => s + (l[k] as number), 0);
        expect([porTenant(T1, 'pontos'), porTenant(T2, 'pontos')]).toEqual([3, 1]);
        expect([porTenant(T1, 'pausas'), porTenant(T1, 'resumos'), porTenant(T2, 'resumos'), porTenant(T1, 'aceites')]).toEqual([1, 1, 1, 1]);
        expect((await expurgar(1000)).rows).toEqual([]);
        // o que fica: ponto de 89 dias e de 1 dia, pausa de 89 dias, resumo de exatamente 5 anos, aceite do U1 (excluído há 4 anos)
        const n = async (sql: string) => ((await c.query(sql)).rows[0] as { n: number }).n;
        expect(await n(`select count(*)::int as n from core.ponto_trajeto where tenant_id in ('${T1}', '${T2}')`)).toBe(2);
        expect(await n(`select count(*)::int as n from core.pausa_trajeto where tenant_id = '${T1}'`)).toBe(1);
        expect(await n(`select count(*)::int as n from core.deslocamento_dia where tenant_id in ('${T1}', '${T2}')`)).toBe(1);
        expect(await n(`select count(*)::int as n from core.aceite_termo_rastreamento where tenant_id = '${T1}' and usuario_id = '${U1}'`)).toBe(1);
        expect(await n(`select count(*)::int as n from core.usuario where id = '${UX}'`)).toBe(1);

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
