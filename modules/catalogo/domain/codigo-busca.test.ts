import { describe, expect, it } from 'vitest';
import { textoPareceCodigo } from './codigo-busca';

describe('RN-CAT-03: texto que parece código não gasta a IA', () => {
  it('RN-CAT-03: SKU com ponto, hífen, barra e dígito parece código', () => {
    for (const t of ['PAF.0503', 'abc-123', 'ABC/12', '7891234567895', 'K9', ' PAF.0503 ']) expect(textoPareceCodigo(t), t).toBe(true);
  });
  it('RN-CAT-03: frase, palavra sem dígito e texto vazio não parecem código', () => {
    for (const t of ['tinta branca', 'parafuso 8mm inox', 'parafuso', 'pf 0503', '', '   ', '---', '...']) expect(textoPareceCodigo(t), t).toBe(false);
  });
  it('RN-CAT-03: caractere fora de letras, dígitos, ponto e hífen (e barra) não é código', () => {
    expect(textoPareceCodigo('preço$1')).toBe(false);
    expect(textoPareceCodigo('café1')).toBe(false);
  });
});
