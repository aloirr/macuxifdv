/**
 * Arquivos × Postgres real (ADR 0010; desenho T-0016 §1 E4; fixture dois-tenants, papel macuxi_app, RLS).
 * O comando do módulo cria a linha `aguardando` na própria transação (`tx.registrarArquivo`); o upload só a completa.
 *  - upload antes do comando → 409 ARQUIVO_SEM_REFERENCIA (retentável); depois → 201; repetido → 200; sha diferente → 409;
 *  - comando repetido não duplica; o mesmo id em outra entidade → 409 ARQUIVO_JA_REFERENCIADO;
 *  - GET: dono lê os bytes; fora da carteira → 403; módulo inativo → 403 MODULO_INATIVO; outro tenant → 404 (RLS);
 *  - upload de outro usuário não completa a linha (não revela que existe);
 *  - foto de produto do Catálogo (sem cliente) vale para o tenant (T-0097, RN-CAT-04): vendedor e promotor leem a do analista;
 *    outra finalidade sem cliente segue os usuários visíveis (404); outro tenant → 404 (RLS).
 * Pula sem Docker/Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { randomUUID } from 'node:crypto';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { definirModuloApi, type ModuloId, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { criarArmazenamentoEmMemoria } from '../src/arquivos';
import { criarBancoApp } from '../src/banco';
import { MODULOS_API } from '../src/modulos';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;

const quem: Record<string, UsuarioAutenticado> = {
  vendedor1: { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' },
  vendedor2: { id: A.usuarios.vendedor2, tenant_id: A.tenantId, perfil: 'vendedor' },
  promotor: { id: A.usuarios.promotor, tenant_id: A.tenantId, perfil: 'promotor' },
  analista: { id: A.usuarios.analista, tenant_id: A.tenantId, perfil: 'analista' },
  adminB: { id: B.usuarios.admin, tenant_id: B.tenantId, perfil: 'admin' },
};
const autenticar = async (h: Readonly<Record<string, string | undefined>>) => quem[h['x-teste-usuario'] ?? ''] ?? null;
// carteiras da fixture (core.carteira): vendedor-1 = c1, c3; vendedor-2 = c2; promotor = c1
const CARTEIRAS: Record<string, string[]> = {
  [A.usuarios.vendedor1]: [A.clientes.c1, A.clientes.c3],
  [A.usuarios.vendedor2]: [A.clientes.c2],
  [A.usuarios.promotor]: [A.clientes.c1],
};
// licenças fixas: outros arquivos de teste mudam licenças da fixture no mesmo banco (o resultado aqui não pode depender da ordem)
const licencas = async (u: UsuarioAutenticado) => ({
  ativosNoTenant: ['core', 'catalogo', 'vendedor', 'promotor'] as ModuloId[],
  doPerfil: (u.perfil === 'promotor' ? ['core', 'catalogo', 'promotor'] : ['core', 'catalogo', 'vendedor', 'promotor']) as ModuloId[],
  removidosDoUsuario: [] as ModuloId[],
  parametros: {},
});
const carteira = async (u: UsuarioAutenticado) => (u.perfil === 'analista' || u.perfil === 'admin' ? ('tenant' as const) : new Set(CARTEIRAS[u.id] ?? []));

/** JPEG mínimo com SOF0 1600×1200 (dimensões gravadas na linha). */
function jpeg(semente = 0): Buffer {
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0xb0, 0x06, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x03, semente, ...sof0, 0xff, 0xd9]);
}

/** Rota de teste do Vendedor que referencia a foto no comando (como fará o checkout do Core na T-0018). */
const vendedorApi = definirModuloApi({
  manifesto: vendedor,
  rotas: [
    {
      metodo: 'POST',
      caminho: 'pedidos',
      acao: 'pedido.criar',
      status: 201,
      corpo: z.object({ id: z.string().uuid(), cliente_id: z.string().uuid(), foto_id: z.string().uuid() }),
      carteira: (e) => (e.corpo as { cliente_id: string }).cliente_id,
      executar: (ctx) =>
        ctx.comTenant(async (_db, tx) =>
          tx.registrarArquivo({ id: ctx.corpo.foto_id, finalidade: 'comprovante', entidade: 'pedido', entidade_id: ctx.corpo.id, cliente_id: ctx.corpo.cliente_id }),
        ),
    },
  ],
});

/** Catálogo real + rota de teste que registra a foto sem cliente (como o PUT produtos/:id/foto-principal da T-0097). */
const catalogoReal = MODULOS_API.find((m) => m.manifesto.id === 'catalogo')!;
const catalogoApi = definirModuloApi({
  ...catalogoReal,
  rotas: [
    ...(catalogoReal.rotas ?? []),
    {
      metodo: 'POST',
      caminho: 'teste-fotos',
      acao: 'produto.enriquecer',
      status: 201,
      carteira: 'nao_se_aplica',
      corpo: z.object({ foto_id: z.string().uuid(), produto_id: z.string().uuid(), finalidade: z.enum(['foto_produto', 'anexo_interno']) }),
      executar: (ctx) =>
        ctx.comTenant(async (_db, tx) => tx.registrarArquivo({ id: ctx.corpo.foto_id, finalidade: ctx.corpo.finalidade, entidade: 'produto', entidade_id: ctx.corpo.produto_id })),
    },
  ],
});

describe.skipIf(semBanco())('arquivos × Postgres (ADR 0010)', () => {
  let pool: pg.Pool;
  const armazenamento = criarArmazenamentoEmMemoria();
  let app: ReturnType<typeof createApp>;
  const AGORA = new Date('2026-10-31T15:00:00Z');

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    app = createApp({
      banco: criarBancoApp(pool),
      autenticar,
      licencas,
      carteira,
      arquivos: armazenamento,
      relogio: () => AGORA,
      modulos: MODULOS_API.map((m) => (m.manifesto.id === 'vendedor' ? vendedorApi : m.manifesto.id === 'catalogo' ? catalogoApi : m)),
    });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  const put = (u: string, id: string, bytes: Buffer) =>
    app.inject({ method: 'PUT', url: `/v1/arquivos/${id}`, headers: { 'x-teste-usuario': u, 'content-type': 'image/jpeg' }, payload: bytes });
  const get = (u: string, id: string) => app.inject({ method: 'GET', url: `/v1/arquivos/${id}`, headers: { 'x-teste-usuario': u } });
  const comando = (u: string, corpo: { id: string; cliente_id: string; foto_id: string }) =>
    app.inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: { 'x-teste-usuario': u }, payload: corpo });
  const linha = (id: string) =>
    criarBancoApp(pool).comTenant(A.tenantId, async (db) => (await db.query('select * from plataforma.arquivo where id = $1', [id])).rows[0] as Record<string, unknown> | undefined);

  it('upload antes do comando → 409 retentável; comando cria a linha aguardando; upload → 201 com sha, tamanho e dimensões', async () => {
    const foto = randomUUID();
    const pedido = randomUUID();
    const antes = await put('vendedor1', foto, jpeg(1));
    expect(antes.statusCode).toBe(409);
    expect(antes.json()).toMatchObject({ codigo: 'ARQUIVO_SEM_REFERENCIA' });

    expect((await comando('vendedor1', { id: pedido, cliente_id: A.clientes.c1, foto_id: foto })).json()).toEqual({ criado: true });
    expect(await linha(foto)).toMatchObject({ situacao: 'aguardando', modulo: 'vendedor', entidade: 'pedido', entidade_id: pedido, enviado_por: A.usuarios.vendedor1, cliente_id: A.clientes.c1 });

    const ok = await put('vendedor1', foto, jpeg(1));
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ id: foto, situacao: 'recebido', tamanho_bytes: jpeg(1).length, repetido: false });
    const l = await linha(foto);
    expect(l).toMatchObject({ situacao: 'recebido', tamanho_bytes: jpeg(1).length, largura_px: 1600, altura_px: 1200, chave_armazenamento: `${A.tenantId}/vendedor/2026-10/${foto}.jpg` });
    expect(l?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(armazenamento.chaves()).toContain(`${A.tenantId}/vendedor/2026-10/${foto}.jpg`);
  });

  it('idempotência: upload repetido → 200; conteúdo diferente → 409 ARQUIVO_DIVERGENTE; comando repetido não duplica; outro uso do id → 409', async () => {
    const foto = randomUUID();
    const pedido = randomUUID();
    await comando('vendedor1', { id: pedido, cliente_id: A.clientes.c1, foto_id: foto });
    expect((await comando('vendedor1', { id: pedido, cliente_id: A.clientes.c1, foto_id: foto })).json()).toEqual({ criado: false });
    expect((await put('vendedor1', foto, jpeg(2))).statusCode).toBe(201);
    const repetido = await put('vendedor1', foto, jpeg(2));
    expect(repetido.statusCode).toBe(200);
    expect(repetido.json()).toMatchObject({ repetido: true });
    const outro = await put('vendedor1', foto, jpeg(3));
    expect(outro.statusCode).toBe(409);
    expect(outro.json()).toMatchObject({ codigo: 'ARQUIVO_DIVERGENTE' });
    const reuso = await comando('vendedor1', { id: randomUUID(), cliente_id: A.clientes.c1, foto_id: foto });
    expect(reuso.statusCode).toBe(409);
    expect(reuso.json()).toMatchObject({ codigo: 'ARQUIVO_JA_REFERENCIADO' });
  });

  it('upload de outro usuário não completa a linha (409, sem revelar); outro tenant nem vê', async () => {
    const foto = randomUUID();
    await comando('vendedor1', { id: randomUUID(), cliente_id: A.clientes.c1, foto_id: foto });
    expect((await put('vendedor2', foto, jpeg(4))).json()).toMatchObject({ codigo: 'ARQUIVO_SEM_REFERENCIA' });
    expect((await put('adminB', foto, jpeg(4))).json()).toMatchObject({ codigo: 'ARQUIVO_SEM_REFERENCIA' });
    expect(await linha(foto)).toMatchObject({ situacao: 'aguardando' });
  });

  it('GET: dono e analista leem os bytes; fora da carteira → 403; módulo inativo → 403; outro tenant → 404; aguardando → 404', async () => {
    const foto = randomUUID();
    await comando('vendedor1', { id: randomUUID(), cliente_id: A.clientes.c1, foto_id: foto });
    expect((await get('vendedor1', foto)).statusCode).toBe(404); // ainda aguardando
    await put('vendedor1', foto, jpeg(5));

    const dono = await get('vendedor1', foto);
    expect(dono.statusCode).toBe(200);
    expect(dono.headers['content-type']).toBe('image/jpeg');
    expect(dono.rawPayload).toEqual(jpeg(5));
    expect((await get('analista', foto)).statusCode).toBe(200);

    const fora = await get('vendedor2', foto);
    expect(fora.statusCode).toBe(403);
    expect(fora.json()).toMatchObject({ codigo: 'FORA_DA_CARTEIRA' });
    // a foto é do Vendedor; o promotor não tem o módulo efetivo (RN-CORE-01/02)
    const promotor = await get('promotor', foto);
    expect(promotor.statusCode).toBe(403);
    expect(promotor.json()).toMatchObject({ codigo: 'MODULO_INATIVO' });
    expect((await get('adminB', foto)).statusCode).toBe(404);
  });

  it('foto_produto do Catálogo (sem cliente): vendedor e promotor leem a do analista; outra finalidade → 404; outro tenant → 404', async () => {
    const foto = randomUUID();
    const anexo = randomUUID();
    const registrar = (id: string, finalidade: string) =>
      app.inject({ method: 'POST', url: '/v1/catalogo/teste-fotos', headers: { 'x-teste-usuario': 'analista' }, payload: { foto_id: id, produto_id: randomUUID(), finalidade } });
    expect((await registrar(foto, 'foto_produto')).statusCode).toBe(201);
    expect((await registrar(anexo, 'anexo_interno')).statusCode).toBe(201);
    expect(await linha(foto)).toMatchObject({ modulo: 'catalogo', finalidade: 'foto_produto', cliente_id: null, enviado_por: A.usuarios.analista });
    expect((await put('analista', foto, jpeg(6))).statusCode).toBe(201);
    expect((await put('analista', anexo, jpeg(7))).statusCode).toBe(201);

    for (const quem of ['vendedor1', 'vendedor2', 'promotor']) {
      const r = await get(quem, foto);
      expect(r.statusCode, quem).toBe(200);
      expect(r.rawPayload).toEqual(jpeg(6));
    }
    const outro = await get('vendedor1', anexo);
    expect(outro.statusCode).toBe(404);
    expect(outro.json()).toMatchObject({ codigo: 'ARQUIVO_NAO_ENCONTRADO' });
    expect((await get('analista', anexo)).statusCode).toBe(200);
    expect((await get('adminB', foto)).statusCode).toBe(404);
  });
});
