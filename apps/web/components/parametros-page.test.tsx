/**
 * Página Parâmetros do BKO (ADR 0060, spec docs/design/menu-parametros/spec.md §2–§3): título único, sem lista de seções (a
 * escolha fica no menu), painel do módulo dentro de `Panel` com a âncora, página em transição como está e seção sem licença só com o aviso.
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const estado: { parametros: unknown[]; navegacao: unknown[] } = { parametros: [], navegacao: [] };
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined }),
  notFound: () => {
    throw new Error('404');
  },
}));
vi.mock('next/link', () => ({ default: ({ children, href, ...p }: { children: ReactNode; href: string }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@macuxi/platform-sdk/react', () => ({ useVisaoShell: () => estado }));

const { PaginaParametros } = await import('./parametros-page');
const { TEXTO_SEM_LICENCA } = await import('@/lib/menu-bko');

const Farol = () => <span>conteúdo do farol</span>;
const Plano = () => <span>página do plano</span>;
const painel = (modulo: string, id: string, titulo: string, origem: 'painel' | 'pagina', componente: () => ReactNode) => ({
  modulo,
  id,
  titulo,
  ancora: `${modulo}-${id}`,
  testID: `parametros-${modulo}-${id}`,
  origem,
  componente,
});
estado.parametros = [
  { secao: 'clientes', rotulo: 'Clientes', caminho: 'parametros/clientes', bloqueado: false, paineis: [painel('core', 'farol', 'Farol', 'painel', Farol)] },
  { secao: 'metas-e-rv', rotulo: 'Metas e RV', caminho: 'parametros/metas-e-rv', bloqueado: false, paineis: [painel('core', 'plano-rv', 'Plano de RV', 'pagina', Plano)] },
  { secao: 'pesquisa', rotulo: 'Pesquisa', caminho: 'parametros/pesquisa', bloqueado: true, paineis: [] },
];

describe('página Parâmetros (ADR 0060)', () => {
  it('seção com painel: título "Parâmetros", painel com âncora e título, sem lista de seções (a escolha fica no menu)', () => {
    const html = renderToStaticMarkup(<PaginaParametros segmentos={['clientes']} />);
    expect(html).toContain('Parâmetros');
    expect(html).toContain('data-testid="parametros-conteudo-clientes"');
    expect(html).not.toContain('parametros-secao-');
    expect(html).toMatch(/id="core-farol" data-testid="parametros-core-farol"/);
    expect(html).toContain('Farol');
    expect(html).toContain('conteúdo do farol');
  });

  it('página em transição: como está, com o testID de página, sem título a mais', () => {
    const html = renderToStaticMarkup(<PaginaParametros segmentos={['metas-e-rv']} />);
    expect(html).toContain('data-testid="pagina-core-plano-rv"');
    expect(html).toContain('página do plano');
    expect(html).not.toContain('Plano de RV');
  });

  it('seção sem licença: só o cadeado e "Contrate o módulo para usar"', () => {
    const html = renderToStaticMarkup(<PaginaParametros segmentos={['pesquisa']} />);
    expect(html).toContain('data-testid="parametros-sem-licenca"');
    expect(html).toContain(TEXTO_SEM_LICENCA);
  });

  it('seção inexistente ou endereço com mais de um segmento: 404', () => {
    expect(() => renderToStaticMarkup(<PaginaParametros segmentos={['nao-existe']} />)).toThrow('404');
    expect(() => renderToStaticMarkup(<PaginaParametros segmentos={['clientes', 'x']} />)).toThrow('404');
  });
});
