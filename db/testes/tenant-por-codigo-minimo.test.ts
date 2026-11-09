/**
 * 0052 — login sem nome do tenant antes da senha (T-0122 N5; pedido R-20261109-000053-engenheiro-software).
 * O que o BANCO garante: plataforma.tenant_por_codigo(text) devolve só (id, status), SECURITY DEFINER com o search_path da
 * 0012 e EXECUTE só ao macuxi_app; plataforma.tenant_da_sessao() devolve id, codigo, nome e fuso SÓ do tenant da sessão
 * (INVOKER, pela RLS de plataforma.tenant); evento_nome_formato e evento_consumo_consumidor_formato iguais ao EVENTO_RE do SDK
 * (sem hífen). Down volta ao catálogo da 0051.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * Os casos de banco rodam no CI (sem Docker no PC do dono do produto, R-20261105-053835).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENTO_RE } from '@macuxi/platform-sdk';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m52 = migracoes.find((m) => m.versao === '0052')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const REGEX_EVENTO = String.raw`^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@[1-9][0-9]*$`;

describe('0052 tenant_por_codigo mínimo e tenant_da_sessao (estático)', () => {
  it('nome e posição: 0052_plataforma_tenant_por_codigo_minimo logo depois da 0051', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0051_plataforma_perfil_assistente') + 1]).toBe('0052_plataforma_tenant_por_codigo_minimo');
  });

  it('tenant_por_codigo devolve só (id, status), DEFINER com pg_temp por último; tenant_da_sessao INVOKER pelo tenant_atual(); EXECUTE só ao macuxi_app', () => {
    const up = semComentarios(m52.up);
    expect(up).toMatch(/drop function plataforma\.tenant_por_codigo\(text\);\ncreate function plataforma\.tenant_por_codigo\(p_codigo text\)\n {2}returns table \(id uuid, status text\)\n {2}language sql stable security definer\n {2}set search_path = pg_catalog, plataforma, pg_temp/);
    expect(up).not.toMatch(/select t\.id, t\.nome, t\.fuso, t\.status/);
    expect(up).toMatch(/create function plataforma\.tenant_da_sessao\(\)\n {2}returns table \(id uuid, codigo text, nome text, fuso text\)\n {2}language sql stable security invoker\n {2}set search_path = pg_catalog, plataforma, pg_temp/);
    expect(up).toContain('where t.id = plataforma.tenant_atual() and t.deleted_at is null');
    for (const f of ['plataforma.tenant_por_codigo(text)', 'plataforma.tenant_da_sessao()']) {
      expect(up).toContain(`revoke all on function ${f} from public;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_app;`);
    }
    expect([...up.matchAll(/grant ([^;]*);/g)].map((x) => x[1])).toEqual([
      'execute on function plataforma.tenant_por_codigo(text) to macuxi_app',
      'execute on function plataforma.tenant_da_sessao() to macuxi_app',
    ]);
  });

  it('o CHECK do nome do evento é o EVENTO_RE do SDK (sem hífen) e o do consumidor usa o mesmo segmento; NOT VALID + VALIDATE', () => {
    const up = semComentarios(m52.up);
    expect(up).toContain(`check (nome ~ '${REGEX_EVENTO}') not valid;`);
    expect(new RegExp(REGEX_EVENTO).source).toBe(EVENTO_RE.source.replace(/\(([^()]*)\)/g, '$1'));
    expect(up).toContain(String.raw`check (consumidor ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$') not valid;`);
    expect(up).toContain('alter table plataforma.evento validate constraint evento_nome_formato;');
    expect(up).toContain('alter table plataforma.evento_consumo validate constraint evento_consumo_consumidor_formato;');
    for (const nome of ['vendedor.pedido.criado@1', 'integracao.pedido.retorno_erp@1', 'core.cliente_endereco.atualizado@2']) {
      expect(new RegExp(REGEX_EVENTO).test(nome), nome).toBe(EVENTO_RE.test(nome));
    }
    for (const nome of ['meu-modulo.pedido.criado@1', 'vendedor.pedido.criado@0', 'Vendedor.pedido.criado@1']) {
      expect(new RegExp(REGEX_EVENTO).test(nome), nome).toBe(false);
      expect(EVENTO_RE.test(nome), nome).toBe(false);
    }
  });

  it('down volta ao texto da 0001 (com o search_path da 0012) e aos CHECKs com hífen', () => {
    const down = semComentarios(m52.down);
    expect(down).toContain('drop function if exists plataforma.tenant_da_sessao();');
    expect(down).toContain('returns table (id uuid, nome text, fuso text, status text)');
    expect(down).toContain('select t.id, t.nome, t.fuso, t.status');
    expect(down).toContain(String.raw`check (nome ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@[1-9][0-9]*$');`);
    expect(down).toContain(String.raw`check (consumidor ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_-]*)*$');`);
  });
});

describe.skipIf(semBanco())('0052 tenant_por_codigo mínimo e tenant_da_sessao (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });

  it('login sem contexto: tenant_por_codigo só com id e status (nome e fuso não saem antes da senha)', async () => {
    const r = await app.query('select * from plataforma.tenant_por_codigo($1)', ['ALFA']);
    expect(r.rows).toEqual([{ id: A.tenantId, status: 'ativo' }]);
    expect(r.fields.map((f) => f.name)).toEqual(['id', 'status']);
    expect((await erroDe(app.query('select nome from plataforma.tenant_por_codigo($1)', ['alfa'])))?.code).toBe('42703');
  });

  it('tenant_da_sessao: só o tenant da sessão; sem contexto, 0 linhas', async () => {
    for (const t of [A, B]) {
      await emTransacao(app, t.tenantId, async () => {
        const r = await app.query<{ id: string; codigo: string; fuso: string }>('select id, codigo, fuso from plataforma.tenant_da_sessao()');
        expect(r.rows).toEqual([{ id: t.tenantId, codigo: t.codigo, fuso: t.fuso }]);
      });
    }
    await emTransacao(app, null, async () => {
      expect((await app.query('select * from plataforma.tenant_da_sessao()')).rowCount).toBe(0);
    });
  });

  it('evento com hífen no módulo e consumidor com hífen são recusados (23514); os nomes do SDK passam', async () => {
    const e1 = await erroDe(emTransacao(app, A.tenantId, () =>
      app.query("insert into plataforma.evento (tenant_id, nome, modulo) values ($1, 'meu-modulo.pedido.criado@1', 'meu-modulo')", [A.tenantId])));
    expect(e1).toMatchObject({ code: '23514', message: expect.stringContaining('evento_nome_formato') });
    const e2 = await erroDe(emTransacao(app, A.tenantId, async () => {
      const ev = await app.query<{ id: string }>("insert into plataforma.evento (tenant_id, nome, modulo) values ($1, 'vendedor.pedido.criado@1', 'vendedor') returning id", [A.tenantId]);
      await app.query("insert into plataforma.evento_consumo (tenant_id, consumidor, evento_id) values ($1, 'meu-modulo', $2)", [A.tenantId, ev.rows[0]!.id]);
    }));
    expect(e2).toMatchObject({ code: '23514', message: expect.stringContaining('evento_consumo_consumidor_formato') });
  });
});

describe.skipIf(semBanco())('0052 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up troca as 2 funções e os 2 CHECKs; down volta ao catálogo da 0051, idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0051' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0052' })).aplicadas).toEqual(['0052_plataforma_tenant_por_codigo_minimo']);
      const depois = await retratoDoCatalogo(c);
      const nome = (l: string) => l.split(' ').slice(0, 2).join(' ');
      expect(depois.filter((l) => !antes.includes(l)).map(nome).sort()).toEqual([
        'con plataforma.evento_consumo_consumidor_formato',
        'con plataforma.evento_nome_formato',
        'fn plataforma.tenant_da_sessao()',
      ]);
      expect(antes.filter((l) => !depois.includes(l)).map(nome).sort()).toEqual([
        'con plataforma.evento_consumo_consumidor_formato',
        'con plataforma.evento_nome_formato',
      ]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0052_plataforma_tenant_por_codigo_minimo']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m52.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0052' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
