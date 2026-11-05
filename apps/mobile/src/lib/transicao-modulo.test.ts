/**
 * T-0072: avançar lateral (240 ms) nas telas de módulo do shell, sem animação na troca de aba e nenhum deslocamento
 * com "reduzir movimento" (docs/design/componentes.md §6). A pilha por aba é testada em historico-telas.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { animacaoDeEntrada, chaveDaRota, FRACAO_DESLOCAMENTO } from './transicao-modulo';

describe('chave da rota de módulo', () => {
  it('caminho + parâmetros em ordem, sem o próprio caminho', () => {
    expect(chaveDaRota(['pedido'], { caminho: ['pedido'], id: '7', aba: 'itens' })).toBe('pedido?aba=itens&id=7');
    expect(chaveDaRota('pedidos', {})).toBe('pedidos');
    expect(chaveDaRota(['treinamento', 'licao'], { caminho: ['treinamento', 'licao'], x: undefined })).toBe('treinamento/licao');
    expect(chaveDaRota(undefined, {})).toBe('');
  });
  it('sem parâmetros nulos nem os internos do expo-router', () => {
    expect(chaveDaRota(['pedido'], { id: '7', filtro: null, __internal_expo_router_no_animation: 'true' })).toBe('pedido?id=7');
  });
});

describe('animação de entrada', () => {
  it('avançar entra pela direita e voltar pela esquerda, em 240 ms', () => {
    expect(animacaoDeEntrada('avancar', 400, false)).toEqual({ deslocamento: 400 * FRACAO_DESLOCAMENTO, duracaoMs: 240 });
    expect(animacaoDeEntrada('voltar', 400, false)).toEqual({ deslocamento: -400 * FRACAO_DESLOCAMENTO, duracaoMs: 240 });
    expect(animacaoDeEntrada('nenhuma', 400, false)).toEqual({ deslocamento: 0, duracaoMs: 0 });
  });
  it('com "reduzir movimento" nada se desloca', () => {
    expect(animacaoDeEntrada('avancar', 400, true)).toEqual({ deslocamento: 0, duracaoMs: 0 });
    expect(animacaoDeEntrada('voltar', 400, true)).toEqual({ deslocamento: 0, duracaoMs: 0 });
  });
});
