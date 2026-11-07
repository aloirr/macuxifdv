/**
 * T-0091 (condição da ADR 0029) × Postgres real (CI; sem Docker local): a sessão do super-admin só abre no papel
 * `macuxi_portal`. Pula sem Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 *  - `macuxi_app` não chega a nenhuma `plataforma.sa_*` (42501), e o pool do portal recusa subir com ele;
 *  - `macuxi_portal` executa as `sa_*` com grant (SA_PORTAL), não lê tabela nenhuma e sobe a API com os dois pools;
 *  - as internas (SA_INTERNAS: só o dono) não executam como ninguém; sa_* do catálogo fora das duas listas = vermelho.
 */
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { criarBancoApp, criarBancoPortal, ErroPapelBanco } from '../src/banco';
import { SA_INTERNAS, SA_PORTAL } from './funcoes-sa';

const SEM_PERMISSAO = '42501';
const UM = '00000000-0000-4000-8000-000000000001';

describe.skipIf(semBanco())('API × Postgres: papel macuxi_portal (T-0091)', () => {
  let app: pg.Pool;
  let admin: pg.Pool;
  let portal: pg.Pool | null = null;

  beforeAll(() => {
    app = new pg.Pool({ connectionString: banco().urlApp, max: 2 });
    admin = new pg.Pool({ connectionString: banco().urlAdmin, max: 1 });
    const url = banco().urlPortal;
    portal = url ? new pg.Pool({ connectionString: url, max: 2 }) : null;
  });
  afterAll(async () => {
    await Promise.all([app?.end(), admin?.end(), portal?.end()]);
  });

  type Sa = { assinatura: string; app: boolean; worker: boolean; portal: boolean; publico: boolean };
  /** Todas as `plataforma.sa_*` do catálogo (não só as das listas: função nova sem classe faz o teste falhar). */
  const funcoesSa = async (): Promise<Sa[]> =>
    (
      await admin.query<Sa>(
        `select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as assinatura,
                has_function_privilege('macuxi_app', p.oid, 'EXECUTE') as app,
                has_function_privilege('macuxi_worker', p.oid, 'EXECUTE') as worker,
                has_function_privilege('macuxi_portal', p.oid, 'EXECUTE') as portal,
                exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         where a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'plataforma' and p.proname like 'sa\\_%'
          order by 1`,
      )
    ).rows;

  it('toda sa_* do catálogo está em SA_PORTAL ou SA_INTERNAS (sa_* nova sem classe = vermelho)', async () => {
    const fs = await funcoesSa();
    expect(fs.map((f) => f.assinatura).sort()).toEqual([...SA_PORTAL, ...SA_INTERNAS].sort());
  });

  it('nenhuma sa_* executa como macuxi_app, macuxi_worker ou PUBLIC; as com grant executam como macuxi_portal; as internas, ninguém', async () => {
    const fs = await funcoesSa();
    expect(fs.filter((f) => f.app || f.worker || f.publico).map((f) => f.assinatura)).toEqual([]);
    expect(fs.filter((f) => SA_PORTAL.includes(f.assinatura) && !f.portal).map((f) => f.assinatura)).toEqual([]);
    expect(fs.filter((f) => SA_INTERNAS.includes(f.assinatura) && f.portal).map((f) => f.assinatura)).toEqual([]);
  });

  it('macuxi_app chamando a sa_tenant_ativo e a sa_auditar: 42501 (a injeção numa rota de tenant não abre o portal)', async () => {
    await expect(app.query('select plataforma.sa_tenant_ativo($1::uuid, $2::uuid)', [UM, UM])).rejects.toMatchObject({ code: SEM_PERMISSAO });
    await expect(app.query('select plataforma.sa_auditar($1::jsonb)', ['{}'])).rejects.toMatchObject({ code: SEM_PERMISSAO });
  });

  it('o pool do portal recusa subir com o macuxi_app; o do app recusa o macuxi_portal', async () => {
    await expect(criarBancoPortal(app).verificar()).rejects.toBeInstanceOf(ErroPapelBanco);
    expect(portal, 'banco de teste sem urlPortal (MACUXI_PG_PORTAL_SENHA)').not.toBeNull();
    await expect(criarBancoApp(portal!).verificar()).rejects.toBeInstanceOf(ErroPapelBanco);
  });

  it('macuxi_portal: passa na verificação, não lê tabela nenhuma e a API sobe com os dois pools', async () => {
    expect(portal).not.toBeNull();
    const p = portal!;
    await expect(criarBancoPortal(p).verificar()).resolves.toBeUndefined();
    for (const tabela of ['plataforma.tenant', 'plataforma.auditoria_plataforma', 'core.usuario']) {
      await expect(p.query(`select 1 from ${tabela} limit 1`), tabela).rejects.toMatchObject({ code: SEM_PERMISSAO });
    }
    const api = createApp({ banco: criarBancoApp(app), bancoPortal: criarBancoPortal(p) });
    try {
      await api.ready();
      // portal no ar: sem token, 401 (e não 503 PORTAL_INDISPONIVEL)
      const r = await api.inject({ method: 'GET', url: '/v1/plataforma/empresas' });
      expect([r.statusCode, r.json().codigo]).toEqual([401, 'NAO_AUTENTICADO']);
    } finally {
      await api.close();
    }
  });
});
