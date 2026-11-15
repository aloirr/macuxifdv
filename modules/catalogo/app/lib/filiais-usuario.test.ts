import { describe, expect, it } from 'vitest';
import { lerFiliaisDeVendaDaLinha } from './filiais-usuario';

// RN-CORE-39: um adaptador só para a linha `usuario` do sync
describe('adaptador das filiais da linha usuario (RN-CORE-39)', () => {
  it('RN-CORE-39 / decisão 2 do R-20261115-100000: lê filial_venda_ids e a filial de cadastro (só para a faixa; nunca entra no estoque)', () => {
    expect(lerFiliaisDeVendaDaLinha({ filial_cadastro_id: 'c', filial_venda_ids: ['a', 'b'], sem_filial: false })).toEqual({ filiaisVenda: ['a', 'b'], filialCadastro: 'c', semFilial: false });
    expect(lerFiliaisDeVendaDaLinha({ filial_venda_ids: ['a'] })).toEqual({ filiaisVenda: ['a'], filialCadastro: null, semFilial: false });
  });
  it('RN-CORE-39: sem_filial vale mesmo sem lista; sem lista e sem a marca = emissor antigo (null)', () => {
    expect(lerFiliaisDeVendaDaLinha({ sem_filial: true })).toEqual({ filiaisVenda: [], filialCadastro: null, semFilial: true });
    expect(lerFiliaisDeVendaDaLinha({ id: 'u' })).toBeNull();
    expect(lerFiliaisDeVendaDaLinha({ filial_ids: ['a'] })).toBeNull(); // o nome antigo não existe mais
  });
});
