/**
 * 0028 — core.plano_rv (T-0082, RN-CORE-29/30; pedido R-20261105-060422-engenheiro-software; desenho T-0082 §5). O que o
 * BANCO garante:
 * - campos da regra 5, RLS enable + force + isolamento_tenant (A não vê nem grava no B; sem contexto = 0 linhas);
 * - um plano vivo por (tenant, mês de início): o soft delete libera o mês; vigência 'AAAA-MM', perfis ⊆ {vendedor,
 *   promotor} não vazio e sem nulo, valor máximo > 0, regras = array JSON (o formato é do domain/API), nome 1..80;
 * - atualizado_por do PRÓPRIO tenant (FK composta para core.usuario);
 * - macuxi_app com select/insert/update/delete; macuxi_worker sem acesso; down apaga só a tabela (catálogo da 0027).
 * Banco: fixture dois-tenants, sempre com ROLLBACK (admin); up/down num banco efêmero. Nada roda em base real.
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INDICADORES_RV, RegraRvSchema } from '../../modules/core/contracts/plano-rv';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { idUsuarioDemo, TENANT_DEMO } from '../seeds/demo/demo';
import { dadosDemoPlanoRv, ID_PLANO_RV_DEMO, REGRAS_PLANO_RV_DEMO } from '../seeds/demo/plano-rv';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m28 = migracoes.find((m) => m.versao === '0028')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

/** Regras do plano da demo (formato RegraRvSchema): venda 50%, positivação 30%, visitas 20%, cobertura como gatilho. */
const REGRAS = [
  { indicador: 'venda_cents', peso_pct: 50, gatilho: false, faixas: [
    { de_pct: 0, modo: 'zero', pagamento_pct: 0 }, { de_pct: 80, modo: 'proporcional', pagamento_pct: 0 },
    { de_pct: 100, modo: 'fixo', pagamento_pct: 100 }, { de_pct: 110, modo: 'fixo', pagamento_pct: 120 },
  ] },
  { indicador: 'positivacao', peso_pct: 30, gatilho: false, faixas: [{ de_pct: 0, modo: 'proporcional', pagamento_pct: 0 }] },
  { indicador: 'visitas', peso_pct: 20, gatilho: false, faixas: [{ de_pct: 0, modo: 'proporcional', pagamento_pct: 0 }] },
  { indicador: 'cobertura_pct', peso_pct: 0, gatilho: true, faixas: [] },
];

describe('0028 core.plano_rv (estático)', () => {
  it('nome e posição: 0028_core_plano_rv logo depois da 0027', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0027_plataforma_tenants_ativos') + 1]).toBe('0028_core_plano_rv');
  });

  it('colunas, CHECKs, FK composta, índices, gatilho, RLS forçado e grants', () => {
    const sql = semComentarios(m28.up);
    for (const trecho of [
      'create table if not exists core.plano_rv (',
      'tenant_id           uuid not null references plataforma.tenant (id)',
      'vigencia_inicio     text not null',
      'perfis              text[] not null',
      'valor_maximo_cents  bigint not null',
      'regras              jsonb not null',
      'atualizado_por      uuid,',
      'constraint plano_rv_atualizado_por_fk foreign key (tenant_id, atualizado_por) references core.usuario (tenant_id, id)',
      "constraint plano_rv_vigencia_formato check (vigencia_inicio ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')",
      "and perfis <@ array['vendedor', 'promotor']::text[]",
      'constraint plano_rv_valor_maximo_positivo check (valor_maximo_cents > 0)',
      "constraint plano_rv_regras_array check (jsonb_typeof(regras) = 'array')",
      'create unique index if not exists plano_rv_vigencia_uk on core.plano_rv (tenant_id, vigencia_inicio) where deleted_at is null;',
      'create index if not exists plano_rv_sync_ix on core.plano_rv (tenant_id, updated_at, id);',
      'drop trigger if exists plano_rv_updated_at on core.plano_rv;',
      'alter table core.plano_rv enable row level security;',
      'alter table core.plano_rv force row level security;',
      'drop policy if exists isolamento_tenant on core.plano_rv;',
      'grant select, insert, update, delete on core.plano_rv to macuxi_app;',
    ]) expect(sql).toContain(trecho);
    expect(sql).not.toMatch(/macuxi_worker|security definer|create function/);
  });

  it('down apaga só a tabela (if exists)', () => {
    expect(semComentarios(m28.down).trim()).toBe('drop table if exists core.plano_rv;');
  });

  it('seed da demo: vendedor, R$ 2.000,00, mês do "hoje", pesos dos não-gatilho somam 100, faixas começam em 0, cobertura gatilho', () => {
    const l = dadosDemoPlanoRv({ tenantId: TENANT_DEMO, hoje: '2030-03-15', atualizadoPor: idUsuarioDemo('analista') });
    expect(l).toMatchObject({ id: ID_PLANO_RV_DEMO, tenant_id: TENANT_DEMO, vigencia_inicio: '2030-03', perfis: '{vendedor}', valor_maximo_cents: 200_000 });
    const regras = REGRAS_PLANO_RV_DEMO;
    // o plano de RV usa os indicadores do contrato (INDICADORES_RV): itens_por_pedido (T-0170) é só meta
    expect(regras.map((r) => r.indicador).sort()).toEqual([...INDICADORES_RV].sort());
    for (const r of regras) expect(RegraRvSchema.safeParse(r).success).toBe(true);
    expect(regras.filter((r) => !r.gatilho).reduce((s, r) => s + r.peso_pct, 0)).toBe(100);
    for (const r of regras.filter((x) => !x.gatilho)) expect(r.faixas[0]).toEqual({ de_pct: 0, modo: 'zero', pagamento_pct: 0 });
    expect(regras.filter((r) => r.gatilho).map((r) => [r.indicador, r.peso_pct])).toEqual([['cobertura_pct', 0]]);
  });

  it('Drizzle: perfis do plano (PERFIS_PLANO_RV_BANCO) iguais ao CHECK plano_rv_perfis_validos e ao contrato', () => {
    expect([...nuvemCore.PERFIS_PLANO_RV_BANCO]).toEqual(['vendedor', 'promotor']);
  });
});

describe.skipIf(semBanco())('0028 core.plano_rv (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });
  const codigo = async (contexto: string | null, fn: () => Promise<unknown>) => (await erroDe(emTransacao(admin, contexto, fn)))?.code;
  const comoApp = () => admin.query('set local role macuxi_app');
  const inserir = (tenant: string, v: Partial<Record<'vigencia_inicio' | 'perfis' | 'valor_maximo_cents' | 'regras' | 'nome' | 'atualizado_por', unknown>> = {}) =>
    admin.query<{ id: string }>(
      `insert into core.plano_rv (id, tenant_id, nome, vigencia_inicio, perfis, valor_maximo_cents, regras, atualizado_por)
       values ($1, $2, $3, $4, $5::text[], $6, $7::jsonb, $8) returning id`,
      [
        crypto.randomUUID(), tenant, v.nome ?? 'Plano padrão', v.vigencia_inicio ?? '2030-01', v.perfis ?? ['vendedor'],
        v.valor_maximo_cents ?? 200_000, JSON.stringify(v.regras ?? REGRAS), v.atualizado_por ?? null,
      ],
    );

  it('app no tenant A grava e lê o próprio plano; B e sem contexto não veem; regras voltam como gravadas', async () => {
    await emTransacao(admin, A.tenantId, async () => {
      await comoApp();
      const { rows: [p] } = await inserir(A.tenantId, { atualizado_por: A.usuarios.analista, perfis: ['vendedor', 'promotor'] });
      const r = await admin.query('select perfis, valor_maximo_cents::int as v, regras, atualizado_por from core.plano_rv where id = $1', [p!.id]);
      expect(r.rows).toEqual([{ perfis: ['vendedor', 'promotor'], v: 200_000, regras: REGRAS, atualizado_por: A.usuarios.analista }]);
      await admin.query("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
      expect((await admin.query('select id from core.plano_rv where id = $1', [p!.id])).rowCount).toBe(0);
      await admin.query("select set_config('app.tenant_id', '', true)");
      expect((await admin.query('select id from core.plano_rv')).rowCount).toBe(0);
    });
  });

  it('app no tenant A não grava linha do tenant B (42501, with check da política)', async () => {
    expect(await codigo(A.tenantId, async () => {
      await comoApp();
      await inserir(B.tenantId);
    })).toBe('42501');
  });

  it('atualizado_por de outro tenant: 23503 (FK composta)', async () => {
    expect(await codigo(null, () => inserir(A.tenantId, { atualizado_por: B.usuarios.admin }))).toBe('23503');
  });

  it('um plano vivo por (tenant, mês de início); o soft delete libera o mês; outro tenant no mesmo mês pode', async () => {
    expect(await codigo(null, async () => {
      await inserir(A.tenantId);
      await inserir(A.tenantId);
    })).toBe('23505');
    await emTransacao(admin, null, async () => {
      const { rows: [p] } = await inserir(A.tenantId);
      await admin.query('update core.plano_rv set deleted_at = created_at where id = $1', [p!.id]);
      await inserir(A.tenantId);
      await inserir(B.tenantId);
      await inserir(A.tenantId, { vigencia_inicio: '2030-02' });
      const n = await admin.query<{ n: number }>("select count(*)::int as n from core.plano_rv where tenant_id = $1 and vigencia_inicio like '2030-%' and deleted_at is null", [A.tenantId]);
      expect(n.rows[0]!.n).toBe(2);
    });
  });

  it.each([
    ['vigência fora do formato', { vigencia_inicio: '2030-13' }],
    ['vigência com dia', { vigencia_inicio: '2030-01-15' }],
    ['perfis vazio', { perfis: [] }],
    ['perfil fora de vendedor/promotor', { perfis: ['vendedor', 'gerente'] }],
    ['perfil nulo', { perfis: ['vendedor', null] }],
    ['valor máximo zero', { valor_maximo_cents: 0 }],
    ['regras como objeto', { regras: { indicador: 'venda_cents' } }],
    ['nome em branco', { nome: '   ' }],
    ['nome com mais de 80', { nome: 'x'.repeat(81) }],
  ])('CHECK recusa %s (23514)', async (_caso, v) => {
    expect(await codigo(null, () => inserir(A.tenantId, v))).toBe('23514');
  });

  it('macuxi_worker não lê o plano (42501)', async () => {
    expect(await codigo(null, async () => {
      await admin.query('set local role macuxi_worker');
      await admin.query('select id from core.plano_rv');
    })).toBe('42501');
  });

  it('catálogo: RLS ligado e forçado, política isolamento_tenant, grants do app, gatilho de updated_at', async () => {
    const r = await admin.query<{ rls: boolean; force: boolean; politicas: string[]; app: string[]; gatilhos: string[] }>(
      `select c.relrowsecurity as rls, c.relforcerowsecurity as force,
              array(select policyname::text from pg_policies where schemaname = 'core' and tablename = 'plano_rv' order by 1) as politicas,
              array(select privilege_type::text from information_schema.role_table_grants
                     where table_schema = 'core' and table_name = 'plano_rv' and grantee = 'macuxi_app' order by 1) as app,
              array(select tgname::text from pg_trigger where tgrelid = c.oid and not tgisinternal) as gatilhos
         from pg_class c where c.oid = 'core.plano_rv'::regclass`,
    );
    expect(r.rows).toEqual([{ rls: true, force: true, politicas: ['isolamento_tenant', 'manutencao'], app: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'], gatilhos: ['plano_rv_updated_at'] }]);
  });
});

describe.skipIf(semBanco())('0028 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0028_core_plano_rv') - 1]!.slice(0, 4);
  const desde0028 = nomes.filter((n) => n >= '0028');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up cria a tabela; up repetido não muda o catálogo; down volta exatamente ao catálogo da 0027', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c)).aplicadas).toEqual(desde0028);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toEqual(expect.arrayContaining(['rel core.plano_rv r rls=true force=true']));
      await c.query(m28.up); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect((await migrarDown(c, { passos: desde0028.length })).aplicadas).toEqual([...desde0028].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m28.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
