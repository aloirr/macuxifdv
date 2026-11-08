/**
 * ADR 0025 §4.1 (T-0114) × Postgres real (fixture dois-tenants, papel macuxi_app): a consulta `configuracaoDoTenant` pedida
 * com `{ licenca: 'tenant' }` numa rota de ESCRITA roda num savepoint somente leitura no meio da transação da rota:
 *  - depois de a rota já ter escrito, a consulta enxerga `transaction_read_only = on`, e a rota volta a escrever depois dela;
 *  - se a consulta tenta escrever, o Postgres recusa (SQLSTATE 25006), a rota cai em 500 e a transação desfaz tudo.
 * Pula sem Docker/Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { randomUUID } from 'node:crypto';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { defineModule, definirConsulta, definirModuloApi, implementarConsulta, type ModuloId, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { criarBancoApp } from '../src/banco';
import { MODULOS_API } from '../src/modulos';

const A = DOIS_TENANTS.A;
const quem: Record<string, UsuarioAutenticado> = { vendedorA: { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' } };
const autenticar = async (h: Readonly<Record<string, string | undefined>>) => quem[h['x-teste-usuario'] ?? ''] ?? null;
const licencas = async () => ({
  ativosNoTenant: ['core', 'catalogo', 'vendedor'] as ModuloId[],
  doPerfil: ['core', 'catalogo', 'vendedor'] as ModuloId[],
  removidosDoUsuario: [] as ModuloId[],
  parametros: {},
});

/** Consulta de configuração do tenant: diz se roda só leitura e, se pedido, tenta escrever (deve ser recusada). */
const CONFIG = definirConsulta({
  nome: 'catalogo.config_teste@1',
  entrada: z.object({ escrever: z.boolean() }).strict(),
  saida: z.object({ somente_leitura: z.string(), txid: z.string() }).strict(),
  configuracaoDoTenant: true,
});
const catalogoReal = MODULOS_API.find((m) => m.manifesto.id === 'catalogo')!;
const catalogoApi = definirModuloApi({
  ...catalogoReal,
  manifesto: defineModule({ ...catalogo, ofereceConsultas: [...(catalogo.ofereceConsultas ?? []), 'catalogo.config_teste@1'] }),
  consultas: [
    ...(catalogoReal.consultas ?? []),
    implementarConsulta(CONFIG, async (e, ctx) => {
      if (e.escrever)
        await ctx.db.query(
          `insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id, request_id, ocorrido_em)
           values (plataforma.tenant_atual(), $1, 'catalogo', 'teste.escrever', 'teste', $2, 'r', now())`,
          [ctx.usuario.id, randomUUID()],
        );
      const r = (await ctx.db.query<{ ro: string; txid: string }>("select current_setting('transaction_read_only') as ro, txid_current_if_assigned()::text as txid")).rows[0]!;
      return { somente_leitura: r.ro, txid: r.txid ?? '' };
    }),
  ],
});

const vendedorApi = definirModuloApi({
  manifesto: defineModule({ ...vendedor, usaConsultas: [...(vendedor.usaConsultas ?? []), 'catalogo.config_teste@1'] }),
  rotas: [
    {
      metodo: 'POST',
      caminho: 'teste-config/:id',
      acao: 'pedido.criar',
      carteira: 'nao_se_aplica',
      params: z.object({ id: z.string().uuid() }),
      query: z.object({ escrever: z.string().optional() }),
      executar: (ctx) =>
        ctx.comTenant(async (db, tx) => {
          const id = (ctx.params as { id: string }).id;
          await tx.auditar({ acao: 'teste.antes', entidade: 'pedido', entidade_id: id });
          const txid = (await db.query<{ txid: string }>('select txid_current()::text as txid')).rows[0]!.txid;
          const r = await tx.consultar(CONFIG, { escrever: Boolean((ctx.query as { escrever?: string }).escrever) }, { licenca: 'tenant' });
          const depois = (await db.query<{ ro: string }>("select current_setting('transaction_read_only') as ro")).rows[0]!.ro;
          await tx.auditar({ acao: 'teste.depois', entidade: 'pedido', entidade_id: id });
          return { txid, consulta: r, depois };
        }),
    },
  ],
});

describe.skipIf(semBanco())('ADR 0025 §4.1 × Postgres: consulta configuracaoDoTenant em escrita, só leitura', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    app = createApp({
      banco: criarBancoApp(pool),
      autenticar,
      licencas,
      modulos: MODULOS_API.map((m) => (m.manifesto.id === 'vendedor' ? vendedorApi : m.manifesto.id === 'catalogo' ? catalogoApi : m)),
    });
  });
  afterAll(async () => {
    await app?.close();
    await admin?.end();
    await pool?.end();
  });

  const chamar = (id: string, escrever = false) =>
    app.inject({ method: 'POST', url: `/v1/vendedor/teste-config/${id}${escrever ? '?escrever=1' : ''}`, headers: { 'x-teste-usuario': 'vendedorA' } });
  const acoes = async (id: string) =>
    (await admin.query<{ acao: string }>('select acao from plataforma.auditoria where entidade_id = $1 order by acao', [id])).rows.map((r) => r.acao);

  it('na mesma transação: a consulta roda só leitura e a rota volta a escrever depois dela', async () => {
    const id = randomUUID();
    const r = await chamar(id);
    expect(r.statusCode, r.body).toBe(200);
    const corpo = r.json() as { txid: string; consulta: { somente_leitura: string; txid: string }; depois: string };
    expect(corpo.consulta.somente_leitura).toBe('on');
    expect(corpo.consulta.txid).toBe(corpo.txid);
    expect(corpo.depois).toBe('off');
    expect(await acoes(id)).toEqual(['teste.antes', 'teste.depois']);
  });

  it('a consulta que tenta escrever é recusada pelo Postgres: 500 e a transação desfaz tudo', async () => {
    const id = randomUUID();
    const r = await chamar(id, true);
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ codigo: 'ERRO_INTERNO', mensagem: expect.any(String) });
    expect(await acoes(id)).toEqual([]);
    expect((await admin.query("select count(*)::int as n from plataforma.auditoria where acao = 'teste.escrever'")).rows[0]).toEqual({ n: 0 });
  });
});
