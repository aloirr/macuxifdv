/**
 * Arquivos sem banco (ADR 0010; desenho T-0016 §1 E4): sessão antes do corpo, tipo, assinatura JPEG, limite de 2 MB,
 * adaptador de disco (chave fechada, gravação atômica), a proteção do Zod (GHSA-mrhx-c7xc-m3w5) no createApp e o escopo
 * do GET sem cliente: foto de produto do Catálogo vale para o tenant (T-0097, RN-CAT-04); as outras, os usuários visíveis.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { definirModuloApi, LIMITE_ARQUIVO_BYTES, type ClienteBanco } from '@macuxi/platform-sdk';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, excedeElementos, MAX_ELEMENTOS_CORPO } from '../src/app';
import { chaveDoArquivo, criarArmazenamentoEmDisco, criarArmazenamentoEmMemoria } from '../src/arquivos';
import type { BancoApp } from '../src/banco';
import { bancoFalso, cab, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, TENANT, usuarios } from './apoio';

const ID = '0f000000-0000-4000-8000-0000000000b1';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);

function montar() {
  return createApp(opcoesDeTeste(undefined, { banco: bancoFalso().banco, arquivos: criarArmazenamentoEmMemoria() }));
}

describe('PUT /v1/arquivos/:id — antes do banco', () => {
  it('401 sem sessão (o corpo nem é aceito)', async () => {
    const app = montar();
    const r = await app.inject({ method: 'PUT', url: `/v1/arquivos/${ID}`, headers: { 'content-type': 'image/jpeg' }, payload: JPEG });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ codigo: 'NAO_AUTENTICADO' });
    await app.close();
  });

  it('400 com id que não é UUID; 415 com outro tipo; 400 ARQUIVO_INVALIDO sem assinatura JPEG ou vazio', async () => {
    const app = montar();
    const put = (url: string, tipo: string, payload: Buffer | string) =>
      app.inject({ method: 'PUT', url, headers: { ...cab('vendedor'), 'content-type': tipo }, payload });
    expect((await put('/v1/arquivos/foto-1', 'image/jpeg', JPEG)).statusCode).toBe(400);
    const png = await put(`/v1/arquivos/${ID}`, 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(png.statusCode).toBe(415);
    expect(png.json()).toMatchObject({ codigo: 'TIPO_NAO_ACEITO' });
    const json = await put(`/v1/arquivos/${ID}`, 'application/json', JSON.stringify({ x: 1 }));
    expect(json.statusCode).toBe(415);
    const falso = await put(`/v1/arquivos/${ID}`, 'image/jpeg', Buffer.from('não sou jpeg'));
    expect(falso.statusCode).toBe(400);
    expect(falso.json()).toMatchObject({ codigo: 'ARQUIVO_INVALIDO' });
    expect((await put(`/v1/arquivos/${ID}`, 'image/jpeg', Buffer.alloc(0))).json()).toMatchObject({ codigo: 'ARQUIVO_INVALIDO' });
    await app.close();
  });

  it('413 ARQUIVO_GRANDE_DEMAIS acima de 2 MB', async () => {
    const app = montar();
    const grande = Buffer.concat([JPEG, Buffer.alloc(LIMITE_ARQUIVO_BYTES)]);
    const r = await app.inject({ method: 'PUT', url: `/v1/arquivos/${ID}`, headers: { ...cab('vendedor'), 'content-type': 'image/jpeg' }, payload: grande });
    expect(r.statusCode).toBe(413);
    expect(r.json()).toMatchObject({ codigo: 'ARQUIVO_GRANDE_DEMAIS' });
    await app.close();
  });

  it('503 sem armazenamento configurado (falha fechada)', async () => {
    const app = createApp(opcoesDeTeste(undefined, { banco: bancoFalso().banco }));
    const r = await app.inject({ method: 'PUT', url: `/v1/arquivos/${ID}`, headers: { ...cab('vendedor'), 'content-type': 'image/jpeg' }, payload: JPEG });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ codigo: 'ARMAZENAMENTO_INDISPONIVEL' });
    await app.close();
  });

  it('GET: 401 sem sessão e 404 quando a linha não existe', async () => {
    const app = montar();
    expect((await app.inject({ method: 'GET', url: `/v1/arquivos/${ID}` })).statusCode).toBe(401);
    const r = await app.inject({ method: 'GET', url: `/v1/arquivos/${ID}`, headers: cab('vendedor') });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ codigo: 'ARQUIVO_NAO_ENCONTRADO' });
    await app.close();
  });
});

describe('adaptador de disco (MACUXI_ARQUIVOS_DIR)', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'macuxi-arquivos-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('chave <tenant>/<modulo>/<aaaa-mm>/<id>.jpg; grava, lê, remove; ler o que não existe = null', async () => {
    const chave = chaveDoArquivo({ tenant_id: TENANT, modulo: 'core', id: ID.toUpperCase() }, new Date('2026-10-31T23:59:00Z'));
    expect(chave).toBe(`${TENANT}/core/2026-10/${ID}.jpg`);
    const disco = criarArmazenamentoEmDisco(dir);
    await disco.gravar(chave, JPEG);
    expect(Buffer.from((await disco.ler(chave))!)).toEqual(JPEG);
    // gravação atômica: nenhum .tmp sobra na pasta
    expect(await readdir(join(dir, TENANT, 'core', '2026-10'))).toEqual([`${ID}.jpg`]);
    await disco.remover(chave);
    expect(await disco.ler(chave)).toBeNull();
  });

  it('chave fora do formato (.., absoluta, barra invertida) nunca vira caminho', async () => {
    const disco = criarArmazenamentoEmDisco(dir);
    for (const ruim of ['../x.jpg', `${TENANT}/core/2026-10/../../x.jpg`, `/etc/passwd`, `${TENANT}\\core\\2026-10\\${ID}.jpg`])
      await expect(disco.gravar(ruim, JPEG)).rejects.toThrow(/chave de arquivo inválida/);
    expect(() => chaveDoArquivo({ tenant_id: TENANT, modulo: '../core', id: ID }, new Date())).toThrow(/inválida/);
  });
});

describe('proteção do Zod (GHSA-mrhx-c7xc-m3w5)', () => {
  it('excedeElementos soma os arrays em qualquer profundidade e ignora bytes', () => {
    expect(excedeElementos({ itens: new Array(10).fill(0) }, 10)).toBe(false);
    expect(excedeElementos({ itens: new Array(6).fill({ sub: [1, 2, 3, 4, 5] }) }, 10)).toBe(true);
    expect(excedeElementos(Buffer.alloc(100_000), 10)).toBe(false);
    expect(excedeElementos(null)).toBe(false);
  });

  it('push sem sessão: 401 antes de validar o lote', async () => {
    const app = montar();
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', payload: { itens: [{ x: 1 }] } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it(`corpo com mais de ${MAX_ELEMENTOS_CORPO} elementos: 413 antes de qualquer schema (rota pública e push)`, async () => {
    const app = montar();
    const enorme = JSON.stringify({ itens: new Array(MAX_ELEMENTOS_CORPO + 1).fill(0) });
    const push = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: { ...cab('vendedor'), 'content-type': 'application/json' }, payload: enorme });
    expect(push.statusCode).toBe(413);
    expect(push.json()).toMatchObject({ codigo: 'CORPO_GRANDE_DEMAIS' });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: enorme });
    expect(login.statusCode).toBe(413);
    await app.close();
  });

  it('400 de validação lista no máximo 50 problemas (com o total)', async () => {
    const vendedorLote = definirModuloApi({
      manifesto: vendedor,
      rotas: [
        { metodo: 'POST', caminho: 'lote-teste', acao: 'pedido.criar', carteira: 'nao_se_aplica', corpo: z.object({ quantidades: z.array(z.number()) }), executar: async () => ({}) },
      ],
    });
    const app = createApp(opcoesDeTeste(undefined, { banco: bancoFalso().banco, modulos: modulosDeTeste({ vendedor: vendedorLote }) }));
    const r = await app.inject({ method: 'POST', url: '/v1/vendedor/lote-teste', headers: cab('vendedor'), payload: { quantidades: new Array(120).fill('x') } });
    expect(r.statusCode).toBe(400);
    const d = (r.json() as { detalhes: { problemas: unknown[]; total_problemas: number } }).detalhes;
    expect(d.problemas).toHaveLength(50);
    expect(d.total_problemas).toBe(120);
    await app.close();
  });
});

describe('GET /v1/arquivos/:id — foto sem cliente (T-0097, RN-CAT-04)', () => {
  const CHAVE = `${TENANT}/catalogo/2026-11/${ID}.jpg`;

  /** Banco com uma linha `recebido` em plataforma.arquivo, sem cliente, enviada pelo analista. */
  async function montarCom(finalidade: string, licencas = LICENCAS_PADRAO) {
    const linha = {
      modulo: 'catalogo',
      finalidade,
      enviado_por: usuarios.analista!.id,
      situacao: 'recebido',
      sha256: 'a'.repeat(64),
      tamanho_bytes: JPEG.length,
      cliente_id: null,
      chave_armazenamento: CHAVE,
    };
    const cliente: ClienteBanco = {
      query: async <R>(sql: string) => (/from plataforma\.arquivo/.test(sql) ? { rows: [linha] as R[], rowCount: 1 } : { rows: [] as R[], rowCount: 0 }),
    };
    const banco: BancoApp = { ...bancoFalso().banco, comTenant: async (_t, fn) => fn(cliente), semTenant: async (fn) => fn(cliente) };
    const arquivos = criarArmazenamentoEmMemoria();
    await arquivos.gravar(CHAVE, JPEG);
    // vendedor e promotor só enxergam a si mesmos (como no Core)
    return createApp(opcoesDeTeste(licencas, { banco, arquivos, usuariosVisiveis: async (u) => (u.perfil === 'analista' ? 'tenant' : new Set([u.id])) }));
  }
  const get = (app: ReturnType<typeof createApp>, quem: 'vendedor' | 'promotor' | 'supervisor') =>
    app.inject({ method: 'GET', url: `/v1/arquivos/${ID}`, headers: cab(quem) });

  it('foto_produto enviada pelo analista: vendedor, promotor e supervisor leem (200, os bytes)', async () => {
    const app = await montarCom('foto_produto');
    for (const quem of ['vendedor', 'promotor', 'supervisor'] as const) {
      const r = await get(app, quem);
      expect(r.statusCode, quem).toBe(200);
      expect(r.headers['content-type']).toBe('image/jpeg');
      expect(r.rawPayload).toEqual(JPEG);
    }
    await app.close();
  });

  it('outra finalidade sem cliente: quem não enviou nem enxerga o remetente recebe 404', async () => {
    const app = await montarCom('anexo_interno');
    const r = await get(app, 'vendedor');
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ codigo: 'ARQUIVO_NAO_ENCONTRADO' });
    await app.close();
  });

  it('foto_produto continua exigindo a licença do Catálogo (403 MODULO_INATIVO sem ela)', async () => {
    const app = await montarCom('foto_produto', { ...LICENCAS_PADRAO, perfil: { ...LICENCAS_PADRAO.perfil, vendedor: ['core', 'vendedor'] } });
    const r = await get(app, 'vendedor');
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'MODULO_INATIVO' });
    await app.close();
  });
});
