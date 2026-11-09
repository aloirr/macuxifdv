/**
 * T-0033 (pedido R-20261109-124719 do banco-dados) — o isolamento multi-tenant não depende de como o banco de teste nasceu:
 * cópia do banco modelo (`create database … template macuxi_modelo_<chave>`, `db/src/banco-modelo.ts`) ou migrado do zero
 * (`MACUXI_PG_MODELO=0`, o caminho antigo). A suíte de `tests/` roda no modo padrão do ambiente (no CI, Postgres local =
 * modelo ligado); este arquivo força os DOIS modos no mesmo processo e roda, em cada banco, a mesma conferência de RLS:
 *  - BM-01 o modo pedido foi o usado (com o modelo ligado, nenhum aviso "[db] banco modelo indisponível" / "cópia … falhou");
 *  - BM-02 papel `macuxi_app` sem SUPERUSER/BYPASSRLS e a fixture dois-tenants com linha de A e de B em toda tabela com tenant;
 *  - BM-03 no contexto de A (e de B) o app vê EXATAMENTE os ids que o admin vê com `tenant_id` = A (B), em toda tabela;
 *  - BM-04 sem contexto, contexto vazio ou UUID que não é tenant: 0 linhas em toda tabela (falha fechada);
 *  - BM-05 escrita cruzada: no contexto de A, UPDATE/DELETE com `tenant_id` = B não toca nenhuma linha (ou é recusado);
 *          INSERT com o tenant de B é recusado;
 *  - BM-06 os dois bancos têm o mesmo retrato de segurança: RLS e FORCE por tabela, políticas (texto) e GRANTs do `macuxi_app`.
 * A conferência completa de catálogo (funções, migrações) é do banco-dados (`db/testes/banco-modelo.test.ts`). Nenhum teste de
 * `tests/` depende do instante das migrações (`public.macuxi_migracao.aplicada_em`): varredura em docs/testes/T-0033.md.
 * PRECISA DE BANCO: pula sem Postgres (PC sem Docker); no CI roda.
 */
import { carregarDoisTenants, criarBancoDeTeste, DOIS_TENANTS, type BancoDeTeste } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { conectar, tabelasDoCatalogo, tentar, type Tabela } from '../apoio/banco';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;

const MODOS = [
  { rotulo: 'modelo ligado (MACUXI_PG_MODELO=1)', valor: '1' },
  { rotulo: 'modelo desligado (MACUXI_PG_MODELO=0, migrado do zero)', valor: '0' },
] as const;

/** Retrato de segurança de um banco (BM-06), comparado entre os dois modos. */
const retratos = new Map<string, unknown>();

async function retratoDeSeguranca(admin: pg.ClientBase) {
  const rls = await admin.query<{ t: string; rls: boolean; force: boolean }>(`
    select n.nspname || '.' || c.relname as t, c.relrowsecurity as rls, c.relforcerowsecurity as force
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
     order by 1`);
  const politicas = await admin.query<{ p: string }>(`
    select schemaname || '.' || tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' ||
           coalesce(qual, '') || ':' || coalesce(with_check, '') as p
      from pg_policies order by 1`);
  const grants = await admin.query<{ g: string }>(`
    select table_schema || '.' || table_name || ':' || privilege_type as g
      from information_schema.role_table_grants where grantee = 'macuxi_app' order by 1`);
  return { rls: rls.rows, politicas: politicas.rows.map((x) => x.p), grants: grants.rows.map((x) => x.g) };
}

describe.skipIf(semBanco())('T-0033 — RLS e multi-tenant com o banco modelo ligado e desligado', () => {
  describe.each(MODOS)('$rotulo', ({ rotulo, valor }) => {
    let banco: BancoDeTeste;
    let admin: pg.Client;
    let app: pg.Client;
    let tabelas: Tabela[] = [];
    const avisos: string[] = [];
    const ids = new Map<string, { A: string[]; B: string[] }>();

    beforeAll(async () => {
      const anterior = process.env.MACUXI_PG_MODELO;
      const espiao = vi.spyOn(console, 'warn').mockImplementation((...m: unknown[]) => void avisos.push(m.map(String).join(' ')));
      process.env.MACUXI_PG_MODELO = valor;
      try {
        banco = await criarBancoDeTeste({ preparar: (c) => carregarDoisTenants(c).then(() => undefined) });
      } finally {
        if (anterior === undefined) delete process.env.MACUXI_PG_MODELO;
        else process.env.MACUXI_PG_MODELO = anterior;
        espiao.mockRestore();
      }
      admin = await conectar(banco.urlAdmin);
      app = await conectar(banco.urlApp);
      tabelas = (await tabelasDoCatalogo(admin)).filter((t) => t.temTenant);
      for (const t of tabelas) {
        const ler = async (tenant: string) =>
          (await admin.query<{ id: string }>(`select id::text as id from ${t.sql} where tenant_id = $1 order by id`, [tenant])).rows.map((x) => x.id);
        ids.set(t.nome, { A: await ler(A), B: await ler(B) });
      }
      retratos.set(valor, await retratoDeSeguranca(admin));
    });
    afterAll(async () => {
      await app?.end();
      await admin?.end();
      await banco?.apagar().catch(() => undefined);
    });

    it('BM-01 o banco nasceu pelo caminho pedido (com o modelo: sem aviso de modelo indisponível nem de cópia que falhou)', () => {
      const doModelo = avisos.filter((a) => /\[db\] (banco modelo indisponível|cópia do modelo)/.test(a));
      if (valor === '1') expect(doModelo, `${rotulo}: o modelo caiu no caminho antigo`).toEqual([]);
      expect(banco.nome).toMatch(/^macuxi_teste_/);
    });

    it('BM-02 macuxi_app sem SUPERUSER/BYPASSRLS; a fixture tem linha de A e de B em toda tabela com tenant', async () => {
      const r = await app.query<{ usuario: string; super: boolean; bypass: boolean }>(
        'select current_user as usuario, r.rolsuper as super, r.rolbypassrls as bypass from pg_roles r where r.rolname = current_user',
      );
      expect(r.rows[0]).toEqual({ usuario: 'macuxi_app', super: false, bypass: false });
      expect(tabelas.length).toBeGreaterThan(10);
      const vazias = tabelas.filter((t) => ids.get(t.nome)!.A.length === 0 || ids.get(t.nome)!.B.length === 0).map((t) => t.nome);
      expect(vazias, 'tabelas sem linha de algum tenant (o teste passaria no vazio)').toEqual([]);
    });

    it.each([
      ['A', A],
      ['B', B],
    ] as const)('BM-03 contexto de %s: o app vê exatamente as próprias linhas em toda tabela', async (r, tenant) => {
      for (const t of tabelas) {
        const v = await tentar(app, tenant, async () => (await app.query<{ id: string }>(`select id::text as id from ${t.sql} order by id`)).rows.map((x) => x.id));
        expect(v, t.nome).toEqual({ ok: true, valor: ids.get(t.nome)![r] });
      }
    });

    it.each([
      ['sem set_config', null],
      ['contexto vazio', ''],
      ['UUID que não é tenant', '00000000-0000-4000-8000-000000000000'],
    ] as const)('BM-04 %s → 0 linhas em toda tabela (falha fechada)', async (_r, ctx) => {
      for (const sql of [...tabelas.map((t) => t.sql), 'plataforma.tenant']) {
        const v = await tentar(app, ctx, async () => (await app.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).rows[0]!.n);
        expect(v, `${sql} com contexto ${JSON.stringify(ctx)}`).toEqual({ ok: true, valor: 0 });
      }
    });

    it('BM-05 escrita cruzada no contexto de A: UPDATE/DELETE de linha de B tocam 0 linhas (ou são recusados); INSERT com o tenant de B é recusado', async () => {
      for (const t of tabelas) {
        for (const sql of [`update ${t.sql} set tenant_id = tenant_id where tenant_id = $1`, `delete from ${t.sql} where tenant_id = $1`]) {
          const v = await tentar(app, A, async () => (await app.query(sql, [B])).rowCount);
          if (v.ok) expect(v.valor, `${t.nome}: ${sql.split(' ')[0]} tocou linha de B`).toBe(0);
          else expect(v.codigo, `${t.nome}: ${v.mensagem}`).toMatch(/^(42501|23\d{3}|P0001)$/);
        }
      }
      // INSERT com o tenant de B na tabela-raiz do Core (as colunas mínimas): recusado pela política (42501) ou pelo FK/CHECK
      const ins = await tentar(app, A, async () =>
        app.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values (gen_random_uuid(), $1, 'Intrusa Fictícia', 'intrusa.t0033@exemplo.com.br', 'vendedor')", [B]),
      );
      expect(ins.ok, 'INSERT com o tenant de B no contexto de A foi aceito').toBe(false);
    });
  });

  it('BM-06 os dois modos dão o mesmo retrato de segurança (RLS/FORCE por tabela, políticas e GRANTs do macuxi_app)', () => {
    const ligado = retratos.get('1') as { rls: unknown[]; politicas: string[]; grants: string[] } | undefined;
    const desligado = retratos.get('0') as typeof ligado;
    expect(ligado && desligado, 'os dois bancos foram criados').toBeTruthy();
    expect(ligado!.rls).toEqual(desligado!.rls);
    expect(ligado!.politicas).toEqual(desligado!.politicas);
    expect(ligado!.grants).toEqual(desligado!.grants);
    expect(ligado!.politicas.length).toBeGreaterThan(0);
  });
});
