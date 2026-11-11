import { describe, expect, it } from 'vitest';
import { depositosDaFilial, saldoPorProdutoDaFilial } from './estoque-filial';

const dep = (id: string, filial_id: string | null) => ({ id, filial_id });
const saldo = (deposito_id: string, produto_id: string, quantidade: number) => ({ deposito_id, produto_id, quantidade });
const DEPS = [dep('d1', 'fA'), dep('d2', 'fA'), dep('d3', 'fB')];

describe('RN-VEN-20 / RN-CORE-39: saldo do produto na filial (catalogo.estoque_filial@1)', () => {
  it('RN-VEN-20: tenant com depósito ligado a filial usa só os depósitos da filial do pedido', () => {
    expect(depositosDaFilial(DEPS, 'fA')).toEqual(new Set(['d1', 'd2']));
  });
  it('RN-CORE-39: pedido sem filial soma todos os depósitos (comportamento anterior)', () => {
    expect(depositosDaFilial(DEPS, null)).toEqual(new Set(['d1', 'd2', 'd3']));
  });
  it('RN-VEN-20: tenant legado, sem depósito ligado a filial, soma todos os depósitos', () => {
    expect(depositosDaFilial([dep('d1', null), dep('d2', null)], 'fA')).toEqual(new Set(['d1', 'd2']));
  });
  it('RN-VEN-20: filial sem depósito num tenant com filiais tem disponível 0 (conjunto vazio)', () => {
    const validos = depositosDaFilial(DEPS, 'fZ');
    expect(validos.size).toBe(0);
    expect(saldoPorProdutoDaFilial(['p1'], validos, [saldo('d1', 'p1', 5)])).toEqual([{ produto_id: 'p1', quantidade_base: 0 }]);
  });
  it('RN-VEN-20: soma os depósitos da filial na unidade base e ignora os de outra filial', () => {
    const r = saldoPorProdutoDaFilial(['p1'], depositosDaFilial(DEPS, 'fA'), [saldo('d1', 'p1', 4), saldo('d2', 'p1', 6), saldo('d3', 'p1', 100)]);
    expect(r).toEqual([{ produto_id: 'p1', quantidade_base: 10 }]);
  });
  it('RN-VEN-20: produto com saldo só em outra filial sai com 0 nesta filial', () => {
    const r = saldoPorProdutoDaFilial(['p2'], depositosDaFilial(DEPS, 'fA'), [saldo('d3', 'p2', 9)]);
    expect(r).toEqual([{ produto_id: 'p2', quantidade_base: 0 }]);
  });
  it('RN-VEN-20: produto sem nenhuma linha de saldo no tenant é sem controle e fica fora da saída', () => {
    const r = saldoPorProdutoDaFilial(['p1', 'p3'], depositosDaFilial(DEPS, 'fA'), [saldo('d1', 'p1', 3)]);
    expect(r).toEqual([{ produto_id: 'p1', quantidade_base: 3 }]);
  });
  it('RN-VEN-20: saldo negativo vira zero e produto repetido na entrada sai uma vez', () => {
    const r = saldoPorProdutoDaFilial(['p1', 'p1'], new Set(['d1']), [saldo('d1', 'p1', -5)]);
    expect(r).toEqual([{ produto_id: 'p1', quantidade_base: 0 }]);
  });
});
