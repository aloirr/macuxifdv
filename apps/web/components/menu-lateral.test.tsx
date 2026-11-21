/**
 * Lista do menu lateral do BKO (spec docs/design/menu-parametros/spec.md §3 e §5; bko-revisao §M3 item 3): sem barra de
 * rolagem em 1366×768. A lista não rola para o lado (overflow-x escondido) e o item de rótulo longo ("Formas de pagamento e
 * prazos", mais largo que os 186 px do texto com a fonte do sistema) quebra a linha em vez de vazar; na sanfona, só o grupo
 * da tela atual abre.
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined }), usePathname: () => '/' }));
vi.mock('next/link', () => ({
  default: ({ children, href, prefetch: _p, ...resto }: { children: ReactNode; href: string; prefetch?: boolean } & Record<string, unknown>) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: () => undefined }) }));

const { MenuLateral } = await import('./app-shell');
const { montarMenuAdmin } = await import('@/lib/menu-bko.fixture');

const { grupos } = montarMenuAdmin();
const classes = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => (m[1] ?? '').split(' '));

describe('menu lateral do BKO: sem barra de rolagem (spec menu-parametros §3)', () => {
  // tela Clientes: sanfona com Cadastros (o maior grupo, 6 itens) aberto
  const html = renderToStaticMarkup(<MenuLateral grupos={grupos} ativo="/clientes" />);

  it('a lista não rola para o lado', () => {
    const [lista] = classes(html, /data-testid="menu-bko-lista" class="([^"]*)"/g);
    expect(lista).toEqual(expect.arrayContaining(['overflow-x-hidden', 'overflow-y-auto']));
  });

  it('só Cadastros aberto, com os 6 itens; item de 32 px no mínimo, que quebra a linha (sem whitespace-nowrap nem altura fixa)', () => {
    const aberto = /<div id="menu-grupo-cadastros"[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? '';
    const itens = classes(aberto, /<a href="[^"]*" data-testid="nav-[^"]*"(?: aria-current="page")? class="([^"]*)"/g);
    expect(itens).toHaveLength(6);
    expect(aberto).toContain('Formas de pagamento e prazos');
    for (const c of itens) {
      expect(c).toEqual(expect.arrayContaining(['min-h-8', 'py-1.5', 'leading-5']));
      expect(c).not.toContain('whitespace-nowrap');
      expect(c).not.toContain('h-8');
    }
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-testid="nav-grupo-cadastros" aria-expanded="true"/);
  });
});
