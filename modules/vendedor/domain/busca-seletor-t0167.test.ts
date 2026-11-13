import { describe, expect, it } from 'vitest';

import { buscaPodeComecar, codigoExatoPrimeiro, paginaDaBusca } from './busca-seletor';

describe('T-0167: busca do Novo pedido', () => {
  it('RF-CAT-01: a busca só começa com 3 letras', () => {
    expect(buscaPodeComecar('ag')).toBe(false);
    expect(buscaPodeComecar('  ag ')).toBe(false);
    expect(buscaPodeComecar('agu')).toBe(true);
  });
  it('RF-CAT-01: 87 resultados mostram 20, depois 40, até 87, sem "mais" no fim', () => {
    expect(paginaDaBusca(87, 1)).toEqual({ mostrando: 20, total: 87, temMais: true, texto: 'Mostrando 20 de 87' });
    expect(paginaDaBusca(87, 2).mostrando).toBe(40);
    expect(paginaDaBusca(87, 5)).toMatchObject({ mostrando: 87, temMais: false });
    expect(paginaDaBusca(12, 1)).toMatchObject({ mostrando: 12, temMais: false });
    expect(paginaDaBusca(0, 1)).toMatchObject({ mostrando: 0, temMais: false });
  });
  it('RF-CAT-01: código ou EAN exato vem em 1º; sem exato, a ordem não muda', () => {
    const l = [{ id: '1', erp_code: 'AGU-1500' }, { id: '2', erp_code: 'AGU-500', ean: '789' }, { id: '3', erp_code: 'LPO-400' }];
    expect(codigoExatoPrimeiro(l, 'agu-500').map((p) => p.id)).toEqual(['2', '1', '3']);
    expect(codigoExatoPrimeiro(l, '789').map((p) => p.id)).toEqual(['2', '1', '3']);
    expect(codigoExatoPrimeiro(l, 'agu').map((p) => p.id)).toEqual(['1', '2', '3']);
  });
});
