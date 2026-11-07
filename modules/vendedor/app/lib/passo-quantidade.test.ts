import { describe, expect, it } from 'vitest';

import { quantidadePorPasso } from './valor-pendente';

describe('toque no + e no − do item (T-0089)', () => {
  it('RN-VEN-02: três toques no + partem de 0 e chegam a 3, mesmo antes da tela redesenhar; total = 3 × preço', () => {
    const preco = 1851; // R$ 18,51
    const estado = { texto: '0', focado: false, qtd: 0 };
    for (let i = 0; i < 3; i++) estado.qtd = quantidadePorPasso(estado, 1);
    expect(estado.qtd).toBe(3);
    expect(estado.qtd * preco).toBe(5553);
  });
  it('o − reduz e para em 0; com o teclado aberto vale o que está digitado', () => {
    expect(quantidadePorPasso({ texto: '3', focado: false, qtd: 3 }, -1)).toBe(2);
    expect(quantidadePorPasso({ texto: '', focado: false, qtd: 0 }, -1)).toBe(0);
    expect(quantidadePorPasso({ texto: '7', focado: true, qtd: 3 }, 1)).toBe(8);
    expect(quantidadePorPasso({ texto: '0', focado: true, qtd: 5 }, 1)).toBe(1);
  });
});
