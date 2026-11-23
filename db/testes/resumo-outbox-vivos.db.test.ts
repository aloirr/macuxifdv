/**
 * 0099 — saúde da outbox sem os eventos apagados (v1.0.30; limpeza da AM2808 marcou eventos não publicados com deleted_at e o
 * /v1/saude mostrava "parados" para sempre). Dicionário: docs/banco/plataforma.md (seção evento). O que o BANCO garante:
 * - plataforma.resumo_outbox: evento apagado não conta em pendentes, parados nem mais_antigo_s; evento vivo conta; assinatura,
 *   SECURITY DEFINER, search_path e EXECUTE (só macuxi_app) iguais aos da 0024;
 * - macuxi_worker lê deleted_at de plataforma.evento (filtro do despachante e do reprocessarParados) e continua sem ler
 *   ultimo_erro nem created_at;
 * - up/down: o down volta ao corpo da 0024 e às ACLs da 0098; up de novo igual.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { comoPapel, emTransacao, erroDe, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0099';
const m99 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m99) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const FUNCAO = 'plataforma.resumo_outbox(text[], integer)';

describe('0099 resumo da outbox sem apagados (estático)', () => {
  it('nome e posição: 0099_plataforma_resumo_outbox_vivos logo depois da 0098', () => {
    expect(m99.nome).toBe('plataforma_resumo_outbox_vivos');
    expect(ANTERIOR).toBe('0098');
  });

  it('up: create or replace com o filtro de deleted_at e o SELECT da coluna ao worker; nenhum outro grant, tabela ou política', () => {
    const up = semComentarios(m99.up);
    expect(up).toMatch(/create or replace function plataforma\.resumo_outbox\(p_nomes text\[\], p_max_tentativas integer\)\s+returns table \(pendentes integer, parados integer, mais_antigo_s double precision\)\s+language sql stable security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
    expect(up).toContain('and e.deleted_at is null');
    expect([...up.matchAll(/grant ([^;]+);/g)].map((g) => g[1])).toEqual(['select (deleted_at) on plataforma.evento to macuxi_worker']);
    expect(up).not.toMatch(/create table|alter table|create policy|alter policy|revoke/);
  });

  it('down: revoga o SELECT e volta ao corpo da 0024 (sem o filtro)', () => {
    const down = semComentarios(m99.down);
    const m24 = migracoes.find((m) => m.versao === '0024')!;
    expect(down).toContain('revoke select (deleted_at) on plataforma.evento from macuxi_worker;');
    expect(down).not.toContain('deleted_at is null');
    const corpo = (sql: string) => sql.slice(sql.indexOf('as $$'), sql.indexOf('$$;') + 3).replace(/\s+/g, ' ');
    expect(corpo(down)).toBe(corpo(semComentarios(m24.up)));
  });
});

describe.skipIf(semBanco())('0099 resumo da outbox sem apagados (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });
  const NOME = 'core.teste_resumo_vivos.criado@1';
  const inserirEvento = (tenant: string, segundos: number, tentativas: number, apagado: boolean) =>
    admin.query(
      `insert into plataforma.evento (tenant_id, nome, modulo, ocorrido_em, tentativas, deleted_at)
       values ($1, $2, 'core', now() - make_interval(secs => $3), $4, case when $5 then now() end)`,
      [tenant, NOME, segundos, tentativas, apagado],
    );
  const resumo = () =>
    comoPapel<{ pendentes: number; parados: number; mais_antigo_s: number | null }>(
      admin, 'macuxi_app', 'select pendentes, parados, mais_antigo_s from plataforma.resumo_outbox($1::text[], 5)', [[NOME]],
    );

  it('evento apagado não conta em pendentes, parados nem no mais antigo; evento vivo conta', async () => {
    await emTransacao(admin, null, async () => {
      await inserirEvento(A.tenantId, 3600, 0, true); // pendente apagado (o mais antigo, mas fora)
      await inserirEvento(B.tenantId, 7200, 5, true); // parado apagado
      await inserirEvento(B.tenantId, 7200, 9, true); // parado apagado
      expect((await resumo()).rows).toEqual([{ pendentes: 0, parados: 0, mais_antigo_s: null }]);
      await inserirEvento(A.tenantId, 120, 1, false); // pendente vivo
      await inserirEvento(B.tenantId, 600, 5, false); // parado vivo
      const r = (await resumo()).rows[0]!;
      expect(r.pendentes).toBe(1);
      expect(r.parados).toBe(1);
      expect(r.mais_antigo_s).toBeGreaterThanOrEqual(119);
      expect(r.mais_antigo_s).toBeLessThan(3600);
    });
  });

  it('macuxi_worker lê deleted_at da outbox (filtro do despacho e do reprocessarParados); ultimo_erro e created_at continuam fora', async () => {
    await emTransacao(admin, null, async () => {
      await inserirEvento(A.tenantId, 60, 0, true);
      await inserirEvento(A.tenantId, 60, 0, false);
      await inserirEvento(B.tenantId, 60, 5, false);
      const vivos = await comoPapel<{ n: number }>(
        admin, 'macuxi_worker',
        'select count(*)::int as n from plataforma.evento where nome = $1 and publicado_em is null and deleted_at is null', [NOME],
      );
      expect(vivos.rows[0]!.n).toBe(2);
      const parados = await comoPapel(
        admin, 'macuxi_worker',
        'update plataforma.evento set tentativas = 0 where nome = $1 and publicado_em is null and deleted_at is null and tentativas >= 5', [NOME],
      );
      expect(parados.rowCount).toBe(1);
      for (const coluna of ['ultimo_erro', 'created_at']) {
        const e = await erroDe(comoPapel(admin, 'macuxi_worker', `select ${coluna} from plataforma.evento limit 1`));
        expect(e?.code, coluna).toBe('42501');
      }
    });
  });

  it('resumo_outbox continua só do macuxi_app: worker não executa', async () => {
    await emTransacao(admin, null, async () => {
      const e = await erroDe(comoPapel(admin, 'macuxi_worker', "select * from plataforma.resumo_outbox(array['x.y.z@1'], 5)"));
      expect(e?.code).toBe('42501');
    });
  });
});

describe.skipIf(semBanco())('0099 resumo da outbox sem apagados (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  const ESTADO = `
    select pg_get_functiondef(p.oid) as def, p.proacl::text as acl, p.prosecdef as definer, p.proconfig::text as config,
           has_column_privilege('macuxi_worker', 'plataforma.evento', 'deleted_at', 'SELECT') as worker_deleted_at
      from pg_proc p where p.oid = '${FUNCAO}'::regprocedure`;

  it('up filtra os apagados e dá o SELECT ao worker; down volta à 0098; up de novo igual', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      const estadoAntes = (await c.query(ESTADO)).rows[0];
      expect(estadoAntes.worker_deleted_at).toBe(false);
      expect(estadoAntes.def).not.toContain('deleted_at is null');

      expect((await migrarUp(c)).aplicadas).toEqual([`${VERSAO}_${m99.nome}`]);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toEqual(antes); // nenhum objeto novo: só o corpo da função e o grant
      const estadoDepois = (await c.query(ESTADO)).rows[0];
      expect(estadoDepois.worker_deleted_at).toBe(true);
      expect(estadoDepois.def).toContain('deleted_at is null');
      expect([estadoDepois.acl, estadoDepois.definer, estadoDepois.config]).toEqual([estadoAntes.acl, estadoAntes.definer, estadoAntes.config]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${VERSAO}_${m99.nome}`]);
      expect((await c.query(ESTADO)).rows[0]).toEqual(estadoAntes);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m99.down); // idempotente
      expect((await c.query(ESTADO)).rows[0]).toEqual(estadoAntes);

      await migrarUp(c);
      expect((await c.query(ESTADO)).rows[0]).toEqual(estadoDepois);
    });
  });
});
