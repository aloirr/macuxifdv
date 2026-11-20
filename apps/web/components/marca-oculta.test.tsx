/**
 * Item 15 do teste de campo do Campo v1.0.16 — no BKO, com a logomarca do Macuxi oculta pela empresa (`empresa_ocultar_marca_macuxi`)
 * e a logo dela, a marca do menu mostra só a logo do cliente; sem a logo ou com a chave desligada, a do Macuxi continua.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined }), usePathname: () => '/' }));
vi.mock('next/link', () => ({ default: ({ children }: { children: unknown }) => children }));

const { Brand } = await import('./app-shell');

// a regra "chave ligada + logo presente" é a `logoQueSubstituiAMarca` do SDK, testada lá (RD-1326)
describe('item 15: logomarca do Macuxi oculta no BKO', () => {
  it('marca do menu com a logo do cliente: só ela, na placa branca, lida como "Logo da <empresa>"', () => {
    const html = renderToStaticMarkup(<Brand company="Exemplo Norte" logoCliente="blob:logo" />);
    expect(html).toContain('data-testid="menu-bko.logo-cliente"');
    expect(html).toMatch(/<img src="blob:logo" alt="Logo da Exemplo Norte"/);
    expect(html).not.toContain('Macuxi Força de Vendas');
  });

  it('sem a logo do cliente: a do Macuxi, como hoje', () => {
    const html = renderToStaticMarkup(<Brand company="Exemplo Norte" />);
    expect(html).toContain('alt="Macuxi Força de Vendas"');
    expect(html).not.toContain('menu-bko.logo-cliente');
  });
});
