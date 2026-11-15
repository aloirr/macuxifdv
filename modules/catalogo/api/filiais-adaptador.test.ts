import { describe, expect, it } from 'vitest';
import { lerFiliaisDeVenda } from './filiais-core';

// RN-CORE-39: o Catálogo lê só as filiais de venda de core.filiais_do_usuario@1 (o nome do campo ainda pode mudar; um adaptador só)
describe('adaptador de core.filiais_do_usuario@1 (RN-CORE-39)', () => {
  it('RN-CORE-39: lê filial_venda_ids e ignora a filial de cadastro', () => {
    expect(lerFiliaisDeVenda({ filial_cadastro_id: 'c', filial_venda_ids: ['b', 'a'], sem_filial: false })).toEqual({ filiaisVenda: ['a', 'b'], semFilial: false });
  });
  it('RN-CORE-39: sem_filial verdadeiro ou lista vazia = sem filial', () => {
    expect(lerFiliaisDeVenda({ filial_cadastro_id: null, filial_venda_ids: [], sem_filial: true }).semFilial).toBe(true);
    expect(lerFiliaisDeVenda({ filial_venda_ids: ['a'], sem_filial: true }).semFilial).toBe(true);
    expect(lerFiliaisDeVenda(undefined)).toEqual({ filiaisVenda: [], semFilial: true });
  });
  it('RN-CORE-39: aceita o nome anterior filial_ids enquanto o Core não migra', () => {
    expect(lerFiliaisDeVenda({ filial_ids: ['a'], sem_filial: false })).toEqual({ filiaisVenda: ['a'], semFilial: false });
  });
});
