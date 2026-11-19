import { describe, expect, it } from 'vitest';
import { ajustarCentsPeloPrazoPadrao, CONSULTA_PRECO_PRAZO_PADRAO, type FormaDePagamento, type PrazoDePagamento } from './index';

const forma: FormaDePagamento = { id: 'f1', codigo: 'BOL', nome: 'Boleto', ativo: true, ordem: 1 };
const prazo = (pct: number): PrazoDePagamento => ({ id: 'p1', forma_pagamento_id: 'f1', codigo: 'P1', descricao: '28 dias', parcelas_dias: [28], prazo_medio_dias: 28, percentual_ajuste: pct, ordem: 1, ativo: true });
const cliente = { formas_pagamento: null };

describe('RN-VEN-43: vendedor.preco_prazo_padrao@1', () => {
  it('RN-VEN-43: o contrato bate com o que o Catálogo espera (nome, entrada até 1000 e saída)', () => {
    expect(CONSULTA_PRECO_PRAZO_PADRAO.nome).toBe('vendedor.preco_prazo_padrao@1');
    const id = '11111111-1111-4111-8111-111111111111';
    expect(CONSULTA_PRECO_PRAZO_PADRAO.entrada.safeParse({ cliente_id: id, cents: [100, 0] }).success).toBe(true);
    expect(CONSULTA_PRECO_PRAZO_PADRAO.entrada.safeParse({ cliente_id: id, cents: [-1] }).success).toBe(false);
    expect(CONSULTA_PRECO_PRAZO_PADRAO.entrada.safeParse({ cliente_id: id, cents: Array(1001).fill(1) }).success).toBe(false);
  });
  it('RN-VEN-43: desconto de -1,71% e acréscimo de +2,5% do prazo padrão, mesmo tamanho e ordem', () => {
    const base = { cliente, formas: [forma] };
    expect(ajustarCentsPeloPrazoPadrao([1000, 0, 333], { ...base, prazos: [prazo(-1.71)] })).toEqual([983, 0, 327]);
    expect(ajustarCentsPeloPrazoPadrao([1000, 0, 333], { ...base, prazos: [prazo(2.5)] })).toEqual([1025, 0, 341]);
  });
  it('RN-VEN-43: sem cliente, sem prazo padrão ou sem percentual devolve valores iguais', () => {
    expect(ajustarCentsPeloPrazoPadrao([1000, 50], { cliente: null, formas: [forma], prazos: [prazo(5)] })).toEqual([1000, 50]);
    expect(ajustarCentsPeloPrazoPadrao([1000], { cliente, formas: [forma], prazos: [] })).toEqual([1000]);
    expect(ajustarCentsPeloPrazoPadrao([1000], { cliente, formas: [forma], prazos: [prazo(0)] })).toEqual([1000]);
  });
});
