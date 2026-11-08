/**
 * T-0029 §11 E1 e E2 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS):
 *  - E1 (ADR 0012): a consulta roda na MESMA transação de quem consulta (mesmo txid), com o tenant do token
 *    (`plataforma.tenant_atual()`) e o papel macuxi_app — o dono só enxerga linhas do tenant;
 *  - E2 (RN-AUD-01): `tx.auditar` grava em `plataforma.auditoria` com o módulo da rota, o usuário, o `request_id` e
 *    antes/depois; se a transação desfaz, a auditoria some junto.
 * Pula sem Docker/Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { randomUUID } from 'node:crypto';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { defineModule, definirConsulta, definirModuloApi, ErroRegraNegocio, implementarConsulta, type ModuloId, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { criarBancoApp } from '../src/banco';
import { MODULOS_API } from '../src/modulos';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const quem: Record<string, UsuarioAutenticado> = {
  vendedorA: { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' },
  analistaB: { id: B.usuarios.admin, tenant_id: B.tenantId, perfil: 'analista' },
};
const autenticar = async (h: Readonly<Record<string, string | undefined>>) => quem[h['x-teste-usuario'] ?? ''] ?? null;
const licencas = async () => ({
  ativosNoTenant: ['core', 'catalogo', 'vendedor'] as ModuloId[],
  doPerfil: ['core', 'catalogo', 'vendedor'] as ModuloId[],
  removidosDoUsuario: [] as ModuloId[],
  parametros: {},
});

/** Consulta de teste: o dono diz em que transação, tenant e papel rodou e quantos tenants enxerga na auditoria. */
const ONDE = definirConsulta({
  nome: 'catalogo.onde_estou@1',
  entrada: z.object({}),
  saida: z.object({ txid: z.string(), tenant: z.string(), papel: z.string(), tenants_visiveis: z.array(z.string()) }),
});
// O Catálogo real (rotas e consultas, ex.: catalogo.marcas@1 que o Promotor usa desde a T-0113) + a consulta de teste
const catalogoReal = MODULOS_API.find((m) => m.manifesto.id === 'catalogo')!;
const catalogoApi = definirModuloApi({
  ...catalogoReal,
  manifesto: defineModule({ ...catalogo, ofereceConsultas: [...(catalogo.ofereceConsultas ?? []), 'catalogo.onde_estou@1'] }),
  consultas: [
    ...(catalogoReal.consultas ?? []),
    implementarConsulta(ONDE, async (_e, ctx) => {
      const r = (await ctx.db.query<{ txid: string; tenant: string; papel: string }>('select txid_current()::text as txid, plataforma.tenant_atual()::text as tenant, current_user as papel')).rows[0]!;
      const t = (await ctx.db.query<{ tenant_id: string }>('select distinct tenant_id::text from plataforma.auditoria')).rows.map((x) => x.tenant_id);
      return { ...r, tenants_visiveis: t };
    }),
  ],
});

const PEDIDO = randomUUID();
const vendedorApi = definirModuloApi({
  manifesto: defineModule({ ...vendedor, usaConsultas: ['catalogo.onde_estou@1'] }),
  rotas: [
    {
      metodo: 'POST',
      caminho: 'teste-auditar/:id',
      acao: 'pedido.criar',
      carteira: 'nao_se_aplica',
      params: z.object({ id: z.string().uuid() }),
      query: z.object({ desfazer: z.string().optional() }),
      executar: (ctx) =>
        ctx.comTenant(async (db, tx) => {
          const txid = (await db.query<{ txid: string }>('select txid_current()::text as txid')).rows[0]!.txid;
          const onde = await tx.consultar(ONDE, {});
          await tx.auditar({ acao: 'pedido.aprovar', entidade: 'pedido', entidade_id: ctx.params.id, antes: { status: 'pending_approval' }, depois: { status: 'approved' } });
          if (ctx.query.desfazer) throw new ErroRegraNegocio('RN-VEN-30', 'Desfaz a transação.');
          return { txid, onde };
        }),
    },
  ],
});

describe.skipIf(semBanco())('consultas entre módulos e auditoria × Postgres (T-0029 E1/E2)', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  let app: ReturnType<typeof createApp>;
  const AGORA = new Date('2026-11-01T12:00:00Z');

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    app = createApp({
      banco: criarBancoApp(pool),
      autenticar,
      licencas,
      relogio: () => AGORA,
      modulos: MODULOS_API.map((m) => (m.manifesto.id === 'vendedor' ? vendedorApi : m.manifesto.id === 'catalogo' ? catalogoApi : m)),
    });
  });
  afterAll(async () => {
    await app?.close();
    await admin?.end();
    await pool?.end();
  });

  const chamar = (u: string, id: string, requestId: string, desfazer = false) =>
    app.inject({ method: 'POST', url: `/v1/vendedor/teste-auditar/${id}${desfazer ? '?desfazer=1' : ''}`, headers: { 'x-teste-usuario': u, 'x-request-id': requestId } });
  const auditoria = async (id: string) =>
    (
      await admin.query<{ tenant_id: string; usuario_id: string; modulo: string; acao: string; entidade: string; antes: unknown; depois: unknown; request_id: string; ocorrido_em: Date }>(
        'select tenant_id::text, usuario_id::text, modulo, acao, entidade, antes, depois, request_id, ocorrido_em from plataforma.auditoria where entidade_id = $1',
        [id],
      )
    ).rows;

  it('E1: o dono roda na mesma transação, no tenant do token, como macuxi_app (RLS)', async () => {
    const rid = randomUUID();
    const r = await chamar('vendedorA', PEDIDO, rid);
    expect(r.statusCode).toBe(200);
    const { txid, onde } = r.json() as { txid: string; onde: { txid: string; tenant: string; papel: string; tenants_visiveis: string[] } };
    expect(onde.txid).toBe(txid);
    expect(onde.tenant).toBe(A.tenantId);
    expect(onde.papel).toBe('macuxi_app');
    expect(onde.tenants_visiveis.every((t) => t === A.tenantId)).toBe(true);
    // outro tenant: outro contexto, e o dono não enxerga a auditoria de A
    const b = await chamar('analistaB', randomUUID(), randomUUID());
    expect(b.statusCode).toBe(200);
    expect((b.json() as { onde: { tenant: string; tenants_visiveis: string[] } }).onde).toMatchObject({ tenant: B.tenantId });
    expect((b.json() as { onde: { tenants_visiveis: string[] } }).onde.tenants_visiveis).not.toContain(A.tenantId);
  });

  it('E2: auditoria com módulo da rota, usuário, request_id e antes/depois (só ids e status)', async () => {
    const id = randomUUID();
    const rid = randomUUID();
    expect((await chamar('vendedorA', id, rid)).statusCode).toBe(200);
    expect(await auditoria(id)).toEqual([
      {
        tenant_id: A.tenantId,
        usuario_id: A.usuarios.vendedor1,
        modulo: 'vendedor',
        acao: 'pedido.aprovar',
        entidade: 'pedido',
        antes: { status: 'pending_approval' },
        depois: { status: 'approved' },
        request_id: rid,
        ocorrido_em: AGORA,
      },
    ]);
  });

  it('E2: transação desfeita (422) leva a auditoria junto', async () => {
    const id = randomUUID();
    const r = await chamar('vendedorA', id, randomUUID(), true);
    expect(r.statusCode).toBe(422);
    expect(await auditoria(id)).toEqual([]);
  });
});
