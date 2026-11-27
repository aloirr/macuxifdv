/**
 * Estado de licenças × Postgres real (fixture dois-tenants, RLS): RN-CORE-01 e R-20261127-144433 (item 2). Os módulos do usuário
 * seguem o perfil da empresa dele (`plataforma.usuario_perfil` → `perfil_modulo` pelo código), como os módulos efetivos da API.
 * A troca de perfil roda num savepoint desfeito no fim. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LicencasEstadoSchema } from '../contracts';
import { lerEstadoDeLicencas } from './licencas';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;

describe.skipIf(semBanco())('Core × Postgres: estado de licenças pelo perfil da empresa', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 2 });
  });
  afterAll(async () => {
    if (pool) await pool.end();
  });

  const ler = (c: pg.ClientBase) => lerEstadoDeLicencas(c as unknown as ClienteBanco, {}).then((e) => LicencasEstadoSchema.parse(e));

  it('perfil padrão: perfil_codigo = o código do perfil vinculado (no padrão, o do cargo)', async () => {
    const e = await comTenant(pool, A.tenantId, ler);
    expect(e.usuarios.find((u) => u.id === A.usuarios.vendedor1)).toMatchObject({ perfil: 'vendedor', perfil_codigo: 'vendedor' });
    expect(e.perfis.vendedor_externo).toBeDefined();
  });

  it('perfil personalizado: o usuário passa a ter o código e os módulos do perfil da empresa, não os do padrão do cargo', async () => {
    await comTenant(pool, A.tenantId, async (c) => {
      await c.query('savepoint item2');
      try {
        await c.query('update plataforma.usuario_perfil set perfil_id = $1 where usuario_id = $2 and deleted_at is null', [A.perfis.vendedorExterno, A.usuarios.vendedor1]);
        await c.query("update plataforma.perfil_modulo set deleted_at = now() where perfil = 'vendedor_externo' and modulo = 'vendedor' and deleted_at is null");
        const e = await ler(c);
        const u = e.usuarios.find((x) => x.id === A.usuarios.vendedor1)!;
        expect(u).toMatchObject({ perfil: 'vendedor', perfil_codigo: 'vendedor_externo' });
        expect(e.perfis[u.perfil_codigo]).not.toContain('vendedor');
        expect(e.perfis.vendedor).toContain('vendedor');
      } finally {
        await c.query('rollback to savepoint item2');
      }
    });
  });

  it('multi-tenant (RLS): o estado do B não traz usuário nem perfil personalizado do A', async () => {
    const e = await comTenant(pool, B.tenantId, ler);
    expect(e.usuarios.some((u) => u.id === A.usuarios.vendedor1)).toBe(false);
    expect(e.perfis.vendedor_externo).toBeUndefined();
    expect(e.usuarios.find((u) => u.id === B.usuarios.vendedor)).toMatchObject({ perfil_codigo: 'vendedor' });
  });
});
