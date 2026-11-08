/**
 * T-0091 — teste de segurança do papel do portal (critério 3; condição da ADR 0029, R-20261106-182000-alexandre item 3;
 * desenho docs/desenho/T-0091.md §6; migração 0038_plataforma_papel_portal; RN-CORE-31).
 * Conexões REAIS de cada papel no banco do globalSetup (dois-tenants), independentes do db/testes do banco-dados:
 *  - PP-01/02 com a credencial do macuxi_app e do macuxi_worker, chamar CADA função plataforma.sa_* do catálogo (lista tirada
 *             do pg_proc, não fixa; com a interna e as de deploy plataforma.provisionar_tenant e plataforma.criar_super_admin)
 *             = 42501. Uma injeção de SQL numa rota de tenant ou a senha do app vazada não abre sessão do portal, não lê hash
 *             de admin, não cria super-admin nem tenant;
 *  - PP-03    o macuxi_portal conecta como ele mesmo e executa as sa_* (sem superusuário/BYPASSRLS);
 *  - PP-04    o macuxi_portal não lê nem grava tabela nenhuma (as do super-admin, as 3 do portal da 0039, plataforma.tenant/
 *             parametro, core.*): 42501 antes da RLS; não executa a função interna, as de deploy nem as do app; não troca de papel.
 * T-0093 (0039, ADR 0031): as sa_* passaram a ser as 12 do portal só com e-mail e senha; o que este arquivo prova não mudou.
 * T-0094 (0042): mais 2 (sa_admins_da_empresa e sa_redefinir_senha_admin), 14 públicas; app e worker também levam 42501 nelas.
 * Tudo em transação desfeita (tentar): o banco compartilhado não muda. Roda só com banco (CI); sem banco, pula.
 */
import { DOIS_TENANTS, PAPEL_PORTAL } from '@macuxi/db/teste';
import { banco, comMotivo, estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conectar, tentar } from '../apoio/banco';

/** Lidos sem lançar na coleta (o describe pulado sem banco também é coletado). */
const ESTADO = estadoBanco();
const SEM_WORKER = ESTADO.disponivel && !ESTADO.urlWorker ? 'sem MACUXI_PG_WORKER_SENHA neste ambiente' : null;
const SEM_PORTAL = ESTADO.disponivel && !ESTADO.urlPortal ? 'sem MACUXI_PG_PORTAL_SENHA neste ambiente' : null;

interface Funcao {
  assinatura: string;
  chamada: string;
}

/** Toda plataforma.sa_* do catálogo (e as de deploy provisionar_tenant e criar_super_admin), com argumentos nulos tipados. */
async function funcoesDoPortal(admin: pg.ClientBase): Promise<Funcao[]> {
  const r = await admin.query<{ assinatura: string; nome: string; tipos: string[] }>(
    `select p.oid::regprocedure::text as assinatura, p.proname as nome,
            array(select format_type(t.oid, null) from unnest(p.proargtypes::oid[]) with ordinality as t(oid, i) order by t.i)::text[] as tipos
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'plataforma' and (starts_with(p.proname, 'sa_') or p.proname in ('provisionar_tenant', 'criar_super_admin'))
      order by 1`,
  );
  return r.rows.map((f) => ({
    assinatura: f.assinatura,
    chamada: `select * from plataforma.${f.nome}(${f.tipos.map((t) => `null::${t}`).join(', ')})`,
  }));
}

/** Chama cada função como `c`; devolve as que NÃO deram 42501 (o esperado é lista vazia). */
async function quemNaoNegou(c: pg.ClientBase, funcoes: Funcao[]): Promise<string[]> {
  const furos: string[] = [];
  for (const f of funcoes) {
    const r = await tentar(c, null, () => c.query(f.chamada));
    if (r.ok || r.codigo !== '42501') furos.push(`${f.assinatura}: ${r.ok ? 'executou!' : `${r.codigo} ${r.mensagem}`}`);
  }
  return furos;
}

describe.skipIf(semBanco())('T-0091/T-0093: só o macuxi_portal abre sessão do portal; app e worker levam 42501', () => {
  let admin: pg.Client;
  let app: pg.Client;
  let worker: pg.Client | null = null;
  let portal: pg.Client | null = null;
  let funcoes: Funcao[] = [];

  beforeAll(async () => {
    admin = await conectar(banco().urlAdmin);
    app = await conectar(banco().urlApp);
    if (banco().urlWorker) worker = await conectar(banco().urlWorker!);
    if (banco().urlPortal) portal = await conectar(banco().urlPortal!);
    funcoes = await funcoesDoPortal(admin);
  });
  afterAll(async () => {
    await portal?.end();
    await worker?.end();
    await app?.end();
    await admin?.end();
  });

  it('o catálogo tem as 15 sa_* (12 públicas da 0039, 2 da 0042 e a interna) e as 2 de deploy: a lista não está vazia nem tem as da 0035', () => {
    expect(funcoes.length).toBeGreaterThanOrEqual(17);
    const assinaturas = funcoes.map((f) => f.assinatura);
    expect(assinaturas).toEqual(
      expect.arrayContaining([
        'plataforma.sa_contas_para_login(text)',
        'plataforma.sa_abrir_sessao_portal(jsonb)',
        'plataforma.sa_escolher_empresa(uuid,uuid)',
        'plataforma.sa_provisionar_tenant(uuid,jsonb)',
        'plataforma.sa_auditar(jsonb)',
        // T-0094 (0042): o super-admin redefine a senha do admin do cliente
        'plataforma.sa_admins_da_empresa(uuid,uuid)',
        'plataforma.sa_redefinir_senha_admin(uuid,uuid,uuid,text,text,uuid,bytea)',
        'plataforma.criar_super_admin(jsonb)',
        'plataforma.provisionar_tenant(jsonb)',
      ]),
    );
    expect(assinaturas).not.toContain('plataforma.sa_abrir_sessao(text)');
    expect(assinaturas).not.toContain('plataforma.sa_para_login(text)');
  });

  it('PP-01 com a credencial do macuxi_app: cada sa_* (e a provisionar_tenant) = 42501', async () => {
    const quem = await app.query<{ u: string }>('select current_user as u');
    expect(quem.rows[0]!.u).toBe('macuxi_app');
    expect(await quemNaoNegou(app, funcoes)).toEqual([]);
  });

  it('PP-01b com a credencial do macuxi_app, mesmo com o tenant no contexto: abrir sessão, ler hashes, criar super-admin e tenant = 42501', async () => {
    const A = DOIS_TENANTS.A.tenantId;
    for (const sql of [
      `select * from plataforma.sa_abrir_sessao_portal('{"tipo":"super_admin","super_admin_id":"${randomUUID()}"}'::jsonb)`,
      `select * from plataforma.sa_abrir_sessao_portal('{"tipo":"admin_cliente","empresas":[{"tenant_id":"${A}","usuario_id":"${DOIS_TENANTS.A.usuarios.admin}"}]}'::jsonb)`,
      "select * from plataforma.sa_contas_para_login('admin@exemplo.com.br')",
      `select * from plataforma.sa_provisionar_tenant('${randomUUID()}', '{}'::jsonb)`,
      // 0042: listar os admins (com e-mail) e redefinir a senha do admin, mesmo com o tenant no contexto
      `select * from plataforma.sa_admins_da_empresa('${randomUUID()}', '${A}')`,
      `select * from plataforma.sa_redefinir_senha_admin('${randomUUID()}', '${A}', '${DOIS_TENANTS.A.usuarios.admin}', '$argon2id$v=19$m=19456,t=2,p=1$YWJj$YWJj', 'admin@exemplo.com.br', '${randomUUID()}', decode('01', 'hex'))`,
      `select plataforma.criar_super_admin('{"acao":"criar","email":"x@exemplo.com.br","nome":"X","senha_hash":"x"}'::jsonb)`,
    ]) {
      const r = await tentar(app, A, () => app.query(sql));
      expect(r.ok ? `executou: ${sql}` : r.codigo, sql).toBe('42501');
    }
  });

  it.skipIf(!!SEM_WORKER)(
    comMotivo('PP-02 com a credencial do macuxi_worker: cada sa_* (e a provisionar_tenant) = 42501', SEM_WORKER),
    async () => {
      const quem = await worker!.query<{ u: string }>('select current_user as u');
      expect(quem.rows[0]!.u).toBe('macuxi_worker');
      expect(await quemNaoNegou(worker!, funcoes)).toEqual([]);
    },
  );

  describe.skipIf(!!SEM_PORTAL)(comMotivo('com a credencial do macuxi_portal', SEM_PORTAL), () => {
    it('PP-03 conecta como macuxi_portal, sem superusuário nem BYPASSRLS, e executa as sa_* (sa_tentativa_estado, sa_contas_para_login, sa_sessao_valida)', async () => {
      const p = portal!;
      const r = await p.query<{ u: string; su: boolean; br: boolean }>(
        'select current_user as u, r.rolsuper as su, r.rolbypassrls as br from pg_roles r where r.rolname = current_user',
      );
      expect(r.rows[0]).toEqual({ u: PAPEL_PORTAL, su: false, br: false });
      const estado = await tentar(p, null, () => p.query('select * from plataforma.sa_tentativa_estado($1)', ['0'.repeat(64)]));
      expect(estado.ok, estado.ok ? '' : estado.mensagem).toBe(true);
      const contas = await tentar(p, null, () => p.query('select * from plataforma.sa_contas_para_login($1)', ['ninguem.pp03@exemplo.com.br']));
      expect(contas.ok ? contas.valor.rows : contas.mensagem).toEqual([]);
      // T-0094 (0040, §8.1): a função devolve o estado da senha e a versão da sessão, nunca o hash do "Esqueci a senha"
      const colunas = await tentar(p, null, () => p.query('select * from plataforma.sa_contas_para_login($1)', ['admin@exemplo.com.br']));
      const nomes = colunas.ok ? colunas.valor.fields.map((f) => f.name) : [colunas.mensagem];
      expect(nomes).toEqual(expect.arrayContaining(['trocar_senha', 'senha_expira_em', 'sessao_versao']));
      expect(nomes.filter((n) => n.startsWith('senha_temporaria'))).toEqual([]);
      const sessao = await tentar(p, null, () => p.query('select * from plataforma.sa_sessao_valida($1)', [randomUUID()]));
      expect(sessao.ok, sessao.ok ? '' : sessao.mensagem).toBe(true);
    });

    it.each([
      ['plataforma.super_admin', 'select count(*) from plataforma.super_admin'],
      ['plataforma.super_admin_desafio', 'select count(*) from plataforma.super_admin_desafio'],
      ['plataforma.super_admin_sessao', 'select count(*) from plataforma.super_admin_sessao'],
      ['plataforma.portal_tentativa (0039)', 'select count(*) from plataforma.portal_tentativa'],
      ['plataforma.portal_tentativa (zerar bloqueio)', 'delete from plataforma.portal_tentativa'],
      ['plataforma.portal_sessao (0039)', 'select count(*) from plataforma.portal_sessao'],
      ['plataforma.portal_sessao (reviver)', 'update plataforma.portal_sessao set revogada_em = null'],
      ['plataforma.portal_sessao_empresa (0039)', 'select count(*) from plataforma.portal_sessao_empresa'],
      ['plataforma.portal_sessao_empresa (pôr empresa)', `insert into plataforma.portal_sessao_empresa (sessao_id, tenant_alvo_id, usuario_id) values ('${randomUUID()}', '${DOIS_TENANTS.B.tenantId}', '${randomUUID()}')`],
      ['plataforma.auditoria_plataforma (ler)', 'select count(*) from plataforma.auditoria_plataforma'],
      ['plataforma.auditoria_plataforma (inserir)', "insert into plataforma.auditoria_plataforma (acao) values ('sa.forjada')"],
      ['plataforma.auditoria_plataforma (alterar)', "update plataforma.auditoria_plataforma set acao = 'sa.apagada'"],
      ['plataforma.auditoria_plataforma (apagar)', 'delete from plataforma.auditoria_plataforma'],
      ['plataforma.tenant', 'select count(*) from plataforma.tenant'],
      ['plataforma.parametro', 'select count(*) from plataforma.parametro'],
      ['plataforma.tenant_modulo', 'select count(*) from plataforma.tenant_modulo'],
      ['plataforma.evento (outbox)', 'select count(*) from plataforma.evento'],
      ['plataforma.email_saida (outbox de e-mail, 0040)', 'select count(*) from plataforma.email_saida'],
      ['plataforma.email_saida (ler a carga)', 'select carga from plataforma.email_saida limit 1'],
      ['plataforma.email_saida (zerar a carga)', 'update plataforma.email_saida set carga = null'],
      ['core.usuario', 'select count(*) from core.usuario'],
      ['core.usuario (hash da senha)', 'select senha_hash from core.usuario limit 1'],
      ['core.cliente', 'select count(*) from core.cliente'],
      ['função interna sa_registrar_auditoria (7 argumentos, 0039)', "select plataforma.sa_registrar_auditoria(null, null, null, null, null, 'sa.forjada', '{}'::jsonb)"],
      ['função de administração provisionar_tenant', "select plataforma.provisionar_tenant('{}'::jsonb)"],
      ['função de deploy criar_super_admin (0039)', `select plataforma.criar_super_admin('{"acao":"criar","email":"x@exemplo.com.br","nome":"X","senha_hash":"x"}'::jsonb)`],
      ['função do app tenant_por_codigo', "select * from plataforma.tenant_por_codigo('qualquer')"],
      ['virar o macuxi_app', 'set local role macuxi_app'],
      ['virar o macuxi_manutencao (política da 0031)', 'set local role macuxi_manutencao'],
    ])('PP-04 o macuxi_portal não chega a %s (42501)', async (_alvo, sql) => {
      const p = portal!;
      const r = await tentar(p, null, () => p.query(sql));
      // 42501 = sem privilégio; 42P01 (tabela inexistente) reprova também: a lista precisa acompanhar o catálogo
      expect(r.ok ? `passou: ${sql}` : r.codigo).toBe('42501');
    });

    it('PP-04b o macuxi_portal não lê tabela de tenant nem com o tenant no contexto (42501 antes da RLS)', async () => {
      const p = portal!;
      const r = await tentar(p, DOIS_TENANTS.A.tenantId, () => p.query('select count(*) from core.usuario'));
      expect(r.ok ? 'leu core.usuario!' : r.codigo).toBe('42501');
    });
  });
});
