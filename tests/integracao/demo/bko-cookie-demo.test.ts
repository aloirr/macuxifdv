/**
 * T-0117 (pedido R-20261109-122431) — autoteste do `tests/scripts/bko-cookie-demo.mjs`, o smoke do cookie do BKO na demo
 * (`https://bko-demo.macuxifdv.com.br/api-proxy/auth/*`). Sem internet: um servidor HTTP local faz o papel do BKO com o
 * rewrite e a API da T-0117 (contrato do desenho §3 a §5, em memória) e, em cada variante, de um defeito real:
 *  - rewrite que engole o Set-Cookie; API anterior à T-0117 (ignora o cabeçalho); cookie com Domain ou sem HttpOnly;
 *    JSON do login com refresh_token; refresh que não gira o cookie; logout que não revoga; CSRF desligado.
 * O teste prova que o script (1) passa com o contrato; (2) falha com mensagem clara em cada defeito; (3) nunca põe e-mail,
 * senha, token de acesso nem o valor do cookie na saída; (4) recusa credencial em argumento ou incompleta.
 * A rodada contra a demo é manual, depois da publicação do lote (roteiro em docs/testes/T-0117.md):
 * `MACUXI_DEMO_BKO_EMPRESA=... MACUXI_DEMO_BKO_EMAIL=... MACUXI_DEMO_BKO_SENHA=... node tests/scripts/bko-cookie-demo.mjs`.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'bko-cookie-demo.mjs');

type Principal = (argv: string[], env: Record<string, string | undefined>, escrever: (l: string) => void) => Promise<number>;

const NOME = '__Secure-macuxi_rt';
const TENANT = '0f0f0f0f-0000-4000-8000-000000000001';
const CRED = { MACUXI_DEMO_BKO_EMPRESA: 'empresa-ficticia', MACUXI_DEMO_BKO_EMAIL: 'gerente.ficticia@exemplo.com.br', MACUXI_DEMO_BKO_SENHA: 'Senha#Ficticia-T0117' };

/** Defeitos que o servidor local pode simular. */
interface Defeitos {
  rewriteSemSetCookie?: boolean;
  apiAntiga?: boolean;
  comDomain?: boolean;
  semHttpOnly?: boolean;
  loginComRefresh?: boolean;
  naoGira?: boolean;
  logoutNaoRevoga?: boolean;
  csrfDesligado?: boolean;
}

describe('T-0117 — bko-cookie-demo.mjs: smoke do cookie do BKO pelo rewrite', () => {
  let principal: Principal;
  let servidor: Server;
  let base = '';
  let defeitos: Defeitos = {};
  const validos = new Set<string>();
  /** Tudo o que o servidor entregou e que não pode aparecer na saída do script. */
  const segredos: string[] = [];
  const recebidos: { url: string; cabecalhos: IncomingMessage['headers'] }[] = [];

  const novoToken = () => {
    const t = `${TENANT}.${randomBytes(24).toString('base64url')}`;
    validos.add(t);
    segredos.push(t);
    return t;
  };
  const gravar = (t: string) =>
    [`${NOME}=${t}`, 'Max-Age=2592000', 'Path=/api-proxy/auth', ...(defeitos.semHttpOnly ? [] : ['HttpOnly']), 'Secure', 'SameSite=Strict', ...(defeitos.comDomain ? ['Domain=macuxifdv.com.br'] : [])].join('; ');
  const APAGAR = `${NOME}=; Max-Age=0; Path=/api-proxy/auth; HttpOnly; Secure; SameSite=Strict`;

  /** O BKO (rewrite) + a API da T-0117, em memória. */
  function atender(req: IncomingMessage, res: ServerResponse, corpo: string) {
    const url = req.url ?? '';
    recebidos.push({ url, cabecalhos: req.headers });
    const json = (status: number, c: unknown, setCookie?: string) => {
      const h: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
      if (setCookie && !defeitos.rewriteSemSetCookie) h['set-cookie'] = setCookie;
      res.writeHead(status, h).end(JSON.stringify(c));
    };
    const erro = (status: number, codigo: string, setCookie?: string) => json(status, { codigo, mensagem: `mensagem de ${codigo}` }, setCookie);
    if (req.method !== 'POST' || !url.startsWith('/api-proxy/auth/')) return erro(404, 'NAO_ENCONTRADO');
    const rota = url.slice('/api-proxy/auth/'.length);
    let b: Record<string, unknown> = {};
    try {
      b = JSON.parse(corpo || '{}') as Record<string, unknown>;
    } catch {
      return erro(400, 'VALIDACAO');
    }
    const csrf = req.headers['x-macuxi-csrf'];
    const site = req.headers['sec-fetch-site'];
    let modo: 'corpo' | 'cookie' | 'recusado' = csrf === undefined || defeitos.apiAntiga ? 'corpo' : csrf !== '1' ? 'recusado' : site !== undefined && site !== 'same-origin' && site !== 'none' ? 'recusado' : 'cookie';
    if (defeitos.csrfDesligado && modo === 'recusado') modo = 'cookie';
    if (modo === 'recusado') return erro(403, 'CSRF_RECUSADO');
    const cookie = /(?:^|;\s*)__Secure-macuxi_rt=([^;]+)/.exec(String(req.headers.cookie ?? ''))?.[1] ?? null;
    if (rota === 'login') {
      if (b.email !== CRED.MACUXI_DEMO_BKO_EMAIL || b.senha !== CRED.MACUXI_DEMO_BKO_SENHA) return erro(401, 'CREDENCIAIS_INVALIDAS');
      const t = novoToken();
      const acesso = `acesso-${randomBytes(8).toString('hex')}`;
      segredos.push(acesso);
      if (modo === 'corpo') return json(200, { access_token: acesso, token_type: 'Bearer', expires_in: 900, refresh_token: t });
      return json(200, { access_token: acesso, token_type: 'Bearer', expires_in: 900, ...(defeitos.loginComRefresh ? { refresh_token: t } : {}) }, gravar(t));
    }
    if (rota === 'refresh') {
      const t = modo === 'cookie' ? cookie : typeof b.refresh_token === 'string' ? b.refresh_token : null;
      if (modo === 'corpo' && !t) return erro(400, 'VALIDACAO');
      if (!t || !validos.has(t)) return erro(401, 'SESSAO_INVALIDA', modo === 'cookie' ? APAGAR : undefined);
      const acesso = `acesso-${randomBytes(8).toString('hex')}`;
      segredos.push(acesso);
      if (defeitos.naoGira) return json(200, { access_token: acesso, token_type: 'Bearer', expires_in: 900 }, gravar(t));
      validos.delete(t);
      const novo = novoToken();
      if (modo === 'corpo') return json(200, { access_token: acesso, token_type: 'Bearer', expires_in: 900, refresh_token: novo });
      return json(200, { access_token: acesso, token_type: 'Bearer', expires_in: 900 }, gravar(novo));
    }
    if (rota === 'logout') {
      if (modo === 'corpo') return typeof b.refresh_token === 'string' ? json(200, {}) : erro(400, 'VALIDACAO');
      if (cookie && !defeitos.logoutNaoRevoga) validos.delete(cookie);
      return json(200, {}, APAGAR);
    }
    return erro(404, 'NAO_ENCONTRADO');
  }

  const rodar = async (env: Record<string, string | undefined> = {}, argv: string[] = []) => {
    const linhas: string[] = [];
    const codigo = await principal(['--bko', base, '--tempo', '30000', ...argv], env, (l) => linhas.push(l));
    return { codigo, saida: linhas.join('\n') };
  };
  const semSegredo = (saida: string) => {
    for (const s of [...segredos, CRED.MACUXI_DEMO_BKO_EMAIL, CRED.MACUXI_DEMO_BKO_SENHA]) expect(saida.includes(s), `segredo na saída: ${s.slice(0, 10)}…`).toBe(false);
    expect(saida).not.toContain(TENANT);
  };

  beforeAll(async () => {
    principal = ((await import(pathToFileURL(SCRIPT).href)) as { principal: Principal }).principal;
    servidor = createServer((req, res) => {
      let corpo = '';
      req.on('data', (d) => (corpo += String(d)));
      req.on('end', () => atender(req, res, corpo));
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    servidor?.closeAllConnections();
    await new Promise<void>((r) => servidor?.close(() => r()));
  });
  beforeEach(() => {
    defeitos = {};
    recebidos.length = 0;
  });

  it('BC-01 contrato da T-0117, sem credencial: refresh sem cookie apaga o cookie, CSRF 403, logout apaga → código 0 e o aviso do roteiro manual', async () => {
    const r = await rodar();
    expect(r.codigo, r.saida).toBe(0);
    expect(r.saida).toMatch(/OK +apaga .*401 SESSAO_INVALIDA e o cookie apagado pelo rewrite/);
    expect(r.saida).toMatch(/OK +csrf0 .*403 CSRF_RECUSADO/);
    expect(r.saida).toMatch(/OK +sai0 .*200 e o cookie apagado/);
    expect(r.saida).toContain('passos 4 a 7) ficam para o roteiro manual');
    // só as rotas de sessão, sempre POST pelo /api-proxy/auth, e o X-Macuxi-CSRF em todas
    expect(recebidos.every((x) => x.url.startsWith('/api-proxy/auth/'))).toBe(true);
    expect(recebidos.every((x) => x.cabecalhos['x-macuxi-csrf'] !== undefined)).toBe(true);
  });

  it('BC-02 com a credencial: login → cookie com os atributos, renovação girando, CSRF com o cookie, logout que revoga → código 0, sem segredo na saída', async () => {
    const r = await rodar(CRED);
    expect(r.codigo, r.saida).toBe(0);
    expect(r.saida).toMatch(/OK +login .*200 sem refresh_token no JSON; __Secure-macuxi_rt=<token>; Max-Age=2592000; Path=\/api-proxy\/auth; HttpOnly; Secure; SameSite=Strict/);
    expect(r.saida).toMatch(/OK +renova .*cookie novo \(girou\)/);
    expect(r.saida).toMatch(/OK +csrf .*sem o cabeçalho 400/);
    expect(r.saida).toMatch(/OK +logout .*refresh com o cookie revogado → 401/);
    semSegredo(r.saida);
    // o login levou app: 'web' e o cabeçalho; o cookie foi mandado só no caminho de sessão
    const login = recebidos.find((x) => x.url === '/api-proxy/auth/login')!;
    expect(login.cabecalhos['x-macuxi-csrf']).toBe('1');
  });

  it('BC-03 rewrite que engole o Set-Cookie → FALHA "o rewrite /api-proxy do Next não repassou"', async () => {
    defeitos.rewriteSemSetCookie = true;
    const r = await rodar(CRED);
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA apaga .*o rewrite \/api-proxy do Next não repassou/);
    expect(r.saida).toMatch(/FALHA login .*não repassou/);
    semSegredo(r.saida);
  });

  it('BC-04 API anterior à T-0117 (ignora o cabeçalho) → FALHA "anterior à T-0117" e o login com refresh_token no JSON', async () => {
    defeitos.apiAntiga = true;
    const r = await rodar(CRED);
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA apaga .*400 VALIDACAO: a API da demo ignora o X-Macuxi-CSRF \(anterior à T-0117\)/);
    expect(r.saida).toMatch(/FALHA login .*o JSON traz refresh_token/);
    semSegredo(r.saida);
  });

  it('BC-05 cookie com Domain ou sem HttpOnly → FALHA com os atributos (sem o valor)', async () => {
    defeitos.comDomain = true;
    let r = await rodar(CRED);
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA login .*cookie com Domain \(tem de ser host-only do BKO\): __Secure-macuxi_rt=<token>;/);
    semSegredo(r.saida);
    defeitos = { semHttpOnly: true };
    r = await rodar(CRED);
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA login .*Set-Cookie fora do contrato/);
    semSegredo(r.saida);
  });

  it('BC-06 JSON do login com refresh_token (modo cookie desligado na rota do Core) → FALHA', async () => {
    defeitos.loginComRefresh = true;
    const r = await rodar(CRED);
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA login .*o JSON traz refresh_token/);
    semSegredo(r.saida);
  });

  it('BC-07 refresh que não gira o cookie → FALHA "o cookie não girou"', async () => {
    defeitos.naoGira = true;
    const r = await rodar(CRED);
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA renova .*o cookie não girou/);
  });

  it('BC-08 logout que não revoga → FALHA (o refresh com o cookie revogado deu 200)', async () => {
    defeitos.logoutNaoRevoga = true;
    const r = await rodar(CRED);
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA logout .*o refresh com o cookie revogado deu 200/);
  });

  it('BC-09 CSRF desligado (aceita X-Macuxi-CSRF: 0 e cross-site) → FALHA no csrf0 e no csrf com o cookie', async () => {
    defeitos.csrfDesligado = true;
    const r = await rodar(CRED);
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA csrf0 .*esperado 403 CSRF_RECUSADO/);
    expect(r.saida).toMatch(/FALHA csrf .*X-Macuxi-CSRF: 0: esperado 403 CSRF_RECUSADO/);
    semSegredo(r.saida);
  });

  it('BC-10 credencial errada → FALHA no login com a dica, sem e-mail nem senha na saída', async () => {
    const r = await rodar({ ...CRED, MACUXI_DEMO_BKO_SENHA: 'Outra#Senha-Ficticia' });
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA login .*401 CREDENCIAIS_INVALIDAS \(confira a empresa, o e-mail e a senha do ambiente\)/);
    expect(r.saida).not.toContain('Outra#Senha-Ficticia');
    semSegredo(r.saida);
  });

  it('BC-11 uso errado → código 2 sem fazer requisição: credencial em argumento, credencial incompleta, URL com usuário/senha', async () => {
    for (const [env, argv, texto] of [
      [{}, ['--senha', 'x'], 'credencial só por variável de ambiente'],
      [{}, ['--cookie', 'x'], 'credencial só por variável de ambiente'],
      [{ MACUXI_DEMO_BKO_EMAIL: CRED.MACUXI_DEMO_BKO_EMAIL }, [], 'juntos (ou nenhum)'],
    ] as const) {
      const r = await rodar(env, [...argv]);
      expect(r.codigo, texto).toBe(2);
      expect(r.saida).toContain(texto);
    }
    const linhas: string[] = [];
    const codigo = await principal(['--bko', 'https://u:s@bko-demo.macuxifdv.com.br'], {}, (l) => linhas.push(l));
    expect(codigo).toBe(2);
    expect(recebidos).toEqual([]);
  });

  it('BC-12 padrão: o domínio da demo; MACUXI_DEMO_BKO_URL troca o endereço', async () => {
    const m = (await import(pathToFileURL(SCRIPT).href)) as { PADRAO: { bko: string }; COOKIE_APAGADO: string };
    expect(m.PADRAO).toEqual({ bko: 'https://bko-demo.macuxifdv.com.br' });
    expect(m.COOKIE_APAGADO).toBe(APAGAR);
    const linhas: string[] = [];
    const codigo = await principal(['--tempo', '30000'], { MACUXI_DEMO_BKO_URL: base }, (l) => linhas.push(l));
    expect(codigo, linhas.join('\n')).toBe(0);
  });
});
