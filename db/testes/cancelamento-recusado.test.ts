/**
 * 0048 — o ERP recusa o cancelamento pedido pelo Hub (T-0114; pedido R-20261108-095741-modulo-integracao; RN-INT-08/RN-VEN-31).
 * O que o BANCO garante em integracao.pedido_fila_erp: cancelamento_recusado_em timestamptz e cancelamento_recusa_motivo text
 * (1..300 sem só espaços), estado 'recusado' no CHECK do estado e o CHECK de coerência (as regras da 0043 + 'recusado' => os dois
 * preenchidos; os dois andam juntos; preenchidos só em 'recusado' ou 'confirmado') e o índice parcial do monitor; sem política
 * nem grant novo (RLS e update do macuxi_app herdados). Down volta ao catálogo da 0047 ('recusado' vira 'enviado').
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * Os casos de banco rodam no CI (sem Docker no PC do dono do produto, R-20261105-053835).
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EstadoCancelamento } from '../../modules/integracao/domain/cancelamento';
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
const m48 = migracoes.find((m) => m.versao === '0048')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const COLUNAS = ['cancelamento_recusado_em', 'cancelamento_recusa_motivo'];
/** ocorrido_em do retorno do ERP: só gravado e lido de volta, nunca comparado ao relógio do banco. */
const OCORRIDO_EM = '2026-11-08T14:05:00.000Z'; // hora-fixa-ok: instante informado pelo ERP, ida e volta sem comparação com now()

// o espelho do CHECK é exatamente o EstadoCancelamento do domain da Integração (falha no typecheck se divergir)
type Espelho = (typeof nuvemIntegracao.ESTADOS_CANCELAMENTO_BANCO)[number];
const _domainNoEspelho: Espelho[] = [] as EstadoCancelamento[];
const _espelhoNoDomain: EstadoCancelamento[] = [] as Espelho[];
void _domainNoEspelho;
void _espelhoNoDomain;

describe('0048 cancelamento recusado pelo ERP (estático)', () => {
  it('nome e posição: 0048_integracao_cancelamento_recusado logo depois da 0047', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0047_plataforma_portal_admin_multiperfil') + 1]).toBe('0048_integracao_cancelamento_recusado');
  });

  it('só 2 colunas, 3 CHECKs (2 trocados) e 1 índice em integracao.pedido_fila_erp: sem tabela, política, grant, backfill nem outro schema', () => {
    const sql = semComentarios(m48.up);
    expect(sql).toContain('alter table integracao.pedido_fila_erp add column cancelamento_recusado_em timestamptz;');
    expect(sql).toContain('alter table integracao.pedido_fila_erp add column cancelamento_recusa_motivo text;');
    expect([...sql.matchAll(/add column ([a-z_]+)/g)].map((x) => x[1])).toEqual(COLUNAS);
    expect([...sql.matchAll(/drop constraint ([a-z_]+)/g)].map((x) => x[1])).toEqual([
      'pedido_fila_erp_cancelamento_estado_valido',
      'pedido_fila_erp_cancelamento_coerente',
    ]);
    expect([...sql.matchAll(/add constraint ([a-z_]+)/g)].map((x) => x[1])).toEqual([
      'pedido_fila_erp_cancelamento_estado_valido',
      'pedido_fila_erp_cancelamento_recusa_motivo_tamanho',
      'pedido_fila_erp_cancelamento_coerente',
    ]);
    expect([...sql.matchAll(/create (?:unique )?index ([a-z_]+)/g)].map((x) => x[1])).toEqual(['pedido_fila_erp_cancelamento_recusado_ix']);
    expect(sql).toContain("(tenant_id, cancelamento_recusado_em desc)\n  where cancelamento_estado = 'recusado' and deleted_at is null;");
    expect(sql).not.toMatch(/create table|create policy|grant |revoke |update |delete from|insert into|drop column/);
    expect(new Set([...sql.matchAll(/\b([a-z_]+)\.[a-z_]+/g)].map((x) => x[1]))).toEqual(new Set(['integracao']));
    expect(new Set([...sql.matchAll(/alter table ([a-z_]+\.[a-z_]+)/g)].map((x) => x[1]))).toEqual(new Set(['integracao.pedido_fila_erp']));
  });

  it("o CHECK do estado = espelho Drizzle (ESTADOS_CANCELAMENTO_BANCO) com 'recusado'; o motivo da recusa vai a 300, como o pedido", () => {
    const sql = semComentarios(m48.up);
    const lista = nuvemIntegracao.ESTADOS_CANCELAMENTO_BANCO.map((e) => `'${e}'`).join(', ');
    expect(lista).toBe("'pendente', 'enviado', 'confirmado', 'recusado'");
    expect(sql).toContain(`cancelamento_estado in (${lista})`);
    expect(sql).toContain("btrim(cancelamento_recusa_motivo) <> '' and char_length(cancelamento_recusa_motivo) <= 300");
  });

  it('o CHECK de coerência novo mantém as 2 regras da 0043, letra por letra', () => {
    const m43 = migracoes.find((m) => m.versao === '0043')!;
    const regras43 = /add constraint pedido_fila_erp_cancelamento_coerente\s+check \(([\s\S]*?)\);/.exec(semComentarios(m43.up))![1]!;
    const regras48 = /add constraint pedido_fila_erp_cancelamento_coerente\s+check \(([\s\S]*?)\);/.exec(semComentarios(m48.up))![1]!;
    expect(regras48.startsWith(regras43)).toBe(true);
    // o down recria os 2 CHECKs da 0043 com o mesmo texto
    const down = semComentarios(m48.down);
    expect(down).toContain(`check (${regras43});`);
    expect(down).toContain("check (cancelamento_estado is null or cancelamento_estado in ('pendente', 'enviado', 'confirmado'));");
  });

  it("down desfaz tudo o que o up cria (idempotente; CHECKs antes do update, 'recusado' volta a 'enviado' antes de apagar as colunas)", () => {
    const down = semComentarios(m48.down);
    expect(down).toContain('drop index if exists integracao.pedido_fila_erp_cancelamento_recusado_ix;');
    for (const k of ['coerente', 'recusa_motivo_tamanho', 'estado_valido']) {
      expect(down).toContain(`drop constraint if exists pedido_fila_erp_cancelamento_${k};`);
    }
    for (const c of COLUNAS) expect(down).toContain(`drop column if exists ${c}`);
    expect(down).not.toMatch(/drop column (?!if exists)|drop constraint (?!if exists)|drop index (?!if exists)/);
    const iUpdate = down.indexOf("set cancelamento_estado = 'enviado'");
    expect(iUpdate).toBeGreaterThan(down.lastIndexOf('drop constraint'));
    expect(iUpdate).toBeLessThan(down.indexOf('drop column'));
    expect(down.indexOf('drop column')).toBeLessThan(down.indexOf('add constraint'));
    expect(down).toContain("where cancelamento_estado = 'recusado';");
  });

  it('espelho Drizzle: as 2 colunas da recusa, nulas, com os tipos do SQL', () => {
    const cols = getTableConfig(nuvemIntegracao.pedidoFilaErp).columns;
    expect(COLUNAS.map((n) => {
      const c = cols.find((x) => x.name === n);
      return [n, c?.getSQLType(), c?.notNull];
    })).toEqual([
      ['cancelamento_recusado_em', 'timestamp with time zone', false],
      ['cancelamento_recusa_motivo', 'text', false],
    ]);
  });
});

describe.skipIf(semBanco())('0048 cancelamento recusado pelo ERP (banco, papel de aplicação)', () => {
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
  /** Linha já com o cancelamento entregue ao Conector ('enviado'), como o poll deixa. */
  const enviado = () =>
    marcar("cancelamento_estado = 'enviado', cancelamento_motivo = 'Cliente desistiu', cancelamento_solicitado_em = now(), cancelamento_enviado_em = now(), cancelamento_tentativas = 1");
  /** O update exato de retornoPedido (modules/integracao/api/rotas-pedidos.ts) para o retorno `cancelamento_recusado`. */
  const recusar = (tenant: string, motivo: string, quando: string) =>
    q(
      `update integracao.pedido_fila_erp set cancelamento_estado = 'recusado', cancelamento_recusa_motivo = $3, cancelamento_recusado_em = $4::timestamptz, conector_id = $5
        where tenant_id = $1 and pedido_uuid = $2`,
      [tenant, A.pedidos.p3, motivo, quando, A.integracao.conector],
    );
  /** A consulta exata do monitor (modules/integracao/api/bko-monitor.ts). */
  const monitor = (tenant: string) =>
    q<{ pedido_uuid: string; numero_erp: string | null; cancelamento_recusa_motivo: string }>(
      `select pedido_uuid, numero_erp, cancelamento_recusa_motivo from integracao.pedido_fila_erp
          where tenant_id = $1 and deleted_at is null and cancelamento_estado = 'recusado' and estado <> 'cancelado'
          order by cancelamento_recusado_em desc limit 1000`,
      [tenant],
    );

  it('fixture: filas de A e B sem recusa (as 2 colunas nulas)', async () => {
    for (const t of [A, B]) {
      await emTransacao(app, t.tenantId, async () => {
        expect((await q(`select ${COLUNAS.join(', ')} from integracao.pedido_fila_erp`)).rows).toEqual([
          { cancelamento_recusado_em: null, cancelamento_recusa_motivo: null },
        ]);
      });
    }
  });

  it("a recusa grava (update do Hub): 'recusado' com motivo de 1 e de 300 e a hora do ERP; o monitor acha; o cancelado posterior confirma e guarda a recusa", async () => {
    expect(await codigo(A.tenantId, async () => {
      await enviado();
      expect((await recusar(A.tenantId, 'é'.repeat(300), OCORRIDO_EM)).rowCount).toBe(1);
      expect((await recusar(A.tenantId, 'X', OCORRIDO_EM)).rowCount).toBe(1);
      expect((await recusar(A.tenantId, 'Pedido já faturado no ERP', OCORRIDO_EM)).rowCount).toBe(1);
      expect((await q('select cancelamento_estado, cancelamento_recusa_motivo, cancelamento_recusado_em, estado from integracao.pedido_fila_erp where id = $1', [FILA_A])).rows).toEqual([
        { cancelamento_estado: 'recusado', cancelamento_recusa_motivo: 'Pedido já faturado no ERP', cancelamento_recusado_em: new Date(OCORRIDO_EM), estado: 'faturado_parcial' },
      ]);
      expect((await monitor(A.tenantId)).rows).toEqual([{ pedido_uuid: A.pedidos.p3, numero_erp: 'PV1003', cancelamento_recusa_motivo: 'Pedido já faturado no ERP' }]);
      // o poll não leva de novo a recusa ao Conector
      expect((await q(`select 1 from integracao.pedido_fila_erp where tenant_id = $1 and cancelamento_estado in ('pendente', 'enviado')`, [A.tenantId])).rowCount).toBe(0);
      // retorno `cancelado` posterior (update de retornoPedido): confirma, a recusa fica de histórico e sai do monitor
      await marcar("estado = 'cancelado', cancelamento_estado = case when cancelamento_estado is not null then 'confirmado' else cancelamento_estado end");
      expect((await q('select cancelamento_estado, cancelamento_recusa_motivo from integracao.pedido_fila_erp where id = $1', [FILA_A])).rows).toEqual([
        { cancelamento_estado: 'confirmado', cancelamento_recusa_motivo: 'Pedido já faturado no ERP' },
      ]);
      expect((await monitor(A.tenantId)).rows).toEqual([]);
    })).toBeUndefined();
  });

  it.each([
    ["cancelamento_estado = 'recusou', cancelamento_solicitado_em = now()", 'pedido_fila_erp_cancelamento_estado_valido'],
    ["cancelamento_estado = 'recusado', cancelamento_recusa_motivo = '', cancelamento_recusado_em = now()", 'pedido_fila_erp_cancelamento_recusa_motivo_tamanho'],
    ["cancelamento_estado = 'recusado', cancelamento_recusa_motivo = '   ', cancelamento_recusado_em = now()", 'pedido_fila_erp_cancelamento_recusa_motivo_tamanho'],
    ["cancelamento_estado = 'recusado', cancelamento_recusa_motivo = repeat('x', 301), cancelamento_recusado_em = now()", 'pedido_fila_erp_cancelamento_recusa_motivo_tamanho'],
    // 'recusado' sem os dois campos
    ["cancelamento_estado = 'recusado'", 'pedido_fila_erp_cancelamento_coerente'],
    ["cancelamento_estado = 'recusado', cancelamento_recusado_em = now()", 'pedido_fila_erp_cancelamento_coerente'],
    ["cancelamento_estado = 'recusado', cancelamento_recusa_motivo = 'Faturado'", 'pedido_fila_erp_cancelamento_coerente'],
    // recusa fora de 'recusado'/'confirmado'
    ["cancelamento_estado = 'enviado', cancelamento_recusa_motivo = 'Faturado', cancelamento_recusado_em = now()", 'pedido_fila_erp_cancelamento_coerente'],
    ["cancelamento_estado = 'pendente', cancelamento_recusa_motivo = 'Faturado', cancelamento_recusado_em = now()", 'pedido_fila_erp_cancelamento_coerente'],
    ["cancelamento_estado = null, cancelamento_solicitado_em = null, cancelamento_recusa_motivo = 'Faturado', cancelamento_recusado_em = now()", 'pedido_fila_erp_cancelamento_coerente'],
    // as regras da 0043 continuam
    ["cancelamento_estado = 'enviado', cancelamento_enviado_em = null", 'pedido_fila_erp_cancelamento_coerente'],
    ['cancelamento_solicitado_em = null', 'pedido_fila_erp_cancelamento_coerente'],
  ])('CHECK recusa: %s', async (campos, restricao) => {
    const e = await erroDe(emTransacao(app, A.tenantId, async () => {
      await enviado();
      await marcar(campos);
    }));
    expect(e).toMatchObject({ code: '23514', message: expect.stringContaining(restricao) });
  });

  it('vazamento entre tenants: B não grava recusa no pedido de A nem vê o alerta de A', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await enviado();
      await recusar(A.tenantId, 'Pedido já faturado no ERP', OCORRIDO_EM);
      expect((await monitor(A.tenantId)).rowCount).toBe(1);
    });
    // B não enxerga a linha de A: nem o update do Hub nem o monitor com o id de A acham algo
    await emTransacao(app, B.tenantId, async () => {
      expect((await recusar(A.tenantId, 'x', OCORRIDO_EM)).rowCount).toBe(0);
      expect((await marcar("cancelamento_recusa_motivo = 'x', cancelamento_recusado_em = now()")).rowCount).toBe(0);
      expect((await monitor(A.tenantId)).rows).toEqual([]);
      expect((await q('select cancelamento_recusa_motivo from integracao.pedido_fila_erp')).rows).toEqual([{ cancelamento_recusa_motivo: null }]);
    });
    await emTransacao(app, A.tenantId, async () => {
      expect((await q('select cancelamento_estado, cancelamento_recusa_motivo from integracao.pedido_fila_erp where id = $1', [FILA_A])).rows).toEqual([
        { cancelamento_estado: null, cancelamento_recusa_motivo: null },
      ]);
    });
  });

  it('INSERT de B com recusa e tenant_id de A é barrado pela política (WITH CHECK)', async () => {
    const e = await erroDe(emTransacao(app, B.tenantId, () =>
      q(
        `insert into integracao.pedido_fila_erp (tenant_id, pedido_uuid, estado, payload_origem, conector_id, aprovado_em,
           cancelamento_estado, cancelamento_motivo, cancelamento_solicitado_em, cancelamento_enviado_em, cancelamento_recusado_em, cancelamento_recusa_motivo)
         values ($1, gen_random_uuid(), 'enviado', '{}'::jsonb, $2, now(), 'recusado', 'm', now(), now(), now(), 'Faturado')`,
        [A.tenantId, A.integracao.conector],
      )));
    expect(e?.code).toBe('42501');
  });

  it('monitor usa o índice parcial pedido_fila_erp_cancelamento_recusado_ix', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await q('set local enable_seqscan = off');
      const plano = await q<{ 'QUERY PLAN': string }>(
        `explain select pedido_uuid, numero_erp, cancelamento_recusa_motivo from integracao.pedido_fila_erp
          where tenant_id = '${A.tenantId}' and deleted_at is null and cancelamento_estado = 'recusado' and estado <> 'cancelado'
          order by cancelamento_recusado_em desc limit 1000`,
      );
      expect(plano.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('pedido_fila_erp_cancelamento_recusado_ix');
    });
  });
});

describe.skipIf(semBanco())('0048 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000048';
  const C = 'cccccccc-0048-4000-8000-000000000001';
  const F_RECUSADO = 'cccccccc-0048-4000-8000-000000000002';
  const F_CONFIRMADO = 'cccccccc-0048-4000-8000-000000000003';
  const F_ANTIGA = 'cccccccc-0048-4000-8000-000000000004';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it("linhas da 0047 ficam intactas; recusa grava; down volta ao catálogo da 0047 ('recusado' → 'enviado', confirmado fica), idempotente; up de novo igual", async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0047' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo48', 'Antigo')", [T]);
      await c.query("insert into integracao.conector (id, tenant_id, identificador, nome, aceita_cancelamento) values ($1, $2, 'erp-48', 'ERP 48', true)", [C, T]);
      const inserir = (id: string, estado: string | null) =>
        c.query(
          `insert into integracao.pedido_fila_erp (id, tenant_id, pedido_uuid, estado, payload_origem, conector_id, aprovado_em,
             cancelamento_estado, cancelamento_motivo, cancelamento_solicitado_em, cancelamento_enviado_em, cancelamento_tentativas)
           values ($1, $2, gen_random_uuid(), 'enviado', '{}'::jsonb, $3, now(), $4, case when $4::text is null then null else 'Cliente desistiu' end,
                   case when $4::text is null then null else now() end, case when $4::text is null then null else now() end, case when $4::text is null then 0 else 1 end)`,
          [id, T, C, estado],
        );
      await inserir(F_RECUSADO, 'enviado');
      await inserir(F_CONFIRMADO, 'enviado');
      await inserir(F_ANTIGA, null);
      const linha = (id: string) => c.query('select * from integracao.pedido_fila_erp where id = $1', [id]).then((r) => r.rows[0]);
      const antiga = await linha(F_ANTIGA);

      expect((await migrarUp(c, { ate: '0048' })).aplicadas).toEqual(['0048_integracao_cancelamento_recusado']);
      const depois = await retratoDoCatalogo(c);
      const novas = depois.filter((l) => !antes.includes(l));
      expect(novas.filter((l) => !l.startsWith('con ')).sort()).toEqual([
        'col integracao.pedido_fila_erp.cancelamento_recusa_motivo text nn=false',
        'col integracao.pedido_fila_erp.cancelamento_recusado_em timestamp with time zone nn=false',
        expect.stringMatching(/^idx integracao CREATE INDEX pedido_fila_erp_cancelamento_recusado_ix ON integracao\.pedido_fila_erp .*\(tenant_id, cancelamento_recusado_em DESC\) WHERE .*recusado/),
      ]);
      // CHECKs: 2 trocados (estado_valido e coerente) e 1 novo (recusa_motivo_tamanho); nenhum outro muda
      const nome = (l: string) => l.split(' ')[1];
      expect(novas.filter((l) => l.startsWith('con ')).map(nome).sort()).toEqual([
        'integracao.pedido_fila_erp_cancelamento_coerente',
        'integracao.pedido_fila_erp_cancelamento_estado_valido',
        'integracao.pedido_fila_erp_cancelamento_recusa_motivo_tamanho',
      ]);
      expect(antes.filter((l) => !depois.includes(l)).map(nome).sort()).toEqual([
        'integracao.pedido_fila_erp_cancelamento_coerente',
        'integracao.pedido_fila_erp_cancelamento_estado_valido',
      ]);
      expect(depois.filter((l) => l.startsWith('pol ') || l.startsWith('rel integracao.pedido_fila_erp '))).toEqual(
        antes.filter((l) => l.startsWith('pol ') || l.startsWith('rel integracao.pedido_fila_erp ')),
      );
      expect(await linha(F_ANTIGA)).toEqual({ ...antiga, cancelamento_recusado_em: null, cancelamento_recusa_motivo: null });

      await c.query(
        "update integracao.pedido_fila_erp set cancelamento_estado = 'recusado', cancelamento_recusa_motivo = 'Faturado no ERP', cancelamento_recusado_em = now() where id = any($1::uuid[])",
        [[F_RECUSADO, F_CONFIRMADO]],
      );
      await c.query("update integracao.pedido_fila_erp set estado = 'cancelado', cancelamento_estado = 'confirmado' where id = $1", [F_CONFIRMADO]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0048_integracao_cancelamento_recusado']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      const estados = await c.query('select id, estado, cancelamento_estado, (cancelamento_enviado_em is not null) as enviado from integracao.pedido_fila_erp where tenant_id = $1 order by id', [T]);
      expect(estados.rows).toEqual([
        { id: F_RECUSADO, estado: 'enviado', cancelamento_estado: 'enviado', enviado: true },
        { id: F_CONFIRMADO, estado: 'cancelado', cancelamento_estado: 'confirmado', enviado: true },
        { id: F_ANTIGA, estado: 'enviado', cancelamento_estado: null, enviado: false },
      ]);
      expect(await linha(F_ANTIGA)).toEqual(antiga);
      await c.query(m48.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);

      await migrarUp(c, { ate: '0048' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
