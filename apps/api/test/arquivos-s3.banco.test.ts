/**
 * Isolamento de fotos entre tenants com o adaptador S3 (RN-CORE-05; ADR 0010 + ADR 0020; T-0074, critério 4).
 * Postgres real (fixture dois-tenants, papel macuxi_app, RLS) + S3 FALSO local que confere a assinatura (s3-falso.ts);
 * nunca o bucket real. Cada tenant grava sob o próprio prefixo; um tenant não lê nem sobrescreve a foto do outro, mesmo
 * sabendo o id (o objeto existe no bucket, mas a linha de plataforma.arquivo do outro tenant é invisível pela RLS).
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
import { criarArmazenamentoS3 } from '../src/armazenamento-s3';
import { criarBancoApp } from '../src/banco';
import { MODULOS_API } from '../src/modulos';
import { CRED_TESTE, subirS3Falso, type S3Falso } from './s3-falso';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;

const quem: Record<string, UsuarioAutenticado> = {
  vendedorA: { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' },
  analistaA: { id: A.usuarios.analista, tenant_id: A.tenantId, perfil: 'analista' },
  vendedorB: { id: B.usuarios.vendedor, tenant_id: B.tenantId, perfil: 'vendedor' },
  adminB: { id: B.usuarios.admin, tenant_id: B.tenantId, perfil: 'admin' },
};
const autenticar = async (h: Readonly<Record<string, string | undefined>>) => quem[h['x-teste-usuario'] ?? ''] ?? null;
const licencas = async () => ({
  ativosNoTenant: ['core', 'catalogo', 'vendedor'] as ModuloId[],
  doPerfil: ['core', 'catalogo', 'vendedor'] as ModuloId[],
  removidosDoUsuario: [] as ModuloId[],
  parametros: {},
});
const carteira = async (u: UsuarioAutenticado) =>
  u.perfil === 'analista' || u.perfil === 'admin' ? ('tenant' as const) : new Set(u.tenant_id === A.tenantId ? [A.clientes.c1] : [B.clientes.c1]);

function jpeg(semente: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x03, semente, 0xff, 0xd9]);
}

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

describe.skipIf(semBanco())('fotos no S3 × dois tenants (RN-CORE-05)', () => {
  let pool: pg.Pool;
  let s3: S3Falso;
  let app: ReturnType<typeof createApp>;
  const AGORA = new Date('2026-11-04T05:00:00Z');

  beforeAll(async () => {
    s3 = await subirS3Falso('macuxi-demo-arquivos');
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    app = createApp({
      banco: criarBancoApp(pool),
      autenticar,
      licencas,
      carteira,
      arquivos: criarArmazenamentoS3({ endpoint: s3.endpoint, regiao: CRED_TESTE.regiao, bucket: s3.bucket, chaveId: CRED_TESTE.chaveId, segredo: CRED_TESTE.segredo, prefixo: 'arquivos/' }),
      relogio: () => AGORA,
      modulos: MODULOS_API.map((m) => (m.manifesto.id === 'vendedor' ? vendedorApi : m)),
    });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await s3?.fechar();
  });

  const put = (u: string, id: string, bytes: Buffer) =>
    app.inject({ method: 'PUT', url: `/v1/arquivos/${id}`, headers: { 'x-teste-usuario': u, 'content-type': 'image/jpeg' }, payload: bytes });
  const get = (u: string, id: string) => app.inject({ method: 'GET', url: `/v1/arquivos/${id}`, headers: { 'x-teste-usuario': u } });
  const comando = (u: string, cliente: string, foto: string) =>
    app.inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: { 'x-teste-usuario': u }, payload: { id: randomUUID(), cliente_id: cliente, foto_id: foto } });
  const objeto = (tenant: string, foto: string) => `/${s3.bucket}/arquivos/${tenant}/vendedor/2026-11/${foto}.jpg`;

  it('cada tenant grava sob o próprio prefixo e lê a própria foto do bucket', async () => {
    const fotoA = randomUUID();
    const fotoB = randomUUID();
    expect((await comando('vendedorA', A.clientes.c1, fotoA)).statusCode).toBe(201);
    expect((await comando('vendedorB', B.clientes.c1, fotoB)).statusCode).toBe(201);
    expect((await put('vendedorA', fotoA, jpeg(1))).statusCode).toBe(201);
    expect((await put('vendedorB', fotoB, jpeg(2))).statusCode).toBe(201);
    expect(s3.objetos.get(objeto(A.tenantId, fotoA))).toEqual(jpeg(1));
    expect(s3.objetos.get(objeto(B.tenantId, fotoB))).toEqual(jpeg(2));

    const doA = await get('vendedorA', fotoA);
    expect(doA.statusCode).toBe(200);
    expect(doA.rawPayload).toEqual(jpeg(1));
    expect((await get('analistaA', fotoA)).rawPayload).toEqual(jpeg(1));
    expect((await get('vendedorB', fotoB)).rawPayload).toEqual(jpeg(2));
  });

  it('tenant B não lê a foto do tenant A nem sabendo o id (404), e A não lê a de B', async () => {
    const fotoA = randomUUID();
    const fotoB = randomUUID();
    await comando('vendedorA', A.clientes.c1, fotoA);
    await comando('vendedorB', B.clientes.c1, fotoB);
    await put('vendedorA', fotoA, jpeg(3));
    await put('vendedorB', fotoB, jpeg(4));
    expect(s3.objetos.has(objeto(A.tenantId, fotoA))).toBe(true); // o objeto existe no bucket…

    for (const u of ['vendedorB', 'adminB']) {
      const r = await get(u, fotoA); // …mas a linha é invisível para B (RLS)
      expect(r.statusCode).toBe(404);
      expect(r.json()).toMatchObject({ codigo: 'ARQUIVO_NAO_ENCONTRADO' });
      expect(r.rawPayload.includes(jpeg(3))).toBe(false);
    }
    expect((await get('analistaA', fotoB)).statusCode).toBe(404);
  });

  it('tenant B não sobrescreve nem cria objeto com o id da foto de A', async () => {
    const fotoA = randomUUID();
    await comando('vendedorA', A.clientes.c1, fotoA);
    await put('vendedorA', fotoA, jpeg(5));
    const antes = s3.objetos.size;

    const r = await put('vendedorB', fotoA, jpeg(6));
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ codigo: 'ARQUIVO_SEM_REFERENCIA' });
    expect(s3.objetos.get(objeto(A.tenantId, fotoA))).toEqual(jpeg(5));
    expect(s3.objetos.has(objeto(B.tenantId, fotoA))).toBe(false);
    expect(s3.objetos.size).toBe(antes);
  });

  it('todo objeto gravado fica sob arquivos/<tenant>/ de um dos dois tenants', () => {
    for (const caminho of s3.objetos.keys()) {
      expect(caminho.startsWith(`/${s3.bucket}/arquivos/${A.tenantId}/`) || caminho.startsWith(`/${s3.bucket}/arquivos/${B.tenantId}/`)).toBe(true);
    }
  });
});
