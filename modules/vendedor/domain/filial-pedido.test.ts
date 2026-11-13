import { describe, expect, it } from 'vitest';

import { dadosFiscaisDaFilial, marcaDoRetrato, nomeDaFilialDoPedido, retratoFilialDoPedido } from './filial-pedido';

const F = { id: '3F2B8C1E-5A4D-4E6F-9A1B-2C3D4E5F6A7B', codigo: '0002', nome: 'Boa Vista', cidade: 'Boa Vista', uf: 'RR', padrao: false, ativo: true, external_id: 'F2' };

describe('T-0149 (RN-CORE-39): retrato da filial no pedido', () => {
  it('RN-CORE-39: o id do retrato vai em minúsculas e o par (filial_id, filial) é coerente', () => {
    const r = retratoFilialDoPedido(F);
    expect(r.filial_id).toBe('3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b');
    expect(r.filial.id).toBe(r.filial_id);
    expect(r.filial).toEqual({ id: r.filial_id, codigo: '0002', nome: 'Boa Vista', cidade: 'Boa Vista', uf: 'RR', external_id: 'F2', padrao: false });
  });
  it('RN-CORE-39: filial sem cidade, UF ou external_id grava nulos (padrão recém-nascida)', () => {
    const r = retratoFilialDoPedido({ ...F, cidade: null, uf: null, external_id: null, padrao: true });
    expect(r.filial).toMatchObject({ cidade: null, uf: null, external_id: null, padrao: true });
  });
  it('RN-CORE-39: o nome na tela é "código · nome/UF" e não inventa o que falta', () => {
    expect(nomeDaFilialDoPedido(retratoFilialDoPedido(F).filial)).toBe('0002 · Boa Vista/RR');
    expect(nomeDaFilialDoPedido({ codigo: '0001', nome: 'Filial padrão', uf: null })).toBe('0001 · Filial padrão');
    expect(nomeDaFilialDoPedido(null)).toBe('');
    expect(nomeDaFilialDoPedido({})).toBe('');
  });
  it('T-0159: o retrato leva CNPJ, endereço e telefone da filial (a data do pedido) e dadosFiscaisDaFilial os devolve; sem nada, nulo', () => {
    const r = retratoFilialDoPedido({ ...F, cnpj: '12345678000271', logradouro: 'Rua Cecília Brasil', numero: '450', bairro: 'Centro', telefone: '9532241000' });
    expect(r.filial).toMatchObject({ cnpj: '12345678000271', logradouro: 'Rua Cecília Brasil', telefone: '9532241000' });
    expect(dadosFiscaisDaFilial(r.filial)).toEqual({ nome: F.nome, cnpj: '12345678000271', logradouro: 'Rua Cecília Brasil', numero: '450', bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', telefone: '9532241000' });
    expect(dadosFiscaisDaFilial(retratoFilialDoPedido(F).filial)).toBeNull();
    expect(dadosFiscaisDaFilial(null)).toBeNull();
  });
  it('T-0159: a marca do item é aparada, cortada em 100 e vazia vira nulo (0060)', () => {
    expect(marcaDoRetrato('  Serra Alta ')).toBe('Serra Alta');
    expect(marcaDoRetrato('x'.repeat(150))).toHaveLength(100);
    expect(marcaDoRetrato('   ')).toBeNull();
    expect(marcaDoRetrato(undefined)).toBeNull();
  });
});
