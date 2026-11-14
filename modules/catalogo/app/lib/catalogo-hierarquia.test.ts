/** T-0173 / RF-CAT-09: a aba Catálogo é a grade de 2 colunas com sistema e categoria em chips (sem "Ver por linha" nem lista de níveis); as marcas vêm da entidade do próprio Catálogo. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LeitorLocal } from './local';
import { marcasConcorrentesLocais } from './local';

const fonte = readFileSync(join(__dirname, '..', 'telas', 'catalogo.tsx'), 'utf8');

describe('T-0173: Catálogo em grade no app', () => {
  it('T-0173: sem o atalho "Ver por linha", sem lista de níveis nem trilha; sistema e categoria são chips', () => {
    expect(fonte).not.toContain('Ver por linha');
    expect(fonte).not.toContain('LinhaAtalho');
    expect(fonte).not.toContain('irParaListaPorLinha');
    expect(fonte).not.toContain('<ListaNiveis');
    expect(fonte).not.toContain('<Trilha');
    expect(fonte).toContain('testID="catalogo-chips-sistema"');
    expect(fonte).toContain('testID="catalogo-chips-categoria"');
  });

  it('T-0173: a busca fica logo abaixo da faixa, antes dos chips e da grade; subtítulo abaixo do título e só o botão Mostrar mais', () => {
    expect(fonte.indexOf('testID="catalogo-busca"')).toBeGreaterThan(0);
    expect(fonte.indexOf('testID="catalogo-busca"')).toBeLessThan(fonte.indexOf('testID="catalogo-chips-sistema"'));
    expect(fonte.indexOf('testID="catalogo-chips-sistema"')).toBeLessThan(fonte.indexOf('<CartaoGrade'));
    expect(fonte).toContain("posicaoSubtitulo: 'abaixo'");
    expect(fonte).toContain('contagem={false}');
    expect(fonte).toContain('sobreFaixa');
  });
});

describe('T-0173: cartão da grade', () => {
  const comum = readFileSync(join(__dirname, '..', 'telas', 'comum.tsx'), 'utf8');
  const indice = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
  it('T-0173: foto de 112 dp (sem foto, caixa vazia: RD-0242), nome, marca, preço "Sem preço" e uma tag de estoque; nenhuma tela lista-por-linha', () => {
    expect(fonte).toContain('<CartaoGrade');
    expect(comum).toContain('altura={112}');
    expect(comum).not.toContain('reserva=');
    expect(comum).not.toContain('inicial');
    expect(comum).toContain('precoDoCartao(preco)');
    expect(comum).not.toContain("'Sem preço'");
    expect(comum).toContain('<ChipEstado');
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
