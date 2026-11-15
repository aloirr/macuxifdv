import { describe, expect, it } from 'vitest';
import { lerFiliaisDeVendaDaLinha } from './filiais-usuario';

// RN-CORE-39: um adaptador só para a linha `usuario` do sync
describe('adaptador das filiais da linha usuario (RN-CORE-39)', () => {
  it('RN-CORE-39: lê filial_venda_ids e não usa a de cadastro', () => {
    expect(lerFiliaisDeVendaDaLinha({ filial_cadastro_id: 'c', filial_venda_ids: ['a', 'b'], sem_filial: false })).toEqual({ filiaisVenda: ['a', 'b'], semFilial: false });
  });
  it('RN-CORE-39: sem_filial vale mesmo sem lista; sem lista e sem a marca = emissor antigo (null)', () => {
    expect(lerFiliaisDeVendaDaLinha({ sem_filial: true })).toEqual({ filiaisVenda: [], semFilial: true });
    expect(lerFiliaisDeVendaDaLinha({ id: 'u' })).toBeNull();
    expect(lerFiliaisDeVendaDaLinha({ filial_ids: ['a'] })).toEqual({ filiaisVenda: ['a'], semFilial: false });
  });
});
