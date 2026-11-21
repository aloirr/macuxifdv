/**
 * Início do BKO em `/` (T-0189, RN-CORE-64): o shell monta o Início do Core só com `inicio_bko.ver`; sem ela, só o título.
 * A lista de páginas que repetia o menu saiu.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const acoes = new Set<string>();
vi.mock('@macuxi/platform-sdk/react', () => ({ useVisaoShell: () => ({ pode: (a: string) => acoes.has(a), navegacao: [{ testID: 'x', caminho: 'pedidos', rotulo: 'Pedidos', bloqueado: false }] }) }));
vi.mock('@macuxi/core/web', () => ({ InicioBkoPage: () => <span>início do core</span> }));

const { PaginaInicio } = await import('./inicio-page');

describe('Início do BKO no shell (T-0189)', () => {
  it('com inicio_bko.ver: monta o Início do Core, sem a lista de páginas', () => {
    acoes.add('inicio_bko.ver');
    const html = renderToStaticMarkup(<PaginaInicio />);
    expect(html).toContain('data-testid="pagina-core-inicio-bko"');
    expect(html).toContain('início do core');
    expect(html).not.toContain('Pedidos');
    expect(html).not.toContain('Páginas disponíveis');
  });

  it('sem inicio_bko.ver: só o título, sem o Início e sem texto explicativo', () => {
    acoes.clear();
    const html = renderToStaticMarkup(<PaginaInicio />);
    expect(html).toContain('data-testid="inicio-sem-acesso"');
    expect(html).toContain('Backoffice');
    expect(html).not.toContain('início do core');
    expect(html).not.toContain('Pedidos');
  });
});
