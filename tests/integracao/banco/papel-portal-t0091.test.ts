/**
 * T-0091 — teste de segurança do papel do portal (critério 3; condição da ADR 0029, R-20261106-182000-alexandre item 3;
 * desenho docs/desenho/T-0091.md §6; migração 0038_plataforma_papel_portal; RN-CORE-31).
 * Conexões REAIS de cada papel no banco do globalSetup (dois-tenants), independentes do db/testes do banco-dados:
 *  - PP-01/02 com a credencial do macuxi_app e do macuxi_worker, chamar CADA função plataforma.sa_* do catálogo (lista tirada
 *             do pg_proc, não fixa; com a interna e a plataforma.provisionar_tenant) = 42501. Uma injeção de SQL numa rota de
 *             tenant ou a senha do app vazada não abre mais sessão de super-admin nem cria tenant;
 *  - PP-03    o macuxi_portal conecta como ele mesmo e executa as sa_* (sem superusuário/BYPASSRLS);
 *  - PP-04    o macuxi_portal não lê nem grava tabela nenhuma (as 4 do super-admin, plataforma.tenant/parametro, core.*):
 *             42501 antes da RLS; não executa a função interna nem as do app; não troca de papel.
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

/** Toda plataforma.sa_* do catálogo (e a provisionar_tenant), com uma chamada de argumentos nulos tipados. */
async function funcoesDoPortal(admin: pg.ClientBase): Promise<Funcao[]> {
  const r = await admin.query<{ assinatura: string; nome: string; tipos: string[] }>(
    `select p.oid::regprocedure::text as assinatura, p.proname as nome,
            array(select format_type(t.oid, null) from unnest(p.proargtypes::oid[]) with ordinality as t(oid, i) order by t.i)::text[] as tipos
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'plataforma' and (starts_with(p.proname, 'sa_') or p.proname = 'provisionar_tenant')
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

describe.skipIf(semBanco())('T-0091 critério 3: só o macuxi_portal abre sessão de super-admin; app e worker levam 42501', () => {
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

  it('o catálogo tem as 21 sa_* da 0035 (20 públicas + a interna) e a provisionar_tenant: a lista não está vazia', () => {
    expect(funcoes.length).toBeGreaterThanOrEqual(22);
    expect(funcoes.map((f) => f.assinatura)).toEqual(
      expect.arrayContaining(['plataforma.sa_abrir_sessao(text)', 'plataforma.sa_provisionar_tenant(uuid,jsonb)', 'plataforma.sa_auditar(jsonb)']),
    );
  });

  it('PP-01 com a credencial do macuxi_app: cada sa_* (e a provisionar_tenant) = 42501', async () => {
    const quem = await app.query<{ u: string }>('select current_user as u');
    expect(quem.rows[0]!.u).toBe('macuxi_app');
    expect(await quemNaoNegou(app, funcoes)).toEqual([]);
  });

  it('PP-01b com a credencial do macuxi_app, mesmo com o tenant no contexto: abrir sessão e criar tenant = 42501', async () => {
    const A = DOIS_TENANTS.A.tenantId;
    for (const sql of ["select * from plataforma.sa_abrir_sessao('x')", `select * from plataforma.sa_provisionar_tenant('${randomUUID()}', '{}'::jsonb)`]) {
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
    it('PP-03 conecta como macuxi_portal, sem superusuário nem BYPASSRLS, e executa as sa_* (sa_existe, sa_sessao_valida)', async () => {
      const p = portal!;
      const r = await p.query<{ u: string; su: boolean; br: boolean }>(
        'select current_user as u, r.rolsuper as su, r.rolbypassrls as br from pg_roles r where r.rolname = current_user',
      );
      expect(r.rows[0]).toEqual({ u: PAPEL_PORTAL, su: false, br: false });
      const existe = await tentar(p, null, () => p.query('select plataforma.sa_existe() as e'));
      expect(existe.ok, existe.ok ? '' : existe.mensagem).toBe(true);
      const sessao = await tentar(p, null, () => p.query('select * from plataforma.sa_sessao_valida($1)', [randomUUID()]));
      expect(sessao.ok, sessao.ok ? '' : sessao.mensagem).toBe(true);
    });

    it.each([
      ['plataforma.super_admin', 'select count(*) from plataforma.super_admin'],
      ['plataforma.super_admin_desafio', 'select count(*) from plataforma.super_admin_desafio'],
      ['plataforma.super_admin_sessao', 'select count(*) from plataforma.super_admin_sessao'],
      ['plataforma.auditoria_plataforma (ler)', 'select count(*) from plataforma.auditoria_plataforma'],
      ['plataforma.auditoria_plataforma (inserir)', "insert into plataforma.auditoria_plataforma (acao) values ('sa.forjada')"],
      ['plataforma.auditoria_plataforma (alterar)', "update plataforma.auditoria_plataforma set acao = 'sa.apagada'"],
      ['plataforma.auditoria_plataforma (apagar)', 'delete from plataforma.auditoria_plataforma'],
      ['plataforma.tenant', 'select count(*) from plataforma.tenant'],
      ['plataforma.parametro', 'select count(*) from plataforma.parametro'],
      ['plataforma.tenant_modulo', 'select count(*) from plataforma.tenant_modulo'],
      ['plataforma.evento (outbox)', 'select count(*) from plataforma.evento'],
      ['core.usuario', 'select count(*) from core.usuario'],
      ['core.cliente', 'select count(*) from core.cliente'],
      ['função interna sa_registrar_auditoria', "select plataforma.sa_registrar_auditoria(null, null, null, 'sa.forjada', '{}'::jsonb)"],
      ['função de administração provisionar_tenant', "select plataforma.provisionar_tenant('{}'::jsonb)"],
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
