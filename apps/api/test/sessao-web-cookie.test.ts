/**
 * T-0117 (ADR 0038): token de renovação do BKO em cookie httpOnly nas rotas públicas com `cookieSessao`.
 * Core de teste (sem banco): login/troca emitem um token novo, o refresh gira o token, o logout revoga. O app (sem
 * `X-Macuxi-CSRF`) segue com o token no corpo, como sempre.
 */
import { Writable } from 'node:stream';
import {
  CABECALHO_CSRF,
  CAMINHO_COOKIE_SESSAO,
  definirModuloApi,
  ErroHttpModulo,
  NOME_COOKIE_SESSAO_LOCAL,
  NOME_COOKIE_SESSAO_SEGURO,
  problemasRotaPublica,
  type RotaPublica,
} from '@macuxi/platform-sdk';
import { manifest as core } from '@macuxi/core/manifest';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { lerSessaoWeb, opcoesLogger } from '../src/config';
import { bancoFalso, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste } from './apoio';

const TENANT = '00000000-0000-4000-8000-000000000001';
const VALIDADE_S = 30 * 86_400;
const MIN = 5 * 60_000;

/** Token no formato do Core (`<uuid>.<segredo base64url>`). */
const token = (n: number) => `${TENANT}.segredo-de-teste-numero-${String(n).padStart(4, '0')}`;

function coreFalso() {
  let n = 0;
  const validos = new Set<string>();
  const revogados: string[] = [];
  const recebidos: unknown[] = [];
  const emitir = () => {
    const t = token(++n);
    validos.add(t);
    return { access_token: `acesso-${n}`, token_type: 'Bearer' as const, expires_in: 900, refresh_token: t };
  };
  const RT = z.object({ refresh_token: z.string().min(10).max(200) }).strict();
  const rotas: RotaPublica[] = [
    {
      metodo: 'POST',
      caminho: 'auth/login',
      limite: { max: 100, janelaMs: MIN },
      corpo: z.object({ senha: z.string() }).strict(),
      cookieSessao: { papel: 'emitir', validadeSegundos: VALIDADE_S },
      executar: async (ctx) => {
        recebidos.push(ctx.corpo);
        if ((ctx.corpo as { senha: string }).senha !== 'certa') throw new ErroHttpModulo(401, 'CREDENCIAIS_INVALIDAS', 'Errado.');
        return { ...emitir(), usuario: { id: 'u1' } };
      },
    },
    {
      metodo: 'POST',
      caminho: 'auth/senha/trocar',
      limite: { max: 100, janelaMs: MIN },
      corpo: z.object({ senha_nova: z.string() }).strict(),
      cookieSessao: { papel: 'emitir', validadeSegundos: VALIDADE_S },
      executar: async (ctx) => {
        if ((ctx.corpo as { senha_nova: string }).senha_nova.length < 8) throw new ErroHttpModulo(422, 'RN-CORE-32', 'Senha fraca.');
        // a troca revoga TODOS os refresh do usuário e devolve uma sessão nova
        for (const t of validos) revogados.push(t);
        validos.clear();
        return emitir();
      },
    },
    {
      metodo: 'POST',
      caminho: 'auth/refresh',
      limite: { max: 100, janelaMs: MIN, chave: (e) => (e.corpo as { refresh_token?: string } | null)?.refresh_token?.slice(0, 36) ?? '' },
      corpo: RT.extend({ dispositivo_id: z.string().uuid().optional() }).strict(),
      cookieSessao: { papel: 'renovar', validadeSegundos: VALIDADE_S },
      executar: async (ctx) => {
        const t = (ctx.corpo as { refresh_token: string }).refresh_token;
        recebidos.push(ctx.corpo);
        if (t === token(999)) throw new ErroHttpModulo(423, 'DISPOSITIVO_BLOQUEADO', 'Aparelho bloqueado.');
        if (!validos.delete(t)) throw new ErroHttpModulo(401, 'SESSAO_INVALIDA', 'Sessão expirada.');
        return emitir();
      },
    },
    {
      metodo: 'POST',
      caminho: 'auth/logout',
      status: 200,
      limite: { max: 100, janelaMs: MIN },
      corpo: RT,
      cookieSessao: { papel: 'encerrar' },
      executar: async (ctx) => {
        const t = (ctx.corpo as { refresh_token: string }).refresh_token;
        if (t === token(500)) throw new Error('banco fora do ar');
        validos.delete(t);
        revogados.push(t);
        return {};
      },
    },
  ];
  return { modulo: definirModuloApi({ manifesto: core, rotasPublicas: rotas }), validos, revogados, recebidos };
}

function montar(seguro = true) {
  const f = coreFalso();
  const linhas: string[] = [];
  const stream = new Writable({
    write(c: Buffer, _e, cb) {
      linhas.push(c.toString());
      cb();
    },
  });
  const app = createApp({
    ...opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste({ core: f.modulo }) }),
    banco: bancoFalso().banco,
    sessaoWeb: { seguro },
    logger: { ...opcoesLogger('trace'), stream },
  });
  return { app, ...f, log: () => linhas.join('') };
}

const NOME = NOME_COOKIE_SESSAO_SEGURO;
const WEB = { [CABECALHO_CSRF]: '1', 'sec-fetch-site': 'same-origin' };
const cookieDe = (t: string, nome = NOME) => ({ cookie: `${nome}=${t}; outro=1` });

/** `Set-Cookie` da resposta (um só nestas rotas). */
function setCookie(r: { headers: Record<string, unknown> }): string {
  const v = r.headers['set-cookie'];
  return Array.isArray(v) ? v.join('\n') : String(v ?? '');
}

describe('T-0117: login e troca de senha do BKO gravam o cookie (emitir)', () => {
  it('com X-Macuxi-CSRF: 1 o token sai do JSON e vai para o cookie HttpOnly, Secure, SameSite=Strict, no caminho de sessão', async () => {
    const { app } = montar();
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' }, headers: WEB });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ access_token: 'acesso-1', token_type: 'Bearer', expires_in: 900, usuario: { id: 'u1' } });
    expect(r.body).not.toContain(token(1));
    const c = setCookie(r);
    expect(c).toBe(`${NOME}=${token(1)}; Max-Age=${VALIDADE_S}; Path=${CAMINHO_COOKIE_SESSAO}; HttpOnly; Secure; SameSite=Strict`);
    expect(c).not.toMatch(/Domain=/i);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('o app (sem o cabeçalho) recebe o token no corpo e nenhum cookie, como sempre', async () => {
    const { app } = montar();
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().refresh_token).toBe(token(1));
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('login errado: nenhum cookie', async () => {
    const { app } = montar();
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'errada' }, headers: WEB });
    expect([r.statusCode, r.json().codigo]).toEqual([401, 'CREDENCIAIS_INVALIDAS']);
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('no PC (seguro: false) o nome é macuxi_rt, sem Secure', async () => {
    const { app } = montar(false);
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' }, headers: WEB });
    expect(setCookie(r)).toBe(`${NOME_COOKIE_SESSAO_LOCAL}=${token(1)}; Max-Age=${VALIDADE_S}; Path=${CAMINHO_COOKIE_SESSAO}; HttpOnly; SameSite=Strict`);
  });

  it('troca de senha: o cookie antigo deixa de valer (revogado) e o novo substitui; senha recusada não mexe no cookie', async () => {
    const { app, revogados } = montar();
    await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' }, headers: WEB });
    const fraca = await app.inject({ method: 'POST', url: '/v1/auth/senha/trocar', payload: { senha_nova: 'x' }, headers: { ...WEB, ...cookieDe(token(1)) } });
    expect(fraca.statusCode).toBe(422);
    expect(fraca.headers['set-cookie']).toBeUndefined();
    const ok = await app.inject({ method: 'POST', url: '/v1/auth/senha/trocar', payload: { senha_nova: 'nova-senha-forte' }, headers: { ...WEB, ...cookieDe(token(1)) } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().refresh_token).toBeUndefined();
    expect(setCookie(ok)).toContain(`${NOME}=${token(2)};`);
    expect(revogados).toContain(token(1));
    // o cookie antigo, reapresentado, é recusado e apagado
    const velho = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: {}, headers: { ...WEB, ...cookieDe(token(1)) } });
    expect(velho.statusCode).toBe(401);
    expect(setCookie(velho)).toContain('Max-Age=0');
  });
});

describe('T-0117: refresh pelo cookie (renovar)', () => {
  it('lê o cookie, gira o token e devolve só o acesso', async () => {
    const { app, recebidos } = montar();
    await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' }, headers: WEB });
    const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: {}, headers: { ...WEB, ...cookieDe(token(1)) } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ access_token: 'acesso-2', token_type: 'Bearer', expires_in: 900 });
    expect(setCookie(r)).toContain(`${NOME}=${token(2)};`);
    expect(recebidos.at(-1)).toEqual({ refresh_token: token(1) });
  });

  it('sem corpo nenhum (o BKO manda vazio) também funciona', async () => {
    const { app } = montar();
    await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' }, headers: WEB });
    const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { ...WEB, ...cookieDe(token(1)) } });
    expect(r.statusCode, r.body).toBe(200);
  });

  it('no modo cookie, um refresh_token no corpo é ignorado: só vale o cookie', async () => {
    const { app, recebidos } = montar();
    await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' }, headers: WEB });
    const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: token(77) }, headers: { ...WEB, ...cookieDe(token(1)) } });
    expect(r.statusCode).toBe(200);
    expect(recebidos.at(-1)).toEqual({ refresh_token: token(1) });
  });

  it('sem cookie: 401 SESSAO_INVALIDA sem chamar o Core', async () => {
    const { app, recebidos } = montar();
    const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: {}, headers: WEB });
    expect([r.statusCode, r.json().codigo]).toEqual([401, 'SESSAO_INVALIDA']);
    expect(recebidos).toEqual([]);
  });

  it('cookie recusado (401) ou aparelho bloqueado (423): o cookie é apagado', async () => {
    const { app } = montar();
    const r401 = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: {}, headers: { ...WEB, ...cookieDe(token(42)) } });
    expect(r401.statusCode).toBe(401);
    expect(setCookie(r401)).toBe(`${NOME}=; Max-Age=0; Path=${CAMINHO_COOKIE_SESSAO}; HttpOnly; Secure; SameSite=Strict`);
    const r423 = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: {}, headers: { ...WEB, ...cookieDe(token(999)) } });
    expect(r423.statusCode).toBe(423);
    expect(setCookie(r423)).toContain('Max-Age=0');
  });

  it('o cookie local (macuxi_rt) não vale no servidor seguro, e vice-versa', async () => {
    const { app } = montar(true);
    await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' }, headers: WEB });
    const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: {}, headers: { ...WEB, ...cookieDe(token(1), NOME_COOKIE_SESSAO_LOCAL) } });
    expect(r.statusCode).toBe(401);
  });

  it('o app segue com o token no corpo e ignora qualquer cookie', async () => {
    const { app } = montar();
    await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' } });
    const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: token(1) }, headers: cookieDe(token(55)) });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().refresh_token).toBe(token(2));
    expect(r.headers['set-cookie']).toBeUndefined();
  });
});

describe('T-0117: CSRF', () => {
  it('cabeçalho com outro valor ou pedido de outro site: 403 CSRF_RECUSADO sem chamar o Core nem contar tentativa', async () => {
    const { app, recebidos } = montar();
    for (const headers of [
      { [CABECALHO_CSRF]: 'sim', ...cookieDe(token(1)) },
      { [CABECALHO_CSRF]: '1', 'sec-fetch-site': 'cross-site', ...cookieDe(token(1)) },
      { [CABECALHO_CSRF]: '1', 'sec-fetch-site': 'same-site', ...cookieDe(token(1)) },
    ]) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: {}, headers });
      expect([r.statusCode, r.json().codigo]).toEqual([403, 'CSRF_RECUSADO']);
      expect(r.headers['set-cookie']).toBeUndefined();
    }
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' }, headers: { [CABECALHO_CSRF]: '1', 'sec-fetch-site': 'cross-site' } });
    expect(login.statusCode).toBe(403);
    expect(recebidos).toEqual([]);
  });

  it('sem o cabeçalho, o cookie nunca é lido: um formulário de outro site não renova a sessão', async () => {
    const { app, recebidos } = montar();
    await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' }, headers: WEB });
    recebidos.length = 0;
    const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: {}, headers: { 'sec-fetch-site': 'cross-site', ...cookieDe(token(1)) } });
    expect(r.statusCode).toBe(400); // corpo sem refresh_token: o Zod do Core recusa
    expect(recebidos).toEqual([]);
  });

  it('Sec-Fetch-Site ausente (navegador antigo) ou none: aceito', async () => {
    const { app } = montar();
    await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' }, headers: { [CABECALHO_CSRF]: '1' } });
    const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: {}, headers: { [CABECALHO_CSRF]: '1', 'sec-fetch-site': 'none', ...cookieDe(token(1)) } });
    expect(r.statusCode, r.body).toBe(200);
  });
});

describe('T-0117: logout (encerrar)', () => {
  it('revoga o token do cookie e apaga o cookie', async () => {
    const { app, revogados } = montar();
    await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' }, headers: WEB });
    const r = await app.inject({ method: 'POST', url: '/v1/auth/logout', payload: {}, headers: { ...WEB, ...cookieDe(token(1)) } });
    expect([r.statusCode, r.json()]).toEqual([200, {}]);
    expect(revogados).toEqual([token(1)]);
    expect(setCookie(r)).toContain('Max-Age=0');
    const depois = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: {}, headers: { ...WEB, ...cookieDe(token(1)) } });
    expect(depois.statusCode).toBe(401);
  });

  it('sem cookie: 200 {} e o cookie apagado, sem chamar o Core', async () => {
    const { app, revogados } = montar();
    const r = await app.inject({ method: 'POST', url: '/v1/auth/logout', payload: {}, headers: WEB });
    expect([r.statusCode, r.json()]).toEqual([200, {}]);
    expect(setCookie(r)).toContain('Max-Age=0');
    expect(revogados).toEqual([]);
  });

  it('erro no servidor (5xx) ou cookie inválido (400): o cookie é apagado mesmo assim', async () => {
    const { app } = montar();
    const r500 = await app.inject({ method: 'POST', url: '/v1/auth/logout', payload: {}, headers: { ...WEB, ...cookieDe(token(500)) } });
    expect(r500.statusCode).toBe(500);
    expect(setCookie(r500)).toContain('Max-Age=0');
    const r400 = await app.inject({ method: 'POST', url: '/v1/auth/logout', payload: {}, headers: { ...WEB, ...cookieDe('curto') } });
    expect(r400.statusCode).toBe(400);
    expect(setCookie(r400)).toContain('Max-Age=0');
  });
});

describe('T-0117: nada de token em log', () => {
  it('nem o Cookie nem o Set-Cookie nem o corpo aparecem no log', async () => {
    const { app, log } = montar();
    await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { senha: 'certa' }, headers: WEB });
    await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: {}, headers: { ...WEB, ...cookieDe(token(1)) } });
    await app.inject({ method: 'POST', url: '/v1/auth/logout', payload: {}, headers: { ...WEB, ...cookieDe(token(2)) } });
    expect(log()).not.toContain('segredo-de-teste');
  });
});

describe('T-0117: declaração e configuração', () => {
  it('cookieSessao só no core, só em POST, com validade em emitir/renovar e sem validade em encerrar', () => {
    const base = { metodo: 'POST' as const, caminho: 'auth/x' };
    expect(problemasRotaPublica('core', { ...base, cookieSessao: { papel: 'emitir', validadeSegundos: VALIDADE_S } })).toEqual([]);
    expect(problemasRotaPublica('core', { ...base, cookieSessao: { papel: 'encerrar' } })).toEqual([]);
    expect(problemasRotaPublica('core', { ...base, cookieSessao: { papel: 'renovar' } }).join()).toContain('validadeSegundos');
    expect(problemasRotaPublica('core', { ...base, cookieSessao: { papel: 'encerrar', validadeSegundos: 60 } }).join()).toContain('não tem validade');
    expect(problemasRotaPublica('core', { ...base, metodo: 'GET', cookieSessao: { papel: 'encerrar' } }).join()).toContain('só em POST');
    expect(problemasRotaPublica('catalogo', { ...base, cache: { maxAgeSegundos: 60 }, metodo: 'GET', cookieSessao: { papel: 'encerrar' } }).join()).toContain('só no manifesto core');
    expect(() =>
      createApp({
        ...opcoesDeTeste(LICENCAS_PADRAO, {
          modulos: modulosDeTeste({ core: { manifesto: core, rotasPublicas: [{ ...base, limite: { max: 1, janelaMs: 1 }, cookieSessao: { papel: 'renovar' }, executar: async () => ({}) }] } }),
        }),
      }),
    ).toThrow(/validadeSegundos/);
  });

  it('MACUXI_SESSAO_COOKIE_SEGURO: explícito vale; ausente = seguro fora do PC', () => {
    expect(lerSessaoWeb({ MACUXI_SESSAO_COOKIE_SEGURO: '0', NODE_ENV: 'production' }, 'db.magalu')).toEqual({ seguro: false });
    expect(lerSessaoWeb({ MACUXI_SESSAO_COOKIE_SEGURO: 'true' }, 'localhost')).toEqual({ seguro: true });
    expect(lerSessaoWeb({}, 'localhost')).toEqual({ seguro: false });
    expect(lerSessaoWeb({ NODE_ENV: 'production' }, 'localhost')).toEqual({ seguro: true });
    expect(lerSessaoWeb({}, 'db.magalu')).toEqual({ seguro: true });
  });
});
