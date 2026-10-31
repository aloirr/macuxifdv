/**
 * API × Postgres real (fixture dois-tenants, papel macuxi_app). Pula sem Docker/Postgres (aviso no fim);
 * com MACUXI_PG_EXIGIR=1 (CI) falha.
 *  - falha fechada: a API recusa conectar com papel que não seja macuxi_app;
 *  - licenças lidas por comTenant (RLS do tenant do token) → GET /v1/me/modulos;
 *  - horizonte do pull contra transação longa (desenho T-0002 §6 item 3 / T-0004 §5);
 *  - evento gravado na outbox na mesma transação do fato (desfaz junto).
 */
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { MeusModulosRespostaSchema } from '@macuxi/core/contracts';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import {
  codificarCursor,
  definirEntidadeSync,
  definirEvento,
  definirModuloApi,
  ErroRegraNegocio,
  type LinhaSync,
  type UsuarioAutenticado,
} from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { criarBancoApp, ErroPapelBanco } from '../src/banco';
import { licencasDoBanco } from '../src/licencas';
import { MODULOS_API } from '../src/modulos';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;

const quem: Record<string, UsuarioAutenticado> = {
  vendedor1: { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' },
  promotor: { id: A.usuarios.promotor, tenant_id: A.tenantId, perfil: 'promotor' },
  analista: { id: A.usuarios.analista, tenant_id: A.tenantId, perfil: 'analista' },
  adminB: { id: B.usuarios.admin, tenant_id: B.tenantId, perfil: 'admin' },
};
const autenticar = async (h: Readonly<Record<string, string | undefined>>) => quem[h['x-teste-usuario'] ?? ''] ?? null;

describe.skipIf(semBanco())('API × Postgres (papel macuxi_app)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('falha fechada: macuxi_app passa na verificação; o administrador é recusado na subida', async () => {
    await expect(criarBancoApp(pool).verificar()).resolves.toBeUndefined();
    const admin = new pg.Pool({ connectionString: banco().urlAdmin, max: 1 });
    try {
      await expect(criarBancoApp(admin).verificar()).rejects.toBeInstanceOf(ErroPapelBanco);
      const app = createApp({ banco: criarBancoApp(admin) });
      await expect(app.ready()).rejects.toThrow(/só conecta como macuxi_app/);
    } finally {
      await admin.end();
    }
  });

  it('RN-CORE-01/05: licenças lidas por comTenant, só do tenant do token (exceção do usuário remove)', async () => {
    const b = criarBancoApp(pool);
    const v1 = await licencasDoBanco(quem.vendedor1!, b);
    expect(v1.ativosNoTenant.sort()).toEqual(['core', 'promotor', 'vendedor']); // "teste" da fixture não é módulo do produto
    expect(v1.doPerfil.sort()).toEqual(['core', 'vendedor']);
    const adminB = await licencasDoBanco(quem.adminB!, b);
    expect(adminB.ativosNoTenant.sort()).toEqual(['core', 'vendedor']);
    expect(adminB.removidosDoUsuario).toEqual(['vendedor']);
  });

  it('GET /v1/me/modulos com o banco real: vendedor, promotor e admin de B (exceção remove o Vendedor)', async () => {
    const app = createApp({ banco: criarBancoApp(pool), autenticar });
    const ids = async (u: string) => {
      const r = await app.inject({ method: 'GET', url: '/v1/me/modulos', headers: { 'x-teste-usuario': u } });
      expect(r.statusCode).toBe(200);
      return MeusModulosRespostaSchema.parse(r.json()).modulos.map((m) => m.id);
    };
    expect(await ids('vendedor1')).toEqual(['core', 'vendedor']);
    expect(await ids('promotor')).toEqual(['core', 'promotor']);
    expect(await ids('adminB')).toEqual(['core']);
    await app.close();
  });

  it('T-0002 §6 item 3: transação longa aberta não deixa o cursor passar por cima da linha que ela vai confirmar', async () => {
    // Provedor de teste sobre core.cliente (o provedor real é do Core, Fase 2); escopo tenant (analista).
    const cliente = definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.unknown() });
    const coreApi = definirModuloApi({
      manifesto: core,
      sync: [
        {
          entidade: cliente,
          puxar: (ctx, p) =>
            ctx.comTenant(async (db) => {
              const r = await db.query<{ id: string; updated_at: string; deleted_at: string | null }>(
                `select id, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at, deleted_at
                   from core.cliente
                  where updated_at < $1::timestamptz
                    and ($2::timestamptz is null or (updated_at, id) > ($2::timestamptz, $3::uuid))
                  order by updated_at, id
                  limit $4`,
                [p.ate, p.desde?.updated_at ?? null, p.desde?.id ?? null, p.limite],
              );
              return r.rows as LinhaSync[];
            }),
        },
      ],
    });
    const app = createApp({ banco: criarBancoApp(pool, { margemHorizonteMs: 0 }), autenticar, modulos: MODULOS_API.map((m) => (m.manifesto.id === 'core' ? coreApi : m)) });
    const pull = async (cursor: string | null) => {
      const url = `/v1/sync/pull?entidade=cliente${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const r = await app.inject({ method: 'GET', url, headers: { 'x-teste-usuario': 'analista' } });
      expect(r.statusCode).toBe(200);
      return r.json() as { itens: LinhaSync[]; proximo_cursor: string | null };
    };
    const cursorDe = (itens: LinhaSync[], anterior: string | null) => (itens.length ? codificarCursor(itens[itens.length - 1]!) : anterior);

    // carga inicial
    let cursor = cursorDe((await pull(null)).itens, null);

    const longa = await pool.connect();
    const curta = await pool.connect();
    try {
      // T1: a transação longa começa e altera c1 (updated_at = T1), sem confirmar
      await longa.query('begin');
      await longa.query("select set_config('app.tenant_id', $1, true)", [A.tenantId]);
      await longa.query("update core.cliente set nome_fantasia = 'longa' where id = $1", [A.clientes.c1]);
      await new Promise((r) => setTimeout(r, 30));
      // T1.5: uma transação curta altera c2 e confirma
      await curta.query('begin');
      await curta.query("select set_config('app.tenant_id', $1, true)", [A.tenantId]);
      await curta.query("update core.cliente set nome_fantasia = 'curta' where id = $1", [A.clientes.c2]);
      await curta.query('commit');

      // T2: pull com a longa aberta — o horizonte (início da longa) segura c2 e o cursor não passa de T1
      const durante = await pull(cursor);
      expect(durante.itens.map((l) => l.id)).not.toContain(A.clientes.c2);
      // sem o horizonte, c2 (já confirmado, updated_at > T1) sairia agora e o cursor pularia c1 para sempre
      const visivel = await criarBancoApp(pool).comTenant(A.tenantId, (db) =>
        db.query<{ nome_fantasia: string }>('select nome_fantasia from core.cliente where id = $1', [A.clientes.c2]),
      );
      expect(visivel.rows[0]?.nome_fantasia).toBe('curta');
      cursor = cursorDe(durante.itens, cursor);

      // T3: a longa confirma; o próximo pull traz c1 (updated_at = T1) e c2
      await longa.query('commit');
      await new Promise((r) => setTimeout(r, 5));
      const depois = await pull(cursor);
      expect(depois.itens.map((l) => l.id)).toEqual(expect.arrayContaining([A.clientes.c1, A.clientes.c2]));
    } finally {
      await longa.query('rollback').catch(() => undefined);
      longa.release();
      curta.release();
      await app.close();
    }
  });

  it('outbox: o evento entra em plataforma.evento na mesma transação do fato e some se a regra de negócio falhar', async () => {
    const criado = definirEvento('vendedor.pedido.criado@1', z.object({ pedido_id: z.string().uuid() }));
    const vendedorApi = definirModuloApi({
      manifesto: vendedor,
      rotas: [
        {
          metodo: 'POST',
          caminho: 'pedidos',
          acao: 'pedido.criar',
          status: 201,
          carteira: 'filtrar_no_dominio',
          corpo: z.object({ id: z.string().uuid(), falhar: z.boolean() }),
          executar: (ctx) =>
            ctx.comTenant(async (_db, tx) => {
              await tx.publicar(criado, { pedido_id: ctx.corpo.id }, ctx.corpo.id);
              if (ctx.corpo.falhar) throw new ErroRegraNegocio('RN-VEN-01', 'Pedido sem itens.');
              return { id: ctx.corpo.id };
            }),
        },
      ],
    });
    const bancoApp = criarBancoApp(pool);
    const app = createApp({ banco: bancoApp, autenticar, modulos: MODULOS_API.map((m) => (m.manifesto.id === 'vendedor' ? vendedorApi : m)) });
    const ok = '0f000000-0000-4000-8000-000000000001';
    const falha = '0f000000-0000-4000-8000-000000000002';
    const h = { 'x-teste-usuario': 'vendedor1' };
    expect((await app.inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: h, payload: { id: ok, falhar: false } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: h, payload: { id: falha, falhar: true } })).statusCode).toBe(422);
    const eventos = await bancoApp.comTenant(A.tenantId, (db) =>
      db.query<{ agregado_id: string; nome: string; modulo: string; tenant_id: string }>(
        'select agregado_id, nome, modulo, tenant_id from plataforma.evento where agregado_id = any($1::uuid[])',
        [[ok, falha]],
      ),
    );
    expect(eventos.rows).toEqual([{ agregado_id: ok, nome: 'vendedor.pedido.criado@1', modulo: 'vendedor', tenant_id: A.tenantId }]);
    await app.close();
  });
});
