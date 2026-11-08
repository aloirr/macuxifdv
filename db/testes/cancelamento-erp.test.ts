/**
 * 0043 — cancelamento do pedido devolvido ao ERP (T-0114; pedido R-20261107-235216-modulo-integracao; RN-INT-08/RN-VEN-31).
 * O que o BANCO garante: integracao.conector.aceita_cancelamento boolean not null default false; em integracao.pedido_fila_erp
 * as 5 colunas cancelamento_* (estado nulo|pendente|enviado|confirmado, motivo 1..500 sem só espaços, solicitado_em,
 * enviado_em, tentativas >= 0 padrão 0) com o CHECK de coerência (estado nulo <=> solicitado_em nulo; 'enviado' => enviado_em)
 * e o índice parcial do poll; sem política nem grant novo (RLS e update do macuxi_app herdados). Down volta ao catálogo da 0042.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * Os casos de banco rodam no CI (sem Docker no PC do dono do produto, R-20261105-053835).
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemIntegracao from '../../modules/integracao/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const FILA_A = A.integracao.fila.p3;
const migracoes = lerMigracoes();
const m43 = migracoes.find((m) => m.versao === '0043')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const COLUNAS_FILA = ['cancelamento_estado', 'cancelamento_motivo', 'cancelamento_solicitado_em', 'cancelamento_enviado_em', 'cancelamento_tentativas'];

describe('0043 cancelamento para o ERP (estático)', () => {
  it('nome e posição: 0043_integracao_cancelamento_erp logo depois da 0042', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0042_plataforma_portal_redefinir_senha_admin') + 1]).toBe('0043_integracao_cancelamento_erp');
  });

  it('só colunas, CHECKs e 1 índice no schema integracao: sem tabela, política, grant, backfill nem outro schema', () => {
    const sql = semComentarios(m43.up);
    expect(sql).toContain('alter table integracao.conector add column aceita_cancelamento boolean not null default false;');
    for (const c of COLUNAS_FILA) expect(sql).toContain(`add column ${c} `);
    expect(sql).toContain('add column cancelamento_tentativas integer not null default 0');
    expect([...sql.matchAll(/add constraint ([a-z_]+)/g)].map((x) => x[1])).toEqual([
      'pedido_fila_erp_cancelamento_estado_valido',
      'pedido_fila_erp_cancelamento_motivo_tamanho',
      'pedido_fila_erp_cancelamento_tentativas_validas',
      'pedido_fila_erp_cancelamento_coerente',
    ]);
    expect([...sql.matchAll(/create (?:unique )?index ([a-z_]+)/g)].map((x) => x[1])).toEqual(['pedido_fila_erp_cancelamento_ix']);
    expect(sql).not.toMatch(/create table|create policy|grant |revoke |update |delete from|insert into/);
    expect(new Set([...sql.matchAll(/\b([a-z_]+)\.[a-z_]+/g)].map((x) => x[1]))).toEqual(new Set(['integracao']));
  });

  it('o CHECK do estado tem os 3 valores da 0043; o espelho (ESTADOS_CANCELAMENTO_BANCO) soma o recusado da 0048 (cancelamento-recusado.test.ts)', () => {
    expect(nuvemIntegracao.ESTADOS_CANCELAMENTO_BANCO).toEqual(['pendente', 'enviado', 'confirmado', 'recusado']);
    expect(semComentarios(m43.up)).toContain("cancelamento_estado in ('pendente', 'enviado', 'confirmado')");
  });

  it('down desfaz tudo o que o up cria (idempotente; índice e CHECKs antes das colunas)', () => {
    const down = semComentarios(m43.down);
    expect(down).toContain('drop index if exists integracao.pedido_fila_erp_cancelamento_ix;');
    for (const k of ['estado_valido', 'motivo_tamanho', 'tentativas_validas', 'coerente']) {
      expect(down).toContain(`drop constraint if exists pedido_fila_erp_cancelamento_${k};`);
    }
    for (const c of COLUNAS_FILA) expect(down).toContain(`drop column if exists ${c}`);
    expect(down).toContain('alter table integracao.conector drop column if exists aceita_cancelamento;');
    expect(down.lastIndexOf('drop constraint')).toBeLessThan(down.indexOf('drop column'));
    expect(down).not.toMatch(/drop column (?!if exists)/);
  });

  it('espelho Drizzle: conector.aceita_cancelamento e as 5 colunas da fila, com o NOT NULL e o padrão do SQL', () => {
    const col = (t: Parameters<typeof getTableConfig>[0], nome: string) => getTableConfig(t).columns.find((c) => c.name === nome);
    const aceita = col(nuvemIntegracao.conector, 'aceita_cancelamento');
    expect([aceita?.getSQLType(), aceita?.notNull, aceita?.hasDefault]).toEqual(['boolean', true, true]);
    expect(COLUNAS_FILA.map((n) => {
      const c = col(nuvemIntegracao.pedidoFilaErp, n);
      return [n, c?.getSQLType(), c?.notNull];
    })).toEqual([
      ['cancelamento_estado', 'text', false],
      ['cancelamento_motivo', 'text', false],
      ['cancelamento_solicitado_em', 'timestamp with time zone', false],
      ['cancelamento_enviado_em', 'timestamp with time zone', false],
      ['cancelamento_tentativas', 'integer', true],
    ]);
  });
});

describe.skipIf(semBanco())('0043 cancelamento para o ERP (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const codigo = async (tenant: string, fn: () => Promise<unknown>) => (await erroDe(emTransacao(app, tenant, fn)))?.code;
  const marcar = (campos: string, params: unknown[] = []) =>
    q(`update integracao.pedido_fila_erp set ${campos} where id = $1`, [FILA_A, ...params]);

  it('fixture: conectores com aceita_cancelamento false e filas sem cancelamento (estado nulo, 0 tentativas)', async () => {
    for (const t of [A, B]) {
      await emTransacao(app, t.tenantId, async () => {
        expect((await q('select aceita_cancelamento from integracao.conector')).rows).toEqual([{ aceita_cancelamento: false }]);
        expect(
          (await q(`select ${COLUNAS_FILA.join(', ')} from integracao.pedido_fila_erp`)).rows,
        ).toEqual([{ cancelamento_estado: null, cancelamento_motivo: null, cancelamento_solicitado_em: null, cancelamento_enviado_em: null, cancelamento_tentativas: 0 }]);
      });
    }
  });

  it('ciclo do Hub: liga a opção; pendente (consumidor) → enviado (poll) → confirmado (retorno), com motivo de 1 e de 500', async () => {
    expect(await codigo(A.tenantId, async () => {
      expect((await q('update integracao.conector set aceita_cancelamento = true where id = $1', [A.integracao.conector])).rowCount).toBe(1);
      const r = await q(
        `update integracao.pedido_fila_erp
            set cancelamento_estado = 'pendente', cancelamento_motivo = $2, cancelamento_solicitado_em = now(), cancelamento_enviado_em = null, cancelamento_tentativas = 0
          where id = $1 and cancelamento_estado is null`,
        [FILA_A, 'é'.repeat(500)],
      );
      expect(r.rowCount).toBe(1);
      await marcar("cancelamento_motivo = 'X'");
      const poll = await q<{ id: string }>(
        `select id from integracao.pedido_fila_erp
          where tenant_id = $1 and deleted_at is null and estado <> 'cancelado' and cancelamento_estado in ('pendente', 'enviado')
          order by cancelamento_solicitado_em, pedido_uuid limit 50 for update skip locked`,
        [A.tenantId],
      );
      expect(poll.rows).toEqual([{ id: FILA_A }]);
      await marcar("cancelamento_estado = 'enviado', cancelamento_enviado_em = now(), cancelamento_tentativas = cancelamento_tentativas + 1");
      await marcar("estado = 'cancelado', cancelamento_estado = case when cancelamento_estado is not null then 'confirmado' else cancelamento_estado end");
      expect((await q('select cancelamento_estado, cancelamento_tentativas from integracao.pedido_fila_erp where id = $1', [FILA_A])).rows).toEqual([
        { cancelamento_estado: 'confirmado', cancelamento_tentativas: 1 },
      ]);
    })).toBeUndefined();
  });

  it.each([
    ["cancelamento_estado = 'cancelado', cancelamento_solicitado_em = now()", 'pedido_fila_erp_cancelamento_estado_valido'],
    ["cancelamento_estado = 'pendente', cancelamento_solicitado_em = now(), cancelamento_motivo = ''", 'pedido_fila_erp_cancelamento_motivo_tamanho'],
    ["cancelamento_estado = 'pendente', cancelamento_solicitado_em = now(), cancelamento_motivo = '   '", 'pedido_fila_erp_cancelamento_motivo_tamanho'],
    ["cancelamento_estado = 'pendente', cancelamento_solicitado_em = now(), cancelamento_motivo = repeat('x', 501)", 'pedido_fila_erp_cancelamento_motivo_tamanho'],
    ['cancelamento_tentativas = -1', 'pedido_fila_erp_cancelamento_tentativas_validas'],
    ["cancelamento_estado = 'pendente'", 'pedido_fila_erp_cancelamento_coerente'],
    ['cancelamento_solicitado_em = now()', 'pedido_fila_erp_cancelamento_coerente'],
    ["cancelamento_estado = 'enviado', cancelamento_solicitado_em = now()", 'pedido_fila_erp_cancelamento_coerente'],
  ])('CHECK recusa: %s', async (campos, restricao) => {
    const e = await erroDe(emTransacao(app, A.tenantId, () => marcar(campos)));
    expect(e).toMatchObject({ code: '23514', message: expect.stringContaining(restricao) });
  });

  it('confirmado sem enviado_em vale (o ERP cancelou antes do poll); nulo em cancelamento_tentativas recusa (23502)', async () => {
    expect(await codigo(A.tenantId, () => marcar("cancelamento_estado = 'confirmado', cancelamento_solicitado_em = now()"))).toBeUndefined();
    expect(await codigo(A.tenantId, () => marcar('cancelamento_tentativas = null'))).toBe('23502');
  });

  it('vazamento entre tenants: B não lê nem muda o cancelamento nem a opção de A', async () => {
    await emTransacao(app, B.tenantId, async () => {
      expect((await q('select 1 from integracao.pedido_fila_erp where id = $1', [FILA_A])).rowCount).toBe(0);
      expect((await marcar("cancelamento_estado = 'pendente', cancelamento_solicitado_em = now()")).rowCount).toBe(0);
      expect((await q('update integracao.conector set aceita_cancelamento = true where id = $1', [A.integracao.conector])).rowCount).toBe(0);
    });
    await emTransacao(app, A.tenantId, async () => {
      expect((await q('select aceita_cancelamento from integracao.conector where id = $1', [A.integracao.conector])).rows).toEqual([{ aceita_cancelamento: false }]);
    });
  });

  it('poll usa o índice parcial pedido_fila_erp_cancelamento_ix', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await q('set local enable_seqscan = off');
      const plano = await q<{ 'QUERY PLAN': string }>(
        `explain select pedido_uuid from integracao.pedido_fila_erp
          where tenant_id = '${A.tenantId}' and deleted_at is null and estado <> 'cancelado' and cancelamento_estado in ('pendente', 'enviado')
          order by cancelamento_solicitado_em, pedido_uuid limit 50`,
      );
      expect(plano.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('pedido_fila_erp_cancelamento_ix');
    });
  });
});

describe.skipIf(semBanco())('0043 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000043';
  const C = 'cccccccc-0043-4000-8000-000000000001';
  const F = 'cccccccc-0043-4000-8000-000000000002';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const desde0043 = nomes.filter((n) => n >= '0043');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('linhas anteriores ganham os padrões (false, nulo, 0) e ficam intactas; down volta à 0042 com as linhas; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0042' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo43', 'Antigo')", [T]);
      await c.query("insert into integracao.conector (id, tenant_id, identificador, nome) values ($1, $2, 'erp-43', 'ERP 43')", [C, T]);
      await c.query(
        "insert into integracao.pedido_fila_erp (id, tenant_id, pedido_uuid, estado, payload_origem, conector_id, aprovado_em) values ($1, $2, gen_random_uuid(), 'enviado', '{}'::jsonb, $3, now())",
        [F, T, C],
      );
      const linha = () => c.query('select id, pedido_uuid, estado, tentativas, updated_at from integracao.pedido_fila_erp where id = $1', [F]).then((r) => r.rows[0]);
      const linhaAntes = await linha();
      expect((await migrarUp(c)).aplicadas).toEqual(desde0043);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col integracao.conector.aceita_cancelamento boolean nn=true');
      expect(depois).toContain('col integracao.pedido_fila_erp.cancelamento_tentativas integer nn=true');
      expect(depois.filter((l) => l.startsWith('pol ') && l.includes('integracao.pedido_fila_erp'))).toEqual(
        antes.filter((l) => l.startsWith('pol ') && l.includes('integracao.pedido_fila_erp')),
      );
      expect((await c.query('select aceita_cancelamento from integracao.conector where id = $1', [C])).rows).toEqual([{ aceita_cancelamento: false }]);
      expect((await c.query('select cancelamento_estado, cancelamento_tentativas from integracao.pedido_fila_erp where id = $1', [F])).rows).toEqual([
        { cancelamento_estado: null, cancelamento_tentativas: 0 },
      ]);
      expect(await linha()).toEqual(linhaAntes);
      await c.query("update integracao.pedido_fila_erp set cancelamento_estado = 'pendente', cancelamento_solicitado_em = now() where id = $1", [F]);
      expect((await migrarDown(c, { passos: desde0043.length })).aplicadas).toEqual([...desde0043].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select estado from integracao.pedido_fila_erp where id = $1', [F])).rows).toEqual([{ estado: 'enviado' }]);
      await c.query(m43.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
