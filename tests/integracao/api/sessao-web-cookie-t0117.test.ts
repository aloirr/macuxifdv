/**
 * T-0117 (ADR 0038; desenho docs/desenho/T-0117.md v2) — token de renovação do BKO em cookie httpOnly, de ponta a ponta pela
 * API REAL: `createApp` + Core de verdade (login argon2id, refresh rotativo com família, troca de senha com `sessao_versao`) ×
 * Postgres como `macuxi_app` (RLS), banco efêmero do arquivo (dois-tenants), logger real em `trace` capturado.
 *
 * O teste da API (`apps/api/test/sessao-web-cookie.test.ts`) usa um Core falso, sem banco. Aqui a mesma regra é provada com o
 * Core e o banco reais: a família gira no `core.sessao`, o reuso a derruba, o logout e a troca de senha revogam no banco, o
 * cookie de um tenant não abre o outro e nenhum token vai para o log.
 *  - CK-1  atributos: `__Secure-macuxi_rt=<token>; Max-Age=2592000; Path=/api-proxy/auth; HttpOnly; Secure; SameSite=Strict`,
 *          sem `Domain`; JSON sem `refresh_token`; `Cache-Control: no-store`; login errado sem cookie;
 *  - CK-2  o app Android (sem `X-Macuxi-CSRF`) segue com o token no corpo, sem `Set-Cookie`, e ignora qualquer cookie;
 *  - CK-3  CSRF: sem o cabeçalho o cookie não é lido (400); valor ≠ 1 ou `Sec-Fetch-Site` de outro site = 403 `CSRF_RECUSADO`
 *          sem `Set-Cookie`, sem consumir o token, sem sessão nova e sem contar tentativa;
 *  - CK-4  rotação a cada refresh; reuso do cookie antigo = 401, cookie apagado e a família inteira cai;
 *  - CK-5  logout revoga no banco e apaga o cookie (com, sem e com cookie desconhecido);
 *  - CK-6  troca de senha revoga as sessões antigas (cookie e app) e grava o cookie da sessão nova;
 *  - CK-7  refresh recusado (sem cookie, desconhecido, nome local, usuário bloqueado) apaga o cookie;
 *  - CK-8  multi-tenant: o cookie de B renova só em B; o segredo de B com o prefixo de A é recusado e não derruba B;
 *  - CK-9  navegador simulado com o cliente web REAL do SDK (`@macuxi/platform-sdk/web`), pote de cookies com Path/HttpOnly/
 *          Max-Age e o rewrite `/api-proxy/*` → `/v1/*` do Next: login → renovação → aba nova → saída, sem token no
 *          `localStorage` e sem o JavaScript ver o cookie;
 *  - CK-10 nenhum token (acesso, renovação, cookie) nem e-mail no log.
 * PRECISA DE BANCO: pula sem Postgres (PC sem Docker); no CI (`MACUXI_PG_EXIGIR=1`) roda. Matriz: docs/testes/T-0117.md.
 */
import { Writable } from 'node:stream';
import { CODIGOS_AUTH, RefreshRespostaSchema, RefreshWebRespostaSchema, SessaoRespostaSchema, SessaoWebRespostaSchema } from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import { CAMINHO_COOKIE_SESSAO, NOME_COOKIE_SESSAO_LOCAL, NOME_COOKIE_SESSAO_SEGURO } from '@macuxi/platform-sdk';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { opcoesLogger } from '../../../apps/api/src/config';
import { A, B, comToken, erroDe, novoIp, SENHA, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import { criarUsuarioNoTenant } from '../apoio/portal';

const NOME = NOME_COOKIE_SESSAO_SEGURO;
/** Validade do refresh do Core (30 dias, `REFRESH_DIAS`; desenho §3). */
const MAX_AGE = 30 * 86_400;
/** O BKO pelo rewrite: o cabeçalho próprio e o `Sec-Fetch-Site` que o navegador manda numa chamada da própria origem. */
const WEB = { 'x-macuxi-csrf': '1', 'sec-fetch-site': 'same-origin' } as const;
const APAGADO = `${NOME}=; Max-Age=0; Path=${CAMINHO_COOKIE_SESSAO}; HttpOnly; Secure; SameSite=Strict`;
const COOKIE_GRAVADO = new RegExp(`^${NOME}=([A-Za-z0-9._~+/=-]+); Max-Age=(\\d+); Path=${CAMINHO_COOKIE_SESSAO.replace(/\//g, '\\/')}; HttpOnly; Secure; SameSite=Strict$`);
const EM = (x: string) => `${x}.t0117@exemplo.com.br`;
const SENHA_PROPRIA = 'Cookie#T0117-a1';
const SENHA_TROCADA = 'Cookie#T0117-b2';

/** Os `Set-Cookie` da resposta (lista; vazia sem cabeçalho). */
function setCookies(r: LightMyRequestResponse): string[] {
  const v = r.headers['set-cookie'];
  return v === undefined ? [] : Array.isArray(v) ? v : [String(v)];
}

/** O token gravado pelo único `Set-Cookie` da resposta (falha se não houver, se houver dois ou se os atributos divergirem). */
function cookieGravado(r: LightMyRequestResponse): string {
  const sc = setCookies(r);
  expect(sc, `Set-Cookie de ${r.statusCode} ${r.body}`).toHaveLength(1);
  const m = COOKIE_GRAVADO.exec(sc[0]!);
  expect(m, `Set-Cookie fora do contrato: ${sc[0]}`).not.toBeNull();
  expect(sc[0]!.toLowerCase()).not.toContain('domain=');
  expect(Number(m![2])).toBe(MAX_AGE);
  return m![1]!;
}

const comCookie = (token: string, nome = NOME) => ({ cookie: `${nome}=${token}; preferencia=escuro` });

describe.skipIf(semBanco())('T-0117 — refresh do BKO em cookie httpOnly pela API real (Core + Postgres)', () => {
  let api: ApiDeTeste;
  const linhasLog: string[] = [];
  /** Tokens e e-mails que nunca podem aparecer no log (cresce ao longo dos casos). */
  const segredos: string[] = [];
  const emails: string[] = [];

  const post = (url: string, payload: object | undefined, headers: Record<string, string> = {}) =>
    api.app.inject({ method: 'POST', url, remoteAddress: novoIp(), headers, ...(payload !== undefined ? { payload } : {}) });
  const corpoLogin = (email: string, tenant: Tenant = A, senha = SENHA) => ({ codigo_empresa: tenant.codigo, email, senha, app: 'web' as const });
  /** Login do BKO (modo cookie): devolve o acesso e o token do cookie. */
  const entrarWeb = async (email: string, tenant: Tenant = A, senha = SENHA) => {
    const r = await post('/v1/auth/login', corpoLogin(email, tenant, senha), WEB);
    expect(r.statusCode, r.body).toBe(200);
    const s = SessaoWebRespostaSchema.strict().parse(r.json());
    const cookie = cookieGravado(r);
    segredos.push(s.access_token, cookie);
    return { sessao: s, cookie, resposta: r };
  };
  const renovar = (cookie: string | null, headers: Record<string, string> = WEB, payload: object = {}) =>
    post('/v1/auth/refresh', payload, { ...headers, ...(cookie ? comCookie(cookie) : {}) });
  /** Renovação que precisa dar certo: devolve o acesso e o cookie girado. */
  const renovarOk = async (cookie: string) => {
    const r = await renovar(cookie);
    expect(r.statusCode, r.body).toBe(200);
    const t = RefreshWebRespostaSchema.strict().parse(r.json());
    const novo = cookieGravado(r);
    segredos.push(t.access_token, novo);
    return { acesso: t.access_token, cookie: novo, resposta: r };
  };
  const sair = (cookie: string | null, headers: Record<string, string> = WEB) => post('/v1/auth/logout', {}, { ...headers, ...(cookie ? comCookie(cookie) : {}) });
  const meusModulos = (token: string) => api.app.inject({ method: 'GET', url: '/v1/me/modulos', headers: comToken(token) });
  const sessoesVivas = async (usuarioId: string) =>
    (await api.admin.query<{ n: number }>('select count(*)::int as n from core.sessao where usuario_id = $1 and revogado_em is null and usado_em is null and expira_em > now()', [usuarioId])).rows[0]!.n;
  const novoUsuario = async (nome: string, perfil = 'gerente', tenant: Tenant = A) => {
    const email = EM(nome);
    emails.push(email);
    const id = await criarUsuarioNoTenant(api.admin, { tenantId: tenant.tenantId, email, nome: `${nome} Fictício`, senha: SENHA_PROPRIA, perfil });
    return { id, email };
  };

  beforeAll(async () => {
    const stream = new Writable({
      write(c: Buffer, _e, cb) {
        linhasLog.push(c.toString());
        cb();
      },
    });
    api = await subirApi({ logger: { ...opcoesLogger('trace'), stream } });
  });
  afterAll(async () => {
    await api?.fechar();
  });

  // ------------------------------------------------------------------------------------------------------------------ CK-1
  describe('CK-1 login do BKO grava o cookie (emitir)', () => {
    it('CK-01 login com X-Macuxi-CSRF: 1 → 200 sem refresh_token no JSON; um Set-Cookie httpOnly, Secure, SameSite=Strict, Path /api-proxy/auth, sem Domain, 30 dias; no-store; sessão viva no banco', async () => {
      const antes = await sessoesVivas(A.usuarios.gerente);
      const { sessao, cookie, resposta } = await entrarWeb('gerente@exemplo.com.br');
      expect(resposta.body).not.toContain('refresh_token');
      expect(resposta.body).not.toContain(cookie);
      expect(sessao).toMatchObject({ token_type: 'Bearer', expires_in: 900, usuario: { id: A.usuarios.gerente, perfil: 'gerente' }, tenant: { id: A.tenantId } });
      expect(String(resposta.headers['cache-control'])).toContain('no-store');
      // o valor é o token opaco do Core (`<tenant>.<segredo>`), não o JWT de acesso
      expect(cookie.startsWith(`${A.tenantId}.`)).toBe(true);
      expect(cookie).not.toBe(sessao.access_token);
      expect(await sessoesVivas(A.usuarios.gerente)).toBe(antes + 1);
      expect((await meusModulos(sessao.access_token)).statusCode).toBe(200);
    });

    it('CK-02 senha errada com o cabeçalho → 401 CREDENCIAIS_INVALIDAS, nenhum Set-Cookie, nenhuma sessão nova', async () => {
      const antes = await sessoesVivas(A.usuarios.gerente);
      const r = await post('/v1/auth/login', corpoLogin('gerente@exemplo.com.br', A, 'Errada#T0117-0'), WEB);
      expect(`${r.statusCode} ${erroDe(r).codigo}`).toBe(`401 ${CODIGOS_AUTH.credenciais}`);
      expect(setCookies(r)).toEqual([]);
      expect(await sessoesVivas(A.usuarios.gerente)).toBe(antes);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ CK-2
  describe('CK-2 o app Android continua com o token no corpo', () => {
    it('CK-03 login e refresh sem o cabeçalho: refresh_token no corpo (contrato de sempre), nenhum Set-Cookie', async () => {
      const r = await post('/v1/auth/login', { codigo_empresa: A.codigo, email: 'vendedor@exemplo.com.br', senha: SENHA, app: 'campo' });
      expect(r.statusCode, r.body).toBe(200);
      const s = SessaoRespostaSchema.parse(r.json());
      segredos.push(s.access_token, s.refresh_token);
      expect(setCookies(r)).toEqual([]);
      const rr = await post('/v1/auth/refresh', { refresh_token: s.refresh_token });
      expect(rr.statusCode, rr.body).toBe(200);
      const t = RefreshRespostaSchema.parse(rr.json());
      segredos.push(t.access_token, t.refresh_token);
      expect(t.refresh_token).not.toBe(s.refresh_token);
      expect(setCookies(rr)).toEqual([]);
    });

    it('CK-04 o app com um cookie do BKO no pedido: vale o corpo; o cookie não é lido nem consumido', async () => {
      const web = await entrarWeb('gerente@exemplo.com.br');
      const app = SessaoRespostaSchema.parse((await post('/v1/auth/login', { codigo_empresa: A.codigo, email: 'vendedor@exemplo.com.br', senha: SENHA, app: 'campo' })).json());
      segredos.push(app.access_token, app.refresh_token);
      const rr = await post('/v1/auth/refresh', { refresh_token: app.refresh_token }, comCookie(web.cookie));
      expect(rr.statusCode, rr.body).toBe(200);
      const t = RefreshRespostaSchema.parse(rr.json());
      segredos.push(t.access_token, t.refresh_token);
      expect(setCookies(rr)).toEqual([]);
      // o acesso renovado é do vendedor (o dono do corpo), e o cookie do gerente segue valendo
      const claims = JSON.parse(Buffer.from(t.access_token.split('.')[1]!, 'base64url').toString()) as { sub: string };
      expect(claims.sub).toBe(A.usuarios.vendedor1);
      await renovarOk(web.cookie);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ CK-3
  describe('CK-3 CSRF: cabeçalho próprio + Sec-Fetch-Site', () => {
    it('CK-05 cookie SEM o cabeçalho e corpo {} → 400 VALIDACAO (o cookie não é lido), sem Set-Cookie; o token continua valendo', async () => {
      const { cookie } = await entrarWeb('gerente@exemplo.com.br');
      const r = await renovar(cookie, {});
      expect(`${r.statusCode} ${erroDe(r).codigo}`).toBe('400 VALIDACAO');
      expect(setCookies(r)).toEqual([]);
      const sairSemCabecalho = await sair(cookie, {});
      expect(sairSemCabecalho.statusCode).toBe(400);
      expect(setCookies(sairSemCabecalho)).toEqual([]);
      // nada foi consumido nem revogado: a renovação de verdade (com o cabeçalho) passa
      await renovarOk(cookie);
    });

    it('CK-06 X-Macuxi-CSRF com outro valor ("0", "true", "1, 1", "sim") → 403 CSRF_RECUSADO com mensagem, no-store, sem Set-Cookie; o token continua valendo', async () => {
      const { cookie } = await entrarWeb('gerente@exemplo.com.br');
      for (const valor of ['0', 'true', '1, 1', 'sim']) {
        const r = await renovar(cookie, { 'x-macuxi-csrf': valor, 'sec-fetch-site': 'same-origin' });
        expect(`${r.statusCode} ${erroDe(r).codigo}`, `X-Macuxi-CSRF: ${JSON.stringify(valor)}`).toBe('403 CSRF_RECUSADO');
        expect(erroDe(r).mensagem).toMatch(/recusado por segurança/i);
        expect(String(r.headers['cache-control'])).toContain('no-store');
        expect(setCookies(r)).toEqual([]);
      }
      await renovarOk(cookie);
    });

    it('CK-07 Sec-Fetch-Site cross-site ou same-site (ex.: config. → bko.) → 403 no refresh, no logout e no login; nada consumido, revogado nem criado', async () => {
      const { cookie } = await entrarWeb('gerente@exemplo.com.br');
      const vivas = await sessoesVivas(A.usuarios.gerente);
      for (const site of ['cross-site', 'same-site']) {
        const h = { 'x-macuxi-csrf': '1', 'sec-fetch-site': site };
        for (const r of [await renovar(cookie, h), await sair(cookie, h), await post('/v1/auth/login', corpoLogin('gerente@exemplo.com.br'), h)]) {
          expect(`${r.statusCode} ${erroDe(r).codigo}`, `${site}: ${r.body}`).toBe('403 CSRF_RECUSADO');
          expect(setCookies(r)).toEqual([]);
        }
      }
      // login CSRF não abriu sessão; logout recusado não revogou
      expect(await sessoesVivas(A.usuarios.gerente)).toBe(vivas);
      await renovarOk(cookie);
    });

    it('CK-08 403 do CSRF vem antes de contar tentativa: 12 senhas erradas de outro site não bloqueiam nem contam falha', async () => {
      const u = await novoUsuario('csrf');
      const h = { 'x-macuxi-csrf': '1', 'sec-fetch-site': 'cross-site' };
      for (let i = 0; i < 12; i++) expect((await post('/v1/auth/login', corpoLogin(u.email, A, `Errada#${i}`), h)).statusCode).toBe(403);
      const linha = await api.admin.query<{ tentativas_falhas: number; bloqueio_ate: Date | null }>('select tentativas_falhas, bloqueio_ate from core.usuario where id = $1', [u.id]);
      expect(linha.rows[0]).toEqual({ tentativas_falhas: 0, bloqueio_ate: null });
      await entrarWeb(u.email, A, SENHA_PROPRIA);
    });

    it('CK-09 Sec-Fetch-Site ausente (navegador antigo) ou "none" → aceito', async () => {
      let { cookie } = await entrarWeb('gerente@exemplo.com.br');
      for (const h of [{ 'x-macuxi-csrf': '1' }, { 'x-macuxi-csrf': '1', 'sec-fetch-site': 'none' }] as Record<string, string>[]) {
        const r = await renovar(cookie, h);
        expect(r.statusCode, r.body).toBe(200);
        cookie = cookieGravado(r);
        segredos.push(cookie);
      }
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ CK-4
  describe('CK-4 rotação a cada refresh', () => {
    it('CK-10 cada refresh devolve só o acesso (sem refresh_token) e GIRA o cookie: 3 trocas, 3 valores distintos, o acesso novo vale', async () => {
      const { cookie: c0 } = await entrarWeb('gerente@exemplo.com.br');
      const vistos = [c0];
      let atual = c0;
      for (let i = 0; i < 3; i++) {
        const { acesso, cookie, resposta } = await renovarOk(atual);
        expect(resposta.body).not.toContain('refresh_token');
        expect(resposta.body).not.toContain(cookie);
        expect(String(resposta.headers['cache-control'])).toContain('no-store');
        expect(vistos).not.toContain(cookie);
        expect((await meusModulos(acesso)).statusCode).toBe(200);
        vistos.push(cookie);
        atual = cookie;
      }
    });

    it('CK-11 no modo cookie, um refresh_token no corpo é ignorado: só o cookie vale (o token do corpo não é consumido)', async () => {
      const { cookie } = await entrarWeb('gerente@exemplo.com.br');
      const app = SessaoRespostaSchema.parse((await post('/v1/auth/login', { codigo_empresa: A.codigo, email: 'promotor@exemplo.com.br', senha: SENHA, app: 'campo' })).json());
      segredos.push(app.access_token, app.refresh_token);
      const r = await renovar(cookie, WEB, { refresh_token: app.refresh_token });
      expect(r.statusCode, r.body).toBe(200);
      const claims = JSON.parse(Buffer.from((r.json() as { access_token: string }).access_token.split('.')[1]!, 'base64url').toString()) as { sub: string };
      expect(claims.sub).toBe(A.usuarios.gerente);
      segredos.push(cookieGravado(r));
      const doApp = await post('/v1/auth/refresh', { refresh_token: app.refresh_token });
      expect(doApp.statusCode, 'o refresh do app não foi consumido pelo modo cookie').toBe(200);
      segredos.push(RefreshRespostaSchema.parse(doApp.json()).refresh_token);
    });

    it('CK-12 reuso do cookie antigo → 401 SESSAO_INVALIDA e cookie apagado; a FAMÍLIA cai (o cookie mais novo também morre)', async () => {
      const u = await novoUsuario('reuso');
      const { cookie: c0 } = await entrarWeb(u.email, A, SENHA_PROPRIA);
      const { cookie: c1 } = await renovarOk(c0);
      const reuso = await renovar(c0);
      expect(`${reuso.statusCode} ${erroDe(reuso).codigo}`).toBe(`401 ${CODIGOS_AUTH.sessao}`);
      expect(setCookies(reuso)).toEqual([APAGADO]);
      const depois = await renovar(c1);
      expect(depois.statusCode, 'reuso derruba a família inteira (regra do Core)').toBe(401);
      expect(setCookies(depois)).toEqual([APAGADO]);
      expect(await sessoesVivas(u.id)).toBe(0);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ CK-5
  describe('CK-5 logout apaga o cookie', () => {
    it('CK-13 logout com o cookie → 200 {} e Set-Cookie com Max-Age=0; a sessão é revogada no banco; o mesmo cookie depois = 401 e apagado', async () => {
      const u = await novoUsuario('sair');
      const { cookie: c0 } = await entrarWeb(u.email, A, SENHA_PROPRIA);
      const { cookie } = await renovarOk(c0);
      expect(await sessoesVivas(u.id)).toBe(1);
      const r = await sair(cookie);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toEqual({});
      expect(setCookies(r)).toEqual([APAGADO]);
      expect(String(r.headers['cache-control'])).toContain('no-store');
      expect(await sessoesVivas(u.id)).toBe(0);
      const rr = await renovar(cookie);
      expect(`${rr.statusCode} ${erroDe(rr).codigo}`).toBe(`401 ${CODIGOS_AUTH.sessao}`);
      expect(setCookies(rr)).toEqual([APAGADO]);
    });

    it('CK-14 logout sem cookie → 200 {} e o cookie apagado; logout com cookie desconhecido → apagado sem 5xx; ninguém mais perde a sessão', async () => {
      const { cookie: doGerente } = await entrarWeb('gerente@exemplo.com.br');
      const semCookie = await sair(null);
      expect(semCookie.statusCode).toBe(200);
      expect(semCookie.json()).toEqual({});
      expect(setCookies(semCookie)).toEqual([APAGADO]);
      const desconhecido = await sair(`${A.tenantId}.segredo-que-nao-existe-t0117`);
      expect(desconhecido.statusCode).toBeLessThan(500);
      expect(setCookies(desconhecido)).toEqual([APAGADO]);
      await renovarOk(doGerente);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ CK-6
  describe('CK-6 troca de senha revoga as sessões antigas', () => {
    it('CK-15 troca pelo BKO: 200 sem refresh_token e cookie NOVO; o cookie antigo e o refresh do app = 401 (cookie apagado); o novo renova', async () => {
      const u = await novoUsuario('troca');
      const { cookie: velho } = await entrarWeb(u.email, A, SENHA_PROPRIA);
      const app = SessaoRespostaSchema.parse((await post('/v1/auth/login', { codigo_empresa: A.codigo, email: u.email, senha: SENHA_PROPRIA })).json());
      segredos.push(app.access_token, app.refresh_token);
      const fraca = await post('/v1/auth/senha/trocar', { codigo_empresa: A.codigo, email: u.email, senha_atual: SENHA_PROPRIA, senha_nova: 'abc', app: 'web' }, WEB);
      expect(fraca.statusCode).toBe(422);
      expect(setCookies(fraca), 'senha recusada não mexe no cookie').toEqual([]);

      const r = await post('/v1/auth/senha/trocar', { codigo_empresa: A.codigo, email: u.email, senha_atual: SENHA_PROPRIA, senha_nova: SENHA_TROCADA, app: 'web' }, WEB);
      expect(r.statusCode, r.body).toBe(200);
      const s = SessaoWebRespostaSchema.strict().parse(r.json());
      segredos.push(s.access_token);
      const novo = cookieGravado(r);
      segredos.push(novo);
      expect(novo).not.toBe(velho);

      const comVelho = await renovar(velho);
      expect(`${comVelho.statusCode} ${erroDe(comVelho).codigo}`).toBe(`401 ${CODIGOS_AUTH.sessao}`);
      expect(setCookies(comVelho)).toEqual([APAGADO]);
      expect((await post('/v1/auth/refresh', { refresh_token: app.refresh_token })).statusCode).toBe(401);
      expect((await meusModulos(app.access_token)).statusCode, 'acesso anterior à troca cai na hora (ADR 0032)').toBe(401);
      const { acesso } = await renovarOk(novo);
      expect((await meusModulos(acesso)).statusCode).toBe(200);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ CK-7
  describe('CK-7 refresh recusado apaga o cookie', () => {
    it('CK-16 sem cookie → 401 SESSAO_INVALIDA e o cookie apagado; cookie desconhecido → 401 e apagado', async () => {
      const sem = await renovar(null);
      expect(`${sem.statusCode} ${erroDe(sem).codigo}`).toBe(`401 ${CODIGOS_AUTH.sessao}`);
      expect(setCookies(sem)).toEqual([APAGADO]);
      const lixo = await renovar(`${A.tenantId}.segredo-que-nao-existe-t0117`);
      expect(lixo.statusCode).toBe(401);
      expect(setCookies(lixo)).toEqual([APAGADO]);
    });

    it('CK-17 o cookie do PC (macuxi_rt, sem Secure) não vale no servidor seguro: 401 e o seguro apagado', async () => {
      const { cookie } = await entrarWeb('gerente@exemplo.com.br');
      const r = await post('/v1/auth/refresh', {}, { ...WEB, ...comCookie(cookie, NOME_COOKIE_SESSAO_LOCAL) });
      expect(r.statusCode).toBe(401);
      expect(setCookies(r)).toEqual([APAGADO]);
      await renovarOk(cookie);
    });

    it('CK-18 usuário bloqueado pelo admin depois do login: o refresh pelo cookie = 401 e o cookie apagado', async () => {
      const u = await novoUsuario('bloqueado');
      const { cookie } = await entrarWeb(u.email, A, SENHA_PROPRIA);
      await api.admin.query('update core.usuario set bloqueado_em = now() where id = $1', [u.id]);
      const r = await renovar(cookie);
      expect([401, 423]).toContain(r.statusCode);
      expect(setCookies(r)).toEqual([APAGADO]);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ CK-8
  describe('CK-8 multi-tenant', () => {
    it('CK-19 o cookie de B renova só em B; o segredo de B com o prefixo de A = 401 e apagado, e B segue valendo', async () => {
      const { cookie: deB } = await entrarWeb('admin.b@exemplo.com.br', B);
      expect(deB.startsWith(`${B.tenantId}.`)).toBe(true);
      const segredo = deB.slice(B.tenantId.length + 1);
      const trocado = await renovar(`${A.tenantId}.${segredo}`);
      expect(trocado.statusCode).toBe(401);
      expect(setCookies(trocado)).toEqual([APAGADO]);
      const { acesso, cookie } = await renovarOk(deB);
      expect(cookie.startsWith(`${B.tenantId}.`)).toBe(true);
      const claims = JSON.parse(Buffer.from(acesso.split('.')[1]!, 'base64url').toString()) as { tid: string };
      expect(claims.tid).toBe(B.tenantId);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ CK-9
  describe('CK-9 navegador simulado: cliente web REAL do SDK + rewrite /api-proxy + pote de cookies', () => {
    /** Pote de cookies do "navegador": só o host do BKO, com Path, Max-Age e HttpOnly (o JavaScript nunca lê). */
    const pote = new Map<string, { valor: string; caminho: string; httpOnly: boolean }>();
    const pedidos: { url: string; metodo: string; cabecalhos: Record<string, string>; corpo: string }[] = [];
    const local = new Map<string, string>();
    const sessao = new Map<string, string>();
    const storage = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
    let sdk: typeof import('@macuxi/platform-sdk/web');

    function guardar(setCookie: string) {
      const [par, ...attrs] = setCookie.split(';').map((x) => x.trim());
      const i = par!.indexOf('=');
      const nome = par!.slice(0, i);
      const valor = par!.slice(i + 1);
      const attr = (k: string) => attrs.find((a) => a.toLowerCase().startsWith(`${k.toLowerCase()}=`))?.split('=')[1];
      if (attr('Max-Age') === '0' || valor === '') pote.delete(nome);
      else pote.set(nome, { valor, caminho: attr('Path') ?? '/', httpOnly: attrs.some((a) => a.toLowerCase() === 'httponly') });
    }

    /** `fetch` do navegador na origem do BKO: `/api-proxy/<x>` → `/v1/<x>` (rewrite do Next), cookie pelo Path, Set-Cookie escondido. */
    async function fetchDoNavegador(url: string, init: RequestInit = {}): Promise<Response> {
      const caminho = String(url);
      if (!caminho.startsWith('/api-proxy/')) throw new Error(`o BKO na API real só chama a própria origem pelo /api-proxy: ${caminho}`);
      const cabecalhos: Record<string, string> = { 'sec-fetch-site': 'same-origin' };
      for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) cabecalhos[k.toLowerCase()] = v;
      const cookies = [...pote].filter(([, c]) => caminho === c.caminho || caminho.startsWith(`${c.caminho}/`)).map(([n, c]) => `${n}=${c.valor}`);
      if (cookies.length) cabecalhos.cookie = cookies.join('; ');
      const corpo = typeof init.body === 'string' ? init.body : '';
      const metodo = (init.method ?? 'GET') as 'GET' | 'POST';
      pedidos.push({ url: caminho, metodo, cabecalhos, corpo });
      const r = await api.app.inject({ method: metodo, url: `/v1/${caminho.slice('/api-proxy/'.length)}`, headers: cabecalhos, remoteAddress: novoIp(), ...(corpo ? { payload: corpo } : {}) });
      for (const sc of setCookies(r)) guardar(sc);
      const visiveis = new Headers();
      for (const [k, v] of Object.entries(r.headers)) if (k !== 'set-cookie' && v !== undefined) visiveis.set(k, String(v));
      return new Response(r.statusCode === 204 ? null : r.body, { status: r.statusCode, headers: visiveis });
    }

    beforeAll(async () => {
      vi.stubGlobal('window', { localStorage: storage(local), sessionStorage: storage(sessao), addEventListener: () => undefined, removeEventListener: () => undefined });
      vi.stubGlobal('fetch', fetchDoNavegador);
      vi.stubEnv('NEXT_PUBLIC_API_MODO', 'v1');
      vi.resetModules();
      sdk = await import('@macuxi/platform-sdk/web');
    });
    afterAll(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    const todoStorage = () => JSON.stringify([...local, ...sessao]);

    it('CK-20 login pelo SDK (sessaoWeb) → JSON sem refresh_token; cookie httpOnly no pote, no caminho /api-proxy/auth; localStorage só com o usuário', async () => {
      expect(sdk.MODO_API).toBe('v1');
      const s = SessaoWebRespostaSchema.strict().parse(
        await sdk.api<unknown>('/auth/login', { method: 'POST', body: corpoLogin('gerente@exemplo.com.br'), sessaoWeb: true }),
      );
      sdk.saveSession(s.access_token, { id: s.usuario.id, name: s.usuario.nome, perfil: s.usuario.perfil });
      segredos.push(s.access_token);
      const c = pote.get(NOME);
      expect(c).toMatchObject({ caminho: CAMINHO_COOKIE_SESSAO, httpOnly: true });
      segredos.push(c!.valor);
      expect(pedidos.at(-1)).toMatchObject({ url: '/api-proxy/auth/login', cabecalhos: { 'x-macuxi-csrf': '1' } });
      expect([...local.keys()]).toEqual(['macuxi.web.user']);
      expect(todoStorage()).not.toContain(c!.valor);
      expect(JSON.stringify([...local])).not.toContain(s.access_token);
      expect(sdk.getToken()).toBe(s.access_token);
    });

    it('CK-21 chamadas comuns da API não levam o cookie (Path), só o Bearer', async () => {
      await sdk.api('/me/modulos');
      const p = pedidos.at(-1)!;
      expect(p.url).toBe('/api-proxy/me/modulos');
      expect(p.cabecalhos.cookie).toBeUndefined();
      expect(p.cabecalhos.authorization).toMatch(/^Bearer /);
    });

    it('CK-22 renovarAcesso: POST /api-proxy/auth/refresh com X-Macuxi-CSRF: 1 e corpo {}; acesso novo na aba; cookie girado; nada no localStorage', async () => {
      const antes = pote.get(NOME)!.valor;
      const acessoAntes = sdk.getToken();
      const novo = await sdk.renovarAcesso();
      expect(novo).toBeTruthy();
      segredos.push(novo!);
      const p = pedidos.at(-1)!;
      expect(p).toMatchObject({ url: '/api-proxy/auth/refresh', metodo: 'POST', corpo: '{}', cabecalhos: { 'x-macuxi-csrf': '1' } });
      expect(p.cabecalhos.cookie).toBe(`${NOME}=${antes}`);
      const depois = pote.get(NOME)!.valor;
      segredos.push(depois);
      expect(depois).not.toBe(antes);
      expect(sdk.getToken()).toBe(novo);
      expect(novo).not.toBe(acessoAntes);
      expect(todoStorage()).not.toContain(depois);
      expect(JSON.stringify([...local])).not.toContain(novo!);
    });

    it('CK-23 aba nova (sessionStorage vazio, usuário guardado): restaurarSessao troca o cookie por um acesso', async () => {
      sessao.clear();
      expect(sdk.getToken()).toBeNull();
      await sdk.restaurarSessao();
      const t = sdk.getToken();
      expect(t).toBeTruthy();
      segredos.push(t!, pote.get(NOME)!.valor);
      expect((await meusModulos(t!)).statusCode).toBe(200);
    });

    it('CK-24 encerrarSessaoWeb: storage limpo, logout no modo cookie, cookie fora do pote; o cookie antigo não renova mais no servidor', async () => {
      const ultimo = pote.get(NOME)!.valor;
      await sdk.encerrarSessaoWeb();
      expect(pedidos.at(-1)).toMatchObject({ url: '/api-proxy/auth/logout', cabecalhos: { 'x-macuxi-csrf': '1', cookie: `${NOME}=${ultimo}` } });
      expect(pote.has(NOME)).toBe(false);
      expect(local.size + sessao.size).toBe(0);
      const r = await renovar(ultimo);
      expect(r.statusCode).toBe(401);
    });
  });

  // ----------------------------------------------------------------------------------------------------------------- CK-10
  it('CK-25 nenhum token (acesso, renovação, cookie) nem e-mail no log, com o logger real em trace', () => {
    const log = linhasLog.join('');
    expect(log.length, 'o log foi capturado').toBeGreaterThan(0);
    expect(segredos.length).toBeGreaterThan(20);
    for (const s of segredos) expect(log.includes(s), `token no log: ${s.slice(0, 12)}…`).toBe(false);
    // o segredo do refresh (sem o prefixo do tenant) também não
    for (const s of segredos.filter((x) => /^[0-9a-f-]{36}\./.test(x))) expect(log.includes(s.slice(37))).toBe(false);
    for (const e of [...emails, 'gerente@exemplo.com.br', 'admin.b@exemplo.com.br']) expect(log.includes(e), `e-mail no log: ${e}`).toBe(false);
    expect(log).not.toMatch(/macuxi_rt=[A-Za-z0-9]/);
  });
});
