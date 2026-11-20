/**
 * Entrada do menu sem a licença da empresa (ADR 0060, spec docs/design/menu-parametros/spec.md §3): não navega; o balão
 * "Contrate o módulo para usar" é `fixed` à direita do menu (não ocupa lugar na lista), escondido até o ponteiro, o foco, o
 * clique ou Enter/Espaço, e ligado à entrada por `aria-describedby`.
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined }), usePathname: () => '/' }));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: () => undefined }) }));

const { EntradaBloqueada } = await import('./app-shell');
const { TEXTO_SEM_LICENCA } = await import('@/lib/menu-bko');

const ITEM = { href: '/trilhas', label: 'Trilhas', testId: 'nav-treinamento-trilhas' };
const GRUPO = { id: 'treinamento', titulo: 'Treinamento', itens: [ITEM], direto: true, bloqueado: true, testId: ITEM.testId };

describe('entrada bloqueada do menu do BKO (spec §3)', () => {
  const html = renderToStaticMarkup(<EntradaBloqueada grupo={GRUPO} />);

  it('não navega: role link, aria-disabled, foco de teclado e aria-describedby no balão', () => {
    expect(html).toMatch(/role="link" tabindex="0" aria-disabled="true" aria-describedby="menu-dica-treinamento"/);
    expect(html).not.toContain('href=');
  });

  it('o balão é fixo à direita do menu, fora do fluxo da lista, e escondido até o ponteiro, o foco, o clique ou Enter/Espaço', () => {
    const balao = /<div id="menu-dica-treinamento" role="tooltip" hidden=""[^>]*class="([^"]*)"[^>]*>([^<]*)<\/div>/.exec(html);
    expect(balao?.[2]).toBe(TEXTO_SEM_LICENCA);
    expect(balao?.[1]?.split(' ')).toContain('fixed');
    // a entrada e o balão são irmãos: o texto do balão não entra no nome da entrada
    expect(html.startsWith('<div role="link"')).toBe(true);
  });
});
