import { describe, expect, it } from 'vitest';
import {
  MSG_PEDIDO_MINIMO_CENTS_API,
  acaoCreditoExcedido,
  acaoEstoqueInsuficiente,
  pedidoMinimoCents,
  tituloVencidoDias,
  validadeOrcamentoDias,
  validarAcaoCreditoExcedido,
  validarAcaoEstoqueInsuficiente,
  validarPedidoMinimoCents,
  validarTituloVencidoDias,
  validarValidadeOrcamentoDias,
} from './index';
import { abaixoDoPedidoMinimo, mensagemPedidoMinimo } from './pedido-minimo';

describe('RN-VEN-13: titulo_vencido_dias', () => {
  it('RN-VEN-13: aceita inteiro de 0 a 365 e recusa o resto, citando a regra', () => {
    for (const v of [0, 5, 365]) expect(validarTituloVencidoDias(v)).toEqual({ ok: true, valor: v });
    for (const v of [-1, 366, 2.5, '5', null, undefined, Number.NaN]) expect(validarTituloVencidoDias(v)).toMatchObject({ ok: false, codigo: 'RN-VEN-13' });
  });
  it('RN-VEN-13: o leitor usa a mesma faixa e o padrão é 5', () => {
    expect(tituloVencidoDias({})).toBe(5);
    expect(tituloVencidoDias({ titulo_vencido_dias: 365 })).toBe(365);
    expect(tituloVencidoDias({ titulo_vencido_dias: 366 })).toBe(5);
  });
});

describe('RN-VEN-18: validade_orcamento_dias', () => {
  it('RN-VEN-18: aceita inteiro de 1 a 90 e recusa o resto, citando a regra', () => {
    for (const v of [1, 7, 90]) expect(validarValidadeOrcamentoDias(v)).toEqual({ ok: true, valor: v });
    for (const v of [0, 91, 1.5, '7', null, undefined]) expect(validarValidadeOrcamentoDias(v)).toMatchObject({ ok: false, codigo: 'RN-VEN-18' });
  });
  it('RN-VEN-18: o leitor lê a chave nova, ainda aceita a antiga e o padrão é 7', () => {
    expect(validadeOrcamentoDias({})).toBe(7);
    expect(validadeOrcamentoDias({ validade_orcamento_dias: 20 })).toBe(20);
    expect(validadeOrcamentoDias({ 'orcamento.validade_dias': 15 })).toBe(15);
    expect(validadeOrcamentoDias({ validade_orcamento_dias: 20, 'orcamento.validade_dias': 15 })).toBe(20);
    expect(validadeOrcamentoDias({ validade_orcamento_dias: 91 })).toBe(7);
  });
});

describe('RN-VEN-22: pedido_minimo_cents', () => {
  it('RN-VEN-22: aceita 0 (sem mínimo) e inteiro até R$ 100.000,00; recusa o resto citando a regra', () => {
    for (const v of [0, 1, 150000, 10_000_000]) expect(validarPedidoMinimoCents(v)).toEqual({ ok: true, valor: v });
    for (const v of [-1, 10_000_001, 1.5, '1500', null, undefined, Number.NaN]) expect(validarPedidoMinimoCents(v)).toMatchObject({ ok: false, codigo: 'RN-VEN-22' });
    expect(validarPedidoMinimoCents(-1)).toMatchObject({ mensagem: MSG_PEDIDO_MINIMO_CENTS_API });
  });
  it('RN-VEN-22: sem linha vale o padrão 0; valor inválido também cai em 0', () => {
    expect(pedidoMinimoCents({})).toBe(0);
    expect(pedidoMinimoCents({ pedido_minimo_cents: 150000 })).toBe(150000);
    expect(pedidoMinimoCents({ pedido_minimo_cents: 10_000_001 })).toBe(0);
    expect(pedidoMinimoCents({ pedido_minimo_cents: '150000' })).toBe(150000);
  });
  it('RN-VEN-22: abaixo do mínimo só com mínimo ligado e total estritamente menor (igual passa)', () => {
    expect(abaixoDoPedidoMinimo({ total_cents: 99999, minimo_cents: 100000 })).toBe(true);
    expect(abaixoDoPedidoMinimo({ total_cents: 100000, minimo_cents: 100000 })).toBe(false);
    expect(abaixoDoPedidoMinimo({ total_cents: 1, minimo_cents: 0 })).toBe(false);
  });
  it('RN-VEN-22: a mensagem cita o valor em reais', () => {
    expect(mensagemPedidoMinimo(150000).replace(/\s/g, ' ')).toBe('Pedido abaixo do mínimo de R$ 1.500,00. Envie como orçamento ou aumente o pedido.');
  });
});

describe('RN-VEN-12: credito_excedido_acao', () => {
  it('RN-VEN-12: aceita aprovacao, orcamento e avisar; recusa o resto', () => {
    for (const v of ['aprovacao', 'orcamento', 'avisar']) expect(validarAcaoCreditoExcedido(v)).toEqual({ ok: true, valor: v });
    for (const v of ['cortar', '', 1, null, undefined]) expect(validarAcaoCreditoExcedido(v)).toMatchObject({ ok: false, codigo: 'RN-VEN-12' });
  });
  it('RN-VEN-12: sem linha ou valor inválido vale aprovacao', () => {
    expect(acaoCreditoExcedido({})).toBe('aprovacao');
    expect(acaoCreditoExcedido({ credito_excedido_acao: 'orcamento' })).toBe('orcamento');
    expect(acaoCreditoExcedido({ credito_excedido_acao: 'avisar' })).toBe('avisar');
    expect(acaoCreditoExcedido({ credito_excedido_acao: 'xis' })).toBe('aprovacao');
  });
});

describe('RN-VEN-20: estoque_insuficiente_acao', () => {
  it('RN-VEN-20: aceita orcamento, aprovacao e avisar; recusa o resto (sem "cortar")', () => {
    for (const v of ['orcamento', 'aprovacao', 'avisar']) expect(validarAcaoEstoqueInsuficiente(v)).toEqual({ ok: true, valor: v });
    for (const v of ['cortar', '', 0, null, undefined]) expect(validarAcaoEstoqueInsuficiente(v)).toMatchObject({ ok: false, codigo: 'RN-VEN-20' });
  });
  it('RN-VEN-20: sem linha ou valor inválido vale orcamento (o comportamento de antes)', () => {
    expect(acaoEstoqueInsuficiente({})).toBe('orcamento');
    expect(acaoEstoqueInsuficiente({ estoque_insuficiente_acao: 'aprovacao' })).toBe('aprovacao');
    expect(acaoEstoqueInsuficiente({ estoque_insuficiente_acao: 'avisar' })).toBe('avisar');
    expect(acaoEstoqueInsuficiente({ estoque_insuficiente_acao: 'cortar' })).toBe('orcamento');
  });
});
