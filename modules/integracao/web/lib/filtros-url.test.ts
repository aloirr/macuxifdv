import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FILTROS_VAZIOS, lerFiltros, paraBusca, urlComFiltros } from './filtros-url';

const LOTE = '3f0c9a8e-1b2d-4c5e-8f90-a1b2c3d4e5f6';

describe('estado do monitor na URL (link compartilhável)', () => {
  it('lê o que é válido e ignora o que não faz sentido', () => {
    expect(lerFiltros('?historico=cliente&lote=' + LOTE)).toEqual({ historico: 'cliente', lote: LOTE });
    expect(lerFiltros('?historico=nada&lote=123')).toEqual(FILTROS_VAZIOS);
    expect(lerFiltros('')).toEqual(FILTROS_VAZIOS);
  });

  it('grava só o que está preenchido e faz ida e volta', () => {
    expect(paraBusca(FILTROS_VAZIOS)).toBe('');
    const f = { historico: 'produto', lote: LOTE };
    expect(paraBusca(f)).toBe(`?historico=produto&lote=${LOTE}`);
    expect(lerFiltros(paraBusca(f))).toEqual(f);
  });

  it('RF-INT-04: no portal, mantém os parâmetros da página (ex.: a aba) e tira só os filtros fechados', () => {
    expect(paraBusca({ historico: 'cliente', lote: '' }, `?aba=integracao&lote=${LOTE}`)).toBe('?aba=integracao&historico=cliente');
    expect(paraBusca(FILTROS_VAZIOS, '?aba=integracao&historico=cliente')).toBe('?aba=integracao');
  });
});

describe('gravação da URL fora da função de atualização do estado (engenheiro-apps v1.0.31)', () => {
  it('RF-INT-04: devolve a URL nova só quando muda algo e mantém a aba do portal', () => {
    expect(urlComFiltros(FILTROS_VAZIOS, { pathname: '/empresas/x', search: '?aba=integracao' })).toBeNull();
    expect(urlComFiltros({ historico: 'cliente', lote: '' }, { pathname: '/empresas/x', search: '?aba=integracao' })).toBe('/empresas/x?aba=integracao&historico=cliente');
    expect(urlComFiltros(FILTROS_VAZIOS, { pathname: '/integracao', search: '?historico=cliente' })).toBe('/integracao');
  });

  it('RF-INT-04: o `replaceState` roda num efeito sobre os filtros, não dentro do `setFiltros`', () => {
    const hook = readFileSync(new URL('./use-filtros.ts', import.meta.url), 'utf8');
    const updater = hook.slice(hook.indexOf('const mudar'));
    expect(updater).not.toMatch(/replaceState/);
    expect(hook).toMatch(/useEffect\(\(\) => \{\s*const url = urlComFiltros\(filtros, window\.location\);[\s\S]*?\}, \[filtros\]\);/);
  });
});
