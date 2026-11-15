/**
 * Entrada do menu sem a licença da empresa (ADR 0058, spec docs/design/menu-parametros/spec.md §3): o balão "Contrate o
 * módulo para usar" fica na linha logo abaixo da entrada, dentro do menu (nunca fixo sobre o conteúdo), escondido até o
 * ponteiro, o foco ou o clique, e ligado à entrada por `aria-describedby`.
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined }), usePathname: () => '/' }));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: () => undefined }) }));

const { EntradaBloqueada } = await import('./app-shell');
const { TEXTO_SEM_LICENCA } = await import('@/lib/menu-bko');

const ITEM = { href: '/treinamento', label: 'Trilhas', testId: 'nav-treinamento-treinamento' };
const GRUPO = { id: 'treinamento', titulo: 'Treinamento', itens: [ITEM], direto: true, bloqueado: true, testId: ITEM.testId };

describe('entrada bloqueada do menu do BKO (spec §3)', () => {
  const html = renderToStaticMarkup(<EntradaBloqueada grupo={GRUPO} />);

  it('não navega: role link, aria-disabled, foco de teclado e aria-describedby no balão', () => {
    expect(html).toMatch(/role="link" tabindex="0" aria-disabled="true" aria-describedby="menu-dica-treinamento"/);
    expect(html).not.toContain('href=');
  });

  it('o balão fica na linha de baixo, no fluxo do menu, escondido até o ponteiro, o foco ou o clique', () => {
    const balao = /<div id="menu-dica-treinamento" role="tooltip" hidden=""[^>]*class="([^"]*)"[^>]*>([^<]*)<\/div>/.exec(html);
    expect(balao?.[2]).toBe(TEXTO_SEM_LICENCA);
    const classes = balao?.[1]?.split(' ') ?? [];
    expect(classes).not.toContain('fixed');
    expect(classes).not.toContain('absolute');
    expect(classes).toContain('mt-1.5');
    // entrada e balão no mesmo bloco (coluna): o balão nunca sai da largura do menu
    expect(html.startsWith('<div class="flex shrink-0 flex-col">')).toBe(true);
  });
});
