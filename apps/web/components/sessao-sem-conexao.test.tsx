/**
 * T-0117 (revisão G2): o shell do BKO com a sessão `sem_conexao`, renderizado com `react-dom/server`.
 * - sem rede, a aba com o usuário guardado mostra o aviso do SDK e o "Tentar de novo", nunca "Carregando…" nem o login;
 * - o "Tentar de novo" chama `tentarRestaurarSessao()`;
 * - só `anonymous` (401/423) mostra "Indo para o login…".
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const AVISO = 'Sem conexão com o servidor. Confira a internet e tente de novo.';
const USUARIO = { id: '0b8f3c1e-6a1d-4f3a-9a52-1f0f3d6b2c11', name: 'Ana Souza', email: 'ana@empresa.com.br', perfil: 'gerente' as const };

const estado = vi.hoisted(() => ({
  sessao: { status: 'loading', token: null, user: null } as Record<string, unknown>,
  tentar: vi.fn(() => Promise.resolve()),
  replace: vi.fn(),
  props: null as null | { aviso: string; onTentar: () => void },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: estado.replace }), usePathname: () => '/pedidos' }));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: () => undefined }) }));
vi.mock('@/lib/queries', () => ({
  useMe: () => ({ data: undefined, isError: false }),
  useModulosEfetivos: () => ({ data: undefined, isError: false }),
  useModulosContratados: () => undefined,
  useParametrosDosModulos: () => undefined,
  useLogoQueSubstituiAMarca: () => null,
}));
vi.mock('@/lib/session', () => ({ useSessao: () => estado.sessao, encerrarSessao: () => Promise.resolve() }));
vi.mock('@macuxi/platform-sdk/web', async (original) => ({
  ...(await original<typeof import('@macuxi/platform-sdk/web')>()),
  tentarRestaurarSessao: estado.tentar,
}));

// o shell renderiza o componente de verdade; o espião só guarda as props para chamar o onTentar fora da renderização
vi.mock('./sessao-sem-conexao', async (original) => {
  const m = await original<typeof import('./sessao-sem-conexao')>();
  return {
    ...m,
    SessaoSemConexao: (p: { aviso: string; onTentar: () => void }) => {
      estado.props = p;
      return m.SessaoSemConexao(p);
    },
  };
});

const { AppShell } = await import('./app-shell');
const { TEXTO_VOLTA_SOZINHO } = await import('./sessao-sem-conexao');

/** As props que o shell passou ao aviso na última renderização (fora do estreitamento do TypeScript). */
function propsDoAviso(): { aviso: string; onTentar: () => void } | null {
  return estado.props;
}

function renderizarShell(): string {
  return renderToStaticMarkup(
    <AppShell>
      <p>conteúdo da página</p>
    </AppShell>,
  );
}

beforeEach(() => {
  estado.tentar.mockClear();
  estado.replace.mockClear();
});

describe('T-0117 G2: shell do BKO sem conexão', () => {
  it('sem_conexao: aviso do SDK e "Tentar de novo", sem "Carregando…", sem login e sem o conteúdo', () => {
    estado.sessao = { status: 'sem_conexao', token: null, user: USUARIO, aviso: AVISO };
    const html = renderizarShell();
    expect(html).toContain('data-testid="shell-sem-conexao"');
    expect(html).toContain(AVISO);
    expect(html).toContain(TEXTO_VOLTA_SOZINHO);
    expect(html).toContain('data-testid="shell-sem-conexao-tentar"');
    expect(html).toContain('Tentar de novo');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('Carregando…');
    expect(html).not.toContain('Indo para o login…');
    expect(html).not.toContain('conteúdo da página');
  });

  it('"Tentar de novo" chama tentarRestaurarSessao()', () => {
    estado.sessao = { status: 'sem_conexao', token: null, user: USUARIO, aviso: AVISO };
    estado.props = null;
    renderizarShell();
    const props = propsDoAviso();
    expect(props?.aviso).toBe(AVISO);
    props?.onTentar();
    expect(estado.tentar).toHaveBeenCalledTimes(1);
  });

  it('loading (restaurando pelo cookie): "Carregando…"', () => {
    estado.sessao = { status: 'loading', token: null, user: null };
    const html = renderizarShell();
    expect(html).toContain('Carregando…');
    expect(html).not.toContain('shell-sem-conexao');
  });

  it('anonymous (401/423): "Indo para o login…", sem o aviso de sem conexão', () => {
    estado.sessao = { status: 'anonymous', token: null, user: null };
    const html = renderizarShell();
    expect(html).toContain('Indo para o login…');
    expect(html).not.toContain('shell-sem-conexao');
  });
});
