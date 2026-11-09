/**
 * T-0117 (revisão G2): o que o shell do BKO faz com a sessão restaurada pelo cookie.
 * - Só `anonymous` vai ao login (`estadoDaSessao`); `sem_conexao` fica na aba com o aviso.
 * - Com o SDK de verdade: aba nova sem rede → `sem_conexao` (o usuário fica); a rede volta → "Tentar de novo"
 *   (`tentarRestaurarSessao`) troca o cookie e a aba volta autenticada sem novo login; 401 e 423 encerram (login).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoDaSessao } from './estado-shell';

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

const CHAVE_USUARIO = 'macuxi.web.user';
const USUARIO = { id: '0b8f3c1e-6a1d-4f3a-9a52-1f0f3d6b2c11', name: 'Ana Souza', email: 'ana@empresa.com.br', perfil: 'gerente' };

let local: StorageFalso;
let sessao: StorageFalso;
/** Próximas respostas do `POST /api-proxy/auth/refresh`: uma `Response` ou `'sem_rede'` (o fetch falha). */
let respostas: (Response | 'sem_rede')[];

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
}

/** SDK novo a cada caso (o estado da restauração não vaza) e a aba nova: usuário guardado, sem token nesta aba. */
async function abaNovaComUsuario() {
  vi.resetModules();
  const sdk = await import('@macuxi/platform-sdk/web');
  sdk.saveSession('acesso-antigo', USUARIO);
  sessao.dados.clear();
  return sdk;
}

/** O status que o `useSession()` daria, pelo instantâneo do SDK. */
function statusDaSessao(sdk: typeof import('@macuxi/platform-sdk/web')) {
  const t = sdk.instantaneoDaSessao();
  if (t === '') return 'anonymous' as const;
  if (t === sdk.getToken()) return 'authenticated' as const;
  return t.includes('sem_conexao') ? ('sem_conexao' as const) : ('loading' as const);
}

beforeAll(async () => {
  await import('@macuxi/platform-sdk/web');
}, 120_000);

beforeEach(() => {
  local = new StorageFalso();
  sessao = new StorageFalso();
  respostas = [];
  vi.stubGlobal('window', { localStorage: local, sessionStorage: sessao, addEventListener: () => undefined, removeEventListener: () => undefined });
  vi.stubGlobal('fetch', async () => {
    const r = respostas.shift() ?? 'sem_rede';
    if (r === 'sem_rede') throw new TypeError('Failed to fetch');
    return r;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('T-0117 G2: estadoDaSessao (só 401/423 vão ao login)', () => {
  it('cada status da sessão do SDK', () => {
    expect(estadoDaSessao('authenticated')).toBe('autenticada');
    expect(estadoDaSessao('sem_conexao')).toBe('sem_conexao');
    expect(estadoDaSessao('anonymous')).toBe('ir_ao_login');
    expect(estadoDaSessao('loading')).toBe('carregando');
  });
});

describe('T-0117 G2: aba nova do BKO restaurando pelo cookie', () => {
  it('sem rede: sem_conexao com o usuário guardado; a rede volta e "Tentar de novo" autentica sem novo login', async () => {
    const sdk = await abaNovaComUsuario();
    expect(statusDaSessao(sdk)).toBe('loading');

    await sdk.restaurarSessao();
    expect(statusDaSessao(sdk)).toBe('sem_conexao');
    expect(estadoDaSessao(statusDaSessao(sdk))).toBe('sem_conexao');
    expect(local.getItem(CHAVE_USUARIO)).toContain('Ana Souza');

    respostas.push(json(200, { access_token: 'acesso-novo', token_type: 'Bearer', expires_in: 900 }));
    await sdk.tentarRestaurarSessao();
    expect(sdk.getToken()).toBe('acesso-novo');
    expect(estadoDaSessao(statusDaSessao(sdk))).toBe('autenticada');
  });

  it('servidor fora (503) também fica sem_conexao, não vai ao login', async () => {
    const sdk = await abaNovaComUsuario();
    respostas.push(json(503, {}));
    await sdk.restaurarSessao();
    expect(estadoDaSessao(statusDaSessao(sdk))).toBe('sem_conexao');
  });

  it.each([401, 423])('%i na renovação encerra: vai ao login e o usuário sai do navegador', async (codigo) => {
    const sdk = await abaNovaComUsuario();
    respostas.push(json(codigo, { codigo: 'SESSAO_ENCERRADA', mensagem: 'Entre de novo.' }));
    await sdk.restaurarSessao();
    expect(estadoDaSessao(statusDaSessao(sdk))).toBe('ir_ao_login');
    expect(local.getItem(CHAVE_USUARIO)).toBeNull();
  });

  it('sem rede e depois 401 no "Tentar de novo": vai ao login', async () => {
    const sdk = await abaNovaComUsuario();
    await sdk.restaurarSessao();
    expect(estadoDaSessao(statusDaSessao(sdk))).toBe('sem_conexao');
    respostas.push(json(401, {}));
    await sdk.tentarRestaurarSessao();
    expect(estadoDaSessao(statusDaSessao(sdk))).toBe('ir_ao_login');
  });
});
