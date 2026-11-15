/**
 * T-0117 (ADR 0038; desenho docs/desenho/T-0117.md v2 §7): o BKO no modo cookie.
 * - Login e troca de senha mandam `X-Macuxi-CSRF: 1` pelo `/api-proxy/auth/...`; a resposta vem sem `refresh_token`.
 * - Sair chama `POST /api-proxy/auth/logout` no modo cookie (a API revoga a família e apaga o cookie).
 * - Nenhum token no `localStorage`: só o usuário; o acesso fica no `sessionStorage` da aba.
 * - O rewrite `/api-proxy` do Next leva o caminho do cookie à API sem mexer em cabeçalho, e o `proxy.ts` não passa por ele.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LoginSenhaRequest, TrocarSenhaRequest } from '@macuxi/core/contracts';
import { CABECALHO_CSRF, CAMINHO_COOKIE_SESSAO, VALOR_CSRF } from '@macuxi/platform-sdk';
import { PROXY_BASE } from '@macuxi/platform-sdk/web';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import nextConfig from '../next.config';
import { config as configDoProxy } from '../proxy';

class StorageFalso {
  readonly dados = new Map<string, string>();
  getItem(k: string) {
    return this.dados.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.dados.set(k, v);
  }
  removeItem(k: string) {
    this.dados.delete(k);
  }
}

let local: StorageFalso;
let sessao: StorageFalso;
let chamadas: { url: string; init: RequestInit }[];
let respostas: Response[];

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
}

/** Módulos novos a cada teste: o estado da sessão do SDK (migração, restauração) não vaza entre os casos. */
async function carregar() {
  vi.resetModules();
  const s = await import('./session');
  const sdk = await import('@macuxi/platform-sdk/web');
  return { ...s, getToken: sdk.getToken };
}

/** Resposta do Core no modo cookie (`SessaoWebRespostaSchema`): sem `refresh_token`. */
const SESSAO_WEB = {
  access_token: 'acesso-jwt-1',
  token_type: 'Bearer',
  expires_in: 900,
  usuario: { id: '0b8f3c1e-6a1d-4f3a-9a52-1f0f3d6b2c11', nome: 'Ana Souza', nome_curto: 'Ana', email: 'ana@empresa.com.br', perfil: 'gerente' },
  tenant: { id: '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f', codigo: 'AM4821', nome: 'Distribuidora Teste', fuso: 'America/Manaus' },
} as const;

const LOGIN: LoginSenhaRequest = { codigo_empresa: 'AM4821', email: 'ana@empresa.com.br', senha: 'Senha-de-teste-1', app: 'web' };
const TROCA = { codigo_empresa: 'AM4821', email: 'ana@empresa.com.br', senha_atual: 'Temporaria-1', senha_nova: 'Senha-nova-123', app: 'web' } as TrocarSenhaRequest;

function cabecalhos(init: RequestInit): Record<string, string> {
  return Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
}

/** Tudo o que ficou no `localStorage` (chaves e valores), para procurar token. */
function tudoNoLocal(): string {
  return JSON.stringify([...local.dados.entries()]);
}

// 1ª carga dos contratos e do SDK (transformação) fora do tempo de cada caso; PC lento
beforeAll(async () => {
  await import('./session');
}, 120_000);

beforeEach(() => {
  local = new StorageFalso();
  sessao = new StorageFalso();
  chamadas = [];
  respostas = [];
  vi.stubGlobal('window', { localStorage: local, sessionStorage: sessao, addEventListener: () => undefined, removeEventListener: () => undefined });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    return respostas.shift() ?? json(500, {});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('T-0117: login e troca de senha no modo cookie', () => {
  it('o login vai ao /api-proxy/auth/login com X-Macuxi-CSRF: 1 e a sessão aberta não deixa token no localStorage', async () => {
    const s = await carregar();
    respostas.push(json(200, SESSAO_WEB));
    const r = await s.pedirLogin(LOGIN);
    expect(chamadas).toHaveLength(1);
    const [c] = chamadas;
    expect(c?.url).toBe(`${PROXY_BASE}/auth/login`);
    expect(c?.init.method).toBe('POST');
    expect(cabecalhos(c!.init)[CABECALHO_CSRF]).toBe(VALOR_CSRF);
    expect(JSON.parse(String(c?.init.body))).toEqual(LOGIN);

    s.salvarSessaoReal(r);
    expect([...local.dados.keys()]).toEqual(['macuxi.web.user']);
    expect(tudoNoLocal()).not.toContain('acesso-jwt-1');
    expect(local.getItem('macuxi.web.refresh')).toBeNull();
    expect(local.getItem('macuxi.web.token')).toBeNull();
    expect(sessao.getItem('macuxi.web.token')).toBe('acesso-jwt-1');
    expect(s.getToken()).toBe('acesso-jwt-1');
    expect(JSON.parse(local.getItem('macuxi.web.user') ?? '{}')).toMatchObject({ name: 'Ana Souza', perfil: 'gerente', empresa: 'Distribuidora Teste', fuso: 'America/Manaus' });
  });

  it('resposta com refresh_token no corpo (API fora do modo cookie) é recusada: o token nunca chega à sessão', async () => {
    const s = await carregar();
    respostas.push(json(200, { ...SESSAO_WEB, refresh_token: 'AUT.refresh-que-nao-pode-ficar' }));
    await expect(s.pedirLogin(LOGIN)).rejects.toMatchObject({ name: 'ZodError' });
    expect(tudoNoLocal()).not.toContain('refresh-que-nao-pode-ficar');
    expect(JSON.stringify([...sessao.dados.values()])).not.toContain('refresh-que-nao-pode-ficar');
  });

  it('a troca de senha vai ao /api-proxy/auth/senha/trocar com X-Macuxi-CSRF: 1 e abre a sessão nova sem token no localStorage', async () => {
    const s = await carregar();
    respostas.push(json(200, { ...SESSAO_WEB, access_token: 'acesso-da-troca' }));
    const r = await s.pedirTrocaDeSenha(TROCA);
    const [c] = chamadas;
    expect(c?.url).toBe(`${PROXY_BASE}/auth/senha/trocar`);
    expect(c?.init.method).toBe('POST');
    expect(cabecalhos(c!.init)[CABECALHO_CSRF]).toBe(VALOR_CSRF);
    s.salvarSessaoReal(r);
    expect([...local.dados.keys()]).toEqual(['macuxi.web.user']);
    expect(tudoNoLocal()).not.toContain('acesso-da-troca');
    expect(s.getToken()).toBe('acesso-da-troca');
  });

  it('erro do login (403 CSRF_RECUSADO) chega à tela com a frase da API e nada é guardado', async () => {
    const s = await carregar();
    respostas.push(json(403, { codigo: 'CSRF_RECUSADO', mensagem: 'Pedido recusado por segurança. Atualize a página e entre de novo.' }));
    await expect(s.pedirLogin(LOGIN)).rejects.toMatchObject({ status: 403, code: 'CSRF_RECUSADO' });
    expect(local.dados.size).toBe(0);
    expect(sessao.dados.size).toBe(0);
  });
});

describe('T-0117: sair', () => {
  it('limpa a sessão e chama o /api-proxy/auth/logout no modo cookie (corpo vazio, sem token)', async () => {
    const s = await carregar();
    respostas.push(json(200, SESSAO_WEB));
    s.salvarSessaoReal(await s.pedirLogin(LOGIN));
    respostas.push(json(200, {}));
    await s.encerrarSessao();
    expect(local.dados.size).toBe(0);
    expect(sessao.dados.size).toBe(0);
    expect(s.getToken()).toBeNull();
    const c = chamadas.at(-1);
    expect(c?.url).toBe(`${PROXY_BASE}/auth/logout`);
    expect(c?.init.method).toBe('POST');
    expect(cabecalhos(c!.init)[CABECALHO_CSRF]).toBe(VALOR_CSRF);
    expect(c?.init.credentials).toBe('same-origin');
    expect(c?.init.body).toBe('{}');
  });

  it('sem rede, a sessão local sai do mesmo jeito', async () => {
    const s = await carregar();
    respostas.push(json(200, SESSAO_WEB));
    s.salvarSessaoReal(await s.pedirLogin(LOGIN));
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(s.encerrarSessao()).resolves.toBeUndefined();
    expect(local.dados.size).toBe(0);
    expect(s.getToken()).toBeNull();
  });
});

describe('T-0117: o caminho do cookie passa pelo rewrite sem mexer', () => {
  it('o cookie é restrito a /api-proxy/auth, que o rewrite geral leva às rotas /v1/auth da API', async () => {
    expect(CAMINHO_COOKIE_SESSAO).toBe(`${PROXY_BASE}/auth`);
    const regras = await nextConfig.rewrites!();
    expect(Array.isArray(regras)).toBe(true);
    const lista = regras as { source: string; destination: string; has?: unknown; missing?: unknown }[];
    const geral = lista.find((r) => r.source === `${PROXY_BASE}/:path*`);
    expect(geral?.destination).toMatch(/\/v1\/:path\*$/);
    // sem condição nem regra de cabeçalho: `Cookie` e `Set-Cookie` vão e voltam como a API mandou
    expect(geral?.has).toBeUndefined();
    expect(geral?.missing).toBeUndefined();
    expect(nextConfig.headers).toBeUndefined();
  });

  it('o proxy.ts (antigo middleware) não passa pelas rotas de sessão', () => {
    const casa = (caminho: string) => configDoProxy.matcher.some((m) => new RegExp(`^${m}$`).test(caminho));
    for (const rota of ['login', 'refresh', 'logout', 'senha/trocar']) expect(casa(`${CAMINHO_COOKIE_SESSAO}/${rota}`)).toBe(false);
    expect(casa('/login')).toBe(true);
  });
});

describe('T-0117: nenhuma tela do BKO guarda token no navegador', () => {
  const raiz = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  function fontes(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) return fontes(p);
      return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
    });
  }
  const arquivos = ['app', 'components', 'lib'].flatMap((d) => fontes(path.join(raiz, d)));

  it('sem refresh_token, getRefreshToken nem as chaves antigas de token no código do shell', () => {
    expect(arquivos.length).toBeGreaterThan(10);
    const achados = arquivos.filter((a) => /refresh_token|getRefreshToken|macuxi\.web\.(token|refresh)/.test(readFileSync(a, 'utf8'))).map((a) => path.relative(raiz, a));
    expect(achados).toEqual([]);
  });

  it('o localStorage só recebe o código da empresa', () => {
    const gravacoes = arquivos.flatMap((a) => [...readFileSync(a, 'utf8').matchAll(/localStorage\.setItem\(([^,]+),/g)].map((m) => `${path.relative(raiz, a)}: ${m[1]?.trim()}`));
    expect(gravacoes.every((g) => g.endsWith('CHAVE_CODIGO_EMPRESA'))).toBe(true);
  });
});
