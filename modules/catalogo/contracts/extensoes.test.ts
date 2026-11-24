import { describe, expect, it } from 'vitest';
import { acoesDaTela, type AcaoProduto } from './index';

const base = { rotulo: 'x', testID: 't', abrir: () => undefined };
const acoes: { id: string; payload: AcaoProduto }[] = [
  { id: 'ambas', payload: base },
  { id: 'so-pedido', payload: { ...base, onde: 'pedido' } },
  { id: 'so-consulta', payload: { ...base, onde: 'consulta' } },
];

describe('extensão produto.acoes: onde a ação aparece (RF-CAT-04)', () => {
  it('RF-CAT-04: dentro do pedido, só as de pedido e as sem "onde"', () => {
    expect(acoesDaTela(acoes, true).map((a) => a.id)).toEqual(['ambas', 'so-pedido']);
  });
  it('RF-CAT-04: na consulta, só as de consulta e as sem "onde"', () => {
    expect(acoesDaTela(acoes, false).map((a) => a.id)).toEqual(['ambas', 'so-consulta']);
  });
  it('RF-CAT-04: lista vazia dá vazio e a entrada não é alterada', () => {
    expect(acoesDaTela([], true)).toEqual([]);
    const copia = [...acoes];
    acoesDaTela(acoes, true);
    expect(acoes).toEqual(copia);
  });
});
