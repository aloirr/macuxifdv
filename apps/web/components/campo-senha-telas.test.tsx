/**
 * R-20261115-071000 (dono do produto, 15/11/2026: "Padrão da senha é o olho para mostrar e ocultar"): os campos de senha do shell
 * web usam o `CampoSenha` do kit (spec docs/design/campo-senha/spec.md). Renderizado com `react-dom/server`:
 * - login do BKO, "Crie sua senha" e Entrar do portal têm o olho só em ícone, com "Mostrar senha" no leitor de tela;
 * - "Crie sua senha": um olho só (no "Senha nova") para os dois campos, ambos `new-password`;
 * - nenhum texto "Esconder senha" sobra na tela.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/login',
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ clear: () => undefined }),
  useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  useMutation: () => ({ mutate: () => undefined, isPending: false }),
}));
vi.mock('@macuxi/platform-sdk/web', async (original) => ({
  ...(await original<typeof import('@macuxi/platform-sdk/web')>()),
  MODO_API: 'real',
}));
vi.mock('@macuxi/ui/web', async (original) => ({
  ...(await original<typeof import('@macuxi/ui/web')>()),
  useToast: () => () => undefined,
}));

import { CrieSuaSenha } from './ciclo-senha';
import { LoginScreen } from './login-screen';
import { TelaEntrar } from './portal/tela-entrar';

const contar = (html: string, trecho: string) => html.split(trecho).length - 1;

describe('campo de senha com olho (CampoSenha do kit)', () => {
  it('login do BKO: senha oculta, olho "Mostrar senha" e current-password', () => {
    const html = renderToStaticMarkup(<LoginScreen />);
    expect(html).toContain('data-testid="login.senha"');
    expect(html).toContain('data-testid="login.senha.olho"');
    expect(html).toContain('aria-label="Mostrar senha"');
    expect(html).toMatch(/<input[^>]*type="password"[^>]*autoComplete="current-password"|<input[^>]*autoComplete="current-password"[^>]*type="password"/);
    expect(html).not.toContain('Esconder senha');
  });

  it('"Crie sua senha": um olho só, no "Senha nova", e os dois campos new-password', () => {
    const html = renderToStaticMarkup(<CrieSuaSenha codigoEmpresa="ACME01" email="ana@empresa.com.br" motivo="primeiro_acesso" onSalvar={async () => undefined} onVoltarAoLogin={() => undefined} />);
    expect(html).toContain('data-testid="crie-senha.nova.olho"');
    expect(html).not.toContain('crie-senha.repita.olho');
    expect(contar(html, 'aria-label="Mostrar senha"')).toBe(1);
    expect(contar(html, 'type="password"')).toBe(2);
    expect(contar(html, 'autoComplete="new-password"')).toBe(2);
    expect(html).not.toContain('Esconder senha');
  });

  it('portal, Entrar: o olho do kit no campo de senha', () => {
    const html = renderToStaticMarkup(<TelaEntrar />);
    expect(html).toContain('data-testid="entrar.senha.olho"');
    expect(html).toContain('aria-label="Mostrar senha"');
    expect(html).not.toContain('Esconder senha');
  });

  it('T-0185: a senha do login do BKO e do Entrar do portal vai sem maiúscula automática nem corretor', () => {
    for (const [html, id] of [
      [renderToStaticMarkup(<LoginScreen />), 'login.senha'],
      [renderToStaticMarkup(<TelaEntrar />), 'entrar.senha'],
    ] as const) {
      const input = html.match(new RegExp(`<input[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? '';
      expect(input).toContain('autoCapitalize="none"');
      expect(input).toContain('autoCorrect="off"');
      expect(input).toContain('spellCheck="false"');
    }
  });
});
