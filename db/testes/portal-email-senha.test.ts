/**
 * 0039 — portal config. só com e-mail e senha (T-0093 fatia B, ADR 0031; desenho docs/desenho/T-0093.md §3, §4, §7 e §10;
 * pedido R-20261107-145424-engenheiro-software; contrato R-20261107-150432-banco-dados; RN-CORE-31, RN-CORE-33, RN-CORE-34,
 * RN-AUD-01). O que o BANCO garante:
 * - as 12 sa_* do portal são SECURITY DEFINER, search_path fixo, EXECUTE só do macuxi_portal (macuxi_app e macuxi_worker:
 *   42501 em todas); a interna sa_registrar_auditoria e a criar_super_admin (deploy) não são executáveis por nenhum dos três;
 *   as 14 da 0035 (convite, TOTP, desafio, login por conta) não existem mais;
 * - o portal não lê tabela nenhuma: core.usuario, plataforma.tenant e as 3 tabelas novas = 42501 (só por função);
 * - sa_contas_para_login: só super-admin ativo e admin ativo, sem bloqueio, com senha, vivo, de empresa ativa (vendedor,
 *   inativo, bloqueado, apagado, sem senha e empresa suspensa ficam de fora); super-admin primeiro, empresas por nome; até 20;
 *   grava sa.login.consulta só com a contagem (sem e-mail);
 * - bloqueio por chave: 5ª falha seguida = 15 min; bloqueio vivo não conta nem estende; sucesso não desbloqueia;
 * - sessão: super-admin ou admin do cliente; 1 empresa = já escolhida; sa_escolher_empresa recusa tenant fora da lista e admin
 *   rebaixado; sa_sessao_valida cai na hora com o admin desativado ou a empresa suspensa; teto de 8 h; revogável;
 *   listar/tenant_ativo filtram pelo tipo; sa_provisionar_tenant só do super-admin, aceita admin e recusa redefinir_senha;
 * - criar_super_admin: idempotente, redefinir/desativar revogam as sessões, não desativa o último ativo;
 * - up/down: o down volta exatamente ao catálogo e às ACLs da 0038 (as 20 da 0035 de volta, executáveis pelo portal).
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero). Nada roda em base real.
 */
import { createHash } from 'node:crypto';
import { ListaEmpresasSchema, MODULOS } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { CRIAR_SUPER_ADMIN, FUNCOES_SA, FUNCOES_SA_0035, FUNCOES_SA_ATUAIS, FUNCOES_SA_REMOVIDAS_0039, SA_INTERNA, SA_INTERNA_0035 } from './funcoes-sa';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m39 = migracoes.find((m) => m.versao === '0039')!;
const m35 = migracoes.find((m) => m.versao === '0035')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const nome = (f: string) => f.slice(0, f.indexOf('('));
const TABELAS_0039 = ['plataforma.portal_tentativa', 'plataforma.portal_sessao', 'plataforma.portal_sessao_empresa'] as const;

/** Dados de mentira (nunca de uma pessoa real). */
const EMAIL_SA = 'operador.t93@macuxi.exemplo';
const EMAIL_CLI = 'cliente.t93@exemplo.com.br';
const H1 = '$argon2id$v=19$m=1,t=1,p=1$c2FsdW0$aGFzaHVt';
const H2 = '$argon2id$v=19$m=1,t=1,p=1$b3V0cm8$b3V0cm9oYXNo';
const H3 = '$argon2id$v=19$m=1,t=1,p=1$dGVyY2Vpcm8$dGVyY2Vpcm9oYXNo';
const chave = (s: string) => createHash('sha256').update(s).digest('hex');
const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const NENHUM = '00000000-0000-4000-8000-000000000000';
const TODOS = ['admin', 'analista', 'assistente', 'supervisor', 'gerente', 'vendedor', 'promotor'];
/** Entrada do passo Empresa (a mesma forma de EntradaProvisionarPlataforma em apps/api/src/plataforma.ts). */
const entradaEmpresa = (codigo: string, extra: Record<string, unknown> = {}) => ({
  codigo, nome: 'Distribuidora T93', documento: '12345678000195', fuso: 'America/Manaus', plano: 'piloto',
  modulos: [{ modulo: 'core', licencas: null, perfis: TODOS }, { modulo: 'vendedor', licencas: 5, perfis: ['admin', 'vendedor'] }],
  ...extra,
});

describe('0039 portal só com e-mail e senha (estático)', () => {
  const sql = semComentarios(m39.up);

  it('nome e posição: 0039_plataforma_portal_email_senha logo depois da 0038', () => {
    expect(m39.nome).toBe('plataforma_portal_email_senha');
    expect(migracoes[38]?.versao).toBe('0039');
  });

  it('toda sa_* criada ou reescrita: SECURITY DEFINER, search_path com pg_temp por último, revoke de PUBLIC/app/worker e EXECUTE só ao portal', () => {
    const criadas = [...sql.matchAll(/create (?:or replace )?function (plataforma\.sa_[a-z_]+)\([^)]*\)[^;]*?language [a-z]+ [a-z]+ security (definer|invoker)\s+set search_path = ([^\n]+)/g)];
    const definers = criadas.filter((x) => x[2] === 'definer');
    expect(definers.map((x) => x[1]).sort()).toEqual(FUNCOES_SA.map(nome).sort());
    for (const x of criadas) expect(x[3], x[1]).toBe('pg_catalog, plataforma, pg_temp');
    expect(criadas.filter((x) => x[2] === 'invoker').map((x) => x[1])).toEqual([nome(SA_INTERNA)]);
    for (const f of FUNCOES_SA) {
      expect(sql).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(sql).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    const grants = [...sql.matchAll(/^grant ([^;]+);/gm)].map((g) => g[1]!);
    expect(grants.sort()).toEqual(FUNCOES_SA.map((f) => `execute on function ${f} to macuxi_portal`).sort());
    expect(sql).not.toMatch(/to macuxi_(app|worker)\b/);
    expect(sql).not.toMatch(/alter role|create role|bypassrls|\bsuperuser\b/i);
    expect(sql).toContain(`revoke all on function ${SA_INTERNA} from public;`);
    // deploy: fora do prefixo sa_, do invocador, ninguém executa além do dono
    expect(sql).toMatch(/create function plataforma\.criar_super_admin\(p jsonb\)\s+returns jsonb\s+language plpgsql volatile security invoker/);
    expect(sql).toContain(`revoke all on function ${CRIAR_SUPER_ADMIN} from public;`);
    expect(sql).not.toMatch(/grant [^;]*criar_super_admin/);
    // conferência pelo catálogo no fim
    expect(sql).toContain('if v_n <> 12 then');
    expect(FUNCOES_SA).toHaveLength(12);
  });

  it('saem as 14 da 0035 e a interna de 5 argumentos (drop); a sa_sessao_valida é recriada (retorno novo)', () => {
    for (const f of [...FUNCOES_SA_REMOVIDAS_0039, SA_INTERNA_0035, 'plataforma.sa_sessao_valida(uuid)']) {
      expect(sql).toContain(`drop function if exists ${f};`);
    }
    expect(FUNCOES_SA_0035.filter((f) => !(FUNCOES_SA_REMOVIDAS_0039 as readonly string[]).includes(f)).sort())
      .toEqual(FUNCOES_SA.filter((f) => FUNCOES_SA_0035.includes(f as never)).sort());
    expect(sql).toMatch(/create function plataforma\.sa_sessao_valida\(p_sid uuid\)\s+returns table \(tipo text, super_admin_id uuid, tenant_id uuid, usuario_id uuid, expira_em timestamptz\)/);
  });

  it('tabelas novas sem tenant_id (a empresa em tenant_alvo_id), RLS forçado, só a manutencao, nenhum grant; e-mail nunca na tentativa', () => {
    for (const t of TABELAS_0039) {
      expect(TABELAS_SO_POR_FUNCAO as readonly string[]).toContain(t);
      expect(t in TABELAS_SEM_TENANT_ID).toBe(true);
      const corpo = new RegExp(`create table ${t.replace('.', '\\.')} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? '';
      expect(corpo, t).not.toBe('');
      expect(corpo, t).not.toMatch(/^\s+tenant_id\s/m);
      expect(corpo, t).not.toMatch(/email/);
      expect(sql).toContain(`alter table ${t} force row level security;`);
      expect(sql).toContain(`revoke all on ${t} from public, macuxi_app, macuxi_worker;`);
      expect([...sql.matchAll(new RegExp(`create policy ([a-z_]+) on ${t.replace('.', '\\.')} `, 'g'))].map((x) => x[1])).toEqual(['manutencao']);
    }
    expect(sql).not.toMatch(/grant [a-z, ]+ on plataforma\.portal_/);
    expect(sql).toContain("constraint portal_tentativa_chave_formato check (chave ~ '^[0-9a-f]{64}$')");
    expect(sql).toContain('create index usuario_admin_email_ix on core.usuario (lower(email)) where deleted_at is null and perfil = \'admin\';');
    expect(sql).toContain('alter table plataforma.auditoria_plataforma add column ator_tipo text;');
    expect(sql).toContain('alter table plataforma.auditoria_plataforma add column usuario_id uuid;');
  });

  it('sa_listar_tenants só devolve os módulos do contrato (MODULOS do platform-sdk)', () => {
    const lista = /tm\.modulo = any \(array\[([^\]]+)\]\)/.exec(m39.up)?.[1] ?? '';
    expect([...lista.matchAll(/'([a-z]+)'/g)].map((x) => x[1])).toEqual([...MODULOS]);
  });

  it('down: apaga o que a 0039 cria e recria as 20 da 0035 e a interna com o texto EXATO da 0035, EXECUTE ao portal', () => {
    const down = m39.down;
    for (const f of [...FUNCOES_SA, SA_INTERNA, CRIAR_SUPER_ADMIN]) expect(down).toContain(`drop function if exists ${f};`);
    for (const t of TABELAS_0039) expect(down).toContain(`drop table if exists ${t};`);
    expect(down).toContain('drop index if exists core.usuario_admin_email_ix;');
    expect(down).toContain('alter table plataforma.auditoria_plataforma drop column if exists ator_tipo;');
    expect(down).toContain('alter table plataforma.auditoria_plataforma drop column if exists usuario_id;');
    // cada create function da 0035 (sa_*) aparece igual no down
    // fim do corpo: "$$;" (plpgsql) ou "  $$;" (sql)
    const blocos = [...m35.up.matchAll(/^create function plataforma\.sa_[\s\S]*?^ {0,2}\$\$;$/gm)].map((x) => x[0]);
    expect(blocos).toHaveLength(21);
    for (const b of blocos) expect(down, b.slice(0, 60)).toContain(b);
    for (const f of FUNCOES_SA_0035) {
      expect(down).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(down).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    expect(down).not.toMatch(/to macuxi_(app|worker)\b/);
  });
});

describe.skipIf(semBanco())('0039 portal só com e-mail e senha (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  /** Roda como o papel dado dentro da transação aberta (savepoint: um erro não aborta a transação do caso). */
  async function como<T extends pg.QueryResultRow = Record<string, unknown>>(papel: string, sql: string, params: unknown[] = []): Promise<T[]> {
    await admin.query('savepoint como');
    try {
      await admin.query(`set local role ${papel}`);
      const r = await admin.query<T>(sql, params);
      await admin.query('reset role');
      await admin.query('release savepoint como');
      return r.rows;
    } catch (e) {
      await admin.query('rollback to savepoint como');
      throw e;
    }
  }
  const portal = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => como<T>('macuxi_portal', sql, params);
  const um = async <T>(sql: string, params: unknown[] = []): Promise<T> => ((await portal<{ r: T }>(`select ${sql} as r`, params))[0]!).r;
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  /** Erro de um comando do admin sem abortar a transação do caso. */
  async function erroAdmin(sql: string, params: unknown[] = []) {
    await admin.query('savepoint e');
    const erro = await erroDe(admin.query(sql, params));
    await admin.query(erro ? 'rollback to savepoint e' : 'release savepoint e');
    return erro;
  }

  const criarSuperAdmin = async (email = EMAIL_SA, hash = H1) =>
    (await q<{ r: { resultado: string; super_admin_id: string; sessoes_revogadas: number } }>('select plataforma.criar_super_admin($1::jsonb) as r', [
      JSON.stringify({ acao: 'criar', email, nome: 'Operador T93', senha_hash: hash }),
    ]))[0]!.r;
  const superAdmin = async (p: Record<string, unknown>) =>
    (await q<{ r: { resultado: string; super_admin_id: string | null; sessoes_revogadas: number } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify(p)]))[0]!.r;
  const usuario = async (tenant: string, email: string, perfil: string, hash: string | null = H2): Promise<string> =>
    (await q<{ id: string }>('insert into core.usuario (tenant_id, nome, email, perfil, ativo, senha_hash) values ($1, $2, $3, $4, true, $5) returning id', [
      tenant, `Usuário T93 ${perfil}`, email, perfil, hash,
    ]))[0]!.id;
  const contas = async (email: string) =>
    portal<{ tipo: string; conta_id: string; tenant_id: string | null; tenant_codigo: string | null; tenant_nome: string | null; senha_hash: string }>(
      'select * from plataforma.sa_contas_para_login($1)', [email]);
  const abrir = async (p: unknown) => (await portal<{ sessao_id: string; expira_em: Date }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)]))[0];
  const valida = async (sid: string) => portal<{ tipo: string; super_admin_id: string | null; tenant_id: string | null; usuario_id: string | null; expira_em: Date }>(
    'select * from plataforma.sa_sessao_valida($1)', [sid]);
  const escolher = async (sid: string, tenant: string) => portal<{ tenant_id: string; usuario_id: string; codigo: string; nome: string }>(
    'select * from plataforma.sa_escolher_empresa($1, $2)', [sid, tenant]);
  const auditoria = async () => q<{ acao: string; ator_tipo: string | null; super_admin_id: string | null; usuario_id: string | null; sessao_id: string | null; tenant_alvo_id: string | null; detalhes: Record<string, unknown> }>(
    'select acao, ator_tipo, super_admin_id, usuario_id, sessao_id, tenant_alvo_id, detalhes from plataforma.auditoria_plataforma order by ocorrido_em, acao');
  const agora = async () => (await q<{ t: Date }>('select now() as t'))[0]!.t;
  const nomeDe = async (t: string) => (await q<{ nome: string; codigo: string }>('select nome, codigo from plataforma.tenant where id = $1', [t]))[0]!;

  it('catálogo: as 12 sa_* SECURITY DEFINER, search_path fixo, só o portal executa; interna e criar_super_admin por ninguém; as 14 da 0035 não existem', async () => {
    const r = await q<{ f: string; definer: boolean; config: string[]; portal: boolean; app: boolean; worker: boolean; publico: boolean }>(
      `select f, p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('macuxi_portal', p.oid, 'execute') as portal,
              has_function_privilege('macuxi_app', p.oid, 'execute') as app,
              has_function_privilege('macuxi_worker', p.oid, 'execute') as worker,
              coalesce((select bool_or(a.grantee = 0) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE'), false) as publico
         from unnest($1::text[]) f join pg_proc p on p.oid = f::regprocedure`,
      [[...FUNCOES_SA]],
    );
    expect(r).toHaveLength(FUNCOES_SA.length);
    for (const { f, ...resto } of r) {
      expect(resto, f).toEqual({ definer: true, config: ['search_path=pg_catalog, plataforma, pg_temp'], portal: true, app: false, worker: false, publico: false });
    }
    const outras = await q<{ f: string; definer: boolean; algum: boolean }>(
      `select f, p.prosecdef as definer,
              has_function_privilege('macuxi_portal', p.oid, 'execute') or has_function_privilege('macuxi_app', p.oid, 'execute')
                or has_function_privilege('macuxi_worker', p.oid, 'execute') as algum
         from unnest($1::text[]) f join pg_proc p on p.oid = f::regprocedure order by 1`,
      [[SA_INTERNA, CRIAR_SUPER_ADMIN]],
    );
    expect(outras).toEqual([{ f: CRIAR_SUPER_ADMIN, definer: false, algum: false }, { f: SA_INTERNA, definer: false, algum: false }]);
    const sumidas = await q<{ f: string }>('select f from unnest($1::text[]) f where to_regprocedure(f) is not null', [[...FUNCOES_SA_REMOVIDAS_0039, SA_INTERNA_0035]]);
    expect(sumidas).toEqual([]);
    // pelo catálogo (banco na última): nenhuma sa_* fora das listas; a 0042 acrescenta as 2 do super-admin (portal-redefinir-senha.test.ts)
    const todas = await q<{ f: string }>(
      `select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'plataforma' and p.proname like 'sa\\_%' order by 1`);
    expect(todas.map((x) => x.f.replace(/,/g, ', ')).sort()).toEqual([...FUNCOES_SA_ATUAIS, SA_INTERNA].sort());
  });

  it('macuxi_app e macuxi_worker: 42501 em toda sa_* nova e na criar_super_admin; macuxi_portal: 42501 na criar_super_admin', async () => {
    await emTransacao(admin, null, async () => {
      const chamada = (f: string) => {
        const tipos = f.slice(f.indexOf('(') + 1, -1).split(', ').filter(Boolean);
        return `select ${nome(f)}(${tipos.map((t) => `null::${t}`).join(', ')})`;
      };
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        for (const f of [...FUNCOES_SA, CRIAR_SUPER_ADMIN]) expect((await erroDe(como(papel, chamada(f))))?.code, `${papel} ${f}`).toBe('42501');
      }
      expect((await erroDe(como('macuxi_portal', chamada(CRIAR_SUPER_ADMIN))))?.code).toBe('42501');
      expect((await erroDe(como('macuxi_portal', chamada(SA_INTERNA))))?.code).toBe('42501');
    });
  });

  it('macuxi_portal: 42501 em select/insert/delete direto de core.usuario, plataforma.tenant e das tabelas novas', async () => {
    await emTransacao(admin, null, async () => {
      for (const t of ['core.usuario', 'plataforma.tenant', ...TABELAS_0039, 'plataforma.auditoria_plataforma']) {
        expect((await erroDe(portal(`select 1 from ${t} limit 1`)))?.code, t).toBe('42501');
        expect((await erroDe(portal(`delete from ${t}`)))?.code, `delete ${t}`).toBe('42501');
      }
      expect((await erroDe(portal("insert into plataforma.portal_tentativa (chave) values (repeat('a', 64))")))?.code).toBe('42501');
    });
  });

  it('sa_contas_para_login: admin ativo de empresa ativa por nome; super-admin primeiro; vendedor, inativo, bloqueado, apagado, sem senha e empresa suspensa ficam de fora; grava sa.login.consulta sem e-mail', async () => {
    await emTransacao(admin, null, async () => {
      const uA = await usuario(A, EMAIL_CLI, 'admin', H2);
      const uB = await usuario(B, EMAIL_CLI.toUpperCase(), 'admin', H3);
      const c = (await q<{ id: string }>("insert into plataforma.tenant (codigo, nome) values ('t93-gama', 'Gama T93') returning id"))[0]!.id;
      await usuario(c, EMAIL_CLI, 'vendedor');
      const [nA, nB] = [await nomeDe(A), await nomeDe(B)];
      const esperado = [
        // 0040 (T-0094): + trocar_senha, senha_expira_em e sessao_versao (senha-email-saida.test.ts)
        { tipo: 'admin_cliente', conta_id: uA, tenant_id: A, tenant_codigo: nA.codigo, tenant_nome: nA.nome, senha_hash: H2, trocar_senha: false, senha_expira_em: null, sessao_versao: 0 },
        { tipo: 'admin_cliente', conta_id: uB, tenant_id: B, tenant_codigo: nB.codigo, tenant_nome: nB.nome, senha_hash: H3, trocar_senha: false, senha_expira_em: null, sessao_versao: 0 },
      ].sort((x, y) => x.tenant_nome.localeCompare(y.tenant_nome));
      expect(await contas(`  ${EMAIL_CLI.toUpperCase()} `)).toEqual(esperado);

      // cada exclusão, uma por vez (savepoint), deixa só a outra empresa
      for (const [caso, sql, params] of [
        ['inativo', 'update core.usuario set ativo = false where id = $1', [uA]],
        ['bloqueado', 'update core.usuario set bloqueado_em = now() where id = $1', [uA]],
        ['apagado', 'update core.usuario set deleted_at = now() where id = $1', [uA]],
        ['sem senha', 'update core.usuario set senha_hash = null where id = $1', [uA]],
        ['rebaixado', "update core.usuario set perfil = 'analista' where id = $1", [uA]],
        ['empresa suspensa', "update plataforma.tenant set status = 'suspenso' where id = $1", [A]],
        ['empresa apagada', 'update plataforma.tenant set deleted_at = now() where id = $1', [A]],
      ] as const) {
        await admin.query('savepoint caso');
        await admin.query(sql, [...params]);
        expect((await contas(EMAIL_CLI)).map((x) => x.conta_id), caso).toEqual([uB]);
        await admin.query('rollback to savepoint caso');
      }

      // super-admin com o mesmo e-mail vem primeiro, sem empresa
      const sa = await criarSuperAdmin(EMAIL_CLI);
      expect((await contas(EMAIL_CLI))[0]).toEqual({ tipo: 'super_admin', conta_id: sa.super_admin_id, tenant_id: null, tenant_codigo: null, tenant_nome: null, senha_hash: H1, trocar_senha: false, senha_expira_em: null, sessao_versao: null });
      expect(await contas(EMAIL_CLI)).toHaveLength(3);
      await admin.query('update plataforma.super_admin set ativo = false where id = $1', [sa.super_admin_id]);
      expect((await contas(EMAIL_CLI)).map((x) => x.tipo)).toEqual(['admin_cliente', 'admin_cliente']);

      // e-mail que não existe, vazio ou fora do formato: 0 linhas, sem erro
      for (const e of ['ninguem.t93@exemplo.com.br', '', 'sem-arroba', null]) expect(await contas(e as string), String(e)).toEqual([]);

      // 8 consultas fora dos savepoints desfeitos: 2, 3, 3, 2 e quatro de 0 (na mesma transação o now() é igual: sem ordem)
      const consultas = (await auditoria()).filter((a) => a.acao === 'sa.login.consulta');
      expect(consultas.map((x) => x.detalhes.contas).sort()).toEqual([0, 0, 0, 0, 2, 2, 3, 3]);
      for (const x of consultas) {
        expect(x).toMatchObject({ ator_tipo: null, super_admin_id: null, usuario_id: null, sessao_id: null, tenant_alvo_id: null, detalhes: { origem: 'banco' } });
      }
      expect(JSON.stringify(await auditoria())).not.toMatch(/cliente\.t93|CLIENTE\.T93|argon2id/);
    });
  });

  it('sa_contas_para_login: no máximo 20 linhas (as primeiras por nome da empresa)', async () => {
    await emTransacao(admin, null, async () => {
      await q("insert into plataforma.tenant (codigo, nome) select 't93-l' || g, 'Lote T93 ' || lpad(g::text, 2, '0') from generate_series(1, 21) g");
      await q("insert into core.usuario (tenant_id, nome, email, perfil, ativo, senha_hash) select id, 'Admin Lote', 'muitas.t93@exemplo.com.br', 'admin', true, $1 from plataforma.tenant where codigo like 't93-l%'", [H2]);
      const r = await contas('muitas.t93@exemplo.com.br');
      expect(r).toHaveLength(20);
      expect(r.map((x) => x.tenant_nome)).toEqual(Array.from({ length: 20 }, (_, i) => `Lote T93 ${String(i + 1).padStart(2, '0')}`));
    });
  });

  it('bloqueio por chave: 5ª falha seguida = 15 min; bloqueio vivo não conta nem estende; sucesso não desbloqueia; vencido recomeça; chave fora do formato = 22023', async () => {
    await emTransacao(admin, null, async () => {
      const k = chave('portal.login:ninguem.t93@exemplo.com.br');
      const estado = async () => (await portal<{ falhas: number; bloqueado_ate: Date | null }>('select * from plataforma.sa_tentativa_estado($1)', [k]))[0];
      const falha = async () => (await portal<{ falhas: number; bloqueado_ate: Date | null }>('select * from plataforma.sa_tentativa_falha($1)', [k]))[0];
      expect(await estado()).toEqual({ falhas: 0, bloqueado_ate: null });
      for (let i = 1; i <= 4; i++) expect(await falha()).toEqual({ falhas: i, bloqueado_ate: null });
      const bloq = (await falha())!;
      expect(bloq.falhas).toBe(0);
      expect(bloq.bloqueado_ate!.getTime() - (await agora()).getTime()).toBe(15 * 60 * 1000);
      expect(await falha()).toEqual(bloq);
      expect(await estado()).toEqual(bloq);
      await portal('select plataforma.sa_tentativa_sucesso($1)', [k]);
      expect(await estado()).toEqual(bloq);
      expect((await auditoria()).filter((a) => a.acao === 'sa.bloqueio')).toEqual([expect.objectContaining({ ator_tipo: null, detalhes: { minutos: 15, origem: 'banco' } })]);
      // vencido: estado sem bloqueio; a próxima falha conta 1
      await admin.query("update plataforma.portal_tentativa set bloqueado_ate = now() - interval '1 second' where chave = $1", [k]);
      expect(await estado()).toEqual({ falhas: 0, bloqueado_ate: null });
      expect(await falha()).toEqual({ falhas: 1, bloqueado_ate: null });
      await portal('select plataforma.sa_tentativa_sucesso($1)', [k]);
      expect(await q('select 1 from plataforma.portal_tentativa where chave = $1', [k])).toEqual([]);
      for (const f of ['sa_tentativa_estado', 'sa_tentativa_falha', 'sa_tentativa_sucesso']) {
        for (const ruim of ['ninguem@exemplo.com.br', k.toUpperCase(), '', null]) {
          expect((await erroDe(portal(`select plataforma.${f}($1)`, [ruim])))?.code, `${f} ${String(ruim).slice(0, 10)}`).toBe('22023');
        }
      }
    });
  });

  it('sessão do super-admin: 8 h, vê todas as empresas, tenant_ativo pelo status; não escolhe empresa; cai com o super-admin inativo', async () => {
    await emTransacao(admin, null, async () => {
      const sa = await criarSuperAdmin();
      const s = (await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }))!;
      expect(s.expira_em.getTime() - (await agora()).getTime()).toBe(8 * 3600 * 1000);
      expect(await valida(s.sessao_id)).toEqual([{ tipo: 'super_admin', super_admin_id: sa.super_admin_id, tenant_id: null, usuario_id: null, expira_em: s.expira_em }]);
      const lista = ListaEmpresasSchema.parse(await um('plataforma.sa_listar_tenants($1)', [s.sessao_id]));
      expect(lista.itens.map((t) => t.id)).toEqual(expect.arrayContaining([A, B]));
      expect(await um<boolean>('plataforma.sa_tenant_ativo($1, $2)', [s.sessao_id, A])).toBe(true);
      expect(await um<boolean>('plataforma.sa_tenant_ativo($1, $2)', [s.sessao_id, NENHUM])).toBe(false);
      expect(await escolher(s.sessao_id, A)).toEqual([]);
      expect((await auditoria()).find((a) => a.acao === 'sa.sessao.aberta')).toMatchObject({ ator_tipo: 'super_admin', super_admin_id: sa.super_admin_id, sessao_id: s.sessao_id });
      await admin.query('update plataforma.super_admin set ativo = false where id = $1', [sa.super_admin_id]);
      expect(await valida(s.sessao_id)).toEqual([]);
      expect(await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id })).toBeUndefined();
      expect((await erroDe(portal('select plataforma.sa_listar_tenants($1)', [s.sessao_id])))?.code).toBe('28000');
    });
  });

  it('sessão do admin do cliente: lista só as conferidas; escolher recusa tenant fora da lista e admin rebaixado; valida cai na hora com admin desativado ou empresa suspensa', async () => {
    await emTransacao(admin, null, async () => {
      const uA = await usuario(A, EMAIL_CLI, 'admin');
      const uB = await usuario(B, EMAIL_CLI, 'admin');
      const s = (await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: uA }, { tenant_id: B, usuario_id: uB }] }))!;
      expect(await valida(s.sessao_id)).toEqual([{ tipo: 'admin_cliente', super_admin_id: null, tenant_id: null, usuario_id: null, expira_em: s.expira_em }]);
      // sem empresa: lista as duas; nenhuma ativa para requisição de tenant
      const lista = ListaEmpresasSchema.parse(await um('plataforma.sa_listar_tenants($1)', [s.sessao_id]));
      expect(lista.itens.map((t) => t.id).sort()).toEqual([A, B].sort());
      expect(await um<boolean>('plataforma.sa_tenant_ativo($1, $2)', [s.sessao_id, A])).toBe(false);
      // tenant fora da lista (existe, mas a senha não conferiu lá) e tenant inexistente: nada
      const c = (await q<{ id: string }>("insert into plataforma.tenant (codigo, nome) values ('t93-gama', 'Gama T93') returning id"))[0]!.id;
      await usuario(c, EMAIL_CLI, 'admin');
      expect(await escolher(s.sessao_id, c)).toEqual([]);
      expect(await escolher(s.sessao_id, NENHUM)).toEqual([]);
      // escolhe A, depois B: a empresa atual troca; tenant_ativo só a atual
      const nA = await nomeDe(A);
      expect(await escolher(s.sessao_id, A)).toEqual([{ tenant_id: A, usuario_id: uA, codigo: nA.codigo, nome: nA.nome }]);
      expect(await valida(s.sessao_id)).toEqual([expect.objectContaining({ tipo: 'admin_cliente', tenant_id: A, usuario_id: uA })]);
      expect(await um<boolean>('plataforma.sa_tenant_ativo($1, $2)', [s.sessao_id, A])).toBe(true);
      expect(await um<boolean>('plataforma.sa_tenant_ativo($1, $2)', [s.sessao_id, B])).toBe(false);
      expect(await escolher(s.sessao_id, B)).toEqual([expect.objectContaining({ tenant_id: B, usuario_id: uB })]);
      expect(await um<boolean>('plataforma.sa_tenant_ativo($1, $2)', [s.sessao_id, A])).toBe(false);
      const escolhas = (await auditoria()).filter((a) => a.acao === 'sa.empresa.escolher');
      expect(escolhas.map((a) => `${a.ator_tipo} ${a.usuario_id} ${a.tenant_alvo_id} ${a.sessao_id}`).sort())
        .toEqual([`admin_cliente ${uA} ${A} ${s.sessao_id}`, `admin_cliente ${uB} ${B} ${s.sessao_id}`].sort());
      // só o super-admin provisiona
      expect((await erroDe(portal('select plataforma.sa_provisionar_tenant($1, $2::jsonb)', [s.sessao_id, JSON.stringify(entradaEmpresa('t93-cli'))])))?.code).toBe('28000');
      // admin rebaixado em A: não escolhe A
      await admin.query("update core.usuario set perfil = 'analista' where id = $1", [uA]);
      expect(await escolher(s.sessao_id, A)).toEqual([]);
      expect(await valida(s.sessao_id)).toEqual([expect.objectContaining({ tenant_id: B })]);
      // admin de B desativado com B escolhida: cai na hora (sem esperar o token)
      await admin.query('savepoint desativa');
      await admin.query('update core.usuario set ativo = false where id = $1', [uB]);
      expect(await valida(s.sessao_id)).toEqual([]);
      expect(await um<boolean>('plataforma.sa_tenant_ativo($1, $2)', [s.sessao_id, B])).toBe(false);
      await admin.query('rollback to savepoint desativa');
      // empresa B suspensa: cai também
      await admin.query("update plataforma.tenant set status = 'suspenso' where id = $1", [B]);
      expect(await valida(s.sessao_id)).toEqual([]);
      expect((await erroDe(portal('select plataforma.sa_listar_tenants($1)', [s.sessao_id])))?.code).toBe('28000');
    });
  });

  it('sa_abrir_sessao_portal: 1 empresa = já escolhida; conta que deixou de valer = sem sessão; entrada fora do formato = 22023', async () => {
    await emTransacao(admin, null, async () => {
      const uA = await usuario(A, EMAIL_CLI, 'admin');
      const s = (await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: uA }] }))!;
      expect(await valida(s.sessao_id)).toEqual([expect.objectContaining({ tipo: 'admin_cliente', tenant_id: A, usuario_id: uA })]);
      expect((await auditoria()).find((a) => a.acao === 'sa.sessao.aberta')).toMatchObject({ ator_tipo: 'admin_cliente', usuario_id: uA, tenant_alvo_id: A, detalhes: { empresas: 1, origem: 'banco' } });
      // vendedor, usuário de outro tenant, admin inativo: nada (nem sessão parcial)
      const vend = await usuario(B, 'vend.t93@exemplo.com.br', 'vendedor');
      const antes = (await q<{ n: number }>('select count(*)::int as n from plataforma.portal_sessao'))[0]!.n;
      expect(await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: uA }, { tenant_id: B, usuario_id: vend }] })).toBeUndefined();
      expect(await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: B, usuario_id: uA }] })).toBeUndefined();
      expect((await q<{ n: number }>('select count(*)::int as n from plataforma.portal_sessao'))[0]!.n).toBe(antes);
      const sa = await criarSuperAdmin();
      for (const ruim of [
        null, [], { tipo: 'outro' }, { tipo: 'super_admin' }, { tipo: 'super_admin', super_admin_id: 'eu' },
        { tipo: 'super_admin', super_admin_id: sa.super_admin_id, empresas: [] },
        { tipo: 'admin_cliente', empresas: [] }, { tipo: 'admin_cliente', empresas: [{ tenant_id: A }] },
        { tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: uA }, { tenant_id: A, usuario_id: uA }] },
        { tipo: 'admin_cliente', empresas: Array.from({ length: 21 }, () => ({ tenant_id: A, usuario_id: uA })) },
        { tipo: 'admin_cliente', super_admin_id: sa.super_admin_id, empresas: [{ tenant_id: A, usuario_id: uA }] },
      ]) {
        expect((await erroDe(portal('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(ruim)])))?.code, JSON.stringify(ruim)?.slice(0, 50)).toBe('22023');
      }
    });
  });

  it('revogar, teto de 8 h e coerência da sessão (CHECK e FK da empresa atual)', async () => {
    await emTransacao(admin, null, async () => {
      const sa = await criarSuperAdmin();
      const s = (await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }))!;
      expect(await um<boolean>('plataforma.sa_revogar($1)', [s.sessao_id])).toBe(true);
      expect(await valida(s.sessao_id)).toEqual([]);
      expect(await um<boolean>('plataforma.sa_revogar($1)', [s.sessao_id])).toBe(false);
      expect((await auditoria()).filter((a) => a.acao === 'sa.sessao.revogada')).toEqual([expect.objectContaining({ ator_tipo: 'super_admin', super_admin_id: sa.super_admin_id })]);
      const vencida = (await q<{ id: string }>(
        `insert into plataforma.portal_sessao (tipo, super_admin_id, criada_em, ultimo_uso_em, expira_em)
         values ('super_admin', $1, now() - interval '8 hours 1 minute', now() - interval '8 hours 1 minute', now() - interval '1 minute') returning id`, [sa.super_admin_id]))[0]!.id;
      expect(await valida(vencida)).toEqual([]);
      expect((await erroAdmin("insert into plataforma.portal_sessao (tipo, super_admin_id, expira_em) values ('super_admin', $1, now() + interval '9 hours')", [sa.super_admin_id]))?.code).toBe('23514');
      expect((await erroAdmin("insert into plataforma.portal_sessao (tipo, expira_em) values ('super_admin', now() + interval '1 hour')"))?.code).toBe('23514');
      expect((await erroAdmin("insert into plataforma.portal_sessao (tipo, super_admin_id, tenant_atual_id, usuario_atual_id, expira_em) values ('admin_cliente', null, $1, $1, now() + interval '1 hour')", [A]))?.code).toBe('23503');
      expect((await erroAdmin("insert into plataforma.portal_tentativa (chave) values ('nao-hex')"))?.code).toBe('23514');
    });
  });

  it('sa_provisionar_tenant: só super-admin; aceita admin {email, nome, senha_hash} (criado, depois existente sem trocar a senha); empresa nova sem admin = 22023/RN-CORE-34; recusa redefinir_senha e sem_admin', async () => {
    await emTransacao(admin, null, async () => {
      const sa = await criarSuperAdmin();
      const s = (await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }))!;
      const adm = { email: 'admin.novo.t93@exemplo.com.br', nome: 'Admin Novo', senha_hash: H2 };
      const r1 = await um<Record<string, unknown>>('plataforma.sa_provisionar_tenant($1, $2::jsonb)', [s.sessao_id, JSON.stringify(entradaEmpresa('t93-nova', { admin: adm }))]);
      expect(r1).toMatchObject({ resultado: 'criado', admin: 'criado', avisos: [] });
      const tenant = r1.tenant_id as string;
      const criado = await q('select perfil, ativo, senha_hash from core.usuario where tenant_id = $1', [tenant]);
      expect(criado).toEqual([{ perfil: 'admin', ativo: true, senha_hash: H2 }]);
      expect(await q('select usuario_id from plataforma.auditoria where tenant_id = $1 and acao = $2', [tenant, 'tenant.provisionar'])).toEqual([{ usuario_id: sa.super_admin_id }]);
      // o admin inicial já entra pelo portal
      expect((await contas(adm.email)).map((x) => x.tenant_id)).toEqual([tenant]);
      // empresa existente: o admin fica como está (RN-CORE-31), a senha não muda
      const r2 = await um<Record<string, unknown>>('plataforma.sa_provisionar_tenant($1, $2::jsonb)', [s.sessao_id, JSON.stringify(entradaEmpresa('t93-nova', { admin: { ...adm, senha_hash: H3 } }))]);
      expect(r2).toMatchObject({ tenant_id: tenant, resultado: 'sem_mudanca', admin: 'existente' });
      expect(await q('select senha_hash from core.usuario where tenant_id = $1', [tenant])).toEqual([{ senha_hash: H2 }]);
      // sem admin = sem_admin (empresa existente ganhando módulo)
      expect(await um<Record<string, unknown>>('plataforma.sa_provisionar_tenant($1, $2::jsonb)', [s.sessao_id, JSON.stringify(entradaEmpresa('t93-nova'))]))
        .toMatchObject({ admin: 'sem_admin', resultado: 'sem_mudanca' });
      expect((await auditoria()).filter((a) => a.acao === 'sa.tenant.provisionar').map((a) => `${a.ator_tipo} ${String(a.detalhes.admin)}`).sort())
        .toEqual(['super_admin criado', 'super_admin existente', 'super_admin sem_admin']);
      // empresa NOVA sem admin: 22023 com hint RN-CORE-34 (a API traduz em 422); nada é criado
      const semAdmin = await portal('select plataforma.sa_provisionar_tenant($1, $2::jsonb)', [s.sessao_id, JSON.stringify(entradaEmpresa('t93-sem-admin'))])
        .then(() => null, (e: { code?: string; hint?: string }) => ({ code: e.code, hint: e.hint }));
      expect(semAdmin).toEqual({ code: '22023', hint: 'RN-CORE-34' });
      expect(await q("select codigo from plataforma.tenant where codigo = 't93-sem-admin'")).toEqual([]);
      for (const extra of [{ admin: adm, redefinir_senha: true }, { redefinir_senha: false }, { sem_admin: true }, { admin: { ...adm, senha_hash: 'senha-em-claro-123' } }]) {
        const erro = await erroDe(portal('select plataforma.sa_provisionar_tenant($1, $2::jsonb)', [s.sessao_id, JSON.stringify(entradaEmpresa('t93-x', extra))]));
        expect(erro?.code, JSON.stringify(extra).slice(0, 40)).toBe('22023');
        expect(erro!.message).not.toContain('senha-em-claro-123');
      }
      await portal('select plataforma.sa_revogar($1)', [s.sessao_id]);
      expect((await erroDe(portal('select plataforma.sa_provisionar_tenant($1, $2::jsonb)', [s.sessao_id, JSON.stringify(entradaEmpresa('t93-y'))])))?.code).toBe('28000');
      expect(await q("select codigo from plataforma.tenant where codigo in ('t93-x', 't93-y')")).toEqual([]);
    });
  });

  it('sa_auditar: aceita ator_tipo e usuario_id; ator_tipo fora da lista = 22023', async () => {
    await emTransacao(admin, null, async () => {
      const uA = await usuario(A, EMAIL_CLI, 'admin');
      const id = await um<string>('plataforma.sa_auditar($1::jsonb)', [JSON.stringify({ acao: 'sa.requisicao', ator_tipo: 'admin_cliente', usuario_id: uA, tenant_id: A, status: 200 })]);
      expect(await q('select ator_tipo, usuario_id, tenant_alvo_id, super_admin_id from plataforma.auditoria_plataforma where id = $1', [id]))
        .toEqual([{ ator_tipo: 'admin_cliente', usuario_id: uA, tenant_alvo_id: A, super_admin_id: null }]);
      expect((await erroDe(portal('select plataforma.sa_auditar($1::jsonb)', [JSON.stringify({ acao: 'sa.x', ator_tipo: 'vendedor' })])))?.code).toBe('22023');
      expect((await erroAdmin("insert into plataforma.auditoria_plataforma (acao, ator_tipo) values ('sa.x', 'vendedor')"))?.code).toBe('23514');
    });
  });

  it('criar_super_admin: idempotente por e-mail; redefinir e desativar revogam as sessões; não desativa o último ativo; entrada inválida = 22023 sem dado pessoal', async () => {
    await emTransacao(admin, null, async () => {
      await admin.query('update plataforma.super_admin set ativo = false'); // o caso não depende de super-admin já gravado
      const c1 = await criarSuperAdmin();
      expect(c1).toEqual({ resultado: 'criado', super_admin_id: expect.any(String), sessoes_revogadas: 0 });
      expect(await criarSuperAdmin(` ${EMAIL_SA.toUpperCase()} `, H2)).toEqual({ resultado: 'sem_mudanca', super_admin_id: c1.super_admin_id, sessoes_revogadas: 0 });
      expect(await q('select senha_hash from plataforma.super_admin where lower(email) = $1', [EMAIL_SA])).toEqual([{ senha_hash: H1 }]);

      const s = (await abrir({ tipo: 'super_admin', super_admin_id: c1.super_admin_id }))!;
      expect(await superAdmin({ acao: 'redefinir', email: EMAIL_SA, senha_hash: H2 })).toEqual({ resultado: 'redefinido', super_admin_id: c1.super_admin_id, sessoes_revogadas: 1 });
      expect(await q('select senha_hash, falhas, bloqueado_ate from plataforma.super_admin where id = $1', [c1.super_admin_id])).toEqual([{ senha_hash: H2, falhas: 0, bloqueado_ate: null }]);
      expect(await valida(s.sessao_id)).toEqual([]);
      expect(await superAdmin({ acao: 'redefinir', email: 'ninguem.t93@macuxi.exemplo', senha_hash: H2 })).toEqual({ resultado: 'nao_encontrado', super_admin_id: null, sessoes_revogadas: 0 });

      // o último ativo não sai
      const ultimo = await erroAdmin('select plataforma.criar_super_admin($1::jsonb)', [JSON.stringify({ acao: 'desativar', email: EMAIL_SA })]);
      expect(ultimo?.code).toBe('22023');
      const c2 = await criarSuperAdmin('segundo.t93@macuxi.exemplo');
      const s2 = (await abrir({ tipo: 'super_admin', super_admin_id: c1.super_admin_id }))!;
      expect(await superAdmin({ acao: 'desativar', email: EMAIL_SA })).toEqual({ resultado: 'desativado', super_admin_id: c1.super_admin_id, sessoes_revogadas: 1 });
      expect(await valida(s2.sessao_id)).toEqual([]);
      expect(await superAdmin({ acao: 'desativar', email: EMAIL_SA })).toEqual({ resultado: 'sem_mudanca', super_admin_id: c1.super_admin_id, sessoes_revogadas: 0 });
      expect((await erroAdmin('select plataforma.criar_super_admin($1::jsonb)', [JSON.stringify({ acao: 'desativar', email: 'segundo.t93@macuxi.exemplo' })]))?.code).toBe('22023');
      expect(c2.resultado).toBe('criado');

      const acoes = (await auditoria()).filter((a) => a.acao.startsWith('sa.super_admin.')).map((a) => `${a.acao} ${String(a.detalhes.resultado)}`);
      expect(acoes.sort()).toEqual(['sa.super_admin.criar criado', 'sa.super_admin.criar criado', 'sa.super_admin.desativar desativado', 'sa.super_admin.redefinir redefinido']);

      for (const ruim of [
        null, { acao: 'apagar', email: EMAIL_SA }, { acao: 'criar', email: 'sem-arroba', nome: 'X', senha_hash: H1 },
        { acao: 'criar', email: 'x.t93@macuxi.exemplo', nome: '  ', senha_hash: H1 }, { acao: 'criar', email: 'x.t93@macuxi.exemplo', nome: 'X', senha_hash: 'senha-em-claro-123' },
        { acao: 'redefinir', email: EMAIL_SA }, { acao: 'redefinir', email: EMAIL_SA, senha_hash: H1, nome: 'X' },
        { acao: 'desativar', email: EMAIL_SA, senha_hash: H1 }, { acao: 'criar', email: 'x.t93@macuxi.exemplo', nome: 'X', senha_hash: H1, ativo: true },
      ]) {
        const erro = await erroAdmin('select plataforma.criar_super_admin($1::jsonb)', [JSON.stringify(ruim)]);
        expect(erro?.code, JSON.stringify(ruim)?.slice(0, 50)).toBe('22023');
        for (const segredo of [EMAIL_SA, 'senha-em-claro-123', H1]) expect(erro!.message).not.toContain(segredo);
      }
      expect(JSON.stringify(await auditoria())).not.toContain(EMAIL_SA);
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

describe.skipIf(semBanco())('0039 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('down volta exatamente ao catálogo e às ACLs da 0038 (idempotente); as 20 da 0035 respondem ao portal; up de novo = mesmo catálogo', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0038' });
      const catalogo = await retratoDoCatalogo(c);
      const acl = await retratoAcl(c);
      await migrarUp(c, { ate: '0039' });
      const depois = await retratoDoCatalogo(c);
      const aclDepois = await retratoAcl(c);
      expect(depois).toEqual(expect.arrayContaining([
        'fn plataforma.sa_contas_para_login(p_email text)', 'fn plataforma.criar_super_admin(p jsonb)',
        expect.stringMatching(/^rel plataforma\.portal_sessao r rls=true force=true$/),
        'col plataforma.auditoria_plataforma.ator_tipo text nn=false',
      ]));
      expect(depois.filter((l) => l.startsWith('fn plataforma.sa_existe('))).toEqual([]);
      expect(aclDepois.filter((l) => / (macuxi_app|macuxi_worker|PUBLIC) /.test(l) && /^fn plataforma\.(sa_|criar_super_admin)/.test(l))).toEqual([]);
      expect(aclDepois.filter((l) => / macuxi_portal /.test(l))).toHaveLength(FUNCOES_SA.length);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0039_plataforma_portal_email_senha']);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      expect(await retratoAcl(c)).toEqual(acl);
      await c.query(m39.down);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      expect(await retratoAcl(c)).toEqual(acl);
      // as funções da 0035 voltaram de verdade (texto e grants): o portal cria o primeiro super-admin (transação desfeita)
      await c.query('begin');
      await c.query('set local role macuxi_portal');
      const id = (await c.query<{ r: string }>('select plataforma.sa_criar_primeiro($1, $2, $3) as r', [EMAIL_SA, 'Operador T93', H1])).rows[0]!.r;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect((await c.query('select * from plataforma.sa_para_login($1)', [EMAIL_SA])).rows).toHaveLength(1);
      await c.query('rollback');

      await migrarUp(c, { ate: '0039' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect(await retratoAcl(c)).toEqual(aclDepois);
    });
  });
});
