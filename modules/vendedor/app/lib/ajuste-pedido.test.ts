import { describe, expect, it } from 'vitest';
import { textoDoAjuste, valorDoTexto } from './ajuste-pedido';

describe('RN-VEN-02 (T-0137, T-0165): o campo do desconto/acréscimo do item e do Desc./Acrésc. geral', () => {
  it('RN-VEN-02: textos do campo (% com até 2 casas, R$ com 2 casas, zero = vazio)', () => {
    expect(textoDoAjuste('desc_pct', 1.5)).toBe('1,5');
    expect(textoDoAjuste('desc_reais', 250)).toBe('2,50');
    expect(textoDoAjuste('desc_pct', 0)).toBe('');
  });
  it('RN-VEN-02: o número do texto: % até 100, R$ em centavos; vazio ou inválido = 0', () => {
    expect(valorDoTexto('desc_reais', '0,20')).toBe(20);
    expect(valorDoTexto('desc_pct', '250')).toBe(100);
    expect(valorDoTexto('acresc_pct', '5,1')).toBe(5.1);
    expect(valorDoTexto('desc_pct', '')).toBe(0);
  });
});
