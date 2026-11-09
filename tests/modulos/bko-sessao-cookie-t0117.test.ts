/**
 * T-0117 (ADR 0038; desenho docs/desenho/T-0117.md §6 e §7) — o BKO (`apps/web/lib/session.ts`) no modo cookie, sem banco:
 * login e troca de senha mandam `X-Macuxi-CSRF: 1` pelo `/api-proxy` e aceitam a resposta SEM `refresh_token`; a sessão salva
 * não deixa token no `localStorage`; sair chama o logout no modo cookie; nenhum código do BKO lê ou guarda o token de renovação.
 * E o lado do app Android: nenhum código do app manda o cabeçalho do modo cookie (o token segue no corpo, no SecureStore).
 * O `fetch` é falso (registra o pedido); a regra da API (cookie, CSRF, rotação) está em
 * `tests/integracao/api/sessao-web-cookie-t0117.test.ts` (Postgres, CI). Matriz: docs/testes/T-0117.md (BK-01 a BK-06).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { SessaoWebResposta } from '@macuxi/core/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const RAIZ = join(__dirname, '..', '..');

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

const TENANT = '0f0f0f0f-0000-4000-8000-000000000001';
const USUARIO = '0f0f0f0f-0000-4000-8000-0000000000aa';
const ACESSO = 'eyJhbGciOiJIUzI1NiJ9.acesso-ficticio-t0117.assinatura';
const SESSAO_WEB: SessaoWebResposta = {
  access_token: ACESSO,
  token_type: 'Bearer',
  expires_in: 900,
  usuario: { id: USUARIO, nome: 'Gerente Fictícia', nome_curto: null, email: 'gerente.t0117@exemplo.com.br', perfil: 'gerente' },
  tenant: { id: TENANT, codigo: 'alfa', nome: 'Distribuidora Fictícia', fuso: 'America/Manaus' },
};

let local: StorageFalso;
let sessao: StorageFalso;
let pedidos: { url: string; init: RequestInit }[];
let respostas: Response[];

const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const cabecalhos = (init: RequestInit) => Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));

async function carregarBko() {
  vi.resetModules();
  return import('../../apps/web/lib/session');
}

beforeEach(() => {
  local = new StorageFalso();
  sessao = new StorageFalso();
  pedidos = [];
  respostas = [];
  vi.stubEnv('NEXT_PUBLIC_API_MODO', 'v1');
  vi.stubGlobal('window', { localStorage: local, sessionStorage: sessao, addEventListener: () => undefined, removeEventListener: () => undefined });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    pedidos.push({ url: String(url), init });
    return respostas.shift() ?? json(500, {});
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('T-0117 BKO (apps/web/lib/session.ts) no modo cookie', () => {
  it('BK-01 login: POST /api-proxy/auth/login com X-Macuxi-CSRF: 1; a resposta sem refresh_token é a sessão', async () => {
    const bko = await carregarBko();
    respostas.push(json(200, SESSAO_WEB));
    const s = await bko.pedirLogin({ codigo_empresa: 'alfa', email: 'gerente.t0117@exemplo.com.br', senha: 'Senha#Ficticia-1', app: 'web' });
    expect(s.access_token).toBe(ACESSO);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.url).toBe('/api-proxy/auth/login');
    expect(pedidos[0]!.init.method).toBe('POST');
    expect(cabecalhos(pedidos[0]!.init)['x-macuxi-csrf']).toBe('1');
  });

  it('BK-02 troca de senha ("Crie sua senha"): POST /api-proxy/auth/senha/trocar com X-Macuxi-CSRF: 1; resposta sem refresh_token', async () => {
    const bko = await carregarBko();
    respostas.push(json(200, SESSAO_WEB));
    const s = await bko.pedirTrocaDeSenha({ codigo_empresa: 'alfa', email: 'gerente.t0117@exemplo.com.br', senha_atual: 'Senha#Ficticia-1', senha_nova: 'Senha#Ficticia-2', app: 'web' });
    expect(s.usuario.id).toBe(USUARIO);
    expect(pedidos[0]!.url).toBe('/api-proxy/auth/senha/trocar');
    expect(cabecalhos(pedidos[0]!.init)['x-macuxi-csrf']).toBe('1');
  });

  it('BK-03 salvarSessaoReal: localStorage só com o usuário (sem token); o acesso fica no sessionStorage da aba', async () => {
    const bko = await carregarBko();
    bko.salvarSessaoReal(SESSAO_WEB);
    expect([...local.dados.keys()]).toEqual(['macuxi.web.user']);
    expect(JSON.stringify([...local.dados.values()])).not.toContain(ACESSO);
    expect([...sessao.dados.values()]).toContain(ACESSO);
  });

  it('BK-04 sair: limpa o navegador e chama POST /api-proxy/auth/logout no modo cookie (corpo {}, same-origin)', async () => {
    const bko = await carregarBko();
    bko.salvarSessaoReal(SESSAO_WEB);
    respostas.push(json(200, {}));
    await bko.encerrarSessao();
    expect(local.dados.size + sessao.dados.size).toBe(0);
    const logout = pedidos.find((p) => p.url.endsWith('/auth/logout'));
    expect(logout, 'sair chama o logout para revogar a família e apagar o cookie').toBeDefined();
    expect(logout!.url).toBe('/api-proxy/auth/logout');
    expect(logout!.init).toMatchObject({ method: 'POST', body: '{}', credentials: 'same-origin' });
    expect(cabecalhos(logout!.init)['x-macuxi-csrf']).toBe('1');
  });
});

/** Arquivos-fonte (sem testes) de uma pasta, recursivo. */
function fontes(dir: string): string[] {
  const out: string[] = [];
  const abs = join(RAIZ, dir);
  for (const nome of readdirSync(abs)) {
    if (nome === 'node_modules' || nome === '.next' || nome.startsWith('.')) continue;
    const p = join(abs, nome);
    if (statSync(p).isDirectory()) out.push(...fontes(relative(RAIZ, p)));
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) out.push(relative(RAIZ, p));
  }
  return out;
}
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

describe('T-0117 varredura do código: o token de renovação não volta ao JavaScript do BKO nem sai do corpo no app', () => {
  it('BK-05 apps/web não lê nem guarda o token de renovação (getRefreshToken, refresh_token, macuxi.web.refresh)', () => {
    const achados = ['apps/web/app', 'apps/web/components', 'apps/web/lib']
      .flatMap(fontes)
      .flatMap((p) => (/getRefreshToken|refresh_token|macuxi\.web\.refresh/.test(ler(p)) ? [p] : []));
    expect(achados).toEqual([]);
  });

  it('BK-05b login e troca de senha do BKO na API real só por pedirLogin/pedirTrocaDeSenha (o "/auth/login" que sobra é o da demonstração, com user_id)', () => {
    for (const p of ['apps/web/app', 'apps/web/components'].flatMap(fontes)) {
      const texto = ler(p);
      for (const m of texto.matchAll(/api(?:Fetch)?(?:<[^>]*>)?\(\s*(['"]\/auth\/login['"]|CAMINHO_TROCAR_SENHA|['"]\/auth\/senha\/trocar['"])[^)]*\)/g)) {
        expect(m[0], `${p}: chamada direta de ${m[1]} sem o modo cookie`).toMatch(/user_id|sessaoWeb:\s*true/);
      }
    }
  });

  it('BK-06 o app Android (apps/mobile e modules/*/app) nunca manda o cabeçalho do modo cookie: o token segue no corpo', () => {
    const modulos = readdirSync(join(RAIZ, 'modules')).filter((m) => {
      try {
        return statSync(join(RAIZ, 'modules', m, 'app')).isDirectory();
      } catch {
        return false;
      }
    });
    const achados = ['apps/mobile/src', ...modulos.map((m) => `modules/${m}/app`)]
      .flatMap(fontes)
      .flatMap((p) => (/x-macuxi-csrf|CABECALHO_CSRF|CABECALHOS_SESSAO_WEB|sessaoWeb/i.test(ler(p)) ? [p] : []));
    expect(achados).toEqual([]);
  });
});
