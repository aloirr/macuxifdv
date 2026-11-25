/**
 * 0103 — travas por CARGO em plataforma.perfil_concessao e RLS das 4 tabelas (ADR 0073 §2.5 itens 1, 2, 3 e 5; plano §2.1).
 * O que o BANCO garante (23514, constraint perfil_concessao_trava_do_cargo, hint = a RN):
 * - RN-PRO-01: cargo promotor sem escrita de pedido (pedido.criar, pedido.aprovar, pedido_x.editar); pedido.ver passa;
 * - RN-CORE-33: acesso.bko nos cargos vendedor, promotor e supervisor; acesso.portal fora do administrativo; acesso.campo fora de
 *   vendedor e promotor; acesso.gestao fora de supervisor e gerente;
 * - RN-CORE-04: dados.escopo acima do teto do cargo; sem nível = CHECK perfil_concessao_nivel_escopo;
 * - desmarcar (soft delete) sempre passa; a linha apagada não é conferida;
 * - RLS: o macuxi_app vê e grava só o próprio tenant, não apaga linha (soft delete), só lê os achados; o modelo é só leitura;
 *   worker e portal sem acesso.
 * O que depende do conjunto (portal só com a gestão completa, perfil sem acesso, último admin) fica no domain e na API do Core
 * nesta versão; no banco, a migração confere (perfis-sem-base-conflitos.db.test.ts).
 * Fixture dois-tenants (ROLLBACK).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { idPerfilFabrica } from '../src/ids';
import { banco, semBanco } from './estado';
import { emTransacao } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const perfilA = (base: string) => idPerfilFabrica(A.tenantId, base);

describe.skipIf(semBanco())('0103 travas por cargo e RLS (fixture, ROLLBACK)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  /** Roda como o papel (no contexto do tenant) num savepoint; devolve null ou { code, constraint, hint }. */
  async function tentar(sql: string, params: unknown[], papel = 'macuxi_app', tenant: string | null = A.tenantId) {
    await admin.query('savepoint t');
    try {
      await admin.query(`set local role ${papel}`);
      await admin.query("select set_config('app.tenant_id', $1, true)", [tenant ?? '']);
      await admin.query(sql, params);
      return null;
    } catch (e) {
      const err = e as { code?: string; constraint?: string; hint?: string };
      return { code: err.code ?? '?', constraint: err.constraint ?? null, hint: err.hint ?? null };
    } finally {
      await admin.query('rollback to savepoint t');
      await admin.query('reset role');
    }
  }
  const conceder = (perfil: string, chave: string, nivel: string | null = null) =>
    tentar('insert into plataforma.perfil_concessao (tenant_id, perfil_id, chave, nivel) values ($1, $2, $3, $4)', [A.tenantId, perfil, chave, nivel]);
  const trava = (hint: string) => ({ code: '23514', constraint: 'perfil_concessao_trava_do_cargo', hint });

  it('RN-PRO-01: cargo promotor sem escrita de pedido; pedido.ver e coleta passam', async () => {
    await emTransacao(admin, null, async () => {
      await admin.query("delete from plataforma.perfil_concessao where perfil_id = $1 and chave = 'pedido.ver'", [perfilA('promotor')]);
      for (const chave of ['pedido.criar', 'pedido.aprovar', 'pedido_x.editar']) expect(await conceder(perfilA('promotor'), chave), chave).toEqual(trava('RN-PRO-01'));
      expect(await conceder(perfilA('promotor'), 'pedido.ver')).toBeNull();
      await admin.query("delete from plataforma.perfil_concessao where perfil_id = $1 and chave = 'gondola.registrar'", [perfilA('vendedor')]);
      expect(await conceder(perfilA('vendedor'), 'gondola.registrar')).toBeNull();
    });
  });

  it('RN-CORE-33: BKO, portal e apps pelo cargo', async () => {
    await emTransacao(admin, null, async () => {
      for (const base of ['vendedor', 'promotor', 'supervisor']) expect(await conceder(perfilA(base), 'acesso.bko'), base).toEqual(trava('RN-CORE-33'));
      for (const base of ['vendedor', 'gerente']) expect(await conceder(perfilA(base), 'acesso.portal'), base).toEqual(trava('RN-CORE-33'));
      for (const base of ['supervisor', 'gerente', 'analista']) expect(await conceder(perfilA(base), 'acesso.campo'), base).toEqual(trava('RN-CORE-33'));
      for (const base of ['vendedor', 'promotor', 'assistente']) expect(await conceder(perfilA(base), 'acesso.gestao'), base).toEqual(trava('RN-CORE-33'));
      await admin.query("delete from plataforma.perfil_concessao where perfil_id = $1 and chave = 'acesso.portal'", [perfilA('admin')]);
      expect(await conceder(perfilA('admin'), 'acesso.portal')).toBeNull();
    });
  });

  it('RN-CORE-04: escopo acima do teto do cargo recusado; sem nível = CHECK; desmarcar passa', async () => {
    await emTransacao(admin, null, async () => {
      await admin.query("delete from plataforma.perfil_concessao where chave = 'dados.escopo' and tenant_id = $1", [A.tenantId]);
      expect(await conceder(perfilA('supervisor'), 'dados.escopo', 'equipes_abaixo')).toEqual(trava('RN-CORE-04'));
      expect(await conceder(perfilA('vendedor'), 'dados.escopo', 'equipe')).toEqual(trava('RN-CORE-04'));
      expect(await conceder(perfilA('vendedor'), 'dados.escopo', 'proprio')).toBeNull();
      expect(await conceder(perfilA('analista'), 'dados.escopo', 'tenant')).toBeNull();
      expect(await conceder(perfilA('vendedor'), 'dados.escopo')).toEqual({ code: '23514', constraint: 'perfil_concessao_nivel_escopo', hint: null });
      expect(await conceder(perfilA('vendedor'), 'dados.escopo', 'ate_alcada')).toMatchObject({ code: '23514', constraint: 'perfil_concessao_nivel_escopo' });
      // desmarcar (soft delete) passa
      expect(await tentar("update plataforma.perfil_concessao set deleted_at = now() where perfil_id = $1 and chave = 'pedido.criar'", [perfilA('vendedor')])).toBeNull();
    });
  });

  it('RLS e grants: tenant isolado, sem DELETE; achados só leitura; modelo só leitura; worker e portal sem acesso', async () => {
    await emTransacao(admin, null, async () => {
      const conta = async (sql: string, tenant: string | null, papel = 'macuxi_app') => {
        await admin.query('savepoint c');
        try {
          await admin.query(`set local role ${papel}`);
          await admin.query("select set_config('app.tenant_id', $1, true)", [tenant ?? '']);
          return Number((await admin.query<{ n: string }>(sql)).rows[0]!.n);
        } finally {
          await admin.query('rollback to savepoint c');
          await admin.query('reset role');
        }
      };
      expect(await conta(`select count(*) as n from plataforma.perfil_concessao where tenant_id = '${A.tenantId}'`, B.tenantId)).toBe(0);
      expect(await conta('select count(*) as n from plataforma.perfil_concessao', null)).toBe(0);
      expect(await conta(`select count(*) as n from plataforma.perfil_concessao where tenant_id <> '${A.tenantId}'`, A.tenantId)).toBe(0);
      expect(await conta('select count(*) as n from plataforma.modelo_permissao', A.tenantId)).toBe(844); // v1 406 + v2 438 (0108)
      expect(await conta('select count(*) as n from plataforma.modelo_permissao', null)).toBe(0);
      expect(await conta('select count(*) as n from plataforma.catalogo_aplicado', A.tenantId)).toBe(1);
      expect(await tentar('delete from plataforma.perfil_concessao where perfil_id = $1', [perfilA('vendedor')])).toMatchObject({ code: '42501' });
      expect(await tentar('insert into plataforma.perfil_concessao (tenant_id, perfil_id, chave) values ($1, $2, $3)', [A.tenantId, B.perfis.vendedorBalcao, 'pedido.ver'], 'macuxi_app', B.tenantId))
        .toMatchObject({ code: '42501' });
      expect(await tentar("insert into plataforma.perfil_migracao_conflito (tenant_id, tipo, efeito) values ($1, 'ADMIN_MUDA', 'aviso')", [A.tenantId])).toMatchObject({ code: '42501' });
      expect(await tentar("insert into plataforma.modelo_permissao (id, versao, modelo, cargo, chave) values (gen_random_uuid(), 9, 'admin', 'administrativo', 'x.y')", []))
        .toMatchObject({ code: '42501' });
      for (const papel of ['macuxi_worker', 'macuxi_portal']) {
        for (const t of ['perfil_concessao', 'catalogo_aplicado', 'perfil_migracao_conflito', 'modelo_permissao']) {
          expect(await tentar(`select 1 from plataforma.${t} limit 1`, [], papel), `${papel} ${t}`).toMatchObject({ code: '42501' });
        }
      }
      // macuxi_leitura: lê o próprio tenant, sem a coluna chave
      expect(await tentar('select id, nivel from plataforma.perfil_concessao limit 1', [], 'macuxi_leitura')).toBeNull();
      expect(await tentar('select chave from plataforma.perfil_concessao limit 1', [], 'macuxi_leitura')).toMatchObject({ code: '42501' });
    });
  });
});
