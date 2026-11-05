/** T-0079: base recriada no servidor. O que o aparelho preserva antes de apagar a cópia local. Funções puras. */
import { describe, expect, it } from 'vitest';
import { chavesAApagarNaBaseRecriada, planoBaseRecriada, type ItemDaFila } from './base-recriada';

const item = (id: string, entidade: string, situacao: ItemDaFila['situacao'] = 'pendente'): ItemDaFila => ({ id, entidade, situacao });

describe('RN-CORE-23: base recriada preserva a fila de pedidos e orçamentos não enviados', () => {
  it('pedidos pendentes e com falha ficam na fila; nenhum se perde', () => {
    const plano = planoBaseRecriada({
      fila: [item('a', 'pedido'), item('b', 'pedido', 'falhou'), item('c', 'pedido', 'modulo_inativo')],
      exibicoes: { a: { x: 1 }, b: { x: 2 }, z: { x: 9 } },
      rascunhos: {},
    });
    expect(plano.fila_preservada.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(plano.reenviar_primeiro).toBe(true);
  });
  it('só as exibições dos itens da fila sobrevivem; as do servidor somem', () => {
    const plano = planoBaseRecriada({ fila: [item('a', 'pedido')], exibicoes: { a: { x: 1 }, z: { x: 9 } }, rascunhos: {} });
    expect(Object.keys(plano.exibicoes_preservadas)).toEqual(['a']);
  });
  it('rascunhos (pedido ou orçamento ainda não enviado) são preservados inteiros', () => {
    const plano = planoBaseRecriada({ fila: [], exibicoes: {}, rascunhos: { r1: { lines: [] }, r2: { lines: [1] } } });
    expect(Object.keys(plano.rascunhos_preservados)).toEqual(['r1', 'r2']);
  });
  it('item já aceito pelo servidor antigo também é preservado, marcado para conferência (a base nova não o tem)', () => {
    const plano = planoBaseRecriada({ fila: [item('a', 'pedido', 'aceito')], exibicoes: {}, rascunhos: {} });
    expect(plano.fila_preservada).toHaveLength(1);
    expect(plano.conferir_aceitos).toEqual(['a']);
  });
  it('itens de outras entidades (checkout de visita etc.) não são do Vendedor: ficam fora do plano', () => {
    const plano = planoBaseRecriada({ fila: [item('v', 'visita_checkout'), item('a', 'pedido')], exibicoes: {}, rascunhos: {} });
    expect(plano.fila_preservada.map((i) => i.id)).toEqual(['a']);
  });
  it('fila vazia: não há o que reenviar primeiro', () => {
    const plano = planoBaseRecriada({ fila: [], exibicoes: {}, rascunhos: {} });
    expect(plano.reenviar_primeiro).toBe(false);
    expect(plano.fila_preservada).toEqual([]);
  });
  it('a entrada não é alterada', () => {
    const fila = [item('a', 'pedido')];
    const copia = JSON.stringify(fila);
    planoBaseRecriada({ fila, exibicoes: {}, rascunhos: {} });
    expect(JSON.stringify(fila)).toBe(copia);
  });
});

describe('RN-CORE-23: o que o Vendedor apaga do aparelho quando a base é recriada', () => {
  it('apaga a cópia do servidor (pedidos, detalhes, últimos, clientes, produtos...) e nunca rascunhos nem exibições da fila', () => {
    const apagar = chavesAApagarNaBaseRecriada(['me', 'politica', 'clientes', 'produtos', 'pedidos', 'detalhes', 'rascunhos', 'exibicoes', 'mix', 'ultimos', 'sincronizado_em']);
    expect(apagar).toEqual(['me', 'politica', 'clientes', 'produtos', 'pedidos', 'detalhes', 'mix', 'ultimos', 'sincronizado_em']);
    expect(apagar).not.toContain('rascunhos');
    expect(apagar).not.toContain('exibicoes');
  });
});
