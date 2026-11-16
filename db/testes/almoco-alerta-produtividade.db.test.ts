/**
 * 0084 — almoço do usuário e tipos de alerta de produtividade (T-0180, D3/D4/D5; RN-CORE-44, RF-GES-07).
 * Dicionário: docs/banco/core.md e docs/banco/gestor.md, "0084".
 * - core.usuario ganha almoco_inicio_min e almoco_fim_min (smallint, minutos do dia; as duas nulas = padrão da empresa);
 *   CHECKs: as duas ou nenhuma, 0..1439, fim > início com duração de 15 a 180 min;
 * - gestor.alerta aceita parado_entre_visitas e sem_checkin_inicio; gestor.alerta_regra não;
 * - core.usuario_contato (ADR 0059 §5): último contato do aparelho, um por usuário (unique NÃO parcial, alvo do on conflict do
 *   contatoDoAparelho do Core com trava de 1 min), RLS por tenant, select/insert/update ao macuxi_app, fora do sync.
 * Estático no PC; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down num banco efêmero no CI.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { TIPOS_ALERTA } from '../../modules/gestor/contracts/base';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m81 = migracoes.find((m) => m.nome === 'core_almoco_gestor_alerta_produtividade')!;
const m14 = migracoes.find((m) => m.versao === '0014')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const upInteira = semComentarios(m81.up);
const INICIO_CONTATO = upInteira.indexOf('create table core.usuario_contato');
/** Parte 1 e 2 (core.usuario e gestor.alerta), sem a tabela nova. */
const up = upInteira.slice(0, INICIO_CONTATO);
const upContato = upInteira.slice(INICIO_CONTATO);
const down = semComentarios(m81.down);
const NOVOS = ['parado_entre_visitas', 'sem_checkin_inicio'] as const;
const PAR = 'usuario_almoco_par';
const FAIXA = 'usuario_almoco_faixa';
const DURACAO = 'usuario_almoco_duracao';
/** O mesmo SQL de SQL_CONTATO_DO_APARELHO (modules/core/api/produtividade-equipe.ts, T-0180). */
const SQL_CONTATO = `insert into core.usuario_contato (tenant_id, usuario_id, contato_em)
  values (plataforma.tenant_atual(), $1, $2::timestamptz)
  on conflict (tenant_id, usuario_id) do update set contato_em = excluded.contato_em, updated_at = now()
    where core.usuario_contato.contato_em < excluded.contato_em - interval '1 minute'`;

/** Valores do `check (tipo in (...))` de alerta_tipo_valido / alerta_regra_tipo_valido num SQL. */
function listaDoCheck(sql: string, nome: string): string[] {
  const m = new RegExp(`constraint ${nome} check \\(tipo in \\(([^)]*)\\)`).exec(sql);
  expect(m, `constraint ${nome}`).not.toBeNull();
  return [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
}

describe('0084 almoço do usuário e alertas de produtividade (estático)', () => {
  it('nome e posição: 0084_core_almoco_gestor_alerta_produtividade é a 0084', () => {
    expect(`${m81.versao}_${m81.nome}`).toBe('0084_core_almoco_gestor_alerta_produtividade');
  });

  it('aditiva no core.usuario: 2 colunas smallint nulas e 3 CHECKs, sem backfill, índice nem RLS; grant só ao macuxi_leitura (0078)', () => {
    expect(up).toContain('alter table core.usuario add column almoco_inicio_min smallint;');
    expect(up).toContain('alter table core.usuario add column almoco_fim_min smallint;');
    const umaLinha = up.replace(/\s+/g, ' ');
    expect(umaLinha).toContain(`add constraint ${PAR} check ((almoco_inicio_min is null) = (almoco_fim_min is null));`);
    expect(umaLinha).toContain(`add constraint ${FAIXA} check ((almoco_inicio_min is null or almoco_inicio_min between 0 and 1439) and (almoco_fim_min is null or almoco_fim_min between 0 and 1439));`);
    expect(umaLinha).toContain(`add constraint ${DURACAO} check (almoco_inicio_min is null or almoco_fim_min is null or (almoco_fim_min - almoco_inicio_min) between 15 and 180);`);
    // a 0078 deu SELECT por coluna em core.usuario ao macuxi_leitura: coluna nova não herda, então o único grant é o dele
    const GRANT_LEITURA = 'grant select (almoco_inicio_min, almoco_fim_min) on core.usuario to macuxi_leitura;';
    expect(up).toContain(GRANT_LEITURA);
    expect(up.replace(GRANT_LEITURA, '')).not.toMatch(/\bupdate\b|\bdelete\b|\bcreate\b|\bgrant\b|\brevoke\b|\bpolicy\b|row level security/i);
    expect(up).not.toContain('alerta_regra');
  });

  it('alerta_tipo_valido = os 6 da 0014 + os 2 de produtividade; os contratos do Gestor cabem nele', () => {
    const da14 = listaDoCheck(m14.up, 'alerta_tipo_valido');
    const da85 = listaDoCheck(up, 'alerta_tipo_valido');
    expect(da85).toEqual([...da14, ...NOVOS]);
    expect(new Set(da85)).toEqual(new Set([...TIPOS_ALERTA, ...NOVOS]));
    // o down devolve exatamente o da 0014
    expect(listaDoCheck(down, 'alerta_tipo_valido')).toEqual(da14);
  });

  it('down idempotente: apaga os alertas dos tipos novos, volta o CHECK, tira os 3 CHECKs e as 2 colunas', () => {
    expect(down).toContain("delete from gestor.alerta where tipo in ('parado_entre_visitas', 'sem_checkin_inicio');");
    expect(down).toContain('alter table gestor.alerta drop constraint if exists alerta_tipo_valido;');
    for (const c of [PAR, FAIXA, DURACAO]) expect(down).toContain(`alter table core.usuario drop constraint if exists ${c};`);
    for (const c of ['almoco_inicio_min', 'almoco_fim_min']) expect(down).toContain(`alter table core.usuario drop column if exists ${c};`);
    expect(down.indexOf('delete from gestor.alerta')).toBeLessThan(down.indexOf('add constraint alerta_tipo_valido'));
  });

  it('core.usuario_contato: colunas obrigatórias, unique NÃO parcial (tenant_id, usuario_id), FK composta, RLS forçado, políticas e grant', () => {
    expect(INICIO_CONTATO).toBeGreaterThan(0);
    const umaLinha = upContato.replace(/\s+/g, ' ');
    for (const c of ['id uuid primary key default gen_random_uuid()', 'tenant_id uuid not null references plataforma.tenant (id)', 'usuario_id uuid not null', 'contato_em timestamptz not null', 'created_at timestamptz not null default now()', 'updated_at timestamptz not null default now()', 'deleted_at timestamptz', 'external_id text']) {
      expect(umaLinha, c).toContain(c);
    }
    expect(umaLinha).toContain('constraint usuario_contato_usuario_uk unique (tenant_id, usuario_id),');
    expect(umaLinha).toContain('constraint usuario_contato_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id)');
    expect(umaLinha).not.toMatch(/on core\.usuario_contato \(tenant_id, usuario_id\) where/);
    expect(umaLinha).toContain('alter table core.usuario_contato enable row level security;');
    expect(umaLinha).toContain('alter table core.usuario_contato force row level security;');
    expect(umaLinha).toContain('create policy isolamento_tenant on core.usuario_contato for all to macuxi_app using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());');
    expect(umaLinha).toContain('create policy manutencao on core.usuario_contato for all to macuxi_manutencao using (true) with check (true);');
    expect(umaLinha).toContain('grant select, insert, update on core.usuario_contato to macuxi_app;');
    expect(umaLinha).not.toMatch(/grant [a-z, ]*delete[a-z, ]* on core\.usuario_contato/);
    expect(TABELAS_FORA_DO_SYNC).toContain('core.usuario_contato');
    expect(down).toContain('drop table if exists core.usuario_contato;');
  });

  it('espelho Drizzle: smallint, nulas, sem padrão', () => {
    const cols = getTableConfig(nuvemCore.usuario).columns;
    for (const n of ['almoco_inicio_min', 'almoco_fim_min']) {
      const c = cols.find((x) => x.name === n);
      expect([c?.getSQLType(), c?.notNull, c?.default], n).toEqual(['smallint', false, undefined]);
    }
    const contato = getTableConfig(nuvemCore.usuarioContato);
    expect(`${contato.schema}.${contato.name}`).toBe('core.usuario_contato');
    const tipos = Object.fromEntries(contato.columns.map((c) => [c.name, [c.getSQLType(), c.notNull]]));
    expect(tipos).toMatchObject({ usuario_id: ['uuid', true], contato_em: ['timestamp with time zone', true] });
  });
});

describe.skipIf(semBanco())('0084 almoço do usuário e alertas de produtividade (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);
  const ALMOCO = 'almoco_inicio_min, almoco_fim_min';

  it('usuário da fixture fica no padrão da empresa (as duas nulas); grava próprio e volta ao padrão', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect((await q(`select ${ALMOCO} from core.usuario where id = $1`, [A.usuarios.vendedor1])).rows).toEqual([{ almoco_inicio_min: null, almoco_fim_min: null }]);
      for (const [i, f] of [[720, 780], [690, 705], [660, 840], [0, 15], [1259, 1439]] as const) {
        const r = await q(`update core.usuario set almoco_inicio_min = $2, almoco_fim_min = $3 where id = $1 returning ${ALMOCO}`, [A.usuarios.vendedor1, i, f]);
        expect(r.rows).toEqual([{ almoco_inicio_min: i, almoco_fim_min: f }]);
      }
      const r = await q(`update core.usuario set almoco_inicio_min = null, almoco_fim_min = null where id = $1 returning ${ALMOCO}`, [A.usuarios.vendedor1]);
      expect(r.rows).toEqual([{ almoco_inicio_min: null, almoco_fim_min: null }]);
    });
  });

  it('recusas = 23514 com o nome do CHECK', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const sql = 'update core.usuario set almoco_inicio_min = $2, almoco_fim_min = $3 where id = $1';
      const casos: [number | null, number | null, string][] = [
        [720, null, PAR],
        [null, 780, PAR],
        [-1, 30, FAIXA],
        [1300, 1440, FAIXA], // duração 140 cabe: só a faixa recusa (o PG confere os CHECKs em ordem de nome; duracao vem antes)
        [780, 720, DURACAO],
        [720, 720, DURACAO],
        [720, 734, DURACAO],
        [720, 901, DURACAO],
      ];
      for (const [i, f, nome] of casos) {
        await q('savepoint s');
        expect(await erroDe(q(sql, [A.usuarios.vendedor1, i, f])), `${String(i)}-${String(f)}`).toMatchObject({ code: '23514', message: expect.stringContaining(nome) });
        await q('rollback to savepoint s');
      }
    });
  });

  it('gestor.alerta aceita os 2 tipos novos; gestor.alerta_regra não', async () => {
    await emTransacao(app, A.tenantId, async () => {
      for (const tipo of NOVOS) {
        const r = await q(
          `insert into gestor.alerta (tenant_id, chave, tipo, alvo_tipo, alvo_id, severidade, mensagem, aberto_em)
           values ($1, $2, $3, 'usuario', $4, 'atencao', 'Teste 0084', now()) returning tipo`,
          [A.tenantId, `${tipo}:${A.usuarios.vendedor1}`, tipo, A.usuarios.vendedor1],
        );
        expect(r.rows).toEqual([{ tipo }]);
        await q('savepoint s');
        expect(await erroDe(q("insert into gestor.alerta_regra (tenant_id, tipo, ajuste) values ($1, $2, '{}')", [A.tenantId, tipo]))).toMatchObject({
          code: '23514',
          message: expect.stringContaining('alerta_regra_tipo_valido'),
        });
        await q('rollback to savepoint s');
      }
      await q('savepoint s');
      expect(await erroDe(q(
        "insert into gestor.alerta (tenant_id, chave, tipo, alvo_tipo, alvo_id, severidade, mensagem, aberto_em) values ($1, 'x:abc', 'tipo_inexistente', 'usuario', $2, 'info', 'x', now())",
        [A.tenantId, A.usuarios.vendedor1],
      ))).toMatchObject({ code: '23514', message: expect.stringContaining('alerta_tipo_valido') });
      await q('rollback to savepoint s');
    });
  });

  it('core.usuario_contato: upsert com trava de 1 min, sem andar o updated_at do usuário', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const u = A.usuarios.vendedor1;
      const [T0, T0_59, ANTES, T1] = ['2026-11-15T12:00:00Z', '2026-11-15T12:00:59Z', '2026-11-15T11:00:00Z', '2026-11-15T12:01:01Z']; // hora-fixa-ok: só comparados entre si (trava de 1 min); o now() do SQL não entra
      const lerContato = async () => (await q("select to_char(contato_em at time zone 'UTC', 'HH24:MI:SS') as h from core.usuario_contato where usuario_id = $1", [u])).rows;
      const uAntes = (await q('select updated_at from core.usuario where id = $1', [u])).rows[0];
      expect((await q(SQL_CONTATO, [u, T0])).rowCount).toBe(1);
      expect(await lerContato()).toEqual([{ h: '12:00:00' }]);
      expect((await q(SQL_CONTATO, [u, T0_59])).rowCount).toBe(0); // dentro do minuto: não grava
      expect((await q(SQL_CONTATO, [u, ANTES])).rowCount).toBe(0); // mais antigo: não volta
      expect(await lerContato()).toEqual([{ h: '12:00:00' }]);
      expect((await q(SQL_CONTATO, [u, T1])).rowCount).toBe(1);
      expect(await lerContato()).toEqual([{ h: '12:01:01' }]);
      expect((await q('select count(*)::int as n from core.usuario_contato where usuario_id = $1', [u])).rows).toEqual([{ n: 1 }]);
      expect((await q('select updated_at from core.usuario where id = $1', [u])).rows[0]).toEqual(uAntes);
      await q('savepoint s');
      expect(await erroDe(q('delete from core.usuario_contato where usuario_id = $1', [u]))).toMatchObject({ code: '42501' });
      await q('rollback to savepoint s');
    });
  });

  it('core.usuario_contato: B não vê nem altera o contato de A; não grava para usuário de A nem com o tenant de A', async () => {
    await emTransacao(app, B.tenantId, async () => {
      expect((await q('select 1 from core.usuario_contato where usuario_id = $1', [A.usuarios.vendedor2])).rowCount).toBe(0);
      expect((await q("update core.usuario_contato set contato_em = now() where usuario_id = $1", [A.usuarios.vendedor2])).rowCount).toBe(0);
      expect((await q('select count(*)::int as n from core.usuario_contato')).rows).toEqual([{ n: 1 }]); // só o da fixture de B
      await q('savepoint s');
      expect(await erroDe(q(SQL_CONTATO, [A.usuarios.promotor, '2026-11-15T12:00:00Z']))).toMatchObject({ code: '23503' }); // hora-fixa-ok: a FK recusa antes de comparar instantes
      await q('rollback to savepoint s');
      expect(await erroDe(q('insert into core.usuario_contato (tenant_id, usuario_id, contato_em) values ($1, $2, now())', [A.tenantId, A.usuarios.promotor]))).toMatchObject({ code: '42501' });
    });
  });

  it('RLS de sempre: B não vê nem altera o almoço de A', async () => {
    await emTransacao(app, B.tenantId, async () => {
      expect((await q(`select ${ALMOCO} from core.usuario where id = $1`, [A.usuarios.vendedor1])).rowCount).toBe(0);
      expect((await q('update core.usuario set almoco_inicio_min = 720, almoco_fim_min = 780 where id = $1', [A.usuarios.vendedor1])).rowCount).toBe(0);
    });
  });
});

describe.skipIf(semBanco())('0084 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000085';
  const U = 'cccccccc-0000-4000-8000-000000001085';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('usuário existente fica no padrão com o mesmo updated_at; down apaga os alertas novos e volta ao catálogo da 0083; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: migracoes[migracoes.indexOf(m81) - 1]!.versao });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo85', 'Antigo')", [T]);
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'Antigo', 'antigo85@exemplo.com.br', 'vendedor')", [U, T]);
      const u0 = (await c.query('select updated_at from core.usuario where id = $1', [U])).rows[0] as { updated_at: Date };
      expect((await migrarUp(c, { ate: m81.versao })).aplicadas).toEqual([`${m81.versao}_${m81.nome}`]);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col core.usuario.almoco_inicio_min smallint nn=false');
      expect(depois).toContain('col core.usuario.almoco_fim_min smallint nn=false');
      expect(depois).toContain('col core.usuario_contato.contato_em timestamp with time zone nn=true');
      await c.query("insert into core.usuario_contato (tenant_id, usuario_id, contato_em) values ($1, $2, now())", [T, U]);
      const u1 = (await c.query('select updated_at, almoco_inicio_min, almoco_fim_min from core.usuario where id = $1', [U])).rows[0];
      expect(u1).toEqual({ updated_at: u0.updated_at, almoco_inicio_min: null, almoco_fim_min: null });
      await c.query('update core.usuario set almoco_inicio_min = 720, almoco_fim_min = 780 where id = $1', [U]);
      await c.query(
        "insert into gestor.alerta (tenant_id, chave, tipo, alvo_tipo, alvo_id, severidade, mensagem, aberto_em) values ($1, $2, 'parado_entre_visitas', 'usuario', $3, 'atencao', 'Teste 0084', now())",
        [T, `produtividade:${U}`, U],
      );
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${m81.versao}_${m81.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select 1 from gestor.alerta where tenant_id = $1', [T])).rowCount).toBe(0);
      await c.query(m81.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: m81.versao });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      const u2 = (await c.query('select almoco_inicio_min, almoco_fim_min from core.usuario where id = $1', [U])).rows[0];
      expect(u2).toEqual({ almoco_inicio_min: null, almoco_fim_min: null });
    });
  });
});
