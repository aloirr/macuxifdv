/**
 * 0093 — casa e base do usuário e geocodificação do cliente (T-0191, Rotas; RN-CORE-75 a 77). Dicionário: docs/banco/core.md
 * ("0093"). O que o BANCO garante:
 * - core.usuario ganha casa_* e base_* (CEP ^[0-9]{8}$, UF ^[A-Z]{2}$, lat -90..90, lng -180..180, lat e lng juntos), base_tipo
 *   'casa' | 'outro' (nulo = sem base; 'outro' exige o ponto) e base_alterada_em; nenhum SELECT do macuxi_leitura nelas;
 * - core.cliente ganha coordenada_origem ('erp' | 'checkin' | 'geocodificacao' | 'manual'), coordenada_precisao ('numero' |
 *   'rua' | 'cep'), geocodificacao_tentada_em e geocodificacao_chave; o macuxi_leitura passa a SELECT por coluna, sem a chave;
 * - backfill: cliente com latitude recebe coordenada_origem = 'erp', sem andar o updated_at;
 * - isolamento: o macuxi_app de um tenant não lê nem grava as colunas novas do outro (RLS isolamento_tenant de sempre);
 * - up/down: a 0093 só acrescenta (colunas e CHECKs); o down volta exatamente ao catálogo e ao SELECT de tabela da anterior.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; backfill e up/down num banco efêmero).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { comoPapel, emTransacao, erroDe, erroNoSavepoint, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0093';
const m93 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m93) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m93.up);
const down = semComentarios(m93.down);

const TIPOS_USUARIO: Record<string, string> = {
  casa_cep: 'text', casa_logradouro: 'text', casa_numero: 'text', casa_bairro: 'text', casa_cidade: 'text', casa_uf: 'text',
  casa_lat: 'numeric(9,6)', casa_lng: 'numeric(9,6)',
  base_tipo: 'text', base_cep: 'text', base_logradouro: 'text', base_numero: 'text', base_bairro: 'text', base_cidade: 'text',
  base_uf: 'text', base_lat: 'numeric(9,6)', base_lng: 'numeric(9,6)', base_alterada_em: 'timestamptz',
};
const TIPOS_CLIENTE: Record<string, string> = {
  coordenada_origem: 'text', coordenada_precisao: 'text', geocodificacao_tentada_em: 'timestamptz', geocodificacao_chave: 'text',
};
const CHECKS_USUARIO = [
  'usuario_casa_cep_formato', 'usuario_casa_uf_formato', 'usuario_casa_coordenada_faixa', 'usuario_casa_coordenada_par',
  'usuario_base_tipo_valido', 'usuario_base_cep_formato', 'usuario_base_uf_formato', 'usuario_base_coordenada_faixa',
  'usuario_base_coordenada_par', 'usuario_base_outro_com_ponto',
];
const CHECKS_CLIENTE = ['cliente_coordenada_origem_valida', 'cliente_coordenada_precisao_valida'];
const tipoNoCatalogo = (t: string) => (t === 'timestamptz' ? 'timestamp with time zone' : t);

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;

describe('0093 casa e base do usuário e geocodificação do cliente (estático)', () => {
  it('nome; as 22 colunas nulas e sem default, com o espelho Drizzle; coordenadas no tipo de core.cliente.latitude', () => {
    expect(m93.nome).toBe('core_usuario_base_cliente_geocodificacao');
    for (const [c, t] of Object.entries(TIPOS_USUARIO)) {
      expect(up, c).toContain(`alter table core.usuario add column ${c} ${t};`);
      expect(Object.keys(nuvemCore.usuario), c).toContain(c);
    }
    for (const [c, t] of Object.entries(TIPOS_CLIENTE)) {
      expect(up, c).toContain(`alter table core.cliente add column ${c} ${t};`);
      expect(Object.keys(nuvemCore.cliente), c).toContain(c);
    }
    expect(up.match(/add column/g)).toHaveLength(22);
    expect(migracoes.find((m) => m.versao === '0002')!.up).toContain('latitude       numeric(9, 6),');
  });

  it('CHECKs do desenho; nenhum índice, tabela, política ou grant ao macuxi_app', () => {
    const umaLinha = up.replace(/\s+/g, ' ');
    for (const p of ['casa', 'base']) {
      expect(umaLinha).toContain(`add constraint usuario_${p}_cep_formato check (${p}_cep is null or ${p}_cep ~ '^[0-9]{8}$');`);
      expect(umaLinha).toContain(`add constraint usuario_${p}_uf_formato check (${p}_uf is null or ${p}_uf ~ '^[A-Z]{2}$');`);
      expect(umaLinha).toContain(
        `add constraint usuario_${p}_coordenada_faixa check ((${p}_lat is null or ${p}_lat between -90 and 90) and (${p}_lng is null or ${p}_lng between -180 and 180));`,
      );
      expect(umaLinha).toContain(`add constraint usuario_${p}_coordenada_par check ((${p}_lat is null) = (${p}_lng is null));`);
    }
    expect(umaLinha).toContain("add constraint usuario_base_tipo_valido check (base_tipo is null or base_tipo in ('casa', 'outro'));");
    expect(umaLinha).toContain("add constraint usuario_base_outro_com_ponto check (base_tipo is distinct from 'outro' or (base_lat is not null and base_lng is not null));");
    expect(umaLinha).toContain("check (coordenada_origem is null or coordenada_origem in ('erp', 'checkin', 'geocodificacao', 'manual'));");
    expect(umaLinha).toContain("check (coordenada_precisao is null or coordenada_precisao in ('numero', 'rua', 'cep'));");
    expect(up.match(/add constraint/g)).toHaveLength(CHECKS_USUARIO.length + CHECKS_CLIENTE.length);
    expect(up).not.toMatch(/create (unique )?index|create table|create policy|alter policy|row level security|\bdelete\b/i);
    expect(up).not.toMatch(/grant [^;]* to macuxi_(app|worker|portal)/);
    expect(up).not.toMatch(/on core\.usuario to macuxi_leitura/);
  });

  it('backfill sem andar o updated_at; SELECT por coluna do macuxi_leitura em core.cliente, sem a sensível', () => {
    expect(up).toMatch(
      /alter table core\.cliente disable trigger cliente_updated_at;\nupdate core\.cliente set coordenada_origem = 'erp' where latitude is not null;\nalter table core\.cliente enable trigger cliente_updated_at;/,
    );
    expect(up).toContain("execute 'revoke select on core.cliente from macuxi_leitura';");
    expect(up).toContain("execute format('grant select (%s) on core.cliente to macuxi_leitura', v_colunas);");
    expect(up).toContain("and not (a.attname ~ '(hash|token|senha|segredo|chave|carga|cifrad)' and a.atttypid <> 'boolean'::regtype);");
  });

  it('down: apaga as 22 colunas e os 12 CHECKs e devolve o SELECT de tabela ao macuxi_leitura', () => {
    for (const c of Object.keys(TIPOS_USUARIO)) expect(down).toContain(`alter table core.usuario drop column if exists ${c};`);
    for (const c of Object.keys(TIPOS_CLIENTE)) expect(down).toContain(`alter table core.cliente drop column if exists ${c};`);
    for (const k of CHECKS_USUARIO) expect(down).toContain(`alter table core.usuario drop constraint if exists ${k};`);
    for (const k of CHECKS_CLIENTE) expect(down).toContain(`alter table core.cliente drop constraint if exists ${k};`);
    expect(down).not.toMatch(/create |update /);
    expect(down).toContain('revoke select on core.cliente from macuxi_leitura;\ngrant select on core.cliente to macuxi_leitura;');
  });
});

describe.skipIf(semBanco())('0093 casa e base do usuário e geocodificação do cliente (banco, fixture dois-tenants)', () => {
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
  const VEND = A.usuarios.vendedor1;
  const usuario = (set: string, p: unknown[] = []) => erroNoSavepoint(admin, `update core.usuario set ${set} where id = '${VEND}'`, p);
  const cliente = (set: string) => erroNoSavepoint(admin, `update core.cliente set ${set} where id = '${A.clientes.c1}'`);

  it('catálogo: colunas nulas com os tipos do desenho; coordenadas iguais às de core.cliente', async () => {
    const cols = await q<{ t: string; c: string; tipo: string; nn: boolean; def: string | null }>(
      `select c.relname as t, a.attname as c, format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull as nn, pg_get_expr(d.adbin, d.adrelid) as def
         from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where c.oid in ('core.usuario'::regclass, 'core.cliente'::regclass) and a.attname = any ($1::text[]) order by 1, 2`,
      [[...Object.keys(TIPOS_USUARIO), ...Object.keys(TIPOS_CLIENTE), 'latitude']],
    );
    const por = new Map(cols.map((x) => [`${x.t}.${x.c}`, x]));
    for (const [c, t] of Object.entries(TIPOS_USUARIO)) expect(por.get(`usuario.${c}`), c).toEqual({ t: 'usuario', c, tipo: tipoNoCatalogo(t), nn: false, def: null });
    for (const [c, t] of Object.entries(TIPOS_CLIENTE)) expect(por.get(`cliente.${c}`), c).toEqual({ t: 'cliente', c, tipo: tipoNoCatalogo(t), nn: false, def: null });
    expect(por.get('usuario.casa_lat')!.tipo).toBe(por.get('cliente.latitude')!.tipo);
  });

  it('CHECKs de core.usuario: CEP, UF, faixas, par lat/lng, base_tipo e base "outro" com o ponto', async () => {
    await emTransacao(admin, null, async () => {
      for (const p of ['casa', 'base']) {
        for (const ruim of ['6905000', '690500000', '69050-00', 'abcdefgh']) expect((await usuario(`${p}_cep = $1`, [ruim]))?.code, `${p} ${ruim}`).toBe('23514');
        for (const ruim of ['am', 'A', 'AMZ', 'A1']) expect((await usuario(`${p}_uf = $1`, [ruim]))?.code, `${p} ${ruim}`).toBe('23514');
        expect((await usuario(`${p}_lat = 90.5, ${p}_lng = 0`))?.code).toBe('23514');
        expect((await usuario(`${p}_lat = 0, ${p}_lng = -180.5`))?.code).toBe('23514');
        expect((await usuario(`${p}_lat = -3.1`))?.code).toBe('23514');
        expect((await usuario(`${p}_lng = -60`))?.code).toBe('23514');
      }
      expect((await usuario("base_tipo = 'trabalho'"))?.code).toBe('23514');
      expect((await usuario("base_tipo = 'outro'"))?.code).toBe('23514');
      expect(await usuario("base_tipo = 'casa'")).toBeNull();
      expect(await usuario(
        "casa_cep = '69050000', casa_logradouro = 'Rua A', casa_numero = '10', casa_bairro = 'Centro', casa_cidade = 'Manaus', casa_uf = 'AM', casa_lat = -90, casa_lng = 180",
      )).toBeNull();
      expect(await usuario(
        "base_tipo = 'outro', base_cep = '69005010', base_uf = 'AM', base_cidade = 'Manaus', base_lat = 90, base_lng = -180, base_alterada_em = now()",
      )).toBeNull();
      expect((await usuario('base_lat = null, base_lng = null'))?.code).toBe('23514');
      expect(await usuario('base_tipo = null, base_lat = null, base_lng = null')).toBeNull();
    });
  });

  it('CHECKs de core.cliente: origem e precisão; aceita as do desenho e nulo', async () => {
    await emTransacao(admin, null, async () => {
      expect((await cliente("coordenada_origem = 'gps'"))?.code).toBe('23514');
      expect((await cliente("coordenada_precisao = 'bairro'"))?.code).toBe('23514');
      for (const o of ['erp', 'checkin', 'geocodificacao', 'manual']) expect(await cliente(`coordenada_origem = '${o}'`), o).toBeNull();
      for (const p of ['numero', 'rua', 'cep']) expect(await cliente(`coordenada_precisao = '${p}'`), p).toBeNull();
      expect(await cliente("coordenada_origem = null, coordenada_precisao = null, geocodificacao_tentada_em = now(), geocodificacao_chave = 'abc'")).toBeNull();
    });
  });

  it('isolamento: o macuxi_app de B não lê nem grava a casa, a base e a geocodificação de A', async () => {
    await emTransacao(admin, null, async () => {
      await q("update core.usuario set casa_cep = '69050000', casa_lat = -3.1, casa_lng = -60, base_tipo = 'casa' where id = $1", [VEND]);
      await q("update core.cliente set coordenada_origem = 'geocodificacao', coordenada_precisao = 'rua', geocodificacao_chave = 'k' where id = $1", [A.clientes.c1]);
      expect(await comoApp(A.tenantId, 'select casa_cep, base_tipo from core.usuario where id = $1', [VEND])).toEqual([{ casa_cep: '69050000', base_tipo: 'casa' }]);
      expect(await comoApp(A.tenantId, 'select coordenada_origem, geocodificacao_chave from core.cliente where id = $1', [A.clientes.c1])).toEqual([
        { coordenada_origem: 'geocodificacao', geocodificacao_chave: 'k' },
      ]);
      expect(await comoApp(B.tenantId, 'select casa_cep, casa_lat, base_tipo from core.usuario where id = $1', [VEND])).toEqual([]);
      expect(await comoApp(B.tenantId, 'select coordenada_origem, geocodificacao_chave from core.cliente where id = $1', [A.clientes.c1])).toEqual([]);
      expect(await comoApp(B.tenantId, "update core.usuario set base_tipo = null, casa_cep = '11111111' where id = $1 returning id", [VEND])).toEqual([]);
      expect(await comoApp(B.tenantId, "update core.cliente set coordenada_origem = 'manual' where id = $1 returning id", [A.clientes.c1])).toEqual([]);
      expect(await comoApp('', 'select casa_cep from core.usuario')).toEqual([]);
      expect(await q('select casa_cep, base_tipo from core.usuario where id = $1', [VEND])).toEqual([{ casa_cep: '69050000', base_tipo: 'casa' }]);
      expect(await q('select coordenada_origem from core.cliente where id = $1', [A.clientes.c1])).toEqual([{ coordenada_origem: 'geocodificacao' }]);
      // o próprio tenant grava (o BKO do Core)
      expect(await comoApp(A.tenantId, "update core.usuario set base_tipo = 'outro', base_lat = -3, base_lng = -60 where id = $1 returning base_tipo", [VEND])).toEqual([{ base_tipo: 'outro' }]);
    });
  });

  it('macuxi_leitura: core.cliente por coluna, sem geocodificacao_chave; nenhuma coluna nova de core.usuario', async () => {
    const r = await q<{ c: string; ok: boolean }>(
      `select c, has_column_privilege('macuxi_leitura', t::regclass, c, 'SELECT') as ok
         from (values ('core.cliente', 'coordenada_origem'), ('core.cliente', 'coordenada_precisao'), ('core.cliente', 'geocodificacao_tentada_em'),
                      ('core.cliente', 'geocodificacao_chave'), ('core.cliente', 'latitude'), ('core.cliente', 'razao_social')) v(t, c)`,
    );
    expect(Object.fromEntries(r.map((x) => [x.c, x.ok]))).toEqual({
      coordenada_origem: true, coordenada_precisao: true, geocodificacao_tentada_em: true, geocodificacao_chave: false, latitude: true, razao_social: true,
    });
    expect(await q("select has_table_privilege('macuxi_leitura', 'core.cliente', 'SELECT') as ok")).toEqual([{ ok: false }]);
    const u = await q<{ c: string }>(
      `select a.attname as c from pg_attribute a where a.attrelid = 'core.usuario'::regclass and a.attname = any ($1::text[])
          and has_column_privilege('macuxi_leitura', a.attrelid, a.attnum, 'SELECT')`,
      [Object.keys(TIPOS_USUARIO)],
    );
    expect(u).toEqual([]);
    await emTransacao(admin, A.tenantId, async () => {
      expect((await erroDe(comoPapel(admin, 'macuxi_leitura', 'select geocodificacao_chave from core.cliente limit 1')))?.code).toBe('42501');
      expect((await erroDe(comoPapel(admin, 'macuxi_leitura', 'select casa_cep from core.usuario limit 1')))?.code).toBe('42501');
      const n = await comoPapel<{ n: number }>(admin, 'macuxi_leitura', 'select count(*)::int as n from core.cliente where coordenada_origem is null');
      expect(n.rows[0]!.n).toBeGreaterThan(0);
    });
  });
});

describe.skipIf(semBanco())('0093 casa e base do usuário e geocodificação do cliente (backfill e up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  const T1 = '00000000-0000-4000-8000-000000009301';
  const T2 = '00000000-0000-4000-8000-000000009302';
  const F1 = '00000000-0000-4000-8000-000000009311';
  const F2 = '00000000-0000-4000-8000-000000009312';
  const C_COM = '00000000-0000-4000-8000-000000009321';
  const C_SEM = '00000000-0000-4000-8000-000000009322';
  const C_APAGADO = '00000000-0000-4000-8000-000000009323';
  const C_T2 = '00000000-0000-4000-8000-000000009324';

  it('backfill: só quem tem latitude recebe "erp", nos dois tenants e no apagado, sem andar o updated_at', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const q = (sql: string, p: unknown[] = []) => c.query(sql, p);
      for (const [t, f, cod] of [[T1, F1, 'geo93a'], [T2, F2, 'geo93b']] as const) {
        await q('insert into plataforma.tenant (id, codigo, nome) values ($1, $2, $3)', [t, cod, `Tenant ${cod}`]);
        await q("insert into core.filial (id, tenant_id, codigo, nome, ativo) values ($1, $2, '1', 'Matriz', true)", [f, t]);
      }
      const ins = (id: string, t: string, f: string, lat: string | null, lng: string | null, apagado = false) =>
        q(
          `insert into core.cliente (id, tenant_id, razao_social, filial_id, latitude, longitude, updated_at, deleted_at)
           values ($1, $2, 'Cliente 0093', $3, $4, $5, '2026-01-01T00:00:00Z', $6)`,
          [id, t, f, lat, lng, apagado ? '2026-01-02T00:00:00Z' : null],
        );
      await ins(C_COM, T1, F1, '-3.100000', '-60.000000');
      await ins(C_SEM, T1, F1, null, null);
      await ins(C_APAGADO, T1, F1, '-3.200000', '-60.100000', true);
      await ins(C_T2, T2, F2, '2.800000', '-60.600000');
      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual([`${VERSAO}_${m93.nome}`]);
      const r = await q('select id, coordenada_origem, coordenada_precisao, updated_at from core.cliente where id = any ($1::uuid[]) order by id', [[C_COM, C_SEM, C_APAGADO, C_T2]]);
      expect(r.rows.map((x) => [x.id, x.coordenada_origem, x.coordenada_precisao, (x.updated_at as Date).toISOString()])).toEqual([
        [C_COM, 'erp', null, '2026-01-01T00:00:00.000Z'],
        [C_SEM, null, null, '2026-01-01T00:00:00.000Z'],
        [C_APAGADO, 'erp', null, '2026-01-01T00:00:00.000Z'],
        [C_T2, 'erp', null, '2026-01-01T00:00:00.000Z'],
      ]);
      // o gatilho de updated_at voltou ligado
      await q("update core.cliente set coordenada_origem = 'manual' where id = $1", [C_SEM]);
      const depois = await q('select updated_at from core.cliente where id = $1', [C_SEM]);
      expect((depois.rows[0]!.updated_at as Date).toISOString()).not.toBe('2026-01-01T00:00:00.000Z');
      // o down tira as colunas e mantém as coordenadas
      await migrarDown(c, { passos: 1 });
      const coords = await q('select count(*)::int as n from core.cliente where latitude is not null');
      expect(coords.rows[0]!.n).toBe(3);
    });
  });

  it('up só acrescenta; down volta exatamente ao catálogo e ao SELECT de tabela da anterior; up de novo = igual', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const acl = async () =>
        (await c.query<{ tabela: boolean; chave: boolean | null }>(
          `select has_table_privilege('macuxi_leitura', 'core.cliente', 'SELECT') as tabela,
                  (select has_column_privilege('macuxi_leitura', 'core.cliente', 'geocodificacao_chave', 'SELECT')
                     where exists (select 1 from pg_attribute where attrelid = 'core.cliente'::regclass and attname = 'geocodificacao_chave')) as chave`,
        )).rows[0];
      const antes = await retratoDoCatalogo(c);
      expect(await acl()).toEqual({ tabela: true, chave: null });
      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual([`${VERSAO}_${m93.nome}`]);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((x) => !depois.includes(x))).toEqual([]);
      const novos = depois.filter((x) => !antes.includes(x));
      const colunas = [
        ...Object.entries(TIPOS_USUARIO).map(([k, t]) => `col core.usuario.${k} ${tipoNoCatalogo(t)} nn=false`),
        ...Object.entries(TIPOS_CLIENTE).map(([k, t]) => `col core.cliente.${k} ${tipoNoCatalogo(t)} nn=false`),
      ];
      expect(novos.filter((x) => x.startsWith('col ')).sort()).toEqual(colunas.sort());
      expect(novos.filter((x) => x.startsWith('con ')).map((x) => x.split(' ')[1]).sort()).toEqual(
        [...CHECKS_USUARIO.map((k) => `core.${k}`), ...CHECKS_CLIENTE.map((k) => `core.${k}`)].sort(),
      );
      expect(novos.filter((x) => !x.startsWith('col ') && !x.startsWith('con '))).toEqual([]);
      expect(await acl()).toEqual({ tabela: false, chave: false });
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${VERSAO}_${m93.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect(await acl()).toEqual({ tabela: true, chave: null });
      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
