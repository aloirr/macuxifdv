/**
 * Lista do menu lateral do BKO (spec docs/design/menu-parametros/spec.md §3 e §5; bko-revisao §M3 item 3): sem barra de
 * rolagem em 1366×768. A lista não rola para o lado (overflow-x escondido) e o item de rótulo longo ("Formas de pagamento e
 * prazos", mais largo que os 186 px do texto com a fonte do sistema) quebra a linha em vez de vazar; na sanfona, só o grupo
 * da tela atual abre. Densidade compacta (v1.0.18, notebook 1366×768 com ~650 px úteis): item de 28 px numa linha só, com
 * reticências e o nome completo no `title`.
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

const { MenuLateral, NavLink } = await import('./app-shell');
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

describe('menu lateral do BKO: densidade compacta (v1.0.18)', () => {
  const formas = grupos.find((g) => g.id === 'cadastros')?.itens.find((i) => i.label === 'Formas de pagamento e prazos');
  if (!formas) throw new Error('item Formas de pagamento e prazos fora do fixture');
  const item = (densidade: 'normal' | 'compacta') => renderToStaticMarkup(<NavLink item={formas} active densidade={densidade} />);

  it('nenhum item quebra linha: 28 px (h-7, py-1, 15 px, leading-5), nowrap, rótulo truncado e o nome completo no title', () => {
    const html = item('compacta');
    const [c] = classes(html, /<a [^>]*class="([^"]*)"/g);
    expect(c).toEqual(expect.arrayContaining(['h-7', 'py-1', 'text-[15px]', 'leading-5', 'whitespace-nowrap', 'before:top-1.5', 'before:bottom-1.5']));
    expect(c).not.toContain('min-h-8');
    expect(html).toContain('title="Formas de pagamento e prazos"');
    expect(html).toMatch(/<span class="min-w-0 truncate">Formas de pagamento e prazos<\/span>/);
  });

  it('na normal, o item segue em 32 px no mínimo, quebra a linha e não tem title', () => {
    const html = item('normal');
    const [c] = classes(html, /<a [^>]*class="([^"]*)"/g);
    expect(c).toEqual(expect.arrayContaining(['min-h-8', 'py-1.5', 'text-[15px]', 'before:top-2', 'before:bottom-2']));
    expect(c).not.toContain('whitespace-nowrap');
    expect(html).not.toContain('title=');
  });
});
