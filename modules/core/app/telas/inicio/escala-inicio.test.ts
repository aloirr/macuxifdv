/** R-20261114-153500: o Início escala pela janela e pela fonte do sistema e sempre cabe sem rolar nos tamanhos de referência. */
import { ALVO_TOQUE } from '@macuxi/ui/mobile/puro';
import { describe, expect, it } from 'vitest';

import { escalaInicio, FATOR_MINIMO, linhasDaFrase, PISO_LETRA_DP } from './escala-inicio';

const FRASE = 'Cada cliente atendido é uma relação que cresce.';
const TELAS: [number, number][] = [[360, 640], [360, 800], [393, 852], [412, 915]];

describe('R-20261114-153500: escala do Início', () => {
  for (const [largura, altura] of TELAS) {
    for (const fontScale of [1, 1.15]) {
      it(`${largura}x${altura} com fonte ${fontScale}: cabe sem rolar, com letra legível e alvos de toque de 48 dp`, () => {
        const e = escalaInicio({ largura, altura, fontScale, topo: 24, base: 24, frase: FRASE });
        expect(e.cabe).toBe(true);
        expect(e.estimada).toBeLessThanOrEqual(e.disponivel);
        expect(e.fator).toBeGreaterThanOrEqual(FATOR_MINIMO);
        for (const corpo of Object.values(e.fonte)) expect(corpo * fontScale).toBeGreaterThanOrEqual(PISO_LETRA_DP - 0.5);
        expect(e.rodape.botao).toBeGreaterThanOrEqual(ALVO_TOQUE);
      });
    }
  }

  it('telas altas ficam na escala cheia (fator 1) e a baixa encolhe', () => {
    expect(escalaInicio({ largura: 412, altura: 915, fontScale: 1, topo: 24, base: 24, frase: FRASE }).fator).toBe(1);
    expect(escalaInicio({ largura: 360, altura: 640, fontScale: 1.15, topo: 24, base: 24, frase: FRASE }).fator).toBeLessThan(1);
  });

  it('a escala é monotônica: janela menor nunca dá fator maior; fonte maior nunca dá fator maior', () => {
    const f = (altura: number, fontScale: number) => escalaInicio({ largura: 360, altura, fontScale, topo: 24, base: 24, frase: FRASE }).fator;
    expect(f(640, 1)).toBeLessThanOrEqual(f(700, 1));
    expect(f(700, 1)).toBeLessThanOrEqual(f(800, 1));
    expect(f(640, 1.15)).toBeLessThanOrEqual(f(640, 1));
  });

  it('janela minúscula ou fonte enorme: fator mínimo e cabe falso (o meio rola em vez de cortar)', () => {
    const e = escalaInicio({ largura: 320, altura: 480, fontScale: 1.5, topo: 24, base: 24, frase: FRASE });
    expect(e.fator).toBe(FATOR_MINIMO);
    expect(e.cabe).toBe(false);
  });

  it('entradas inválidas não quebram (fontScale 0 vira 1)', () => {
    const e = escalaInicio({ largura: 360, altura: 800, fontScale: 0, topo: Number.NaN, base: -3 });
    expect(Number.isFinite(e.estimada)).toBe(true);
  });

  it('frase longa vale 2 linhas e a curta 1; sem frase, 0', () => {
    expect(linhasDaFrase(FRASE, 14, 1, 360)).toBe(1);
    expect(linhasDaFrase(`${FRASE} ${FRASE}`, 14, 1, 360)).toBe(2);
    expect(linhasDaFrase(undefined, 14, 1, 360)).toBe(0);
  });
});
