/**
 * T-0182 (desenho `docs/desenho/T-0182-logo-cliente.md` §2 e §3) sem banco real: rotas da logo e do nome fantasia no portal
 * (grava só o super-admin, RN-CORE-33), conferência dos bytes (formato, 1 MiB, altura ≥ 200, lado ≤ 4096), idempotência pelo
 * sha256, troca e remoção do objeto, isolamento por tenant na rota do aparelho e as chaves reservadas do Core. As funções `sa_*`
 * de verdade são testadas no CI pelo banco-dados (`db/testes/tenant-logo.db.test.ts`). Dados fictícios.
 */
import { createHash } from 'node:crypto';
import { CODIGOS_LOGO, LIMITES_LOGO, MENSAGENS_ACESSO_LOGO, MENSAGENS_LOGO, type AcessoPortalAutenticado, type ClienteBanco, type LinhaMarcaTenant } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { CHAVE_ARQUIVO_RE, criarArmazenamentoEmMemoria } from '../src/arquivos';
import type { FonteMarcaEmpresa, LogoParaGravar } from '../src/empresa-logo';
import { comEmpresa } from '../src/licencas';
import { respostaMeusModulos } from '../src/me-modulos';
import { fontePlataformaNoBanco } from '../src/plataforma';
import { MODULOS_API } from '../src/modulos';
import { bancoFalso, bancoPortalFalso, cab, opcoesDeTeste, TENANT } from './apoio';

const OUTRO = '0a000000-0000-4000-8000-000000000002';
const SA: AcessoPortalAutenticado = { tipo: 'super_admin', id: '5a000000-0000-4000-8000-000000000001', sessao_id: '5e000000-0000-4000-8000-000000000001' };
const CLI: AcessoPortalAutenticado = {
  tipo: 'admin_cliente',
  sessao_id: '5e000000-0000-4000-8000-000000000002',
  empresa: { tenant_id: TENANT, usuario_id: '0b000000-0000-4000-8000-000000000001' },
};
const sa = { 'x-quem': 'sa' };
const cli = { 'x-quem': 'cli' };

/** PNG mínimo: assinatura + IHDR (só o cabeçalho é lido). `semente` muda o conteúdo (e o sha256). */
function png(largura: number, altura: number, extra = 0, semente = 0): Buffer {
  const b = Buffer.alloc(33 + extra, semente);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  b.writeUInt32BE(largura, 16);
  b.writeUInt32BE(altura, 20);
  return b;
}
function jpeg(largura: number, altura: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, altura >> 8, altura & 0xff, largura >> 8, largura & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

interface Estado {
  razao_social: string;
  nome_fantasia: string | null;
  logo: (Omit<LogoParaGravar, 'id'> & { atualizada_em: string }) | null;
  /** `undefined` = banco anterior à 0091 (a `sa_marca_da_empresa` ainda sem o campo). */
  ocultar_marca_macuxi?: boolean;
}

/** As `sa_*` em memória, com a mesma regra do desenho §1.2 (sessão, acesso, idempotência, `chave_anterior`). */
function montar(op: { erroGravar?: string; semArmazenamento?: boolean; negarLeitura?: boolean; semFuncaoOcultar?: boolean } = {}) {
  const tenants = new Map<string, Estado>([
    [TENANT, { razao_social: 'Distribuidora Exemplo Ltda', nome_fantasia: null, logo: null }],
    [OUTRO, { razao_social: 'Outra Empresa Ltda', nome_fantasia: null, logo: null }],
  ]);
  const chamadas = { gravarLogo: 0, gravarNome: [] as (string | null)[], gravarOcultar: [] as boolean[] };
  const erro = (code: string) => Object.assign(new Error('pg'), { code });
  const ler = (sid: string, t: string, escrita: boolean) => {
    if (sid !== SA.sessao_id && sid !== CLI.sessao_id) throw erro('28000');
    if (sid === CLI.sessao_id && (escrita || t !== TENANT || op.negarLeitura)) throw erro('42501');
    const e = tenants.get(t);
    if (!e) throw erro('P0002');
    return e;
  };
  const json = (t: string, e: Estado, chave_anterior?: string | null) => ({
    tenant_id: t,
    razao_social: e.razao_social,
    nome_fantasia: e.nome_fantasia,
    logo: e.logo ? { ...e.logo } : null,
    ...(e.ocultar_marca_macuxi === undefined ? {} : { ocultar_marca_macuxi: e.ocultar_marca_macuxi }),
    ...(chave_anterior === undefined ? {} : { chave_anterior }),
  });
  const fonte: FonteMarcaEmpresa = {
    marca: async (sid, t) => json(t, ler(sid, t, false)),
    gravarNome: async (sid, t, nome) => {
      const e = ler(sid, t, true);
      chamadas.gravarNome.push(nome);
      e.nome_fantasia = nome;
      return json(t, e);
    },
    gravarLogo: async (sid, t, p) => {
      const e = ler(sid, t, true);
      chamadas.gravarLogo++;
      if (op.erroGravar) throw erro(op.erroGravar);
      if (e.logo?.sha256 === p.sha256) return json(t, e, null);
      const anterior = e.logo?.chave ?? null;
      const { id: _id, ...resto } = p;
      e.logo = { ...resto, atualizada_em: '2026-11-15T16:00:00.000Z' };
      return json(t, e, anterior);
    },
    gravarOcultarMarca: async (sid, t, ocultar) => {
      if (op.semFuncaoOcultar) throw erro('42883');
      const e = ler(sid, t, true);
      chamadas.gravarOcultar.push(ocultar);
      e.ocultar_marca_macuxi = ocultar;
      return json(t, e);
    },
    removerLogo: async (sid, t) => {
      const e = ler(sid, t, true);
      const anterior = e.logo?.chave ?? null;
      e.logo = null;
      return json(t, e, anterior);
    },
    // RLS em memória: só a linha do tenant da transação
    logoDoTenant: async (db) => {
      const e = tenants.get((db as ClienteBanco & { tenant: string }).tenant);
      return e?.logo ? { sha256: e.logo.sha256, tipo: e.logo.tipo, chave: e.logo.chave } : null;
    },
  };
  const base = bancoFalso().banco;
  const banco = { ...base, comTenant: <T>(t: string, fn: (db: ClienteBanco) => Promise<T>) => base.comTenant(t, (db) => fn({ ...db, tenant: t } as ClienteBanco)) };
  const arquivos = criarArmazenamentoEmMemoria();
  const app = createApp(
    opcoesDeTeste(undefined, {
      banco,
      bancoPortal: bancoPortalFalso().banco,
      autenticarPortal: async (h) => (h['x-quem'] === 'sa' ? SA : h['x-quem'] === 'cli' ? CLI : null),
      plataforma: { ...fontePlataformaNoBanco, auditar: async () => undefined },
      fonteMarca: fonte,
      ...(op.semArmazenamento ? {} : { arquivos }),
      relogio: () => new Date('2026-11-15T16:00:00.000Z'),
    }),
  );
  return { app, tenants, chamadas, arquivos };
}

const enviar = (app: ReturnType<typeof createApp>, corpo: Buffer, tipo = 'image/png', h: Record<string, string> = sa, t = TENANT) =>
  app.inject({ method: 'PUT', url: `/v1/plataforma/empresas/${t}/logo`, headers: { ...h, 'content-type': tipo }, payload: corpo });

describe('PUT /v1/plataforma/empresas/:tenant_id/logo (desenho §2.2)', () => {
  it('super-admin grava PNG: 200 MarcaEmpresa sem a chave; objeto em <tenant>/plataforma/<aaaa-mm>/<uuid>.png', async () => {
    const { app, arquivos, tenants } = montar();
    const b = png(600, 200);
    const r = await enviar(app, b);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({
      tenant_id: TENANT,
      razao_social: 'Distribuidora Exemplo Ltda',
      nome_fantasia: null,
      logo: { sha256: sha(b), tipo: 'image/png', tamanho_bytes: b.length, largura_px: 600, altura_px: 200, atualizada_em: '2026-11-15T16:00:00.000Z' },
      ocultar_marca_macuxi: false,
    });
    expect(r.headers['cache-control']).toBe('private, no-store');
    const [chave] = arquivos.chaves();
    expect(chave).toMatch(new RegExp(`^${TENANT}/plataforma/2026-11/[0-9a-f-]{36}\\.png$`));
    expect(CHAVE_ARQUIVO_RE.test(chave!)).toBe(true);
    expect(tenants.get(TENANT)!.logo!.chave).toBe(chave);
    const j = await enviar(app, jpeg(300, 300), 'image/jpeg');
    expect(j.statusCode, j.body).toBe(200);
    expect(arquivos.chaves()).toEqual([expect.stringMatching(/\.jpg$/)]);
  });

  it('idempotente: a mesma imagem de novo = 200 sem gravar objeto nem chamar o banco; outra imagem troca e apaga a anterior', async () => {
    const { app, arquivos, chamadas } = montar();
    const a = png(600, 200);
    await enviar(app, a);
    const de1 = arquivos.chaves();
    const r = await enviar(app, a);
    expect(r.statusCode).toBe(200);
    expect(r.json().logo.sha256).toBe(sha(a));
    expect(chamadas.gravarLogo).toBe(1);
    expect(arquivos.chaves()).toEqual(de1);
    const b = png(600, 200, 10, 7);
    expect((await enviar(app, b)).json().logo.sha256).toBe(sha(b));
    expect(arquivos.chaves()).toHaveLength(1);
    expect(arquivos.chaves()).not.toEqual(de1);
  });

  it.each([
    ['Content-Type fora de PNG/JPEG', png(600, 200), 'image/webp', 415, CODIGOS_LOGO.formato],
    ['JSON no lugar dos bytes', Buffer.from('{"a":1}'), 'application/json', 415, CODIGOS_LOGO.formato],
    ['assinatura diferente do Content-Type', png(600, 200), 'image/jpeg', 422, CODIGOS_LOGO.formato],
    ['corpo vazio', Buffer.alloc(0), 'image/png', 422, CODIGOS_LOGO.formato],
    ['acima de 1 MiB', png(600, 200, LIMITES_LOGO.bytes), 'image/png', 413, CODIGOS_LOGO.grande],
    ['altura de 199 px', png(800, 199), 'image/png', 422, CODIGOS_LOGO.altura],
    ['lado de 4097 px', png(4097, 300), 'image/png', 422, CODIGOS_LOGO.lado],
  ])('%s → %i %s com a frase do portal, nada gravado', async (_n, corpo, tipo, status, codigo) => {
    const { app, arquivos, chamadas } = montar();
    const r = await enviar(app, corpo, tipo);
    expect(r.statusCode, r.body).toBe(status);
    expect(r.json()).toMatchObject({ codigo, mensagem: MENSAGENS_LOGO[codigo] });
    expect(arquivos.chaves()).toEqual([]);
    expect(chamadas.gravarLogo).toBe(0);
  });

  it('limites exatos passam: 1 MiB, 200 px de altura e 4096 px de lado', async () => {
    const { app } = montar();
    expect((await enviar(app, png(4096, 200, LIMITES_LOGO.bytes - 33))).statusCode).toBe(200);
    expect((await enviar(app, png(300, 4096))).statusCode).toBe(200);
  });

  it('RN-CORE-33: admin do cliente (mesmo na própria empresa) = 403 sem tocar no banco; sem sessão = 401', async () => {
    const { app, arquivos, chamadas } = montar();
    const r = await enviar(app, png(600, 200), 'image/png', cli);
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
    expect((await enviar(app, png(600, 200), 'image/png', {})).statusCode).toBe(401);
    // a autorização vem antes do corpo: nem o 413 aparece para quem não pode gravar
    expect((await enviar(app, png(600, 200, LIMITES_LOGO.bytes), 'image/png', cli)).statusCode).toBe(403);
    expect(chamadas.gravarLogo).toBe(0);
    expect(arquivos.chaves()).toEqual([]);
  });

  it('banco recusa: o objeto novo é apagado e o SQLSTATE vira HTTP (P0002 = 404)', async () => {
    const { app, arquivos } = montar({ erroGravar: 'P0002' });
    const r = await enviar(app, png(600, 200));
    expect(r.statusCode).toBe(404);
    expect(r.json().codigo).toBe('TENANT_NAO_ENCONTRADO');
    expect(arquivos.chaves()).toEqual([]);
  });

  it('sem armazenamento = 503 ARMAZENAMENTO_INDISPONIVEL; tenant_id que não é UUID = 400', async () => {
    expect((await enviar(montar({ semArmazenamento: true }).app, png(600, 200))).json().codigo).toBe('ARMAZENAMENTO_INDISPONIVEL');
    const r = await montar().app.inject({ method: 'PUT', url: '/v1/plataforma/empresas/abc/logo', headers: { ...sa, 'content-type': 'image/png' }, payload: png(600, 200) });
    expect(r.statusCode).toBe(400);
  });
});

describe('GET/DELETE da logo e a marca no portal', () => {
  it('GET .../logo devolve os bytes com o tipo, ETag e no-store; sem logo = 404 LOGO_NAO_ENCONTRADA', async () => {
    const { app } = montar();
    expect((await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${TENANT}/logo`, headers: sa })).json().codigo).toBe(CODIGOS_LOGO.naoEncontrada);
    const b = png(600, 200);
    await enviar(app, b);
    const r = await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${TENANT}/logo`, headers: cli });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers.etag).toBe(`"${sha(b)}"`);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.rawPayload.equals(b)).toBe(true);
  });

  it('DELETE: só super-admin; apaga o objeto; repetir = 200 (idempotente)', async () => {
    const { app, arquivos } = montar();
    await enviar(app, png(600, 200));
    expect((await app.inject({ method: 'DELETE', url: `/v1/plataforma/empresas/${TENANT}/logo`, headers: cli })).statusCode).toBe(403);
    const r = await app.inject({ method: 'DELETE', url: `/v1/plataforma/empresas/${TENANT}/logo`, headers: sa });
    expect(r.statusCode).toBe(200);
    expect(r.json().logo).toBeNull();
    expect(arquivos.chaves()).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url: `/v1/plataforma/empresas/${TENANT}/logo`, headers: sa })).statusCode).toBe(200);
  });

  it('PUT .../marca: só super-admin; apara, vazio apaga, acima de 80 = 400', async () => {
    const { app, chamadas } = montar();
    const url = `/v1/plataforma/empresas/${TENANT}/marca`;
    expect((await app.inject({ method: 'PUT', url, headers: cli, payload: { nome_fantasia: 'X' } })).statusCode).toBe(403);
    const r = await app.inject({ method: 'PUT', url, headers: sa, payload: { nome_fantasia: '  Mercado Bom ' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().nome_fantasia).toBe('Mercado Bom');
    expect((await app.inject({ method: 'PUT', url, headers: sa, payload: { nome_fantasia: '' } })).json().nome_fantasia).toBeNull();
    expect((await app.inject({ method: 'PUT', url, headers: sa, payload: { nome_fantasia: 'x'.repeat(81) } })).statusCode).toBe(400);
    expect(chamadas.gravarNome).toEqual(['Mercado Bom', null]);
  });

  it('GET .../marca: admin do cliente lê a própria empresa; outra empresa = 403 antes do banco', async () => {
    const { app } = montar();
    expect((await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${TENANT}/marca`, headers: cli })).statusCode).toBe(200);
    const r = await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${OUTRO}/marca`, headers: cli });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${OUTRO}/marca`, headers: sa })).json().razao_social).toBe('Outra Empresa Ltda');
  });

  it('RN-CORE-33: 403 da leitura (barreira da API ou 42501 da sa_*) diz "só vê … da sua empresa", sem "alter"; o da escrita diz quem altera', async () => {
    for (const negarLeitura of [false, true]) {
      const { app } = montar({ negarLeitura });
      const alvo = negarLeitura ? TENANT : OUTRO;
      for (const rota of ['marca', 'logo']) {
        const r = await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${alvo}/${rota}`, headers: cli });
        expect(r.statusCode).toBe(403);
        expect(r.json()).toMatchObject({ codigo: 'PERFIL_SEM_ACESSO', mensagem: MENSAGENS_ACESSO_LOGO.leitura });
        expect(r.json().mensagem).not.toMatch(/alter/i);
      }
    }
    const { app } = montar();
    const r = await app.inject({ method: 'DELETE', url: `/v1/plataforma/empresas/${TENANT}/logo`, headers: cli });
    expect(r.json()).toMatchObject({ codigo: 'PERFIL_SEM_ACESSO', mensagem: MENSAGENS_ACESSO_LOGO.escrita });
  });
});

describe('PUT .../marca/ocultar-macuxi (item 15, desenho v1017 §1)', () => {
  const url = (t = TENANT) => `/v1/plataforma/empresas/${t}/marca/ocultar-macuxi`;

  it('super-admin grava; a marca volta com ocultar_marca_macuxi; repetir o mesmo valor = 200 (idempotente)', async () => {
    const { app, chamadas } = montar();
    const r = await app.inject({ method: 'PUT', url: url(), headers: sa, payload: { ocultar: true } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ tenant_id: TENANT, razao_social: 'Distribuidora Exemplo Ltda', nome_fantasia: null, logo: null, ocultar_marca_macuxi: true });
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect((await app.inject({ method: 'PUT', url: url(), headers: sa, payload: { ocultar: true } })).statusCode).toBe(200);
    const lida = await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${TENANT}/marca`, headers: cli });
    expect(lida.json().ocultar_marca_macuxi).toBe(true);
    expect((await app.inject({ method: 'PUT', url: url(), headers: sa, payload: { ocultar: false } })).json().ocultar_marca_macuxi).toBe(false);
    expect(chamadas.gravarOcultar).toEqual([true, true, false]);
  });

  it('RN-CORE-33: admin do cliente = 403 com a frase da escrita, sem tocar no banco; sem sessão = 401', async () => {
    const { app, chamadas } = montar();
    const r = await app.inject({ method: 'PUT', url: url(), headers: cli, payload: { ocultar: true } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'PERFIL_SEM_ACESSO', mensagem: MENSAGENS_ACESSO_LOGO.escrita });
    expect((await app.inject({ method: 'PUT', url: url(), payload: { ocultar: true } })).statusCode).toBe(401);
    expect(chamadas.gravarOcultar).toEqual([]);
  });

  it.each([[{}], [{ ocultar: 'sim' }], [{ ocultar: true, outro: 1 }]])('corpo %j = 400 VALIDACAO', async (payload) => {
    const { app, chamadas } = montar();
    const r = await app.inject({ method: 'PUT', url: url(), headers: sa, payload });
    expect(r.statusCode).toBe(400);
    expect(r.json().codigo).toBe('VALIDACAO');
    expect(chamadas.gravarOcultar).toEqual([]);
  });

  it('empresa inexistente = 404 TENANT_NAO_ENCONTRADO; função ausente (banco sem a 0091) = 503 MARCA_INDISPONIVEL', async () => {
    const { app } = montar();
    const r = await app.inject({ method: 'PUT', url: url('0a000000-0000-4000-8000-0000000000ff'), headers: sa, payload: { ocultar: true } });
    expect(r.json().codigo).toBe('TENANT_NAO_ENCONTRADO');
    const semFuncao = montar({ semFuncaoOcultar: true });
    const s = await semFuncao.app.inject({ method: 'PUT', url: url(), headers: sa, payload: { ocultar: true } });
    expect(s.statusCode).toBe(503);
    expect(s.json().codigo).toBe('MARCA_INDISPONIVEL');
  });

  it('banco anterior à 0091 (marca sem o campo) = ocultar_marca_macuxi false; a leitura não quebra', async () => {
    const { app, tenants } = montar();
    delete tenants.get(TENANT)!.ocultar_marca_macuxi;
    const r = await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${TENANT}/marca`, headers: sa });
    expect(r.statusCode).toBe(200);
    expect(r.json().ocultar_marca_macuxi).toBe(false);
  });
});

describe('GET /v1/me/empresa/logo/:sha256 (desenho §3.2): tenant A × B', () => {
  it('o usuário do tenant A baixa a logo atual de A (imutável); o sha256 de B ou um velho = 404', async () => {
    const { app } = montar();
    const a = png(600, 200);
    const b = png(700, 300, 0, 9);
    await enviar(app, a);
    await enviar(app, b, 'image/png', sa, OUTRO);
    const ok = await app.inject({ method: 'GET', url: `/v1/me/empresa/logo/${sha(a)}`, headers: cab('vendedor') });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(ok.headers.vary).toBe('Authorization'); // T-0182: cache separado por sessão
    expect(ok.rawPayload.equals(a)).toBe(true);
    const deB = await app.inject({ method: 'GET', url: `/v1/me/empresa/logo/${sha(b)}`, headers: cab('vendedor') });
    expect(deB.statusCode).toBe(404);
    expect(deB.json().codigo).toBe(CODIGOS_LOGO.naoEncontrada);
    expect(deB.headers['cache-control'] ?? '').not.toContain('immutable');
    await enviar(app, png(600, 200, 5, 3));
    expect((await app.inject({ method: 'GET', url: `/v1/me/empresa/logo/${sha(a)}`, headers: cab('vendedor') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/v1/me/empresa/logo/${sha(a)}` })).statusCode).toBe(401);
  });
});

describe('chaves reservadas do Core (desenho §3.1)', () => {
  const linha: LinhaMarcaTenant = { nome: 'Razão Ltda', nome_fantasia: null, logo_sha256: 'b'.repeat(64), logo_tipo: 'image/png', logo_largura_px: 600, logo_altura_px: 200 };

  it('sobrescrevem uma linha de plataforma.parametro com o mesmo nome; sem o Core, nada muda', () => {
    const p = comEmpresa({ core: { sync_auto_min: 30, empresa_nome: 'falso' }, vendedor: {} }, linha);
    expect(p.core).toEqual({
      sync_auto_min: 30,
      empresa_nome: 'Razão Ltda',
      empresa_logo: { sha256: 'b'.repeat(64), tipo: 'image/png', largura_px: 600, altura_px: 200 },
      empresa_ocultar_marca_macuxi: false,
    });
    expect(p.vendedor).toEqual({});
    expect(comEmpresa({ vendedor: {} }, linha)).toEqual({ vendedor: {} });
    expect(comEmpresa({ core: {} }, undefined)).toEqual({ core: {} });
  });

  it('trocar a logo muda o versao_licencas (o aparelho recebe na próxima sincronização)', () => {
    const manifestos = MODULOS_API.map((m) => m.manifesto);
    const agora = new Date('2026-11-15T16:00:00.000Z');
    const v = (l: typeof linha) => respostaMeusModulos(manifestos, ['core'], comEmpresa({ core: {} }, l), agora);
    const r = v(linha);
    expect(r.modulos[0]!.parametros).toMatchObject({ empresa_nome: 'Razão Ltda', empresa_logo: { sha256: 'b'.repeat(64) } });
    expect(v({ ...linha, logo_sha256: 'c'.repeat(64) }).versao_licencas).not.toBe(r.versao_licencas);
    expect(v({ ...linha, nome_fantasia: 'Fantasia' }).versao_licencas).not.toBe(r.versao_licencas);
    // item 15: ocultar a logomarca do Macuxi também chega ao aparelho na próxima sincronização
    const oculta = v({ ...linha, ocultar_marca_macuxi: true });
    expect(oculta.modulos[0]!.parametros).toMatchObject({ empresa_ocultar_marca_macuxi: true });
    expect(oculta.versao_licencas).not.toBe(r.versao_licencas);
  });
});
