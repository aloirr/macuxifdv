/**
 * T-0180 (ADR 0059 §8) × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): `ctx.gravarParametros` grava em
 * `plataforma.parametro` só com o módulo da rota e o tenant do token, idempotente (2ª gravação igual não muda `updated_at` nem
 * audita), auditada (RN-AUD-01) e desfeita junto com a transação da rota que falha. Chaves próprias desta execução.
 * Pula sem Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { randomUUID } from 'node:crypto';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { definirModuloApi, ErroRegraNegocio, type ModuloId, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { criarBancoApp } from '../src/banco';
import { modulosDeTeste } from './apoio';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const quem: Record<string, UsuarioAutenticado> = {
  a: { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' },
  b: { id: B.usuarios.admin, tenant_id: B.tenantId, perfil: 'vendedor' },
};
const SUFIXO = randomUUID().slice(0, 8);
const CHAVE = `teste_t0180_${SUFIXO}`;
const ACAO = `teste.t0180_${SUFIXO}`;

const Corpo = z.object({ valor: z.number().int(), falhar: z.boolean().default(false) });
const rotas = definirModuloApi({
  manifesto: vendedor,
  rotas: [
    {
      metodo: 'PUT',
      caminho: 'parametros-teste',
      acao: 'pedido.criar',
      carteira: 'nao_se_aplica',
      corpo: Corpo,
      executar: (ctx) =>
        ctx.comTenant(async () => {
          const c = ctx.corpo as z.output<typeof Corpo>;
          await ctx.gravarParametros!({ [CHAVE]: c.valor }, { acao: ACAO });
          if (c.falhar) throw new ErroRegraNegocio('RN-TESTE-01', 'Falha depois de gravar.');
          return { valor: ctx.parametros()[CHAVE] };
        }),
    },
  ],
});

describe.skipIf(semBanco())('ctx.gravarParametros × Postgres (T-0180)', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 2 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    app = createApp({
      banco: criarBancoApp(pool),
      modulos: modulosDeTeste({ vendedor: rotas }),
      autenticar: async (h) => quem[h['x-teste-usuario'] ?? ''] ?? null,
      licencas: async () => ({
        ativosNoTenant: ['core', 'catalogo', 'vendedor'] as ModuloId[],
        doPerfil: ['core', 'catalogo', 'vendedor'] as ModuloId[],
        removidosDoUsuario: [] as ModuloId[],
        parametros: {},
      }),
    });
  });
  afterAll(async () => {
    await admin?.query('delete from plataforma.parametro where chave = $1', [CHAVE]).catch(() => undefined);
    await app?.close();
    await admin?.end();
    await pool?.end();
  });

  const put = (u: string, corpo: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: '/v1/vendedor/parametros-teste', headers: { 'x-teste-usuario': u }, payload: corpo });
  const linhas = async () =>
    (await admin.query<{ tenant_id: string; modulo: string; valor: unknown; updated_at: Date }>(
      'select tenant_id, modulo, valor, updated_at from plataforma.parametro where chave = $1 and deleted_at is null order by tenant_id',
      [CHAVE],
    )).rows;
  const auditorias = async (t: string) =>
    (await admin.query<{ modulo: string; antes: unknown; depois: unknown }>(
      'select modulo, antes, depois from plataforma.auditoria where tenant_id = $1 and acao = $2 order by ocorrido_em, id',
      [t, ACAO],
    )).rows;

  it('grava no módulo da rota e no tenant do token; repetir não muda nada; outro tenant tem o próprio valor', async () => {
    const r = await put('a', { valor: 7 });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ valor: 7 });
    const [l1] = await linhas();
    expect(l1).toMatchObject({ tenant_id: A.tenantId, modulo: 'vendedor', valor: 7 });

    expect((await put('a', { valor: 7 })).statusCode).toBe(200);
    const [l2] = await linhas();
    expect(l2!.updated_at.getTime()).toBe(l1!.updated_at.getTime());
    expect(await auditorias(A.tenantId)).toEqual([{ modulo: 'vendedor', antes: { [CHAVE]: null }, depois: { [CHAVE]: 7 } }]);

    expect((await put('b', { valor: 3 })).json()).toEqual({ valor: 3 });
    expect((await linhas()).map((l) => [l.tenant_id, l.valor])).toEqual(
      [
        [A.tenantId, 7],
        [B.tenantId, 3],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    expect(await auditorias(B.tenantId)).toHaveLength(1);
  });

  it('a rota que falha depois de gravar desfaz a gravação e a auditoria (mesma transação)', async () => {
    const r = await put('a', { valor: 9, falhar: true });
    expect(r.statusCode).toBe(422);
    expect((await linhas()).find((l) => l.tenant_id === A.tenantId)?.valor).toBe(7);
    expect(await auditorias(A.tenantId)).toHaveLength(1);
  });
});
