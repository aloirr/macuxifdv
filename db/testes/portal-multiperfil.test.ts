/**
 * 0046 — portal (config.) pelos perfis do usuário: defeito D-MP2 (T-0094/T-0111; pedidos R-20261108-062613-testes e
 * R-20261108-091451-engenheiro-software; ADR 0031 e 0033; RN-CORE-33, RN-CORE-35). O que o BANCO garante:
 * - plataforma.usuario_entra_no_portal(tenant, usuário) = podeEntrar(perfis, 'portal') do SDK sobre os perfis vivos e ativos do
 *   usuário: ao menos um, TODOS de base admin (regra mais restritiva: um perfil de qualquer outra base fecha o portal) e
 *   acesso.portal pela união (sobreposição viva, senão a fábrica). SECURITY INVOKER, search_path fixo, sem EXECUTE para app,
 *   worker, portal ou PUBLIC;
 * - sa_contas_para_login, sa_abrir_sessao_portal, sa_escolher_empresa e sa_sessao_valida (SECURITY DEFINER, search_path fixo,
 *   EXECUTE só ao macuxi_portal) usam a função: admin só entra; admin + vendedor/promotor/supervisor/gerente/analista/assistente
 *   não (0 linhas, sem oráculo); a sessão viva cai na hora quando a conta ganha um perfil de outra base; a mesma pessoa em duas
 *   empresas só entra na empresa em que é só admin;
 * - o texto das 4 sa_* é o da 0040 + o filtro (estático); o down volta ao texto da 0040 e ao catálogo e às ACLs da 0045.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero). Nada roda em base real.
 * Arquivo `.test.ts` (convenção de db/testes: o vitest do @macuxi/db inclui testes/**\/*.test.ts e os casos de banco pulam sem
 * Postgres; no CI, MACUXI_PG_EXIGIR=1 faz pular virar falha).
 */
import pg from 'pg';
import { matrizDeFabrica, PERFIS, perfilDeFabrica, podeEntrar, resolverPerfil, travaDaChave } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { idPerfilFabrica } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { FUNCOES_SA, FUNCOES_SA_ATE_0057 } from './funcoes-sa';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m40 = migracoes.find((m) => m.versao === '0040')!;
const m46 = migracoes.find((m) => m.versao === '0046')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
/** Bloco de uma função até o "$$;" (ou "  $$;" das funções sql) que fecha o corpo. */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^\s*\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};
const nome = (f: string) => f.slice(0, f.indexOf('('));
const AS_4 = [
  'plataforma.sa_contas_para_login(text)',
  'plataforma.sa_abrir_sessao_portal(jsonb)',
  'plataforma.sa_escolher_empresa(uuid, uuid)',
  'plataforma.sa_sessao_valida(uuid)',
] as const;
const ENTRA = 'plataforma.usuario_entra_no_portal(uuid, uuid)';
const FILTRO = 'and plataforma.usuario_entra_no_portal(u.tenant_id, u.id)';
/** Bloco da 0040 com a forma de recriação da 0046 (create or replace). */
const da0040 = (f: string) => bloco(m40.up, `create function ${nome(f)}(`).replace('create function', 'create or replace function');
/** Bloco da 0046 sem as linhas acrescentadas (comentário "-- 0046" e o filtro). */
const semOFiltro = (b: string) => b.replace(/\n[ ]*-- 0046[^\n]*/g, '').replace(new RegExp(`\\n[ ]*${FILTRO.replace(/[.()]/g, '\\$&')}`, 'g'), '');

/** Dados de mentira (nunca de uma pessoa real); hash no formato PHC, sem senha nenhuma por trás. */
const H = '$argon2id$v=19$m=1,t=1,p=1$bXVsdGlwZXJmaWw$bXVsdGlwZXJmaWxoYXNo';
const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const BASES_NAO_ADMIN = PERFIS.filter((p) => p !== 'admin');
const MATRIZ = matrizDeFabrica([]);

describe('0046 portal pelos perfis do usuário (estático)', () => {
  const up = semComentarios(m46.up);

  it('nome e posição: 0046_plataforma_portal_multiperfil logo depois da 0045', () => {
    expect(m46.nome).toBe('plataforma_portal_multiperfil');
    expect(migracoes[45]?.versao).toBe('0046');
    expect(migracoes[44]?.versao).toBe('0045');
  });

  it('só funções: a usuario_entra_no_portal nova e as 4 sa_* recriadas (create or replace, mesmas assinaturas); nada de tabela, índice, política ou papel', () => {
    const criadas = [...up.matchAll(/create (or replace )?function ([a-z_]+\.[a-z_]+)\(/g)].map((x) => `${x[1] ? 'substitui' : 'cria'} ${x[2]}`);
    expect(criadas.sort()).toEqual(['cria plataforma.usuario_entra_no_portal', ...AS_4.map((f) => `substitui ${nome(f)}`)].sort());
    expect(up).not.toMatch(/drop function/);
    expect(up).not.toMatch(/create (table|index|unique index|policy|role|trigger)|alter (table|role)|drop (table|column)/i);
  });

  it('usuario_entra_no_portal: SECURITY INVOKER, stable, search_path fixo, sem EXECUTE para ninguém (gêmea de podeEntrar)', () => {
    const b = bloco(up, 'create function plataforma.usuario_entra_no_portal(');
    expect(b).toMatch(/returns boolean\s+language sql stable security invoker\s+set search_path = pg_catalog, plataforma, pg_temp/);
    expect(b).toContain("and not exists (select 1 from perfis f where f.base <> 'admin')");
    expect(b).toContain("pp.chave = 'acesso.portal' and pp.deleted_at is null");
    expect(b).toContain("f.base = 'admin'))");
    expect(b).toMatch(/p\.ativo and p\.deleted_at is null/);
    expect(b).toMatch(/up\.deleted_at is null/);
    expect(up).toContain(`revoke all on function ${ENTRA} from public, macuxi_app, macuxi_worker, macuxi_portal;`);
    expect(up).not.toMatch(/grant [^;]*usuario_entra_no_portal/);
    // a regra que a função copia: no SDK, só a base admin não tem trava no acesso.portal e só ela o tem de fábrica
    for (const p of PERFIS) {
      expect(travaDaChave(p, 'acesso.portal') === null, p).toBe(p === 'admin');
      expect('acesso.portal' in MATRIZ[p], p).toBe(p === 'admin');
    }
  });

  it('as 4 sa_*: o texto da 0040 + o filtro (DEFINER, search_path, revoke de PUBLIC/app/worker, EXECUTE só ao portal)', () => {
    for (const f of AS_4) {
      const b = bloco(m46.up, `create or replace function ${nome(f)}(`);
      expect(b, f).toMatch(/language (plpgsql|sql) volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(b.split(FILTRO).length - 1, f).toBe(1);
      expect(semOFiltro(b), f).toBe(da0040(f));
      expect(m46.up).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(m46.up).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    expect(FUNCOES_SA).toEqual(expect.arrayContaining([...AS_4]));
    expect(up).not.toMatch(/grant execute [^;]* to macuxi_(app|worker);/);
    expect(up).toContain('if v_n <> 14 then');
    expect(FUNCOES_SA_ATE_0057).toHaveLength(14); // 14 até a 0057; a 0058 (T-0158) acrescenta 2
  });

  it('down: as 4 com o texto exato da 0040 e o drop da função nova depois delas', () => {
    for (const f of AS_4) {
      expect(bloco(m46.down, `create or replace function ${nome(f)}(`), f).toBe(da0040(f));
      expect(m46.down).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    const down = semComentarios(m46.down);
    expect(down).not.toContain(FILTRO);
    expect(down.indexOf(`drop function if exists ${ENTRA};`)).toBeGreaterThan(down.lastIndexOf('create or replace function'));
  });
});

describe.skipIf(semBanco())('0046 portal pelos perfis do usuário (banco, fixture dois-tenants)', () => {
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
  const contas = (email: string) =>
    como<{ tipo: string; conta_id: string; tenant_id: string }>('macuxi_portal', 'select tipo, conta_id, tenant_id from plataforma.sa_contas_para_login($1) order by tenant_id', [email]);
  const abrir = async (empresas: { tenant_id: string; usuario_id: string }[]) =>
    (await como<{ sessao_id: string }>('macuxi_portal', 'select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify({ tipo: 'admin_cliente', empresas })]))[0];
  const valida = (sid: string) => como<{ tenant_id: string | null; usuario_id: string | null }>('macuxi_portal', 'select tenant_id, usuario_id from plataforma.sa_sessao_valida($1)', [sid]);
  const escolher = (sid: string, tenant: string) => como<{ tenant_id: string; usuario_id: string }>('macuxi_portal', 'select tenant_id, usuario_id from plataforma.sa_escolher_empresa($1, $2)', [sid, tenant]);
  const entra = async (tenant: string, usuario: string) => (await q<{ e: boolean }>('select plataforma.usuario_entra_no_portal($1, $2) as e', [tenant, usuario]))[0]!.e;

  /** Admin novo (principal 'admin'; o gatilho da 0041 liga o perfil admin de fábrica), ativo e com senha. */
  async function criarAdmin(tenant: string, email: string, nomeDaPessoa: string): Promise<string> {
    return (await q<{ id: string }>("insert into core.usuario (tenant_id, nome, email, perfil, ativo, senha_hash) values ($1, $2, $3, 'admin', true, $4) returning id", [tenant, nomeDaPessoa, email, H]))[0]!.id;
  }
  const vincular = (tenant: string, usuario: string, perfilId: string) =>
    q('insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [tenant, usuario, perfilId]);
  const desvincular = (usuario: string, perfilId: string) =>
    q('update plataforma.usuario_perfil set deleted_at = now() where usuario_id = $1 and perfil_id = $2 and deleted_at is null', [usuario, perfilId]);
  /**
   * Roda agora as conferências adiadas da 0041 (sem perfil, principal, último admin): o estado montado é válido para elas. Só as 4
   * da 0041: desde a 0069 (um perfil por usuário) a restrição usuario_perfil_um_vivo recusaria no COMMIT os estados com 2+ perfis
   * montados aqui. Esses estados agora só existem dentro de uma transação; o portal mantém a regra mais restritiva como defesa.
   */
  const conferir = () =>
    q('set constraints core.usuario_conferir_acesso, plataforma.usuario_perfil_conferir, plataforma.perfil_conferir, plataforma.perfil_permissao_conferir immediate');

  it('admin só (fixture, A e B) entra; a função e as 4 sa_* têm os privilégios da 0046', async () => {
    await emTransacao(admin, null, async () => {
      expect(await contas('admin@exemplo.com.br')).toEqual([{ tipo: 'admin_cliente', conta_id: DOIS_TENANTS.A.usuarios.admin, tenant_id: A }]);
      expect(await contas('admin.b@exemplo.com.br')).toEqual([{ tipo: 'admin_cliente', conta_id: DOIS_TENANTS.B.usuarios.admin, tenant_id: B }]);
      expect(await entra(A, DOIS_TENANTS.A.usuarios.admin)).toBe(true);
      // usuário sem nenhum admin (vendedor, analista) e usuário inexistente: não
      expect(await entra(A, DOIS_TENANTS.A.usuarios.vendedor1)).toBe(false);
      expect(await entra(A, DOIS_TENANTS.A.usuarios.analista)).toBe(false);
      expect(await entra(A, '0046ffff-0000-4000-8000-000000000000')).toBe(false);
      expect(await entra(B, DOIS_TENANTS.A.usuarios.admin)).toBe(false);
      const r = await q<{ f: string; definer: boolean; volatil: string; config: string[]; app: boolean; worker: boolean; portal: boolean }>(
        `select f, p.prosecdef as definer, p.provolatile::text as volatil, p.proconfig as config,
                has_function_privilege('macuxi_app', p.oid, 'execute') as app, has_function_privilege('macuxi_worker', p.oid, 'execute') as worker,
                has_function_privilege('macuxi_portal', p.oid, 'execute') as portal
           from unnest($1::text[]) f join pg_proc p on p.oid = f::regprocedure order by 1`,
        [[ENTRA, ...AS_4]],
      );
      const config = ['search_path=pg_catalog, plataforma, pg_temp'];
      expect(r.find((x) => x.f === ENTRA)).toEqual({ f: ENTRA, definer: false, volatil: 's', config, app: false, worker: false, portal: false });
      for (const f of AS_4) expect(r.find((x) => x.f === f), f).toEqual({ f, definer: true, volatil: 'v', config, app: false, worker: false, portal: true });
      for (const papel of ['macuxi_app', 'macuxi_worker', 'macuxi_portal']) {
        expect((await erroDe(como(papel, `select plataforma.usuario_entra_no_portal($1, $2)`, [A, DOIS_TENANTS.A.usuarios.admin])))?.code, papel).toBe('42501');
      }
    });
  });

  it('D-MP2: admin + vendedor não entra (0 linhas, como e-mail inexistente; sem sessão); tirar o vendedor devolve a entrada', async () => {
    await emTransacao(admin, null, async () => {
      const email = 'admv.0046@exemplo.com.br';
      const u = await criarAdmin(A, email, 'Admin que Vende 0046');
      expect(await contas(email)).toEqual([{ tipo: 'admin_cliente', conta_id: u, tenant_id: A }]);
      await vincular(A, u, idPerfilFabrica(A, 'vendedor'));
      await conferir(); // permitido: o admin da fixture segue com a gestão (último admin)
      expect(await contas(email)).toEqual([]);
      expect(await contas('ninguem.0046@exemplo.com.br')).toEqual([]);
      expect(await abrir([{ tenant_id: A, usuario_id: u }])).toBeUndefined();
      // a consulta vazia é auditada como qualquer outra (contas: 0), sem e-mail
      const aud = await q<{ detalhes: Record<string, unknown> }>("select detalhes from plataforma.auditoria_plataforma where acao = 'sa.login.consulta'");
      expect(aud.map((x) => x.detalhes.contas)).toEqual(expect.arrayContaining([1, 0]));
      expect(JSON.stringify(aud)).not.toContain('@');
      await desvincular(u, idPerfilFabrica(A, 'vendedor'));
      expect(await contas(email)).toEqual([{ tipo: 'admin_cliente', conta_id: u, tenant_id: A }]);
      expect(await abrir([{ tenant_id: A, usuario_id: u }])).toEqual({ sessao_id: expect.any(String), expira_em: expect.any(Date) });
    });
  });

  it('RN-CORE-35: admin + QUALQUER outra base (promotor, supervisor, gerente, analista, assistente, vendedor) não entra; = podeEntrar do SDK', async () => {
    for (const base of BASES_NAO_ADMIN) {
      await emTransacao(admin, null, async () => {
        const email = `adm-${base}.0046@exemplo.com.br`;
        const u = await criarAdmin(A, email, `Admin e ${base} 0046`);
        await vincular(A, u, idPerfilFabrica(A, base));
        await conferir();
        const sdk = podeEntrar([resolverPerfil(perfilDeFabrica('admin'), MATRIZ), resolverPerfil(perfilDeFabrica(base), MATRIZ)], 'portal');
        expect(sdk, base).toBe(false);
        expect(await entra(A, u), base).toBe(sdk);
        expect(await contas(email), base).toEqual([]);
        expect(await abrir([{ tenant_id: A, usuario_id: u }]), base).toBeUndefined();
      });
    }
  });

  it('dois perfis de base admin entram; acesso.portal revogado: sozinho fecha, junto do admin de fábrica não (união, como o SDK)', async () => {
    await emTransacao(admin, null, async () => {
      const email = 'adm-pers.0046@exemplo.com.br';
      const u = await criarAdmin(A, email, 'Admin Personalizado 0046');
      const pers = (await q<{ id: string }>("insert into plataforma.perfil (tenant_id, codigo, nome, base, cargo) values ($1, 'admin_sem_portal', 'Admin sem portal', 'admin', 'administrativo') returning id", [A]))[0]!.id;
      await vincular(A, u, pers);
      await conferir();
      expect(await contas(email)).toHaveLength(1);
      await q("insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, 'acesso.portal', false)", [A, pers]);
      await conferir();
      const sdk = (sobre: boolean) =>
        podeEntrar(
          [
            ...(sobre ? [resolverPerfil(perfilDeFabrica('admin'), MATRIZ)] : []),
            resolverPerfil({ codigo: 'admin_sem_portal', base: 'admin', ativo: true, fabrica: false, sobreposicoes: [{ chave: 'acesso.portal', concedida: false }] }, MATRIZ),
          ],
          'portal',
        );
      expect(sdk(true)).toBe(true);
      expect(await entra(A, u)).toBe(true);
      expect(await contas(email)).toHaveLength(1);
      // só o personalizado sem portal (o de fábrica sai): fecha
      await desvincular(u, idPerfilFabrica(A, 'admin'));
      await conferir();
      expect(sdk(false)).toBe(false);
      expect(await entra(A, u)).toBe(false);
      expect(await contas(email)).toEqual([]);
      // a sobreposição apagada (restaurar o padrão) devolve a entrada
      await q("update plataforma.perfil_permissao set deleted_at = now() where perfil_id = $1 and chave = 'acesso.portal'", [pers]);
      expect(await contas(email)).toHaveLength(1);
    });
  });

  it('perfil de outra base inativo ou vínculo apagado não conta (os mesmos perfis que perfis_do_usuario devolve à API)', async () => {
    await emTransacao(admin, null, async () => {
      const email = 'adm-inativo.0046@exemplo.com.br';
      const u = await criarAdmin(A, email, 'Admin com Gerente Inativo 0046');
      const ger = (await q<{ id: string }>("insert into plataforma.perfil (tenant_id, codigo, nome, base, cargo) values ($1, 'gerente_x0046', 'Gerente X', 'gerente', 'gerente') returning id", [A]))[0]!.id;
      await vincular(A, u, ger);
      expect(await contas(email)).toEqual([]);
      // sem COMMIT (a 0041 recusaria o vínculo vivo com perfil inativo): a função ignora o inativo, como o SDK
      await q('update plataforma.perfil set ativo = false where id = $1', [ger]);
      expect(await entra(A, u)).toBe(true);
      await q('update plataforma.perfil set ativo = true where id = $1', [ger]);
      expect(await entra(A, u)).toBe(false);
      await desvincular(u, ger);
      expect(await entra(A, u)).toBe(true);
    });
  });

  it('sessão viva: ganhar um perfil de outra base derruba a sessão na hora (sa_sessao_valida) e fecha a troca de empresa (sa_escolher_empresa)', async () => {
    await emTransacao(admin, null, async () => {
      const email = 'multi.0046@exemplo.com.br';
      const uA = await criarAdmin(A, email, 'Admin em Duas 0046');
      const uB = await criarAdmin(B, email, 'Admin em Duas 0046');
      await conferir();
      expect((await contas(email)).map((x) => x.conta_id).sort()).toEqual([uA, uB].sort());
      const s = (await abrir([{ tenant_id: A, usuario_id: uA }, { tenant_id: B, usuario_id: uB }]))!;
      expect(await valida(s.sessao_id)).toEqual([{ tenant_id: null, usuario_id: null }]);
      // em B a conta ganha o vendedor: B não abre mais; A abre
      await vincular(B, uB, idPerfilFabrica(B, 'vendedor'));
      await conferir();
      expect(await escolher(s.sessao_id, B)).toEqual([]);
      expect(await escolher(s.sessao_id, A)).toEqual([{ tenant_id: A, usuario_id: uA }]);
      expect(await valida(s.sessao_id)).toEqual([{ tenant_id: A, usuario_id: uA }]);
      // em A a conta ganha o supervisor: a sessão cai na hora, sem mudar a sessao_versao
      const versao = await q('select sessao_versao from core.usuario where id = $1', [uA]);
      await vincular(A, uA, idPerfilFabrica(A, 'supervisor'));
      await conferir();
      expect(await valida(s.sessao_id)).toEqual([]);
      expect(await q('select sessao_versao from core.usuario where id = $1', [uA])).toEqual(versao);
    });
  });

  it('multi-tenant: a mesma pessoa só entra na empresa em que é só admin; o vínculo de uma empresa não muda a outra', async () => {
    await emTransacao(admin, null, async () => {
      const email = 'duas.0046@exemplo.com.br';
      const uA = await criarAdmin(A, email, 'Pessoa em Duas 0046');
      const uB = await criarAdmin(B, email, 'Pessoa em Duas 0046');
      await vincular(B, uB, idPerfilFabrica(B, 'promotor'));
      await conferir();
      expect(await contas(email)).toEqual([{ tipo: 'admin_cliente', conta_id: uA, tenant_id: A }]);
      expect(await entra(A, uA)).toBe(true);
      expect(await entra(B, uB)).toBe(false);
      // conta de outra empresa: a de B pedida em A (ou o par trocado) não abre sessão, nem junto de uma que vale
      expect(await abrir([{ tenant_id: A, usuario_id: uB }])).toBeUndefined();
      expect(await abrir([{ tenant_id: B, usuario_id: uA }])).toBeUndefined();
      expect(await abrir([{ tenant_id: A, usuario_id: uA }, { tenant_id: B, usuario_id: uB }])).toBeUndefined();
      expect(await abrir([{ tenant_id: A, usuario_id: uA }])).toEqual({ sessao_id: expect.any(String), expira_em: expect.any(Date) });
      // os admins da fixture não mudaram
      expect((await contas('admin@exemplo.com.br')).map((x) => x.tenant_id)).toEqual([A]);
      expect((await contas('admin.b@exemplo.com.br')).map((x) => x.tenant_id)).toEqual([B]);
    });
  });
});

describe.skipIf(semBanco())('0046 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up acrescenta só a usuario_entra_no_portal (14 do portal); down volta exatamente ao catálogo, às ACLs e ao texto da 0045 (idempotente); up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0045' });
      const catalogo = await retratoDoCatalogo(c);
      const acl = await retratoAcl(c);
      const corpos = await corposDas4(c);
      expect((await migrarUp(c, { ate: '0046' })).aplicadas).toEqual(['0046_plataforma_portal_multiperfil']);
      const depois = await retratoDoCatalogo(c);
      const aclDepois = await retratoAcl(c);
      expect(depois.filter((l) => !catalogo.includes(l))).toEqual(['fn plataforma.usuario_entra_no_portal(p_tenant uuid, p_usuario uuid)']);
      expect(catalogo.filter((l) => !depois.includes(l))).toEqual([]);
      expect(aclDepois).toEqual(acl);
      const corposDepois = await corposDas4(c);
      for (const f of AS_4) expect(corposDepois[f], f).toContain(FILTRO);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0046_plataforma_portal_multiperfil']);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      expect(await retratoAcl(c)).toEqual(acl);
      expect(await corposDas4(c)).toEqual(corpos);
      await c.query(m46.down);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      expect(await corposDas4(c)).toEqual(corpos);

      await migrarUp(c, { ate: '0046' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect(await retratoAcl(c)).toEqual(aclDepois);
      expect(await corposDas4(c)).toEqual(corposDepois);
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

/** Texto do corpo das 4 sa_* recriadas. */
async function corposDas4(c: pg.ClientBase): Promise<Record<string, string>> {
  const r = await c.query<{ f: string; corpo: string }>('select f, p.prosrc as corpo from unnest($1::text[]) f join pg_proc p on p.oid = f::regprocedure', [[...AS_4]]);
  return Object.fromEntries(r.rows.map((x) => [x.f, x.corpo]));
}
