/**
 * T-0002 C2.2 — RN-CORE-05: tenant A não lê dados do tenant B em nenhuma tabela.
 * Cenários S0-024 (leitura) e S0-026 (falha fechada) do plano tests/plano/sprint-0.md.
 *
 * Verificação independente da suíte do banco-dados (db/testes/vazamento.test.ts):
 * - tabelas descobertas pelo pg_catalog (não pelo information_schema);
 * - contagem EXATA: o que o papel da aplicação vê no contexto de X é igual, linha a linha (ids),
 *   ao que o admin vê com `tenant_id = X` — RLS não pode esconder linha própria nem mostrar alheia;
 * - consultas "espertas" (join, subconsulta, agregação, pg_stats) também não vazam.
 * Conexão: papel macuxi_app (sem SUPERUSER/BYPASSRLS, não dono). Fixture: dois-tenants.
 */
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conectar, tabelasDoCatalogo, tentar, type Tabela } from '../apoio/banco';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;

describe.skipIf(semBanco())('S0-024/S0-026 vazamento de leitura entre tenants (papel macuxi_app)', () => {
  let admin: pg.Client;
  let app: pg.Client;
  let tabelas: Tabela[] = [];
  /** ids por tabela e por tenant, lidos como admin (verdade do banco). */
  const ids = new Map<string, { A: string[]; B: string[] }>();

  beforeAll(async () => {
    admin = await conectar(banco().urlAdmin);
    app = await conectar(banco().urlApp);
    tabelas = (await tabelasDoCatalogo(admin)).filter((t) => t.temTenant);
    for (const t of tabelas) {
      const ler = async (tenant: string) =>
        (await admin.query<{ id: string }>(`select id::text as id from ${t.sql} where tenant_id = $1 order by id`, [tenant])).rows.map((x) => x.id);
      ids.set(t.nome, { A: await ler(A), B: await ler(B) });
    }
  });
  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });

  it('pré-condição: conexão é macuxi_app, sem superusuário e sem bypass de RLS', async () => {
    const r = await app.query<{ usuario: string; super: boolean; bypass: boolean }>(
      'select current_user as usuario, r.rolsuper as super, r.rolbypassrls as bypass from pg_roles r where r.rolname = current_user',
    );
    expect(r.rows[0]).toEqual({ usuario: 'macuxi_app', super: false, bypass: false });
  });

  it('pré-condição: há tabelas de plataforma e core, e a fixture tem linha de A e de B em TODAS (senão o teste passaria no vazio)', () => {
    const nomes = tabelas.map((t) => t.nome);
    expect(nomes.some((n) => n.startsWith('plataforma.'))).toBe(true);
    expect(nomes.some((n) => n.startsWith('core.'))).toBe(true);
    const vazias = tabelas.filter((t) => ids.get(t.nome)!.A.length === 0 || ids.get(t.nome)!.B.length === 0).map((t) => t.nome);
    expect(vazias, 'tabelas sem linha de algum tenant na fixture dois-tenants').toEqual([]);
  });

  describe.each([
    ['A', A, 'B'],
    ['B', B, 'A'],
  ] as const)('contexto do tenant %s', (rotulo, tenant, outro) => {
    it(`vê exatamente as próprias linhas (mesmos ids que o admin vê com tenant_id = ${rotulo}) em toda tabela`, async () => {
      for (const t of tabelas) {
        const r = await tentar(app, tenant, async () =>
          (await app.query<{ id: string }>(`select id::text as id from ${t.sql} order by id`)).rows.map((x) => x.id),
        );
        expect(r.ok, t.nome).toBe(true);
        if (r.ok) expect(r.valor, `${t.nome} no contexto ${rotulo}`).toEqual(ids.get(t.nome)![rotulo]);
      }
    });

    it(`não acha nenhuma linha de ${outro} nem pedindo por id, por tenant_id, por join ou por subconsulta`, async () => {
      const outroTenant = outro === 'A' ? A : B;
      for (const t of tabelas) {
        const alheios = ids.get(t.nome)![outro];
        const r = await tentar(app, tenant, async () => {
          const porId = await app.query<{ n: number }>(`select count(*)::int as n from ${t.sql} where id = any($1::uuid[])`, [alheios]);
          const porTenant = await app.query<{ n: number }>(`select count(*)::int as n from ${t.sql} where tenant_id = $1`, [outroTenant]);
          const porJoin = await app.query<{ n: number }>(
            `select count(*)::int as n from unnest($1::uuid[]) as x(id) join ${t.sql} t on t.id = x.id`,
            [alheios],
          );
          const porSub = await app.query<{ n: number }>(
            `select count(*)::int as n from (select tenant_id from ${t.sql}) s where s.tenant_id <> $1`,
            [tenant],
          );
          return porId.rows[0]!.n + porTenant.rows[0]!.n + porJoin.rows[0]!.n + porSub.rows[0]!.n;
        });
        expect(r.ok, t.nome).toBe(true);
        if (r.ok) expect(r.valor, `${t.nome}: linha de ${outro} visível no contexto ${rotulo}`).toBe(0);
      }
    });
  });

  it('plataforma.tenant (exceção sem tenant_id): cada contexto vê só o próprio registro', async () => {
    for (const tenant of [A, B]) {
      const r = await tentar(app, tenant, async () => (await app.query<{ id: string }>('select id::text as id from plataforma.tenant')).rows.map((x) => x.id));
      expect(r).toEqual({ ok: true, valor: [tenant] });
    }
  });

  it('login sem contexto (plataforma.tenant_por_codigo) não lista tenants por curinga nem por código vazio', async () => {
    for (const codigo of ['%', '_%', '', ' ', "' or '1'='1", 'ALFA%']) {
      const r = await app.query('select * from plataforma.tenant_por_codigo($1)', [codigo]);
      expect(r.rowCount, `código ${JSON.stringify(codigo)}`).toBe(0);
    }
    const ok = await app.query<{ id: string }>('select id::text as id from plataforma.tenant_por_codigo($1)', [DOIS_TENANTS.B.codigo]);
    expect(ok.rows.map((x) => x.id)).toEqual([B]);
  });

  it('estatísticas do planejador (pg_stats) não expõem valores das tabelas com RLS, mesmo depois de ANALYZE', async () => {
    await admin.query('analyze');
    const r = await app.query<{ tabela: string }>(
      "select schemaname || '.' || tablename as tabela from pg_stats where schemaname not in ('pg_catalog', 'information_schema') and schemaname not like 'pg\\_%'",
    );
    expect(r.rows.map((x) => x.tabela)).toEqual([]);
  });

  describe('S0-026 falha fechada: sem contexto válido, nenhuma linha (nunca todas)', () => {
    it.each([
      ['sem set_config', null],
      ['contexto vazio', ''],
      ['UUID que não é tenant', '00000000-0000-4000-8000-000000000000'],
    ] as const)('%s => 0 linhas em toda tabela (inclusive plataforma.tenant)', async (_r, ctx) => {
      for (const sql of [...tabelas.map((t) => t.sql), 'plataforma.tenant']) {
        const r = await tentar(app, ctx, async () => (await app.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).rows[0]!.n);
        expect(r, `${sql} com contexto ${JSON.stringify(ctx)}`).toEqual({ ok: true, valor: 0 });
      }
    });

    it.each([
      ['texto qualquer', 'tenant-a'],
      ['espaço', ' '],
      ['dois UUIDs', `${A},${B}`],
      ['injeção', `${A}' or true --`],
    ])('contexto inválido (%s) => erro, nunca linhas', async (_r, ctx) => {
      for (const t of tabelas) {
        const r = await tentar(app, ctx, async () => (await app.query<{ n: number }>(`select count(*)::int as n from ${t.sql}`)).rows[0]!.n);
        expect(r.ok, `${t.nome} com contexto ${JSON.stringify(ctx)}: ${JSON.stringify(r)}`).toBe(false);
      }
    });

    it('contexto de tenant definido numa transação já desfeita não vale na próxima', async () => {
      await tentar(app, A, async () => undefined);
      const r = await app.query<{ ctx: string | null; n: number }>(
        "select nullif(current_setting('app.tenant_id', true), '') as ctx, (select count(*)::int from core.usuario) as n",
      );
      expect(r.rows[0]).toEqual({ ctx: null, n: 0 });
    });
  });
});
