/**
 * 0063 — limite de desconto do usuário (T-0168, RN-VEN-11a; R-20261112-151014-engenheiro-software; desenho T-0168 §1).
 * Dicionário: docs/banco/core.md, "0063".
 * - core.usuario ganha desconto_limita_item (not null, padrão true), desconto_limita_pedido (not null, padrão false) e
 *   desconto_maximo_pedido_permil (nulo, décimos de %: 8,0% = 80, faixa 0..1000);
 * - "por pedido" ligada exige o número; desligar mantém o número; usuário que já existe fica com o padrão sem andar o updated_at.
 * Estático no PC; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down num banco efêmero no CI.
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

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m63 = migracoes.find((m) => m.versao === '0063')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m63.up);
const down = semComentarios(m63.down);
const FAIXA = 'usuario_desconto_pedido_permil_faixa';
const COM_LIMITE = 'usuario_desconto_pedido_com_limite';

describe('0063 limite de desconto do usuário (estático)', () => {
  it('nome e posição: 0063_core_usuario_limite_desconto logo depois da 0062', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0062_core_catalogo_erp_ordem') + 1]).toBe('0063_core_usuario_limite_desconto');
  });

  it('aditiva: 3 colunas com o padrão de hoje, sem backfill, sem índice, sem RLS/grant e sem DROP no up', () => {
    expect(up).toContain('alter table core.usuario add column desconto_limita_item boolean not null default true;');
    expect(up).toContain('alter table core.usuario add column desconto_limita_pedido boolean not null default false;');
    expect(up).toContain('alter table core.usuario add column desconto_maximo_pedido_permil integer;');
    expect(up).not.toMatch(/\bupdate\b|\bdelete\b|\bdrop\b|\bcreate\b|\bgrant\b|\brevoke\b|\bpolicy\b|row level security/i);
  });

  it('os 2 CHECKs do desenho, com os nomes exatos', () => {
    const umaLinha = up.replace(/\s+/g, ' ');
    expect(umaLinha).toContain(`add constraint ${FAIXA} check (desconto_maximo_pedido_permil is null or desconto_maximo_pedido_permil between 0 and 1000);`);
    expect(umaLinha).toContain(`add constraint ${COM_LIMITE} check (not desconto_limita_pedido or desconto_maximo_pedido_permil is not null);`);
  });

  it('down idempotente desfaz tudo (2 CHECKs e 3 colunas)', () => {
    for (const c of [FAIXA, COM_LIMITE]) expect(down).toContain(`alter table core.usuario drop constraint if exists ${c};`);
    for (const c of ['desconto_limita_item', 'desconto_limita_pedido', 'desconto_maximo_pedido_permil']) {
      expect(down).toContain(`alter table core.usuario drop column if exists ${c};`);
    }
    expect(down).not.toMatch(/\b(add|create)\b/i);
  });

  it('espelho Drizzle: tipos, nulidade e padrões', () => {
    const cols = getTableConfig(nuvemCore.usuario).columns;
    const de = (n: string) => {
      const c = cols.find((x) => x.name === n);
      return [c?.getSQLType(), c?.notNull, c?.default];
    };
    expect(de('desconto_limita_item')).toEqual(['boolean', true, true]);
    expect(de('desconto_limita_pedido')).toEqual(['boolean', true, false]);
    expect(de('desconto_maximo_pedido_permil')).toEqual(['integer', false, undefined]);
  });
});

describe.skipIf(semBanco())('0063 limite de desconto do usuário (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);
  const LIMITE = 'desconto_limita_item, desconto_limita_pedido, desconto_maximo_pedido_permil';

  it('usuário da fixture tem o padrão: por item ligada, por pedido desligada, sem número', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const r = await q(`select ${LIMITE} from core.usuario where id = $1`, [A.usuarios.vendedor1]);
      expect(r.rows).toEqual([{ desconto_limita_item: true, desconto_limita_pedido: false, desconto_maximo_pedido_permil: null }]);
    });
  });

  it('liga por pedido com 8,0% (80), desliga mantendo o número, religa; updated_at anda pelo gatilho', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const antes = (await q('select updated_at from core.usuario where id = $1', [A.usuarios.vendedor1])).rows[0] as { updated_at: Date };
      const r1 = await q(
        `update core.usuario set desconto_limita_pedido = true, desconto_maximo_pedido_permil = 80 where id = $1 returning ${LIMITE}, updated_at`,
        [A.usuarios.vendedor1],
      );
      expect(r1.rows[0]).toMatchObject({ desconto_limita_item: true, desconto_limita_pedido: true, desconto_maximo_pedido_permil: 80 });
      expect((r1.rows[0] as { updated_at: Date }).updated_at.getTime()).toBeGreaterThanOrEqual(antes.updated_at.getTime());
      const r2 = await q(`update core.usuario set desconto_limita_pedido = false, desconto_limita_item = false where id = $1 returning ${LIMITE}`, [A.usuarios.vendedor1]);
      expect(r2.rows).toEqual([{ desconto_limita_item: false, desconto_limita_pedido: false, desconto_maximo_pedido_permil: 80 }]);
      const r3 = await q(`update core.usuario set desconto_limita_pedido = true where id = $1 returning ${LIMITE}`, [A.usuarios.vendedor1]);
      expect(r3.rows[0]).toMatchObject({ desconto_limita_pedido: true, desconto_maximo_pedido_permil: 80 });
      // limites da faixa
      for (const v of [0, 75, 1000]) {
        const r = await q('update core.usuario set desconto_maximo_pedido_permil = $2 where id = $1 returning desconto_maximo_pedido_permil', [A.usuarios.vendedor1, v]);
        expect(r.rows[0]!.desconto_maximo_pedido_permil).toBe(v);
      }
    });
  });

  it('recusas = 23514 com o nome do CHECK; nulo nas booleanas = 23502', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const casos: [string, unknown[], string, string][] = [
        ['update core.usuario set desconto_maximo_pedido_permil = $2 where id = $1', [A.usuarios.vendedor1, -1], '23514', FAIXA],
        ['update core.usuario set desconto_maximo_pedido_permil = $2 where id = $1', [A.usuarios.vendedor1, 1001], '23514', FAIXA],
        ['update core.usuario set desconto_limita_pedido = true where id = $1', [A.usuarios.vendedor1], '23514', COM_LIMITE],
        ['update core.usuario set desconto_limita_pedido = true, desconto_maximo_pedido_permil = null where id = $1', [A.usuarios.vendedor2], '23514', COM_LIMITE],
        ['update core.usuario set desconto_limita_item = null where id = $1', [A.usuarios.vendedor1], '23502', 'desconto_limita_item'],
        ['update core.usuario set desconto_limita_pedido = null where id = $1', [A.usuarios.vendedor1], '23502', 'desconto_limita_pedido'],
      ];
      for (const [sql, p, code, trecho] of casos) {
        await q('savepoint s');
        expect(await erroDe(q(sql, p)), `${sql} ${String(p[1])}`).toMatchObject({ code, message: expect.stringContaining(trecho) });
        await q('rollback to savepoint s');
      }
      // "por pedido" ligada com o número desde o insert; usuário novo sem os campos nasce com o padrão
      const novo = await q(
        `insert into core.usuario (tenant_id, nome, email, perfil) values ($1, 'Novo 0063', 'novo63@exemplo.com.br', 'vendedor') returning ${LIMITE}`,
        [A.tenantId],
      );
      expect(novo.rows).toEqual([{ desconto_limita_item: true, desconto_limita_pedido: false, desconto_maximo_pedido_permil: null }]);
    });
  });

  it('RLS de sempre: B não vê nem altera o limite de A', async () => {
    await emTransacao(app, B.tenantId, async () => {
      expect((await q(`select ${LIMITE} from core.usuario where id = $1`, [A.usuarios.vendedor1])).rowCount).toBe(0);
      expect((await q('update core.usuario set desconto_limita_item = false where id = $1', [A.usuarios.vendedor1])).rowCount).toBe(0);
    });
  });
});

describe.skipIf(semBanco())('0063 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000063';
  const U = 'cccccccc-0000-4000-8000-000000001063';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('usuário existente fica com o padrão e o mesmo updated_at; down volta ao catálogo da 0062; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0062' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo63', 'Antigo')", [T]);
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'Antigo', 'antigo63@exemplo.com.br', 'vendedor')", [U, T]);
      const u0 = (await c.query('select updated_at from core.usuario where id = $1', [U])).rows[0] as { updated_at: Date };
      expect((await migrarUp(c, { ate: '0063' })).aplicadas).toEqual(['0063_core_usuario_limite_desconto']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col core.usuario.desconto_limita_item boolean nn=true');
      expect(depois).toContain('col core.usuario.desconto_limita_pedido boolean nn=true');
      expect(depois).toContain('col core.usuario.desconto_maximo_pedido_permil integer nn=false');
      const u1 = (await c.query('select updated_at, desconto_limita_item, desconto_limita_pedido, desconto_maximo_pedido_permil from core.usuario where id = $1', [U])).rows[0];
      expect(u1).toEqual({ updated_at: u0.updated_at, desconto_limita_item: true, desconto_limita_pedido: false, desconto_maximo_pedido_permil: null });
      await c.query('update core.usuario set desconto_limita_pedido = true, desconto_maximo_pedido_permil = 80 where id = $1', [U]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0063_core_usuario_limite_desconto']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m63.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0063' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      // reaplicada, volta ao padrão (o limite gravado antes do down se perdeu, como diz o caminho de volta)
      const u2 = (await c.query('select desconto_limita_pedido, desconto_maximo_pedido_permil from core.usuario where id = $1', [U])).rows[0];
      expect(u2).toEqual({ desconto_limita_pedido: false, desconto_maximo_pedido_permil: null });
    });
  });
});
