/**
 * 0085 — almoço do usuário e tipos de alerta de produtividade (T-0180, D3/D4/D5; RN-CORE-44, RF-GES-07).
 * Dicionário: docs/banco/core.md e docs/banco/gestor.md, "0085".
 * - core.usuario ganha almoco_inicio_min e almoco_fim_min (smallint, minutos do dia; as duas nulas = padrão da empresa);
 *   CHECKs: as duas ou nenhuma, 0..1439, fim > início com duração de 15 a 180 min;
 * - gestor.alerta aceita parado_entre_visitas e sem_checkin_inicio; gestor.alerta_regra não.
 * Estático no PC; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down num banco efêmero no CI.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { TIPOS_ALERTA } from '../../modules/gestor/contracts/base';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m85 = migracoes.find((m) => m.versao === '0085')!;
const m14 = migracoes.find((m) => m.versao === '0014')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m85.up);
const down = semComentarios(m85.down);
const NOVOS = ['parado_entre_visitas', 'sem_checkin_inicio'] as const;
const PAR = 'usuario_almoco_par';
const FAIXA = 'usuario_almoco_faixa';
const DURACAO = 'usuario_almoco_duracao';

/** Valores do `check (tipo in (...))` de alerta_tipo_valido / alerta_regra_tipo_valido num SQL. */
function listaDoCheck(sql: string, nome: string): string[] {
  const m = new RegExp(`constraint ${nome} check \\(tipo in \\(([^)]*)\\)`).exec(sql);
  expect(m, `constraint ${nome}`).not.toBeNull();
  return [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
}

describe('0085 almoço do usuário e alertas de produtividade (estático)', () => {
  it('nome e posição: 0085_core_almoco_gestor_alerta_produtividade é a 0085', () => {
    expect(`${m85.versao}_${m85.nome}`).toBe('0085_core_almoco_gestor_alerta_produtividade');
  });

  it('aditiva no core.usuario: 2 colunas smallint nulas e 3 CHECKs, sem backfill, índice, grant nem RLS', () => {
    expect(up).toContain('alter table core.usuario add column almoco_inicio_min smallint;');
    expect(up).toContain('alter table core.usuario add column almoco_fim_min smallint;');
    const umaLinha = up.replace(/\s+/g, ' ');
    expect(umaLinha).toContain(`add constraint ${PAR} check ((almoco_inicio_min is null) = (almoco_fim_min is null));`);
    expect(umaLinha).toContain(`add constraint ${FAIXA} check ((almoco_inicio_min is null or almoco_inicio_min between 0 and 1439) and (almoco_fim_min is null or almoco_fim_min between 0 and 1439));`);
    expect(umaLinha).toContain(`add constraint ${DURACAO} check (almoco_inicio_min is null or almoco_fim_min is null or (almoco_fim_min - almoco_inicio_min) between 15 and 180);`);
    expect(up).not.toMatch(/\bupdate\b|\bdelete\b|\bcreate\b|\bgrant\b|\brevoke\b|\bpolicy\b|row level security/i);
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

  it('espelho Drizzle: smallint, nulas, sem padrão', () => {
    const cols = getTableConfig(nuvemCore.usuario).columns;
    for (const n of ['almoco_inicio_min', 'almoco_fim_min']) {
      const c = cols.find((x) => x.name === n);
      expect([c?.getSQLType(), c?.notNull, c?.default], n).toEqual(['smallint', false, undefined]);
    }
  });
});

describe.skipIf(semBanco())('0085 almoço do usuário e alertas de produtividade (banco, papel de aplicação)', () => {
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
        [1430, 1440, FAIXA],
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
           values ($1, $2, $3, 'usuario', $4, 'atencao', 'Teste 0085', now()) returning tipo`,
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

  it('RLS de sempre: B não vê nem altera o almoço de A', async () => {
    await emTransacao(app, B.tenantId, async () => {
      expect((await q(`select ${ALMOCO} from core.usuario where id = $1`, [A.usuarios.vendedor1])).rowCount).toBe(0);
      expect((await q('update core.usuario set almoco_inicio_min = 720, almoco_fim_min = 780 where id = $1', [A.usuarios.vendedor1])).rowCount).toBe(0);
    });
  });
});

describe.skipIf(semBanco())('0085 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000085';
  const U = 'cccccccc-0000-4000-8000-000000001085';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('usuário existente fica no padrão com o mesmo updated_at; down apaga os alertas novos e volta ao catálogo da 0084; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0084' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo85', 'Antigo')", [T]);
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'Antigo', 'antigo85@exemplo.com.br', 'vendedor')", [U, T]);
      const u0 = (await c.query('select updated_at from core.usuario where id = $1', [U])).rows[0] as { updated_at: Date };
      expect((await migrarUp(c, { ate: '0085' })).aplicadas).toEqual(['0085_core_almoco_gestor_alerta_produtividade']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col core.usuario.almoco_inicio_min smallint nn=false');
      expect(depois).toContain('col core.usuario.almoco_fim_min smallint nn=false');
      const u1 = (await c.query('select updated_at, almoco_inicio_min, almoco_fim_min from core.usuario where id = $1', [U])).rows[0];
      expect(u1).toEqual({ updated_at: u0.updated_at, almoco_inicio_min: null, almoco_fim_min: null });
      await c.query('update core.usuario set almoco_inicio_min = 720, almoco_fim_min = 780 where id = $1', [U]);
      await c.query(
        "insert into gestor.alerta (tenant_id, chave, tipo, alvo_tipo, alvo_id, severidade, mensagem, aberto_em) values ($1, $2, 'parado_entre_visitas', 'usuario', $3, 'atencao', 'Teste 0085', now())",
        [T, `produtividade:${U}`, U],
      );
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0085_core_almoco_gestor_alerta_produtividade']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select 1 from gestor.alerta where tenant_id = $1', [T])).rowCount).toBe(0);
      await c.query(m85.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0085' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      const u2 = (await c.query('select almoco_inicio_min, almoco_fim_min from core.usuario where id = $1', [U])).rows[0];
      expect(u2).toEqual({ almoco_inicio_min: null, almoco_fim_min: null });
    });
  });
});
