/**
 * 0087 — estado `cancelado` do lote (T-0173, RN-INT-15). Dicionário: docs/banco/integracao.md, "0087".
 * - lote_status_valido aceita os 6 estados (ESTADOS_LOTE_BANCO = ESTADOS_LOTE_BKO do contrato); nenhum dado muda no up;
 * - integracao.expurgar_retencao trata o cancelado como lote final (apaga em 12 meses; corpo do staging em 7 dias);
 * - down volta ao catálogo da migração anterior e recusa (P0001) se houver lote cancelado, sem alterar dado.
 * Estático no PC; banco (fixture dois-tenants, ROLLBACK) e up/down num banco efêmero no CI.
 */
import pg from 'pg';
import { ESTADOS_LOTE } from '../../modules/integracao/contracts';
import * as nuvemIntegracao from '../../modules/integracao/db/nuvem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { comCliente, emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const IA = A.integracao;
const migracoes = lerMigracoes();
const m10 = migracoes.find((m) => m.versao === '0010')!;
const mig = migracoes.find((m) => m.nome === 'integracao_lote_cancelado')!;
/** A migração logo antes da 0087 (sem fixar o número: se outro branch entrar antes no main, a renumeração não mexe aqui). */
const anterior = migracoes[migracoes.indexOf(mig) - 1]!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(mig.up);
const down = semComentarios(mig.down);
const umaLinha = (s: string) => s.replace(/\s+/g, ' ');
const CHECK = 'lote_status_valido';
const valoresDoCheck = (sql: string) =>
  [...(/add constraint lote_status_valido\s+check \(status in \(([^)]*)\)\)/.exec(sql)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
/** Corpo de integracao.expurgar_retencao, do create até o "$$;" que fecha, normalizado para "create function". */
const funcao = (sql: string) => {
  const i = sql.search(/create (or replace )?function integracao\.expurgar_retencao\(/);
  if (i < 0) return '';
  const fim = /^\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length).replace(/^create (or replace )?function/, 'create function') : '';
};
const da10 = funcao(semComentarios(m10.up)).replace('set search_path = pg_catalog, integracao\n', 'set search_path = pg_catalog, integracao, pg_temp\n');

describe('0087 lote cancelado (estático)', () => {
  it('CHECK do up = ESTADOS_LOTE_BANCO (os 5 do contrato + cancelado); down = os 5 do contrato', () => {
    expect(valoresDoCheck(up)).toEqual([...nuvemIntegracao.ESTADOS_LOTE_BANCO]);
    expect(valoresDoCheck(down)).toEqual([...ESTADOS_LOTE]);
    for (const sql of [up, down]) {
      expect(sql).toContain(`alter table integracao.lote drop constraint if exists ${CHECK};`);
      expect(sql.indexOf(`drop constraint if exists ${CHECK}`)).toBeLessThan(sql.indexOf(`add constraint ${CHECK}`));
    }
  });

  it('não mexe em dados: fora do corpo do expurgo, nenhum insert/update/delete/drop table/índice/grant', () => {
    const fora = up.replace(funcao(up).replace(/^create function/, 'create or replace function'), '');
    expect(fora).not.toMatch(/\b(insert|update|delete|truncate|grant|revoke|policy)\b|drop table|create index|drop index/i);
    expect(down.replace(funcao(down).replace(/^create function/, 'create or replace function'), '')).not.toMatch(
      /\b(insert|update|delete|truncate|grant|revoke)\b|drop table|create index|drop index/i,
    );
  });

  it('expurgo: create or replace com a mesma assinatura e search_path da 0012; só as 2 listas de estado ganham cancelado', () => {
    expect(up).toContain('create or replace function integracao.expurgar_retencao(p_agora timestamptz default now(), p_limite integer default 5000)');
    expect(da10).not.toBe('');
    const novo = funcao(up);
    expect(novo.replace(", 'falhou', 'cancelado') and x.recebido_em", ", 'falhou') and x.recebido_em").replace(
      "l.status in ('concluido', 'concluido_com_erros', 'cancelado')", "l.status in ('concluido', 'concluido_com_erros')",
    )).toBe(da10);
    expect(novo).not.toBe(da10);
    // down volta ao corpo da 0010 (com o pg_temp da 0012)
    expect(funcao(down)).toBe(da10);
  });

  it('down: pré-condição sem lote cancelado (P0001) antes de qualquer alter', () => {
    expect(umaLinha(down)).toContain("if exists (select 1 from integracao.lote where status = 'cancelado') then raise exception");
    expect(down.indexOf("where status = 'cancelado'")).toBeLessThan(down.indexOf('alter table'));
  });
});

describe.skipIf(semBanco())('0087 lote cancelado (banco, fixture)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);

  it('app cancela o lote recebido; estado fora da lista = 23514 lote_status_valido; B não cancela o lote de A', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const r = await q("update integracao.lote set status = 'cancelado', concluido_em = now() where id = $1 returning status", [IA.lotes.delta]);
      expect(r.rows).toEqual([{ status: 'cancelado' }]);
      await q('savepoint s');
      expect(await erroDe(q("update integracao.lote set status = 'cancelada' where id = $1", [IA.lotes.delta]))).toMatchObject({
        code: '23514',
        message: expect.stringContaining(CHECK),
      });
      await q('rollback to savepoint s');
    });
    await emTransacao(app, B.tenantId, async () => {
      expect((await q("update integracao.lote set status = 'cancelado' where id = $1", [IA.lotes.delta])).rowCount).toBe(0);
    });
  });

  it('expurgo (worker): cancelado recebido há 13 meses sai (cascata); corpo do staging do cancelado há 8 dias é anulado', async () => {
    const r = await comCliente(banco().urlAdmin, async (c) => {
      await c.query('begin');
      try {
        await c.query('update integracao.lote set recebido_em = now(), concluido_em = case when concluido_em is null then null else now() end');
        await c.query("update integracao.lote set status = 'cancelado', recebido_em = now() - interval '13 months', concluido_em = now() - interval '13 months' where id = $1", [IA.lotes.completoProduto]);
        await c.query("update integracao.lote set status = 'cancelado', recebido_em = now() - interval '8 days', concluido_em = null where id = $1", [IA.lotes.delta]);
        await c.query("update integracao.lote set status = 'cancelado', concluido_em = now() - interval '6 days' where id = $1", [B.integracao.lotes.delta]);
        await c.query('set local role macuxi_worker');
        await c.query('select * from integracao.expurgar_retencao(now(), 1000)');
        await c.query('reset role');
        const s = await c.query(
          `select (select count(*) from integracao.lote where id = $1)::int as lote_velho,
                  (select count(*) from integracao.lote_linha_erro where lote_id = $1)::int as erros_velho,
                  (select count(*) from integracao.lote where id = $2)::int as lote_novo,
                  (select corpo is null from integracao.lote_staging where lote_id = $2) as corpo_8_dias_nulo,
                  (select corpo is null from integracao.lote_staging where lote_id = $3) as corpo_6_dias_nulo`,
          [IA.lotes.completoProduto, IA.lotes.delta, B.integracao.lotes.delta],
        );
        return s.rows[0];
      } finally {
        await c.query('rollback');
      }
    });
    expect(r).toEqual({ lote_velho: 0, erros_velho: 0, lote_novo: 1, corpo_8_dias_nulo: true, corpo_6_dias_nulo: false });
  });

  it('down com lote cancelado para em P0001 antes de mudar o catálogo', async () => {
    const r = await comCliente(banco().urlAdmin, async (c) => {
      await c.query('begin');
      try {
        await c.query("update integracao.lote set status = 'cancelado' where id = $1", [IA.lotes.delta]);
        await c.query('savepoint s');
        const e = await erroDe(c.query(mig.down));
        await c.query('rollback to savepoint s');
        const def = await c.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = $1 and conrelid = 'integracao.lote'::regclass", [CHECK]);
        return { e, def: (def.rows[0] as { d: string }).d };
      } finally {
        await c.query('rollback');
      }
    });
    expect(r.e).toMatchObject({ code: 'P0001', message: expect.stringContaining('cancelado') });
    expect(r.def).toContain("'cancelado'::text");
  });
});

describe.skipIf(semBanco())('0087 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up muda só o CHECK e o expurgo; reaplicar o up não muda nada; down volta ao catálogo da anterior (idempotente); up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior.versao });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: mig.versao })).aplicadas).toEqual([`${mig.versao}_${mig.nome}`]);
      const depois = await retratoDoCatalogo(c);
      const novas = depois.filter((x) => !antes.includes(x));
      expect(novas.some((x) => x.includes(CHECK) && x.includes("'cancelado'"))).toBe(true);
      expect(novas.every((x) => x.includes(CHECK) || x.includes('expurgar_retencao'))).toBe(true);
      await c.query(mig.up); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${mig.versao}_${mig.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(mig.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: mig.versao });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
