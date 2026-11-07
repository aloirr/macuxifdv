/**
 * T-0087 (R-20261106-010602): a rota pública recebe `ctx.cabecalhos` só com a lista fechada do SDK (hoje `authorization`),
 * e o valor nunca vai para o log, mesmo que a rota registre `ctx.cabecalhos` por engano.
 * T-0091: as rotas `plataforma/auth/*` (`conexao: 'portal'`) recebem o banco do portal; sem ele, 503 PORTAL_INDISPONIVEL.
 */
import { Writable } from 'node:stream';
import { definirModuloApi, ErroHttpModulo } from '@macuxi/platform-sdk';
import { manifest as core } from '@macuxi/core/manifest';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { opcoesLogger } from '../src/config';
import { bancoFalso, bancoPortalFalso, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste } from './apoio';

const TOKEN = 'Bearer eyJ.token-de-plataforma.segredo';

const coreDeTeste = definirModuloApi({
  manifesto: core,
  rotasPublicas: [
    {
      metodo: 'POST',
      caminho: 'plataforma/auth/sair',
      conexao: 'portal',
      limite: { max: 50, janelaMs: 60_000 },
      corpo: z.object({}),
      status: 204,
      executar: async (ctx) => {
        // registro "por engano" do objeto inteiro: tem de sair censurado
        ctx.log.info({ cabecalhos: ctx.cabecalhos }, 'cabeçalhos da rota pública');
        if (ctx.cabecalhos?.authorization !== TOKEN) throw new ErroHttpModulo(401, 'NAO_AUTENTICADO', 'Faça login para continuar.');
        return undefined;
      },
    },
    {
      metodo: 'POST',
      caminho: 'plataforma/auth/eco-nomes',
      conexao: 'portal',
      limite: { max: 50, janelaMs: 60_000 },
      corpo: z.object({}),
      executar: async (ctx) => ({ nomes: Object.keys(ctx.cabecalhos ?? {}).sort(), tem: ctx.cabecalhos?.authorization === TOKEN }),
    },
    {
      metodo: 'POST',
      caminho: 'plataforma/auth/qual-banco',
      conexao: 'portal',
      limite: { max: 50, janelaMs: 60_000 },
      executar: async (ctx) => ctx.banco.semTenant(async (db) => (await db.query<{ papel: string }>('select current_user as papel')).rows[0] ?? {}),
    },
  ],
});

function montar(comPortal = true) {
  const linhas: string[] = [];
  const stream = new Writable({
    write(c: Buffer, _e, cb) {
      linhas.push(c.toString());
      cb();
    },
  });
  const app = createApp({
    ...opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste({ core: coreDeTeste }) }),
    banco: bancoFalso().banco,
    bancoPortal: comPortal ? bancoPortalFalso().banco : null,
    logger: { ...opcoesLogger('trace'), stream },
  });
  return { app, log: () => linhas.join('') };
}

describe('rota pública: ctx.cabecalhos (T-0087)', () => {
  it('sair com o token de plataforma: 204; sem o cabeçalho: 401', async () => {
    const { app } = montar();
    const ok = await app.inject({ method: 'POST', url: '/v1/plataforma/auth/sair', payload: {}, headers: { authorization: TOKEN } });
    expect(ok.statusCode, ok.body).toBe(204);
    const sem = await app.inject({ method: 'POST', url: '/v1/plataforma/auth/sair', payload: {} });
    expect([sem.statusCode, sem.json().codigo]).toEqual([401, 'NAO_AUTENTICADO']);
  });

  it('só authorization chega à rota: cookie, x-macuxi-* e o resto ficam de fora', async () => {
    const { app } = montar();
    const r = await app.inject({
      method: 'POST',
      url: '/v1/plataforma/auth/eco-nomes',
      payload: {},
      headers: { authorization: TOKEN, cookie: 'sessao=1', 'x-macuxi-tenant': '00000000-0000-4000-8000-000000000001', 'user-agent': 'teste' },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ nomes: ['authorization'], tem: true });
  });

  it('o valor do authorization nunca vai para o log, nem com ctx.cabecalhos registrado pela rota', async () => {
    const { app, log } = montar();
    await app.inject({ method: 'POST', url: '/v1/plataforma/auth/sair', payload: {}, headers: { authorization: TOKEN } });
    const texto = log();
    expect(texto).toContain('cabeçalhos da rota pública');
    expect(texto).toContain('[omitido]');
    expect(texto).not.toContain('token-de-plataforma');
  });
});

describe('rota pública do portal (T-0091; conexao portal)', () => {
  it('roda no banco do portal, nunca no do macuxi_app', async () => {
    const { app } = montar();
    const r = await app.inject({ method: 'POST', url: '/v1/plataforma/auth/qual-banco' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ papel: 'macuxi_portal' });
  });

  it('sem o banco do portal (MACUXI_PG_PORTAL_SENHA ausente): 503 PORTAL_INDISPONIVEL antes da rota; o resto da API segue', async () => {
    const { app } = montar(false);
    for (const url of ['/v1/plataforma/auth/sair', '/v1/plataforma/auth/qual-banco']) {
      const r = await app.inject({ method: 'POST', url, payload: {}, headers: { authorization: TOKEN } });
      expect([r.statusCode, r.json().codigo]).toEqual([503, 'PORTAL_INDISPONIVEL']);
    }
    expect((await app.inject({ method: 'GET', url: '/v1/saude' })).statusCode).toBe(200);
  });
});
