/**
 * 0042 — o super-admin da Macuxi redefine pelo portal a senha do admin do cliente (T-0094, padrão de fábrica da T-0111;
 * R-20261107-185546; doc 03 §2; ADR 0031, 0032 e 0033; RN-CORE-32, RN-CORE-34, RN-CORE-35, RN-AUD-01).
 * O que o BANCO garante:
 * - sa_admins_da_empresa e sa_redefinir_senha_admin: SECURITY DEFINER, search_path fixo, EXECUTE só ao macuxi_portal (app,
 *   worker e PUBLIC 42501); só com sessão viva de super-admin (admin do cliente ou sessão inválida = 28000);
 * - a lista traz só os admins vivos da empresa pedida (nunca hash) e audita só a contagem;
 * - a redefinição só aceita admin ativo, sem bloqueio, da empresa informada (outro perfil, outro tenant, inativo = P0002) e com o
 *   e-mail atual (diferente = 55000); grava a temporária como a 0040 (hash, 72 h, trocar_senha, sessao_versao + 1, refresh
 *   revogados, sessão do portal do admin cai), enfileira o e-mail com a carga cifrada recebida na MESMA transação e audita sem
 *   dado pessoal; é idempotente por p_email_id; entrada inválida = 22023 e nada muda; o outro tenant fica intacto;
 * - up/down: a 0042 só acrescenta as 2 funções; o down volta exatamente ao catálogo e às ACLs da 0041.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero). Nada roda em base real.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { FUNCOES_SA, FUNCOES_SA_0042, FUNCOES_SA_ATUAIS } from './funcoes-sa';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m42 = migracoes.find((m) => m.versao === '0042')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const nome = (f: string) => f.slice(0, f.indexOf('('));
/** Bloco de uma função até o "$$;" que fecha o corpo. */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};
const LISTA = 'plataforma.sa_admins_da_empresa(uuid, uuid)';
const REDEFINIR = 'plataforma.sa_redefinir_senha_admin(uuid, uuid, uuid, text, text, uuid, bytea)';

/** Dados de mentira (nunca de uma pessoa real); hashes no formato PHC, sem senha nenhuma por trás. */
const H2 = '$argon2id$v=19$m=1,t=1,p=1$b3V0cm8$b3V0cm9oYXNo';
const HT = '$argon2id$v=19$m=1,t=1,p=1$dGVtcG9yYXJpYQ$dGVtcG9yYXJpYWhhc2g';
const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const ADMIN_A = DOIS_TENANTS.A.usuarios.admin;
const ADMIN_B = DOIS_TENANTS.B.usuarios.admin;
const EMAIL_ADMIN_A = 'admin@exemplo.com.br';
const CARGA = Buffer.from('texto-cifrado-de-mentira-0042');

describe('0042 redefinir a senha do admin pelo portal (estático)', () => {
  const sql = semComentarios(m42.up);

  it('nome e posição: 0042_plataforma_portal_redefinir_senha_admin logo depois da 0041', () => {
    expect(m42.nome).toBe('plataforma_portal_redefinir_senha_admin');
    expect(migracoes[41]?.versao).toBe('0042');
    expect(migracoes[40]?.versao).toBe('0041');
  });

  it('só as 2 sa_* novas: SECURITY DEFINER, search_path com pg_temp por último, revoke de PUBLIC/app/worker e EXECUTE só ao portal', () => {
    const criadas = [...sql.matchAll(/create (?:or replace )?function ([a-z_]+\.[a-z_]+)\(/g)].map((x) => x[1]);
    expect(criadas.sort()).toEqual(FUNCOES_SA_0042.map(nome).sort());
    for (const f of FUNCOES_SA_0042) {
      const b = bloco(sql, `create function ${nome(f)}(`);
      expect(b, f).toMatch(/language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(sql).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(sql).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    expect(FUNCOES_SA_0042).toEqual([LISTA, REDEFINIR]);
    expect(FUNCOES_SA_ATUAIS).toEqual([...FUNCOES_SA, ...FUNCOES_SA_0042]);
    expect(FUNCOES_SA_ATUAIS).toHaveLength(14);
    expect(sql).toContain('if v_n <> 14 then');
    expect(sql).not.toMatch(/grant execute [^;]* to macuxi_(app|worker);/);
    expect(sql).not.toMatch(/grant [^;]* on (table )?(plataforma|core)\.[a-z_]+ to macuxi_portal/);
    // só funções: nenhuma tabela, coluna, índice, política ou papel
    expect(sql).not.toMatch(/create (table|index|unique index|policy|role)|alter (table|role)|drop (table|column)/i);
  });

  it('as duas exigem sessão de super-admin (28000); a lista nunca devolve hash', () => {
    for (const f of FUNCOES_SA_0042) {
      const b = bloco(sql, `create function ${nome(f)}(`);
      expect(b, f).toContain("if v_tipo is distinct from 'super_admin' or v_sa is null then");
      expect(b, f).toContain("using errcode = '28000'");
    }
    const lista = bloco(sql, 'create function plataforma.sa_admins_da_empresa(');
    expect(lista).toMatch(/returns table \(usuario_id uuid, nome text, email text, ativo boolean, bloqueado boolean, tem_senha boolean, trocar_senha boolean,\s+senha_expira_em timestamptz, sessao_versao integer\)/);
    expect(lista).not.toMatch(/u\.senha_hash,|senha_temporaria/);
    expect(lista).toContain("jsonb_build_object('admins', v_n)");
  });

  it('redefinir: alvo admin ativo do tenant, e-mail atual, o update da 0040, refresh revogados, e-mail na outbox e auditoria sem dado pessoal', () => {
    const b = bloco(sql, 'create function plataforma.sa_redefinir_senha_admin(');
    expect(b).toMatch(/returns table \(email_id uuid, chave_idempotencia text, sessao_versao integer, senha_expira_em timestamptz, repetida boolean\)/);
    expect(b).toMatch(/where u\.tenant_id = p_tenant and u\.id = p_usuario and u\.perfil = 'admin' and u\.deleted_at is null and u\.ativo\s+and u\.bloqueado_em is null and t\.status = 'ativo' and t\.deleted_at is null\s+for update of u;/);
    expect(b).toContain("using errcode = 'P0002'");
    expect(b).toContain("using errcode = '55000'");
    expect(b).toContain("v_expira timestamptz := now() + interval '72 hours';");
    expect(b).toMatch(/set senha_hash = p_senha_hash, trocar_senha = true, senha_expira_em = v_expira,\s+senha_temporaria_hash = null, senha_temporaria_expira_em = null, senha_temporaria_criada_em = null,\s+tentativas_falhas = 0, bloqueio_ate = null, sessao_versao = u\.sessao_versao \+ 1/);
    expect(b).toContain('update core.sessao s set revogado_em = now()');
    expect(b).toMatch(/insert into plataforma\.email_saida \(id, tenant_id, usuario_id, modelo, chave_idempotencia, carga, expira_em\)\s+values \(p_email_id, p_tenant, p_usuario, 'nova_senha', v_chave, p_carga, v_expira\);/);
    expect(b).toContain("'core', 'usuario.senha_redefinir', 'usuario', p_usuario");
    expect(b).toContain("'sa.admin.senha_redefinir'");
    // nada de e-mail, hash ou carga na auditoria nem nas mensagens de erro
    const linhasDeAuditoria = b.split('\n').filter((l) => l.includes('jsonb_build_object('));
    expect(linhasDeAuditoria).toHaveLength(2);
    for (const l of linhasDeAuditoria) expect(l).not.toMatch(/p_email\b|p_senha_hash|p_carga|v_email_atual/);
    for (const [, msg] of b.matchAll(/raise exception '([^']*)'(, [^ ]+)? using/g)) expect(msg).not.toMatch(/%/);
  });

  it('down: drop das 2 (com a assinatura exata) e conferência das 12', () => {
    for (const f of FUNCOES_SA_0042) expect(m42.down).toContain(`drop function if exists ${f};`);
    expect(m42.down).toContain('if v_n <> 12 then');
    expect(semComentarios(m42.down)).not.toMatch(/create function|grant /);
  });
});

describe.skipIf(semBanco())('0042 redefinir a senha do admin pelo portal (banco, fixture dois-tenants)', () => {
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
      return r;
    } catch (e) {
      await admin.query('rollback to savepoint como');
      throw e;
    }
  }
  const portal = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => como<T>('macuxi_portal', sql, params).then((r) => r.rows);
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const abrir = async (p: unknown) => (await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)]))[0];
  const valida = (sid: string) => portal('select * from plataforma.sa_sessao_valida($1)', [sid]);
  /** Sessão viva de super-admin (criado pela conexão de administração, como no deploy). */
  async function sessaoSuperAdmin() {
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.t94r@macuxi.exemplo', nome: 'Operador 0042', senha_hash: H2 })]))[0]!.r;
    const s = (await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }))!;
    return { sid: s.sessao_id, superAdmin: sa.super_admin_id };
  }
  const listar = (sid: string, tenant: string) => portal<Record<string, unknown>>('select * from plataforma.sa_admins_da_empresa($1, $2)', [sid, tenant]);
  const redefinir = (sid: string, p: { tenant?: string; usuario?: string; hash?: string; email?: string; emailId?: string; carga?: Buffer | null } = {}) =>
    portal<{ email_id: string; chave_idempotencia: string; sessao_versao: number; senha_expira_em: Date; repetida: boolean }>(
      'select * from plataforma.sa_redefinir_senha_admin($1, $2, $3, $4, $5, $6, $7)',
      [sid, p.tenant ?? A, p.usuario ?? ADMIN_A, p.hash ?? HT, p.email ?? EMAIL_ADMIN_A, p.emailId ?? '0042a000-0000-4000-8000-000000000001', p.carga === undefined ? CARGA : p.carga],
    );
  const estado = (u: string) =>
    q<Record<string, unknown>>('select senha_hash, trocar_senha, senha_temporaria_hash, tentativas_falhas, bloqueio_ate, sessao_versao from core.usuario where id = $1', [u]);

  it('macuxi_app e macuxi_worker: 42501 nas 2; o portal executa; nenhum privilégio direto do portal em core.usuario e na outbox', async () => {
    await emTransacao(admin, null, async () => {
      const chamada = (f: string) => {
        const tipos = f.slice(f.indexOf('(') + 1, -1).split(', ').filter(Boolean);
        return `select * from ${nome(f)}(${tipos.map((t) => `null::${t}`).join(', ')})`;
      };
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        for (const f of FUNCOES_SA_0042) expect((await erroDe(como(papel, chamada(f))))?.code, `${papel} ${f}`).toBe('42501');
      }
      // o portal entra na função (sessão nula = 28000, não 42501)
      for (const f of FUNCOES_SA_0042) expect((await erroDe(como('macuxi_portal', chamada(f))))?.code, f).toBe('28000');
      const r = await q<{ f: string; definer: boolean; config: string[]; portal: boolean; app: boolean; worker: boolean }>(
        `select f, p.prosecdef as definer, p.proconfig as config, has_function_privilege('macuxi_portal', p.oid, 'execute') as portal,
                has_function_privilege('macuxi_app', p.oid, 'execute') as app, has_function_privilege('macuxi_worker', p.oid, 'execute') as worker
           from unnest($1::text[]) f join pg_proc p on p.oid = f::regprocedure order by 1`,
        [[...FUNCOES_SA_0042]],
      );
      expect(r).toHaveLength(2);
      for (const { f, ...resto } of r) expect(resto, f).toEqual({ definer: true, config: ['search_path=pg_catalog, plataforma, pg_temp'], portal: true, app: false, worker: false });
      expect(await q(`select has_table_privilege('macuxi_portal', 'core.usuario', 'SELECT, INSERT, UPDATE, DELETE') as u,
                             has_table_privilege('macuxi_portal', 'plataforma.email_saida', 'SELECT, INSERT, UPDATE, DELETE') as e`)).toEqual([{ u: false, e: false }]);
    });
  });

  it('sa_admins_da_empresa: super-admin vê só os admins vivos da empresa pedida, sem hash; admin do cliente e sessão inválida = 28000; audita só a contagem', async () => {
    await emTransacao(admin, null, async () => {
      const { sid, superAdmin } = await sessaoSuperAdmin();
      // um admin apagado e um vendedor não aparecem
      await q("insert into core.usuario (tenant_id, nome, email, perfil, ativo, senha_hash, deleted_at) values ($1, 'Admin Apagado', 'apagado.0042@exemplo.com.br', 'admin', false, $2, now())", [A, H2]);
      const rA = await listar(sid, A);
      expect(rA.map((x) => x.usuario_id)).toEqual([ADMIN_A]);
      // 0047: a lista ganha entra_no_portal no fim (portal-admin-multiperfil.test.ts); o resto é o retorno da 0042
      expect(Object.keys(rA[0]!)).toEqual(['usuario_id', 'nome', 'email', 'ativo', 'bloqueado', 'tem_senha', 'trocar_senha', 'senha_expira_em', 'sessao_versao', 'entra_no_portal']);
      expect(rA[0]).toMatchObject({ email: EMAIL_ADMIN_A, ativo: true, bloqueado: false, tem_senha: true, trocar_senha: false, senha_expira_em: null, sessao_versao: 0 });
      expect(JSON.stringify(rA)).not.toContain('$argon2id$');
      expect((await listar(sid, B)).map((x) => x.usuario_id)).toEqual([ADMIN_B]);
      expect(await listar(sid, '0042ffff-0000-4000-8000-000000000000')).toEqual([]);
      const aud = await q<{ acao: string; ator_tipo: string; super_admin_id: string; tenant_alvo_id: string; detalhes: Record<string, unknown> }>(
        "select acao, ator_tipo, super_admin_id, tenant_alvo_id, detalhes from plataforma.auditoria_plataforma where acao = 'sa.admin.listar' and sessao_id = $1 order by ocorrido_em, tenant_alvo_id", [sid]);
      expect(aud).toHaveLength(3);
      expect(aud.find((x) => x.tenant_alvo_id === A)).toMatchObject({ ator_tipo: 'super_admin', super_admin_id: superAdmin, detalhes: { admins: 1, origem: 'banco' } });
      expect(JSON.stringify(aud)).not.toContain('@');
      // admin do cliente (com sessão viva) e sessão inexistente: 28000
      const cli = (await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] }))!;
      expect(await valida(cli.sessao_id)).toHaveLength(1);
      expect((await erroDe(listar(cli.sessao_id, A)))?.code).toBe('28000');
      expect((await erroDe(listar('0042ffff-0000-4000-8000-000000000001', A)))?.code).toBe('28000');
      await portal('select plataforma.sa_revogar($1)', [sid]);
      expect((await erroDe(listar(sid, A)))?.code).toBe('28000');
    });
  });

  it('sa_redefinir_senha_admin: temporária de 72 h com trocar_senha, versão + 1, refresh e sessão do portal caem, e-mail na outbox, auditoria sem dado pessoal; B intacto', async () => {
    await emTransacao(admin, null, async () => {
      const { sid, superAdmin } = await sessaoSuperAdmin();
      // o admin de A tem tentativas falhas, bloqueio temporário, uma temporária do "Esqueci", um refresh vivo e sessão no portal
      await q(`update core.usuario set tentativas_falhas = 3, bloqueio_ate = now() + interval '10 minutes', senha_temporaria_hash = $2,
                 senha_temporaria_expira_em = now() + interval '72 hours', senha_temporaria_criada_em = now() where id = $1`, [ADMIN_A, H2]);
      await q("insert into core.sessao (tenant_id, usuario_id, familia_id, token_hash, expira_em) values ($1, $2, gen_random_uuid(), repeat('d', 64), now() + interval '30 days')", [A, ADMIN_A]);
      const cli = (await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] }))!;
      expect(await valida(cli.sessao_id)).toHaveLength(1);
      const estadoB = await estado(ADMIN_B);
      const t0 = (await q<{ t: Date }>('select now() as t'))[0]!.t;

      const [r] = await redefinir(sid);
      expect(r).toMatchObject({ email_id: '0042a000-0000-4000-8000-000000000001', chave_idempotencia: `${ADMIN_A}:redefinida_portal:1`, sessao_versao: 1, repetida: false });
      expect(r!.senha_expira_em.getTime() - t0.getTime()).toBe(72 * 3600 * 1000);
      expect(await estado(ADMIN_A)).toEqual([{ senha_hash: HT, trocar_senha: true, senha_temporaria_hash: null, tentativas_falhas: 0, bloqueio_ate: null, sessao_versao: 1 }]);
      expect(await q('select senha_expira_em from core.usuario where id = $1', [ADMIN_A])).toEqual([{ senha_expira_em: r!.senha_expira_em }]);
      expect(await q('select count(*)::int as n from core.sessao where usuario_id = $1 and revogado_em is null', [ADMIN_A])).toEqual([{ n: 0 }]);
      expect(await valida(cli.sessao_id)).toEqual([]);
      // o e-mail: a carga recebida, pendente, modelo nova_senha, validade = a da senha
      expect(await q('select tenant_id, usuario_id, modelo, chave_idempotencia, carga, enviado_em, falhou_em, expira_em from plataforma.email_saida where id = $1', [r!.email_id])).toEqual([
        { tenant_id: A, usuario_id: ADMIN_A, modelo: 'nova_senha', chave_idempotencia: `${ADMIN_A}:redefinida_portal:1`, carga: CARGA, enviado_em: null, falhou_em: null, expira_em: r!.senha_expira_em },
      ]);
      // auditoria do tenant (o admin vê no BKO) e da plataforma (o ator), sem e-mail, hash nem carga
      const audT = await q<Record<string, unknown>>("select usuario_id, modulo, acao, entidade, entidade_id, antes, depois from plataforma.auditoria where tenant_id = $1 and acao = 'usuario.senha_redefinir' and entidade_id = $2", [A, ADMIN_A]);
      expect(audT).toEqual([{ usuario_id: null, modulo: 'core', acao: 'usuario.senha_redefinir', entidade: 'usuario', entidade_id: ADMIN_A, antes: null, depois: { trocar_senha: true, sessoes_revogadas: true, origem: 'portal', email: 'enfileirado' } }]);
      const audP = await q<Record<string, unknown>>("select ator_tipo, super_admin_id, usuario_id, sessao_id, tenant_alvo_id, detalhes from plataforma.auditoria_plataforma where acao = 'sa.admin.senha_redefinir'");
      expect(audP).toEqual([{ ator_tipo: 'super_admin', super_admin_id: superAdmin, usuario_id: null, sessao_id: sid, tenant_alvo_id: A, detalhes: { alvo: ADMIN_A, email_id: r!.email_id, sessoes_revogadas: 1, origem: 'banco' } }]);
      const tudo = JSON.stringify([audT, audP]);
      for (const proibido of [EMAIL_ADMIN_A, HT, '$argon2id$', CARGA.toString()]) expect(tudo).not.toContain(proibido);
      // o login do portal do admin agora pede a troca (sa_abrir_sessao_portal recusa trocar_senha) e B não mudou
      expect(await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] })).toBeUndefined();
      expect(await estado(ADMIN_B)).toEqual(estadoB);
      expect(await q('select count(*)::int as n from plataforma.email_saida where tenant_id = $1 and carga is not null', [B])).toEqual([{ n: 0 }]);
    });
  });

  it('idempotente por p_email_id: a retentativa devolve a mesma linha com repetida = true e nada muda; o mesmo id para outro alvo = 22023', async () => {
    await emTransacao(admin, null, async () => {
      const { sid } = await sessaoSuperAdmin();
      const [r1] = await redefinir(sid);
      const [r2] = await redefinir(sid, { hash: H2 });
      expect(r2).toEqual({ ...r1, repetida: true });
      expect(await estado(ADMIN_A)).toEqual([expect.objectContaining({ senha_hash: HT, sessao_versao: 1 })]);
      expect(await q('select count(*)::int as n from plataforma.email_saida where usuario_id = $1', [ADMIN_A])).toEqual([{ n: 1 }]);
      expect(await q("select count(*)::int as n from plataforma.auditoria_plataforma where acao = 'sa.admin.senha_redefinir'")).toEqual([{ n: 1 }]);
      expect((await erroDe(redefinir(sid, { tenant: B, usuario: ADMIN_B, email: 'admin.b@exemplo.com.br' })))?.code).toBe('22023');
      // um id novo é uma redefinição nova (versão 2, chave nova)
      const [r3] = await redefinir(sid, { emailId: '0042a000-0000-4000-8000-000000000002' });
      expect(r3).toMatchObject({ sessao_versao: 2, chave_idempotencia: `${ADMIN_A}:redefinida_portal:2`, repetida: false });
    });
  });

  it('recusas sem mudar nada: alvo que não é admin, de outro tenant, inativo, bloqueado ou apagado = P0002; e-mail mudado = 55000; entrada inválida = 22023; sessão de cliente = 28000', async () => {
    await emTransacao(admin, null, async () => {
      const { sid } = await sessaoSuperAdmin();
      const antes = await estado(ADMIN_A);
      const vendedor = DOIS_TENANTS.A.usuarios.vendedor1;
      const casos: Array<[string, Parameters<typeof redefinir>[1], string]> = [
        ['vendedor de A', { usuario: vendedor, email: 'vendedor1@exemplo.com.br' }, 'P0002'],
        ['admin de B pedido em A', { usuario: ADMIN_B, email: 'admin.b@exemplo.com.br' }, 'P0002'],
        ['admin de A pedido em B', { tenant: B }, 'P0002'],
        ['usuário inexistente', { usuario: '0042ffff-0000-4000-8000-000000000002' }, 'P0002'],
        ['e-mail antigo', { email: 'outro.0042@exemplo.com.br' }, '55000'],
        ['hash fora do argon2id', { hash: 'senha-em-claro' }, '22023'],
        ['e-mail fora do formato', { email: 'sem-arroba' }, '22023'],
        ['carga vazia', { carga: Buffer.alloc(0) }, '22023'],
        ['carga grande demais', { carga: Buffer.alloc(16385, 1) }, '22023'],
        ['carga nula', { carga: null }, '22023'],
      ];
      for (const [caso, p, codigo] of casos) expect((await erroDe(redefinir(sid, p)))?.code, caso).toBe(codigo);
      // alvo que deixou de valer: inativo, bloqueado, apagado (cada um desfeito antes do próximo)
      for (const [caso, set] of [['inativo', 'ativo = false'], ['bloqueado', 'bloqueado_em = now()'], ['apagado', 'deleted_at = now()']] as const) {
        await admin.query('savepoint alvo');
        await q(`update core.usuario set ${set} where id = $1`, [ADMIN_A]);
        expect((await erroDe(redefinir(sid)))?.code, caso).toBe('P0002');
        await admin.query('rollback to savepoint alvo');
      }
      await admin.query('savepoint suspenso');
      await q("update plataforma.tenant set status = 'suspenso' where id = $1", [A]);
      expect((await erroDe(redefinir(sid)))?.code, 'empresa suspensa').toBe('P0002');
      await admin.query('rollback to savepoint suspenso');
      const cli = (await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] }))!;
      expect((await erroDe(redefinir(cli.sessao_id)))?.code).toBe('28000');
      expect((await erroDe(redefinir('0042ffff-0000-4000-8000-000000000003')))?.code).toBe('28000');
      expect(await estado(ADMIN_A)).toEqual(antes);
      expect(await q('select count(*)::int as n from plataforma.email_saida where usuario_id = $1 and carga is not null', [ADMIN_A])).toEqual([{ n: 0 }]);
      expect(await q("select count(*)::int as n from plataforma.auditoria_plataforma where acao = 'sa.admin.senha_redefinir'")).toEqual([{ n: 0 }]);
      // o mesmo endereço com caixa e espaços diferentes passa
      expect((await redefinir(sid, { email: `  ${EMAIL_ADMIN_A.toUpperCase()} ` }))[0]).toMatchObject({ sessao_versao: 1, repetida: false });
    });
  });
});

describe.skipIf(semBanco())('0042 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up acrescenta só as 2 funções (14 do portal); down volta exatamente ao catálogo e às ACLs da 0041 (idempotente); up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0041' });
      const catalogo = await retratoDoCatalogo(c);
      const acl = await retratoAcl(c);
      expect((await migrarUp(c, { ate: '0042' })).aplicadas).toEqual(['0042_plataforma_portal_redefinir_senha_admin']);
      const depois = await retratoDoCatalogo(c);
      const aclDepois = await retratoAcl(c);
      expect(depois.filter((l) => !catalogo.includes(l)).sort()).toEqual([
        'fn plataforma.sa_admins_da_empresa(p_sid uuid, p_tenant uuid)',
        'fn plataforma.sa_redefinir_senha_admin(p_sid uuid, p_tenant uuid, p_usuario uuid, p_senha_hash text, p_email text, p_email_id uuid, p_carga bytea)',
      ]);
      expect(catalogo.filter((l) => !depois.includes(l))).toEqual([]);
      expect(aclDepois.filter((l) => / macuxi_portal /.test(l))).toHaveLength(FUNCOES_SA_ATUAIS.length);
      expect(aclDepois.filter((l) => / (macuxi_app|macuxi_worker|PUBLIC) /.test(l) && /^fn plataforma\.sa_/.test(l))).toEqual([]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0042_plataforma_portal_redefinir_senha_admin']);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      expect(await retratoAcl(c)).toEqual(acl);
      await c.query(m42.down);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      expect(await retratoAcl(c)).toEqual(acl);

      await migrarUp(c, { ate: '0042' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect(await retratoAcl(c)).toEqual(aclDepois);
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
