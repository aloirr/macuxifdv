/**
 * T-0176 (RN-CORE-39; spec docs/design/filial-cadastro-venda §5): "Escolha a sua filial", renderizada com `react-dom/server`.
 * - os estados 16a a 16d com os textos da spec, na moldura do login e sem menu;
 * - `pode_informar=false`: só o aviso aprovado e o "Sair";
 * - o shell com o 403 `USUARIO_SEM_FILIAL` nos módulos abre só esta tela; filial salva → Início (`/`), módulos relidos.
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({
  modulos: { data: undefined, isError: false, error: null } as Record<string, unknown>,
  replace: vi.fn(),
  resetQueries: vi.fn(() => Promise.resolve()),
  removeQueries: vi.fn(),
  clear: vi.fn(),
  encerrar: vi.fn(() => Promise.resolve()),
  props: null as null | { onSalvo: () => void; onSair: () => void },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: estado.replace }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    clear: estado.clear,
    resetQueries: estado.resetQueries,
    removeQueries: estado.removeQueries,
  }),
  useQuery: () => ({ data: undefined, isLoading: true, isError: false, refetch: () => undefined }),
  useMutation: () => ({ mutate: () => undefined, isPending: false }),
}));
vi.mock('@/lib/queries', () => ({
  qk: { modulos: ['me', 'modulos'] },
  useMe: () => ({ data: undefined, isError: false }),
  useModulosEfetivos: () => estado.modulos,
  useModulosContratados: () => undefined,
  useLogoQueSubstituiAMarca: () => null,
}));
vi.mock('@/lib/session', () => ({
  useSessao: () => ({
    status: 'authenticated',
    token: 't',
    user: {
      id: '0b8f3c1e-6a1d-4f3a-9a52-1f0f3d6b2c11',
      name: 'Ana Souza',
      email: 'ana@empresa.com.br',
      perfil: 'admin',
    },
  }),
  encerrarSessao: estado.encerrar,
}));

// o shell renderiza o componente de verdade; o espião só guarda as props para chamar onSalvo/onSair fora da renderização
vi.mock('./escolher-filial', async (original) => {
  const m = await original<typeof import('./escolher-filial')>();
  return {
    ...m,
    EscolherFilial: (p: { onSalvo: () => void; onSair: () => void }) => {
      estado.props = p;
      return m.EscolherFilial(p);
    },
  };
});

const { AppShell } = await import('./app-shell');
const { TelaEscolherFilial } = await import('./escolher-filial');
const { MENSAGEM_USUARIO_SEM_FILIAL } = await import('@macuxi/platform-sdk');
const { TEXTOS_ESCOLHER_FILIAL: T } = await import('@/lib/escolher-filial');

const BV = { id: '7d1c2a4e-2f0b-4c55-9a1e-0b6d1f2e3a01', nome: 'Boa Vista' };
const MAO = { id: '7d1c2a4e-2f0b-4c55-9a1e-0b6d1f2e3a02', nome: 'Manaus' };
const nada = () => undefined;

function tela(o: Partial<Parameters<typeof TelaEscolherFilial>[0]>): string {
  return renderToStaticMarkup(
    <TelaEscolherFilial
      estado="escolher"
      filiais={[BV, MAO]}
      escolhida=""
      salvando={false}
      erroSalvar={false}
      onEscolher={nada}
      onSalvar={nada}
      onTentar={nada}
      onSair={nada}
      {...o}
    />,
  );
}

function propsDaTela(): { onSalvo: () => void; onSair: () => void } | null {
  return estado.props;
}

beforeEach(() => {
  for (const f of [estado.replace, estado.resetQueries, estado.removeQueries, estado.clear, estado.encerrar])
    f.mockClear();
  estado.props = null;
});

describe('Escolha a sua filial (spec §5)', () => {
  it('16a carregando: "Carregando…" no campo sem toque e o Salvar desabilitado', () => {
    const html = tela({ estado: 'carregando', filiais: [] });
    expect(html).toContain('Escolha a sua filial');
    expect(html).toContain('Filial de cadastro');
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*>.*Carregando…/);
    expect(html).toMatch(/<button[^>]*data-testid="filial.salvar"[^>]*disabled=""[^>]*>Salvar</);
    expect(html).toContain('data-testid="filial.sair"');
    expect(html).toContain('alt="Macuxi Força de Vendas"');
    expect(html).toContain('Backoffice');
  });

  it('16b escolher: "Escolha…" no início e as filiais; Salvar liberado com a escolha', () => {
    const html = tela({ escolhida: BV.id });
    expect(html.indexOf('Escolha…')).toBeLessThan(html.indexOf('Boa Vista'));
    expect(html.indexOf('Boa Vista')).toBeLessThan(html.indexOf('Manaus'));
    expect(html).toMatch(/<button[^>]*data-testid="filial.salvar"(?![^>]*disabled)[^>]*>Salvar</);
    expect(html).not.toContain('role="alert"');
    expect(tela({})).toMatch(/data-testid="filial.salvar"[^>]*disabled=""/);
    expect(tela({ escolhida: BV.id, salvando: true })).toContain('Salvando…');
  });

  it('16c empresa sem filial: o aviso e o "Tentar de novo", sem campo e sem Salvar', () => {
    const html = tela({ estado: 'sem_filiais', filiais: [] });
    expect(html).toContain('Envie as filiais pela carga do ERP.');
    expect(html).toContain('data-testid="filial.tentar"');
    expect(html).toContain('Tentar de novo');
    expect(html).not.toContain('filial.campo');
    expect(html).not.toContain('filial.salvar');
  });

  it('16d erro ao salvar: o aviso acima do campo e a escolha continua', () => {
    const html = tela({ escolhida: BV.id, erroSalvar: true });
    expect(html).toContain('Não deu para salvar. Tente de novo.');
    expect(html.indexOf('filial.erro')).toBeLessThan(html.indexOf('filial.campo'));
    expect(html).toMatch(/<option value="7d1c2a4e-2f0b-4c55-9a1e-0b6d1f2e3a01" selected="">Boa Vista/);
  });

  it('pode_informar=false: só o aviso aprovado e o "Sair"', () => {
    const html = tela({ estado: 'sem_permissao', filiais: [] });
    expect(html).toContain(MENSAGEM_USUARIO_SEM_FILIAL);
    expect(html).toContain('data-testid="filial.sair"');
    expect(html).not.toContain(T.titulo);
    expect(html).not.toContain('filial.campo');
    expect(html).not.toContain('filial.salvar');
  });
});

describe('shell do BKO com a conta sem filial', () => {
  it('403 USUARIO_SEM_FILIAL nos módulos: só a tela da filial, sem menu e sem a página', () => {
    estado.modulos = {
      data: undefined,
      isError: true,
      error: new ApiRequestError(403, 'USUARIO_SEM_FILIAL', 'x'),
    };
    const html = renderToStaticMarkup(
      <AppShell>
        <p>conteúdo da página</p>
      </AppShell>,
    );
    expect(html).toContain('data-testid="filial.tela"');
    expect(html).not.toContain('data-testid="menu-bko"');
    expect(html).not.toContain('Trocar perfil');
    expect(html).not.toContain('conteúdo da página');
  });

  it('salvo → Início: relê os módulos e vai para "/"', () => {
    estado.modulos = {
      data: undefined,
      isError: true,
      error: new ApiRequestError(403, 'USUARIO_SEM_FILIAL', 'x'),
    };
    renderToStaticMarkup(<AppShell>x</AppShell>);
    propsDaTela()?.onSalvo();
    expect(estado.removeQueries).toHaveBeenCalledWith({ queryKey: ['core', 'eu', 'filial-cadastro'] });
    expect(estado.resetQueries).toHaveBeenCalledWith({ queryKey: ['me', 'modulos'] });
    expect(estado.replace).toHaveBeenCalledWith('/');
  });

  it('Sair: encerra a sessão e volta ao login', () => {
    estado.modulos = {
      data: undefined,
      isError: true,
      error: new ApiRequestError(403, 'USUARIO_SEM_FILIAL', 'x'),
    };
    renderToStaticMarkup(<AppShell>x</AppShell>);
    propsDaTela()?.onSair();
    expect(estado.encerrar).toHaveBeenCalledTimes(1);
    expect(estado.replace).toHaveBeenCalledWith('/login');
  });

  it('com a filial (módulos carregados): o menu e a página, sem a tela da filial', () => {
    estado.modulos = { data: ['core'], isError: false, error: null };
    const html = renderToStaticMarkup(<AppShell>conteúdo da página</AppShell>);
    expect(html).toContain('data-testid="menu-bko"');
    expect(html).not.toContain('filial.tela');
  });
});
