import { describe, expect, it } from 'vitest';
import { lerFiliaisDeVenda } from './filiais-core';

const A = '0f000000-0000-4000-8000-00000000000a';
const B = '0f000000-0000-4000-8000-00000000000b';
const C = '0f000000-0000-4000-8000-00000000000c';

// RN-CORE-39: o Catálogo lê só as filiais de venda de core.filiais_do_usuario@1 (contrato final d3ac6d8cc; um adaptador só)
describe('adaptador de core.filiais_do_usuario@1 (RN-CORE-39)', () => {
  it('RN-CORE-39: lê filial_venda_ids e ignora a filial de cadastro', () => {
    expect(lerFiliaisDeVenda({ filial_cadastro_id: C, filial_venda_ids: [B, A, C], sem_filial: false })).toEqual({ filiaisVenda: [A, B, C], semFilial: false });
  });
  it('RN-CORE-39: sem_filial verdadeiro ou lista vazia = sem filial', () => {
    expect(lerFiliaisDeVenda({ filial_cadastro_id: null, filial_venda_ids: [], sem_filial: true }).semFilial).toBe(true);
    expect(lerFiliaisDeVenda({ filial_venda_ids: [A], sem_filial: true }).semFilial).toBe(true);
    expect(lerFiliaisDeVenda(undefined)).toEqual({ filiaisVenda: [], semFilial: true });
  });
  it('RN-CORE-39: o nome antigo filial_ids não existe mais (saída fora do contrato = sem filial)', () => {
    expect(lerFiliaisDeVenda({ filial_ids: [A], sem_filial: false })).toEqual({ filiaisVenda: [], semFilial: true });
  });
});
