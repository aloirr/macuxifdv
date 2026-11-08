/**
 * 0047 — o suporte (super-admin) lista e redefine a senha do admin do cliente pelos PERFIS reais, não pelo principal (resto do
 * D-MP2, T-0094/T-0111; entrega R-20261108-101610 da 0046; decisão do gerente de 08/11 igual ao SDK e à ADR 0033; RN-CORE-33,
 * RN-CORE-35, RN-AUD-01). O que o BANCO garante:
 * - plataforma.usuario_tem_perfil_admin(tenant, usuário): algum perfil vivo e ativo de base admin (a SOMA dos perfis). É o
 *   complemento exato do BKO: o SDK recusa senha.redefinir em alvo com algum perfil de base admin, então o suporte alcança
 *   exatamente quem o BKO não alcança. SECURITY INVOKER, stable, search_path fixo, sem EXECUTE para app, worker, portal ou PUBLIC;
 * - sa_admins_da_empresa: lista quem tem algum perfil de base admin (admin principal, admin extra, admin + vendedor) e diz se a
 *   conta entra no portal (entra_no_portal = usuario_entra_no_portal da 0046, a regra mais restritiva: admin + outra base = não);
 * - sa_redefinir_senha_admin: alcança quem tem algum perfil de base admin, mesmo que o principal seja outro; sem perfil de base
 *   admin (ou só com um inativo / vínculo apagado) = P0002; o outro tenant fica intacto;
 * - as 2 sa_*: SECURITY DEFINER, search_path fixo, EXECUTE só ao macuxi_portal; continuam 14 sa_* do portal;
 * - o texto das 2 é o da 0042 com as trocas desta migração (estático); o down volta ao texto da 0042 e ao catálogo e às ACLs
 *   da 0046.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero). Nada roda em base real.
 * Arquivo `.test.ts` (convenção de db/testes: os casos de banco pulam sem Postgres; no CI, MACUXI_PG_EXIGIR=1 faz pular virar
 * falha). Sem Docker no PC do dono do produto (R-20261105-053835): os casos de banco rodam no CI.
 */
import pg from 'pg';
import { matrizDeFabrica, perfilDeFabrica, pode, podeEntrar, resolverPerfil, type Perfil } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { idPerfilFabrica } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { FUNCOES_SA_0042, FUNCOES_SA_ATUAIS } from './funcoes-sa';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m42 = migracoes.find((m) => m.versao === '0042')!;
const m47 = migracoes.find((m) => m.versao === '0047')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const semCR = (sql: string) => sql.replace(/\r\n/g, '\n');
/** Bloco de uma função até o "$$;" (ou "  $$;" das funções sql) que fecha o corpo. */
const bloco = (sql: string, inicio: string) => {
  const s = semCR(sql);
  const i = s.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^\s*\$\$;$/m.exec(s.slice(i));
  return fim ? s.slice(i, i + fim.index + fim[0].length) : '';
};
const nome = (f: string) => f.slice(0, f.indexOf('('));
const LISTA = 'plataforma.sa_admins_da_empresa(uuid, uuid)';
const REDEFINIR = 'plataforma.sa_redefinir_senha_admin(uuid, uuid, uuid, text, text, uuid, bytea)';
const TEM = 'plataforma.usuario_tem_perfil_admin(uuid, uuid)';
const ENTRA = 'plataforma.usuario_entra_no_portal(uuid, uuid)';
const FILTRO = 'and plataforma.usuario_tem_perfil_admin(u.tenant_id, u.id)';

/** As trocas exatas que a 0047 faz no texto da 0042 (o resto fica igual, letra por letra). */
const TROCAS_LISTA: ReadonlyArray<readonly [string, string]> = [
  ['senha_expira_em timestamptz, sessao_versao integer)', 'senha_expira_em timestamptz, sessao_versao integer, entra_no_portal boolean)'],
  [
    '           u.sessao_versao\n',
    '           u.sessao_versao,\n           -- 0047: entra no portal pelos perfis (0046, regra mais restritiva); ativo/bloqueado/senha completam ao lado\n' +
      '           plataforma.usuario_entra_no_portal(u.tenant_id, u.id)\n',
  ],
  [
    "     where u.tenant_id = p_tenant and u.perfil = 'admin' and u.deleted_at is null and t.deleted_at is null\n",
    '     where u.tenant_id = p_tenant and u.deleted_at is null and t.deleted_at is null\n' +
      '       -- 0047: algum perfil vivo e ativo de base admin (a soma dos perfis), não só o principal\n' +
      `       ${FILTRO}\n`,
  ],
];
const TROCAS_REDEFINIR: ReadonlyArray<readonly [string, string]> = [
  ['create function', 'create or replace function'],
  [
    '  -- alvo: admin (perfil principal, o critério do login do portal) vivo, ativo e sem bloqueio, de empresa ativa e viva\n',
    '  -- alvo: admin vivo, ativo e sem bloqueio, de empresa ativa e viva\n',
  ],
  [
    "   where u.tenant_id = p_tenant and u.id = p_usuario and u.perfil = 'admin' and u.deleted_at is null and u.ativo\n",
    '   where u.tenant_id = p_tenant and u.id = p_usuario and u.deleted_at is null and u.ativo\n',
  ],
  [
    '     for update of u;',
    '     -- 0047: algum perfil vivo e ativo de base admin (a soma dos perfis), mesmo que o principal seja outro\n' +
      `     ${FILTRO}\n     for update of u;`,
  ],
];
const aplicar = (txt: string, trocas: ReadonlyArray<readonly [string, string]>) =>
  trocas.reduce((t, [de, para]) => {
    expect(t.split(de).length - 1, de).toBe(1);
    return t.replace(de, para);
  }, txt);

/** Dados de mentira (nunca de uma pessoa real); hashes no formato PHC, sem senha nenhuma por trás. */
const H = '$argon2id$v=19$m=1,t=1,p=1$YWRtaW4wMDQ3$YWRtaW4wMDQ3aGFzaA';
const HT = '$argon2id$v=19$m=1,t=1,p=1$dGVtcDAwNDc$dGVtcDAwNDdoYXNo';
const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const ADMIN_A = DOIS_TENANTS.A.usuarios.admin;
const VENDEDOR_A = DOIS_TENANTS.A.usuarios.vendedor1;
const VENDEDOR_B = DOIS_TENANTS.B.usuarios.vendedor;
/** vendedor1 de A e vendedor de B: a mesma pessoa (o mesmo e-mail) em duas empresas. */
const EMAIL_VENDEDOR = DOIS_TENANTS.emailRepetido;
const CARGA = Buffer.from('texto-cifrado-de-mentira-0047');
const MATRIZ = matrizDeFabrica([]);
/** O BKO alcança o alvo? O admin de fábrica (senha.redefinir com todos os alvos) sobre os perfis do alvo, pelo SDK. */
const bkoAlcanca = (bases: readonly Perfil[]) =>
  pode([resolverPerfil(perfilDeFabrica('admin'), MATRIZ)], 'senha.redefinir', { proprio: false, perfis: bases.map((b) => ({ codigo: b, base: b })) });
const sdkEntra = (bases: readonly Perfil[]) => podeEntrar(bases.map((b) => resolverPerfil(perfilDeFabrica(b), MATRIZ)), 'portal');

describe('0047 suporte pelos perfis de base admin (estático)', () => {
  const up = semComentarios(m47.up);

  it('nome e posição: 0047_plataforma_portal_admin_multiperfil logo depois da 0046', () => {
    expect(m47.nome).toBe('plataforma_portal_admin_multiperfil');
    expect(migracoes[46]?.versao).toBe('0047');
    expect(migracoes[45]?.versao).toBe('0046');
  });

  it('só funções: a usuario_tem_perfil_admin nova, a lista recriada (drop + create, retorno novo) e a redefinição substituída', () => {
    const criadas = [...up.matchAll(/create (or replace )?function ([a-z_]+\.[a-z_]+)\(/g)].map((x) => `${x[1] ? 'substitui' : 'cria'} ${x[2]}`);
    expect(criadas.sort()).toEqual([`cria ${nome(TEM)}`, `cria ${nome(LISTA)}`, `substitui ${nome(REDEFINIR)}`].sort());
    expect([...up.matchAll(/drop function ([^;]+);/g)].map((x) => x[1])).toEqual([LISTA]);
    expect(up.indexOf(`drop function ${LISTA};`)).toBeLessThan(up.indexOf(`create function ${nome(LISTA)}(`));
    expect(up).not.toMatch(/create (table|index|unique index|policy|role|trigger)|alter (table|role)|drop (table|column)/i);
  });

  it('usuario_tem_perfil_admin: SECURITY INVOKER, stable, search_path fixo, vivos e ativos de base admin, sem EXECUTE para ninguém', () => {
    const b = bloco(up, `create function ${nome(TEM)}(`);
    expect(b).toMatch(/returns boolean\s+language sql stable security invoker\s+set search_path = pg_catalog, plataforma, pg_temp/);
    expect(b).toMatch(/p\.ativo and p\.deleted_at is null/);
    expect(b).toMatch(/up\.deleted_at is null and p\.base = 'admin'\)/);
    expect(b).not.toMatch(/u\.perfil|core\.usuario/);
    expect(up).toContain(`revoke all on function ${TEM} from public, macuxi_app, macuxi_worker, macuxi_portal;`);
    expect(up).not.toMatch(/grant [^;]*usuario_tem_perfil_admin/);
  });

  it('as 2 sa_*: o texto da 0042 com as trocas desta migração (DEFINER, search_path, revoke de PUBLIC/app/worker, EXECUTE só ao portal)', () => {
    const lista47 = bloco(m47.up, `create function ${nome(LISTA)}(`);
    const redef47 = bloco(m47.up, `create or replace function ${nome(REDEFINIR)}(`);
    expect(lista47).toBe(aplicar(bloco(m42.up, `create function ${nome(LISTA)}(`), TROCAS_LISTA));
    expect(redef47).toBe(aplicar(bloco(m42.up, `create function ${nome(REDEFINIR)}(`), TROCAS_REDEFINIR));
    for (const [f, b] of [[LISTA, lista47], [REDEFINIR, redef47]] as const) {
      expect(b, f).toMatch(/language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(semComentarios(b), f).not.toContain("u.perfil = 'admin'");
      expect(b.split(FILTRO).length - 1, f).toBe(1);
      expect(m47.up).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(m47.up).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    expect(lista47).toContain('plataforma.usuario_entra_no_portal(u.tenant_id, u.id)');
    expect(FUNCOES_SA_0042).toEqual([LISTA, REDEFINIR]);
    expect(FUNCOES_SA_ATUAIS).toHaveLength(14);
    expect(up).toContain('if v_n <> 14 then');
    expect(up).not.toMatch(/grant execute [^;]* to macuxi_(app|worker);/);
    expect(up).not.toMatch(/grant [^;]* on (table )?(plataforma|core)\.[a-z_]+ to macuxi_portal/);
    // a conferência cobre as duas funções auxiliares (0046 e 0047)
    for (const f of [ENTRA, TEM]) expect(up).toContain(`has_function_privilege('macuxi_portal', '${f}', 'execute')`);
  });

  it('down: as 2 com o texto exato da 0042 (a lista por drop + create) e o drop da função nova depois delas', () => {
    expect(bloco(m47.down, `create function ${nome(LISTA)}(`)).toBe(bloco(m42.up, `create function ${nome(LISTA)}(`));
    expect(bloco(m47.down, `create or replace function ${nome(REDEFINIR)}(`)).toBe(
      bloco(m42.up, `create function ${nome(REDEFINIR)}(`).replace('create function', 'create or replace function'),
    );
    const down = semComentarios(m47.down);
    for (const f of [LISTA, REDEFINIR]) {
      expect(down).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(down).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    expect(down.indexOf(`drop function if exists ${LISTA};`)).toBeLessThan(down.indexOf(`create function ${nome(LISTA)}(`));
    expect(down.indexOf(`drop function if exists ${TEM};`)).toBeGreaterThan(down.lastIndexOf('create or replace function'));
    expect(down).not.toContain(FILTRO);
    expect(down).not.toContain('entra_no_portal boolean');
    expect(down).toContain('if v_n <> 14 then');
  });
});

describe.skipIf(semBanco())('0047 suporte pelos perfis de base admin (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  /** Roda como o papel dado (sem contexto de tenant) dentro da transação aberta; um erro não aborta o caso. */
  async function como<T extends pg.QueryResultRow = Record<string, unknown>>(papel: string, sql: string, params: unknown[] = []) {
    await admin.query('savepoint como');
    try {
      await admin.query(`set local role ${papel}`);
      await admin.query("select set_config('app.tenant_id', '', true)");
      const r = await admin.query<T>(sql, params);
      await admin.query('reset role');
      await admin.query('release savepoint como');
      return r.rows;
    } catch (e) {
      await admin.query('rollback to savepoint como');
      throw e;
    }
  }
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const portal = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => como<T>('macuxi_portal', sql, params);
  /** Sessão viva de super-admin (criado pela conexão de administração, como no deploy). */
  async function sessaoSuperAdmin(): Promise<string> {
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.0047@macuxi.exemplo', nome: 'Operador 0047', senha_hash: H })]))[0]!.r;
    return (await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify({ tipo: 'super_admin', super_admin_id: sa.super_admin_id })]))[0]!.sessao_id;
  }
  type Linha = { usuario_id: string; entra_no_portal: boolean };
  const listar = async (sid: string, tenant: string) =>
    (await portal<Linha & Record<string, unknown>>('select * from plataforma.sa_admins_da_empresa($1, $2)', [sid, tenant])).map((x) => ({ usuario_id: x.usuario_id, entra_no_portal: x.entra_no_portal }));
  let emailId = 0;
  const novoEmailId = () => `0047a000-0000-4000-8000-${String(++emailId).padStart(12, '0')}`;
  const redefinir = (sid: string, tenant: string, usuario: string, email: string) =>
    portal<{ sessao_versao: number; repetida: boolean }>('select sessao_versao, repetida from plataforma.sa_redefinir_senha_admin($1, $2, $3, $4, $5, $6, $7)', [sid, tenant, usuario, HT, email, novoEmailId(), CARGA]);
  const tem = async (tenant: string, usuario: string) => (await q<{ t: boolean }>('select plataforma.usuario_tem_perfil_admin($1, $2) as t', [tenant, usuario]))[0]!.t;
  const estado = (u: string) => q<Record<string, unknown>>('select senha_hash, trocar_senha, sessao_versao from core.usuario where id = $1', [u]);
  const vincular = (tenant: string, usuario: string, perfilId: string) =>
    q('insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [tenant, usuario, perfilId]);
  const desvincular = (usuario: string, perfilId: string) =>
    q('update plataforma.usuario_perfil set deleted_at = now() where usuario_id = $1 and perfil_id = $2 and deleted_at is null', [usuario, perfilId]);
  /** Roda agora as conferências adiadas da 0041 (sem perfil, principal, último admin): o estado montado é um estado válido. */
  const conferir = () => q('set constraints all immediate');
  /** Admin novo (principal 'admin'; o gatilho da 0041 liga o perfil admin de fábrica), ativo e com senha. */
  const criarAdmin = async (tenant: string, email: string, nomeDaPessoa: string) =>
    (await q<{ id: string }>("insert into core.usuario (tenant_id, nome, email, perfil, ativo, senha_hash) values ($1, $2, $3, 'admin', true, $4) returning id", [tenant, nomeDaPessoa, email, H]))[0]!.id;

  it('privilégios: a função nova sem EXECUTE para app, worker e portal (42501); as 2 sa_* DEFINER com EXECUTE só ao portal; 14 sa_*', async () => {
    await emTransacao(admin, null, async () => {
      const r = await q<{ f: string; definer: boolean; volatil: string; config: string[]; app: boolean; worker: boolean; portal: boolean }>(
        `select f, p.prosecdef as definer, p.provolatile::text as volatil, p.proconfig as config,
                has_function_privilege('macuxi_app', p.oid, 'execute') as app, has_function_privilege('macuxi_worker', p.oid, 'execute') as worker,
                has_function_privilege('macuxi_portal', p.oid, 'execute') as portal
           from unnest($1::text[]) f join pg_proc p on p.oid = f::regprocedure order by 1`,
        [[TEM, LISTA, REDEFINIR]],
      );
      const config = ['search_path=pg_catalog, plataforma, pg_temp'];
      expect(r.find((x) => x.f === TEM)).toEqual({ f: TEM, definer: false, volatil: 's', config, app: false, worker: false, portal: false });
      for (const f of [LISTA, REDEFINIR]) expect(r.find((x) => x.f === f), f).toEqual({ f, definer: true, volatil: 'v', config, app: false, worker: false, portal: true });
      for (const papel of ['macuxi_app', 'macuxi_worker', 'macuxi_portal']) {
        expect((await erroDe(como(papel, 'select plataforma.usuario_tem_perfil_admin($1, $2)', [A, ADMIN_A])))?.code, papel).toBe('42501');
      }
      const n = await q<{ n: number }>(
        `select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
          where s.nspname = 'plataforma' and p.proname like 'sa\\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute')`,
      );
      expect(n).toEqual([{ n: 14 }]);
      // o retorno da lista: as 9 colunas da 0042 + entra_no_portal no fim
      const res = await q<{ r: string }>('select pg_get_function_result($1::regprocedure) as r', [LISTA]);
      expect(res[0]!.r).toBe(
        'TABLE(usuario_id uuid, nome text, email text, ativo boolean, bloqueado boolean, tem_senha boolean, trocar_senha boolean, senha_expira_em timestamp with time zone, sessao_versao integer, entra_no_portal boolean)',
      );
    });
  });

  it('admin principal (só admin): na lista com entra_no_portal = true; o suporte redefine; vendedor puro fora da lista e P0002', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      expect(await listar(sid, A)).toEqual([{ usuario_id: ADMIN_A, entra_no_portal: true }]);
      expect(await tem(A, ADMIN_A)).toBe(true);
      expect(sdkEntra(['admin'])).toBe(true);
      expect(bkoAlcanca(['admin'])).toBe(false);
      expect((await redefinir(sid, A, ADMIN_A, 'admin@exemplo.com.br'))[0]).toEqual({ sessao_versao: 1, repetida: false });
      // vendedor sem perfil de admin: o BKO alcança, o suporte não (complemento)
      expect(await tem(A, VENDEDOR_A)).toBe(false);
      expect(bkoAlcanca(['vendedor'])).toBe(true);
      expect((await erroDe(redefinir(sid, A, VENDEDOR_A, EMAIL_VENDEDOR)))?.code).toBe('P0002');
    });
  });

  it('admin principal + vendedor extra: na lista com entra_no_portal = false (0046); o suporte redefine (o BKO não alcança)', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const email = 'admv.0047@exemplo.com.br';
      const u = await criarAdmin(A, email, 'Admin que Vende 0047');
      await vincular(A, u, idPerfilFabrica(A, 'vendedor'));
      await conferir(); // permitido: o admin da fixture segue com a gestão (último admin)
      expect(sdkEntra(['admin', 'vendedor'])).toBe(false);
      expect(bkoAlcanca(['admin', 'vendedor'])).toBe(false);
      // por nome e id: 'Admin Alfa' (fixture) antes de 'Admin que Vende 0047'
      expect(await listar(sid, A)).toEqual([{ usuario_id: ADMIN_A, entra_no_portal: true }, { usuario_id: u, entra_no_portal: false }]);
      expect((await redefinir(sid, A, u, email))[0]).toEqual({ sessao_versao: 1, repetida: false });
      expect(await estado(u)).toEqual([{ senha_hash: HT, trocar_senha: true, sessao_versao: 1 }]);
      // a redefinição não dá acesso: a conta segue fora do portal
      expect(await q<{ e: boolean }>('select plataforma.usuario_entra_no_portal($1, $2) as e', [A, u])).toEqual([{ e: false }]);
    });
  });

  it('vendedor principal + admin extra: entra na lista (entra_no_portal = false) e o suporte redefine; tirar o admin devolve o P0002', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      expect((await listar(sid, A)).map((x) => x.usuario_id)).not.toContain(VENDEDOR_A);
      await vincular(A, VENDEDOR_A, idPerfilFabrica(A, 'admin'));
      await conferir();
      expect(await q('select perfil from core.usuario where id = $1', [VENDEDOR_A])).toEqual([{ perfil: 'vendedor' }]);
      expect(await tem(A, VENDEDOR_A)).toBe(true);
      expect(bkoAlcanca(['vendedor', 'admin'])).toBe(false);
      expect(sdkEntra(['vendedor', 'admin'])).toBe(false);
      expect(await listar(sid, A)).toContainEqual({ usuario_id: VENDEDOR_A, entra_no_portal: false });
      const antes = (await estado(VENDEDOR_A))[0]!;
      const [r] = await redefinir(sid, A, VENDEDOR_A, EMAIL_VENDEDOR);
      expect(r).toEqual({ sessao_versao: (antes.sessao_versao as number) + 1, repetida: false });
      expect(await estado(VENDEDOR_A)).toEqual([{ senha_hash: HT, trocar_senha: true, sessao_versao: (antes.sessao_versao as number) + 1 }]);
      expect(await q("select count(*)::int as n from plataforma.auditoria where tenant_id = $1 and acao = 'usuario.senha_redefinir' and entidade_id = $2 and depois ->> 'origem' = 'portal'", [A, VENDEDOR_A])).toEqual([{ n: 1 }]);
      // sem o admin extra, volta a ser só vendedor: fora da lista e P0002 (o BKO alcança de novo)
      await desvincular(VENDEDOR_A, idPerfilFabrica(A, 'admin'));
      await conferir();
      expect((await listar(sid, A)).map((x) => x.usuario_id)).not.toContain(VENDEDOR_A);
      expect((await erroDe(redefinir(sid, A, VENDEDOR_A, EMAIL_VENDEDOR)))?.code).toBe('P0002');
    });
  });

  /** Perfil personalizado de base admin com acesso.portal revogado (sobreposição). */
  const criarAdminSemPortal = async () => {
    const pers = (await q<{ id: string }>("insert into plataforma.perfil (tenant_id, codigo, nome, base) values ($1, 'admin_sem_portal_0047', 'Admin sem portal 0047', 'admin') returning id", [A]))[0]!.id;
    await q("insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, 'acesso.portal', false)", [A, pers]);
    return pers;
  };

  it('perfil de base admin inativo ou vínculo apagado não conta (os mesmos perfis que perfis_do_usuario devolve à API)', async () => {
    // sem conferir() nem COMMIT: a 0041 recusaria o vínculo vivo com perfil inativo; a função ignora o inativo, como o SDK
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const pers = await criarAdminSemPortal();
      await vincular(A, VENDEDOR_A, pers);
      expect(await tem(A, VENDEDOR_A)).toBe(true);
      await q('update plataforma.perfil set ativo = false where id = $1', [pers]);
      expect(await tem(A, VENDEDOR_A)).toBe(false);
      expect((await listar(sid, A)).map((x) => x.usuario_id)).not.toContain(VENDEDOR_A);
      expect((await erroDe(redefinir(sid, A, VENDEDOR_A, EMAIL_VENDEDOR)))?.code).toBe('P0002');
      await q('update plataforma.perfil set ativo = true where id = $1', [pers]);
      expect(await tem(A, VENDEDOR_A)).toBe(true);
      await desvincular(VENDEDOR_A, pers);
      expect(await tem(A, VENDEDOR_A)).toBe(false);
      expect((await listar(sid, A)).map((x) => x.usuario_id)).not.toContain(VENDEDOR_A);
      expect((await erroDe(redefinir(sid, A, VENDEDOR_A, EMAIL_VENDEDOR)))?.code).toBe('P0002');
    });
  });

  it('personalizado de base admin sem portal conta como admin: na lista com entra_no_portal = false e o suporte redefine', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const pers = await criarAdminSemPortal();
      // vendedor + admin personalizado sem portal
      await vincular(A, VENDEDOR_A, pers);
      // admin só pelo personalizado sem portal (o de fábrica sai; o principal 'admin' segue coberto pela base do personalizado)
      const email = 'adm-pers.0047@exemplo.com.br';
      const u = await criarAdmin(A, email, 'Admin Personalizado 0047');
      await vincular(A, u, pers);
      await desvincular(u, idPerfilFabrica(A, 'admin'));
      await conferir();
      expect(await tem(A, VENDEDOR_A)).toBe(true);
      expect(await tem(A, u)).toBe(true);
      const lista = await listar(sid, A);
      expect(lista).toContainEqual({ usuario_id: VENDEDOR_A, entra_no_portal: false });
      expect(lista).toContainEqual({ usuario_id: u, entra_no_portal: false });
      expect(lista).toContainEqual({ usuario_id: ADMIN_A, entra_no_portal: true });
      expect((await redefinir(sid, A, u, email))[0]).toEqual({ sessao_versao: 1, repetida: false });
      expect((await redefinir(sid, A, VENDEDOR_A, EMAIL_VENDEDOR))[0]).toMatchObject({ repetida: false });
    });
  });

  it('multi-tenant: a mesma pessoa com admin extra só em B aparece e é redefinida só em B; em A segue P0002 e nada muda', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      await vincular(B, VENDEDOR_B, idPerfilFabrica(B, 'admin'));
      await conferir();
      expect(await tem(B, VENDEDOR_B)).toBe(true);
      expect(await tem(A, VENDEDOR_A)).toBe(false);
      // o vínculo de B não vale em A (nem para o id de B pedido com o tenant A, nem para o par trocado)
      expect(await tem(A, VENDEDOR_B)).toBe(false);
      expect(await tem(B, VENDEDOR_A)).toBe(false);
      expect(await listar(sid, B)).toContainEqual({ usuario_id: VENDEDOR_B, entra_no_portal: false });
      expect((await listar(sid, A)).map((x) => x.usuario_id)).toEqual([ADMIN_A]);
      const estadoA = await estado(VENDEDOR_A);
      expect((await erroDe(redefinir(sid, A, VENDEDOR_A, EMAIL_VENDEDOR)))?.code).toBe('P0002');
      expect((await erroDe(redefinir(sid, A, VENDEDOR_B, EMAIL_VENDEDOR)))?.code).toBe('P0002');
      const antesB = (await estado(VENDEDOR_B))[0]!;
      expect((await redefinir(sid, B, VENDEDOR_B, EMAIL_VENDEDOR))[0]).toEqual({ sessao_versao: (antesB.sessao_versao as number) + 1, repetida: false });
      expect(await estado(VENDEDOR_A)).toEqual(estadoA);
      expect(await q('select tenant_id from plataforma.email_saida where usuario_id = any($1::uuid[]) and carga is not null', [[VENDEDOR_A, VENDEDOR_B]])).toEqual([{ tenant_id: B }]);
    });
  });
});

describe.skipIf(semBanco())('0047 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up acrescenta só a usuario_tem_perfil_admin (ACLs iguais, 14 do portal); down volta exatamente ao catálogo, às ACLs, ao texto e ao retorno da 0046 (idempotente); up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0046' });
      const catalogo = await retratoDoCatalogo(c);
      const acl = await retratoAcl(c);
      const fns = await retratoDas2(c);
      expect((await migrarUp(c, { ate: '0047' })).aplicadas).toEqual(['0047_plataforma_portal_admin_multiperfil']);
      const depois = await retratoDoCatalogo(c);
      const aclDepois = await retratoAcl(c);
      const fnsDepois = await retratoDas2(c);
      expect(depois.filter((l) => !catalogo.includes(l))).toEqual(['fn plataforma.usuario_tem_perfil_admin(p_tenant uuid, p_usuario uuid)']);
      expect(catalogo.filter((l) => !depois.includes(l))).toEqual([]);
      expect(aclDepois).toEqual(acl);
      expect(fnsDepois[LISTA]!.resultado).toContain('entra_no_portal boolean');
      for (const f of [LISTA, REDEFINIR]) expect(fnsDepois[f]!.corpo, f).toContain(FILTRO);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0047_plataforma_portal_admin_multiperfil']);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      expect(await retratoAcl(c)).toEqual(acl);
      expect(await retratoDas2(c)).toEqual(fns);
      await c.query(m47.down);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      expect(await retratoAcl(c)).toEqual(acl);
      expect(await retratoDas2(c)).toEqual(fns);

      await migrarUp(c, { ate: '0047' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect(await retratoAcl(c)).toEqual(aclDepois);
      expect(await retratoDas2(c)).toEqual(fnsDepois);
    });
  });
});

/** ACLs (fora o dono) das funções do schema plataforma. */
async function retratoAcl(c: pg.ClientBase): Promise<string[]> {
  const r = await c.query<{ l: string }>(
    `select 'fn ' || p.oid::regprocedure::text || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type as l
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname = 'plataforma' and a.grantee <> p.proowner
      order by 1`,
  );
  return r.rows.map((x) => x.l);
}

/** Corpo, retorno, DEFINER e search_path das 2 sa_* da 0042. */
async function retratoDas2(c: pg.ClientBase): Promise<Record<string, { corpo: string; resultado: string; definer: boolean; config: string[] }>> {
  const r = await c.query<{ f: string; corpo: string; resultado: string; definer: boolean; config: string[] }>(
    `select f, p.prosrc as corpo, pg_get_function_result(p.oid) as resultado, p.prosecdef as definer, p.proconfig as config
       from unnest($1::text[]) f join pg_proc p on p.oid = f::regprocedure`,
    [[LISTA, REDEFINIR]],
  );
  return Object.fromEntries(r.rows.map(({ f, ...resto }) => [f, resto]));
}
