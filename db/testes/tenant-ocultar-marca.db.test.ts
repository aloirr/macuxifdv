/**
 * 0091 — ocultar a marca do Macuxi e mostrar só a do cliente (item 15 do teste de campo do Campo v1.0.16; continuação da
 * T-0182, 0083; RN-CORE-33). Dicionário: docs/banco/plataforma.md, "Ocultar a marca do Macuxi (0091)". O que o BANCO garante:
 * - plataforma.tenant.ocultar_marca_macuxi boolean not null default false; o macuxi_app lê a da própria linha (RLS
 *   isolamento_tenant da 0001) e não grava; o macuxi_leitura ganha SELECT na coluna;
 * - o jsonb da marca (sa_marca_da_empresa e as de gravação) traz ocultar_marca_macuxi;
 * - sa_gravar_ocultar_marca(p_sid uuid, p_tenant uuid, p_ocultar boolean): SÓ super-admin (admin do cliente = 42501); sessão
 *   inválida = 28000; tenant ou valor nulo = 22023; inexistente/apagada = P0002; idempotente e auditada;
 * - up/down: a 0091 só acrescenta; o down volta exatamente ao catálogo da 0090.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { tenant } from '../esquema/plataforma';
import { banco, semBanco } from './estado';
import { FUNCOES_SA_ATUAIS, FUNCOES_SA_OCULTAR_MARCA, MARCA_INTERNA_LOGO } from './funcoes-sa';
import { comoPapel, emTransacao, erroDe, HASH_TESTE, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0091';
const m91 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m91) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m91.up);
const down = semComentarios(m91.down);
const GRAVAR = 'create function plataforma.sa_gravar_ocultar_marca(p_sid uuid, p_tenant uuid, p_ocultar boolean)';
const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const ADMIN_A = DOIS_TENANTS.A.usuarios.admin;
const SEM_TENANT = '00000000-0000-4000-8000-000000000091';

describe('0091 ocultar a marca do Macuxi (estático)', () => {
  it('nome; coluna not null default false com o espelho Drizzle; SELECT da coluna ao macuxi_leitura; nada mais de tabela', () => {
    expect(m91.nome).toBe('plataforma_tenant_ocultar_marca_macuxi');
    expect(up).toMatch(/^alter table plataforma\.tenant add column ocultar_marca_macuxi boolean not null default false;$/m);
    expect(up.match(/add column/g)).toHaveLength(1);
    expect(Object.keys(tenant)).toContain('ocultar_marca_macuxi');
    expect(up).toContain('grant select (ocultar_marca_macuxi) on plataforma.tenant to macuxi_leitura;');
    expect(up).not.toMatch(/create (unique )?index|create policy|alter policy|create table/);
  });

  it('função: SECURITY DEFINER, search_path fixo, só super-admin, só ao portal; a interna da marca traz o campo', () => {
    const i = up.indexOf(GRAVAR);
    expect(i).toBeGreaterThanOrEqual(0);
    const b = up.slice(i, up.indexOf('$$;', up.indexOf('$$', i) + 2) + 3);
    expect(b).toMatch(/language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp\s/);
    expect(b).toContain("if v_tipo is distinct from 'super_admin' or v_sa is null then");
    expect(b).not.toContain('admin_cliente');
    expect(b).toContain("'sa.empresa.ocultar_marca'");
    expect(b).toContain('for update;');
    expect(b.indexOf('if v_antes = p_ocultar then')).toBeLessThan(b.indexOf('update plataforma.tenant'));
    expect(b.indexOf("'42501'")).toBeLessThan(b.indexOf('from plataforma.tenant t'));
    for (const f of FUNCOES_SA_OCULTAR_MARCA) {
      expect(up).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    expect(up.match(/\bgrant execute\b/g)).toHaveLength(1);
    expect(FUNCOES_SA_ATUAIS).toEqual(expect.arrayContaining([...FUNCOES_SA_OCULTAR_MARCA]));
    expect(up).toContain("'ocultar_marca_macuxi', t.ocultar_marca_macuxi,");
    expect(up).toContain(`revoke all on function ${MARCA_INTERNA_LOGO} from public;`);
  });

  it('down: apaga a função e a coluna; a interna volta ao corpo da 0083', () => {
    expect(down).toContain('drop function if exists plataforma.sa_gravar_ocultar_marca(uuid, uuid, boolean);');
    expect(down).toContain('alter table plataforma.tenant drop column if exists ocultar_marca_macuxi;');
    expect(down).not.toContain('ocultar_marca_macuxi,');
    const m83 = migracoes.find((m) => m.versao === '0083')!;
    const interna = (sql: string) => {
      const i = sql.indexOf('function plataforma.marca_da_empresa_json(p_tenant uuid)');
      return sql.slice(i, sql.indexOf('$$;', i));
    };
    expect(interna(down)).toBe(interna(m83.up));
  });
});

describe.skipIf(semBanco())('0091 ocultar a marca do Macuxi (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  type Marca = { tenant_id: string; razao_social: string; nome_fantasia: string | null; ocultar_marca_macuxi: boolean; logo: unknown };
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const portal = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => comoPapel<T>(admin, 'macuxi_portal', sql, params).then((r) => r.rows);
  const abrir = async (p: unknown) => (await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)]))[0]!.sessao_id;
  async function sessaoSuperAdmin() {
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.0091@macuxi.exemplo', nome: 'Operador 0091', senha_hash: HASH_TESTE })]))[0]!.r;
    return { sid: await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }), sa: sa.super_admin_id };
  }
  const um = async (sql: string, params: unknown[]) => (await portal<{ r: Marca }>(sql, params))[0]!.r;
  const ler = (sid: string, t: string) => um('select plataforma.sa_marca_da_empresa($1, $2) as r', [sid, t]);
  // exatamente a chamada da rota PUT .../marca/ocultar-macuxi (parâmetros sem tipo, como o node-postgres manda)
  const ocultar = (sid: string, t: string | null, v: boolean | null) => um('select plataforma.sa_gravar_ocultar_marca($1, $2, $3) as r', [sid, t, v]);
  const auditorias = (sid: string) =>
    q<{ detalhes: Record<string, unknown>; super_admin_id: string; tenant_alvo_id: string | null }>(
      "select detalhes, super_admin_id, tenant_alvo_id from plataforma.auditoria_plataforma where acao = 'sa.empresa.ocultar_marca' and sessao_id = $1 order by ocorrido_em, id",
      [sid],
    );
  const comoApp = (t: string, sql: string, p: unknown[] = []) => comoPapel<Record<string, unknown>>(admin, 'macuxi_app', sql, p, t).then((r) => r.rows);
  const LER_APP = 'select ocultar_marca_macuxi from plataforma.tenant where id = plataforma.tenant_atual()';

  it('default false em todas as empresas; a leitura da marca traz o campo', async () => {
    await emTransacao(admin, null, async () => {
      expect(await q('select count(*)::int as n from plataforma.tenant where ocultar_marca_macuxi')).toEqual([{ n: 0 }]);
      const { sid } = await sessaoSuperAdmin();
      const m = await ler(sid, A);
      expect(Object.keys(m).sort()).toEqual(['logo', 'nome_fantasia', 'ocultar_marca_macuxi', 'razao_social', 'tenant_id']);
      expect(m.ocultar_marca_macuxi).toBe(false);
      expect(await comoApp(A, LER_APP)).toEqual([{ ocultar_marca_macuxi: false }]);
    });
  });

  it('super-admin grava: devolve o jsonb da marca; idempotente (não muda a linha nem audita); volta a false; auditado', async () => {
    await emTransacao(admin, null, async () => {
      const { sid, sa } = await sessaoSuperAdmin();
      const r = await ocultar(sid, A, true);
      expect(r).toEqual(await ler(sid, A));
      expect(r.ocultar_marca_macuxi).toBe(true);
      const [l1] = await q<{ updated_at: Date }>('select updated_at from plataforma.tenant where id = $1', [A]);
      expect((await ocultar(sid, A, true)).ocultar_marca_macuxi).toBe(true);
      expect((await q<{ updated_at: Date }>('select updated_at from plataforma.tenant where id = $1', [A]))[0]!.updated_at).toEqual(l1!.updated_at);
      expect(await auditorias(sid)).toEqual([{ super_admin_id: sa, tenant_alvo_id: A, detalhes: { antes: false, depois: true, origem: 'banco' } }]);
      expect((await ocultar(sid, A, false)).ocultar_marca_macuxi).toBe(false);
      expect(await auditorias(sid)).toHaveLength(2);
    });
  });

  it('erros: sessão inválida 28000; admin do cliente 42501 (até na própria); nulos 22023; inexistente/apagada P0002; app e worker 42501', async () => {
    await emTransacao(admin, null, async () => {
      const { sid } = await sessaoSuperAdmin();
      expect((await erroDe(ocultar(SEM_TENANT, A, true)))?.code).toBe('28000');
      const cli = await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] });
      for (const t of [A, B]) expect((await erroDe(ocultar(cli, t, true)))?.code, t).toBe('42501');
      expect((await erroDe(ocultar(sid, null, true)))?.code).toBe('22023');
      expect((await erroDe(ocultar(sid, A, null)))?.code).toBe('22023');
      expect((await erroDe(ocultar(sid, SEM_TENANT, true)))?.code).toBe('P0002');
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        expect((await erroDe(comoPapel(admin, papel, 'select plataforma.sa_gravar_ocultar_marca(null, null, null)', [], A)))?.code, papel).toBe('42501');
      }
      expect(await q('select count(*)::int as n from plataforma.tenant where ocultar_marca_macuxi')).toEqual([{ n: 0 }]);
      await q('update plataforma.tenant set deleted_at = now() where id = $1', [B]);
      expect((await erroDe(ocultar(sid, B, true)))?.code).toBe('P0002');
    });
  });

  it('isolamento: o macuxi_app de cada tenant lê só a própria escolha e não grava; o portal não lê a tabela direto', async () => {
    await emTransacao(admin, null, async () => {
      const { sid } = await sessaoSuperAdmin();
      await ocultar(sid, A, true);
      expect(await comoApp(A, LER_APP)).toEqual([{ ocultar_marca_macuxi: true }]);
      expect(await comoApp(B, LER_APP)).toEqual([{ ocultar_marca_macuxi: false }]);
      expect(await comoApp(B, 'select ocultar_marca_macuxi from plataforma.tenant where id = $1', [A])).toEqual([]);
      expect(await comoApp('', 'select ocultar_marca_macuxi from plataforma.tenant')).toEqual([]);
      for (const t of [A, B]) {
        expect((await erroDe(comoApp(t, 'update plataforma.tenant set ocultar_marca_macuxi = true')))?.code, t).toBe('42501');
      }
      expect((await erroDe(portal('select ocultar_marca_macuxi from plataforma.tenant')))?.code).toBe('42501');
      // o macuxi_leitura enxerga a coluna (SELECT por coluna da 0083 + o da 0091)
      expect(await q("select has_column_privilege('macuxi_leitura', 'plataforma.tenant', 'ocultar_marca_macuxi', 'SELECT') as tem")).toEqual([{ tem: true }]);
    });
  });
});

describe.skipIf(semBanco())('0091 ocultar a marca do Macuxi (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up só acrescenta; down volta exatamente ao catálogo anterior; up de novo = igual', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual(['0091_plataforma_tenant_ocultar_marca_macuxi']);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((x) => !depois.includes(x))).toEqual([]);
      const novos = depois.filter((x) => !antes.includes(x));
      expect(novos).toEqual(['col plataforma.tenant.ocultar_marca_macuxi boolean nn=true', 'fn plataforma.sa_gravar_ocultar_marca(p_sid uuid, p_tenant uuid, p_ocultar boolean)']);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0091_plataforma_tenant_ocultar_marca_macuxi']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
