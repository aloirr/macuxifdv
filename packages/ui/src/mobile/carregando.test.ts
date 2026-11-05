import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ALTURA_CARREGANDO_EMBUTIDO, ALVO_TOQUE, layoutCarregando } from './componentes';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('Loading dentro de cartão (conferência R-20261105-002733)', () => {
  it('tela cheia continua com flex 1 e sem altura mínima (uso atual intacto)', () => {
    expect(layoutCarregando(false)).toEqual({ flex: 1, alignItems: 'center', justifyContent: 'center' });
  });

  it('embutido não estica: sem flex, altura mínima de 96 e centralizado', () => {
    const e = layoutCarregando(true);
    expect(e.flex).toBeUndefined();
    expect(e.minHeight).toBe(ALTURA_CARREGANDO_EMBUTIDO);
    expect(ALTURA_CARREGANDO_EMBUTIDO).toBeGreaterThanOrEqual(2 * ALVO_TOQUE);
    expect(e).toMatchObject({ alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' });
  });

  it('Loading detecta o cartão pelo contexto, aceita `embutido` explícito e só pinta o fundo em tela cheia', () => {
    const ui = ler('./ui.tsx');
    expect(ui).toMatch(/export function Loading\(\{ embutido, testID \}: \{ embutido\?: boolean; testID\?: string \} = \{\}\)/);
    expect(ui).toContain('const compacto = embutido ?? dentroDeCartao;');
    expect(ui).toContain('layoutCarregando(compacto), compacto ? null : { backgroundColor: colors.ground }');
    // o estilo antigo fixo (flex 1 + fundo cinza sempre) não volta
    expect(ui).not.toMatch(/function Loading\(\)[\s\S]{0,200}flex: 1/);
  });

  it('Cartao (nos dois ramos, tocável ou não) e Card antigo avisam os filhos de que estão em cartão', () => {
    const base = ler('./base.tsx');
    expect(base.match(/<DentroDeCartao value>\{children\}<\/DentroDeCartao>/g)).toHaveLength(2);
    expect(base).toMatch(/export function useDentroDeCartao\(\): boolean/);
    const ui = ler('./ui.tsx');
    expect(ui).toMatch(/export function Card\([\s\S]{0,200}<DentroDeCartao value>\{children\}<\/DentroDeCartao>/);
  });
});
