/** T-0142 / RF-CAT-09: a aba Catálogo abre pela hierarquia (sem "Ver por linha") e as marcas vêm da entidade do próprio Catálogo. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LeitorLocal } from './local';
import { marcasConcorrentesLocais } from './local';

const fonte = readFileSync(join(__dirname, '..', 'telas', 'catalogo.tsx'), 'utf8');

describe('RF-CAT-09: página inicial do Catálogo no app', () => {
  it('RF-CAT-09: sem o atalho "Ver por linha"; a tela desenha o que a função do domain devolve (a mesma do BKO)', () => {
    expect(fonte).not.toContain('Ver por linha');
    expect(fonte).not.toContain('LinhaAtalho');
    expect(fonte).not.toContain('irParaListaPorLinha');
    expect(fonte).toContain('navegarHierarquia(');
    expect(fonte).not.toContain('lista-por-linha');
    expect(fonte).toMatch(/<ListaNiveis[\s\S]*?rotulo=\{nav\.rotuloPlural\}/);
  });

  it('RF-CAT-09: a busca continua no topo, antes da trilha e dos níveis', () => {
    expect(fonte.indexOf('testID="catalogo-busca"')).toBeGreaterThan(0);
    expect(fonte.indexOf('testID="catalogo-busca"')).toBeLessThan(fonte.indexOf('<ListaNiveis'));
    expect(fonte.indexOf('testID="catalogo-busca"')).toBeLessThan(fonte.indexOf('testID="catalogo-trilha"'));
  });
});

describe('RF-CAT-09: último nível = lista rica única', () => {
  const comum = readFileSync(join(__dirname, '..', 'telas', 'comum.tsx'), 'utf8');
  const indice = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
  it('RF-CAT-09: um só cartão de produto (aplicação, equivale a, etiquetas) e nenhuma tela lista-por-linha', () => {
    expect(fonte).toContain('<CartaoProduto');
    expect(fonte).toContain('extras={extras.get(item.id)}');
    expect(comum).toContain('catalogo-aplicacao-');
    expect(comum).toContain('catalogo-etiquetas-');
    expect(indice).not.toContain('lista-por-linha');
    expect(existsSync(join(__dirname, '..', 'telas', 'lista-por-linha.tsx'))).toBe(false);
  });
});

describe('RN-CAT-13 (ADR 0034): marcas concorrentes no aparelho', () => {
  it('RN-CAT-13: lê a entidade `marca_concorrente` do Catálogo, não a `concorrente` do Promotor', async () => {
    const linhas = vi.fn(async (entidade: string) => (entidade === 'marca_concorrente' ? [{ id: 'm1', nome: 'Cobreq', ativo: true, deleted_at: null }] : []));
    const marcas = await marcasConcorrentesLocais({ linhas } as unknown as LeitorLocal);
    expect(marcas.get('m1')).toEqual({ nome: 'Cobreq', ativo: true });
    expect(linhas).toHaveBeenCalledWith('marca_concorrente');
    expect(linhas).not.toHaveBeenCalledWith('concorrente');
  });
});
