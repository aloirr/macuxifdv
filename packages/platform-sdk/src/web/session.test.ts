/**
 * T-0117 (ADR 0038): sessão do BKO sem token no `localStorage`. O token de renovação mora no cookie httpOnly (a API grava);
 * o acesso fica no `sessionStorage` da aba; a aba nova se restaura pelo cookie; sair chama o logout no modo cookie.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CABECALHO_CSRF, CAMINHO_COOKIE_SESSAO } from '../cookie-sessao';

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

async function carregar() {
  vi.resetModules();
  const s = await import('./session');
  const a = await import('./api');
  return { ...s, ...a };
}

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

const USUARIO = { id: 'u1', name: 'Ana', perfil: 'admin' };

describe('T-0117: nada de token no localStorage', () => {
  it('saveSession guarda o usuário no localStorage e o acesso só no sessionStorage; o refresh nunca é guardado', async () => {
    const s = await carregar();
    s.saveSession('acesso-1', USUARIO, 'refresh-que-nao-pode-ficar');
    expect([...local.dados.keys()]).toEqual(['macuxi.web.user']);
    expect(JSON.stringify([...local.dados.values()])).not.toContain('acesso-1');
    expect(JSON.stringify([...local.dados.values(), ...sessao.dados.values()])).not.toContain('refresh-que-nao-pode-ficar');
    expect(s.getToken()).toBe('acesso-1');
    expect(s.getRefreshToken()).toBeNull();
    expect(s.instantaneoDaSessao()).toBe('acesso-1');
  });

  it('migração: as chaves antigas saem do localStorage sem deslogar a aba', async () => {
    local.setItem('macuxi.web.user', JSON.stringify(USUARIO));
    local.setItem('macuxi.web.token', 'acesso-antigo');
    local.setItem('macuxi.web.refresh', 'refresh-antigo');
    const s = await carregar();
    expect(s.getToken()).toBe('acesso-antigo');
    expect(local.getItem('macuxi.web.token')).toBeNull();
    expect(local.getItem('macuxi.web.refresh')).toBeNull();
    expect(sessao.getItem('macuxi.web.token')).toBe('acesso-antigo');
  });

  it('saída ou outro login em outra aba (usuário do localStorage mudou): o token desta aba deixa de valer', async () => {
    const s = await carregar();
    s.saveSession('acesso-1', USUARIO);
    local.setItem('macuxi.web.user', JSON.stringify({ ...USUARIO, id: 'u2' }));
    expect(s.getToken()).toBeNull();
    local.removeItem('macuxi.web.user');
    expect(s.getToken()).toBeNull();
    expect(s.instantaneoDaSessao()).toBe('');
  });
});

describe('T-0117: renovação pelo cookie', () => {
  it('renovar manda X-Macuxi-CSRF, corpo vazio e credentials same-origin no caminho do cookie; guarda só o acesso', async () => {
    const s = await carregar();
    s.saveSession('acesso-1', USUARIO);
    respostas.push(json(200, { access_token: 'acesso-2', token_type: 'Bearer', expires_in: 900 }));
    expect(await s.renovarAcesso()).toBe('acesso-2');
    const c = chamadas[0]!;
    expect(c.url).toBe(`${CAMINHO_COOKIE_SESSAO}/refresh`);
    expect((c.init.headers as Record<string, string>)[CABECALHO_CSRF]).toBe('1');
    expect(c.init.body).toBe('{}');
    expect(c.init.credentials).toBe('same-origin');
    expect(s.getToken()).toBe('acesso-2');
    expect(local.getItem('macuxi.web.token')).toBeNull();
  });

  it('uma renovação por vez: duas chamadas juntas fazem um só pedido', async () => {
    const s = await carregar();
    s.saveSession('acesso-1', USUARIO);
    respostas.push(json(200, { access_token: 'acesso-2' }));
    const [a, b] = await Promise.all([s.renovarAcesso(), s.renovarAcesso()]);
    expect([a, b]).toEqual(['acesso-2', 'acesso-2']);
    expect(chamadas).toHaveLength(1);
  });

  it('com navigator.locks, a renovação roda dentro da trava entre abas', async () => {
    const travas: string[] = [];
    vi.stubGlobal('navigator', { locks: { request: async (nome: string, fn: () => Promise<unknown>) => (travas.push(nome), fn()) } });
    const s = await carregar();
    s.saveSession('acesso-1', USUARIO);
    respostas.push(json(200, { access_token: 'acesso-2' }));
    expect(await s.renovarAcesso()).toBe('acesso-2');
    expect(travas).toEqual(['macuxi-refresh']);
  });

  it('401 numa chamada: renova pelo cookie e repete; renovação recusada encerra a sessão', async () => {
    const s = await carregar();
    s.saveSession('acesso-1', USUARIO);
    respostas.push(json(401, { codigo: 'NAO_AUTENTICADO' }), json(200, { access_token: 'acesso-2' }), json(200, { ok: true }));
    expect(await s.api('/clientes')).toEqual({ ok: true });
    expect((chamadas[2]!.init.headers as Record<string, string>).Authorization).toBe('Bearer acesso-2');
    respostas.push(json(401, {}), json(401, { codigo: 'SESSAO_INVALIDA' }));
    await expect(s.api('/clientes')).rejects.toMatchObject({ status: 401 });
    expect(local.getItem('macuxi.web.user')).toBeNull();
  });

  it('login com sessaoWeb manda o cabeçalho CSRF; chamada comum não', async () => {
    const s = await carregar();
    respostas.push(json(200, {}), json(200, {}));
    await s.api('/auth/login', { method: 'POST', body: { codigo_empresa: 'x' }, sessaoWeb: true });
    await s.api('/clientes');
    expect((chamadas[0]!.init.headers as Record<string, string>)[CABECALHO_CSRF]).toBe('1');
    expect((chamadas[1]!.init.headers as Record<string, string>)[CABECALHO_CSRF]).toBeUndefined();
  });
});

describe('T-0117: aba nova se restaura pelo cookie', () => {
  it('usuário guardado e aba sem token: loading, renova e autentica', async () => {
    local.setItem('macuxi.web.user', JSON.stringify(USUARIO));
    const s = await carregar();
    expect(s.instantaneoDaSessao()).toBe('\u0000pendente');
    respostas.push(json(200, { access_token: 'acesso-novo' }));
    await s.restaurarSessao();
    expect(s.instantaneoDaSessao()).toBe('acesso-novo');
    expect(chamadas[0]!.url).toBe(`${CAMINHO_COOKIE_SESSAO}/refresh`);
  });

  it('cookie recusado: a sessão acaba (anônima) e não tenta de novo', async () => {
    local.setItem('macuxi.web.user', JSON.stringify(USUARIO));
    const s = await carregar();
    respostas.push(json(401, { codigo: 'SESSAO_INVALIDA' }));
    await s.restaurarSessao();
    expect(s.instantaneoDaSessao()).toBe('');
    expect(local.getItem('macuxi.web.user')).toBeNull();
    await s.restaurarSessao();
    expect(chamadas).toHaveLength(1);
  });

  it('G2: sem rede (falha do fetch) a sessão fica com o aviso de sem conexão; a nova tentativa autentica', async () => {
    local.setItem('macuxi.web.user', JSON.stringify(USUARIO));
    const s = await carregar();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await s.restaurarSessao();
    expect(s.instantaneoDaSessao()).toBe('\u0000sem_conexao');
    expect(local.getItem('macuxi.web.user')).toBe(JSON.stringify(USUARIO));
    // sem nova tentativa sozinha: só pela rede, pelo foco ou pelo botão
    await s.restaurarSessao();
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => (chamadas.push({ url, init }), json(200, { access_token: 'acesso-novo' })));
    await s.tentarRestaurarSessao();
    expect(s.instantaneoDaSessao()).toBe('acesso-novo');
    expect(chamadas).toHaveLength(1);
  });

  it('G2: tempo esgotado e servidor fora (5xx) também mantêm a sessão; só 401/423 encerram', async () => {
    vi.useFakeTimers();
    try {
      local.setItem('macuxi.web.user', JSON.stringify(USUARIO));
      const s = await carregar();
      vi.stubGlobal(
        'fetch',
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_ok, falha) => init.signal?.addEventListener('abort', () => falha(new DOMException('abortado', 'AbortError')))),
      );
      const restaurando = s.restaurarSessao();
      await vi.advanceTimersByTimeAsync(s.TEMPO_LIMITE_RENOVACAO_MS);
      await restaurando;
      expect(s.instantaneoDaSessao()).toBe('\u0000sem_conexao');

      vi.stubGlobal('fetch', async () => json(502, {}));
      await s.tentarRestaurarSessao();
      expect(s.instantaneoDaSessao()).toBe('\u0000sem_conexao');
      expect(local.getItem('macuxi.web.user')).not.toBeNull();

      vi.stubGlobal('fetch', async () => json(423, { codigo: 'USUARIO_BLOQUEADO' }));
      await s.tentarRestaurarSessao();
      expect(s.instantaneoDaSessao()).toBe('');
      expect(local.getItem('macuxi.web.user')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('G2: renovarSessaoWeb separa recusa de falta de conexão (aviso em português, sem endereço técnico)', async () => {
    const s = await carregar();
    s.saveSession('acesso-1', USUARIO);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await s.renovarSessaoWeb()).toEqual({ tipo: 'sem_conexao', mensagem: s.mensagemSemConexao('v1') });
    vi.stubGlobal('fetch', async () => json(401, {}));
    expect(await s.renovarSessaoWeb()).toEqual({ tipo: 'recusada' });
  });

  it('G2: 401 numa chamada com a renovação sem rede: erro de conexão e a sessão fica', async () => {
    const s = await carregar();
    s.saveSession('acesso-1', USUARIO);
    let n = 0;
    vi.stubGlobal('fetch', async () => {
      n += 1;
      if (n === 1) return json(401, { codigo: 'NAO_AUTENTICADO' });
      throw new TypeError('Failed to fetch');
    });
    await expect(s.api('/clientes')).rejects.toMatchObject({ status: 0, code: 'network', message: s.mensagemSemConexao('v1') });
    expect(local.getItem('macuxi.web.user')).toBe(JSON.stringify(USUARIO));
  });

  it('G2: duas restaurações juntas (e a renovação de outra chamada) fazem um só pedido, dentro da trava entre abas', async () => {
    const travas: string[] = [];
    vi.stubGlobal('navigator', { locks: { request: async (nome: string, fn: () => Promise<unknown>) => (travas.push(nome), fn()) } });
    local.setItem('macuxi.web.user', JSON.stringify(USUARIO));
    const s = await carregar();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await s.restaurarSessao();
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => (chamadas.push({ url, init }), json(200, { access_token: 'acesso-novo' })));
    await Promise.all([s.tentarRestaurarSessao(), s.tentarRestaurarSessao(), s.renovarAcesso()]);
    expect(chamadas).toHaveLength(1);
    expect(travas).toEqual(['macuxi-refresh', 'macuxi-refresh']);
    expect(s.instantaneoDaSessao()).toBe('acesso-novo');
  });

  it('sem usuário guardado: anônima, sem chamar a API', async () => {
    const s = await carregar();
    expect(s.instantaneoDaSessao()).toBe('');
    await s.restaurarSessao();
    expect(chamadas).toHaveLength(0);
  });
});

describe('T-0117: sair', () => {
  it('limpa a sessão e chama o logout no modo cookie (a API revoga e apaga o cookie)', async () => {
    const s = await carregar();
    s.saveSession('acesso-1', USUARIO);
    respostas.push(json(200, {}));
    await s.encerrarSessaoWeb();
    expect(s.getToken()).toBeNull();
    expect(local.getItem('macuxi.web.user')).toBeNull();
    expect(chamadas[0]!.url).toBe(`${CAMINHO_COOKIE_SESSAO}/logout`);
    expect((chamadas[0]!.init.headers as Record<string, string>)[CABECALHO_CSRF]).toBe('1');
  });

  it('sem rede: a sessão local sai do mesmo jeito', async () => {
    const s = await carregar();
    s.saveSession('acesso-1', USUARIO);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('rede');
    });
    await expect(s.encerrarSessaoWeb()).resolves.toBeUndefined();
    expect(s.getToken()).toBeNull();
  });
});

describe('T-0117: um só caminho de cookie', () => {
  it('o caminho do cookie é o PROXY_BASE + /auth (onde o BKO chama as rotas de sessão)', async () => {
    const s = await carregar();
    expect(CAMINHO_COOKIE_SESSAO).toBe(`${s.PROXY_BASE}/auth`);
  });
});
