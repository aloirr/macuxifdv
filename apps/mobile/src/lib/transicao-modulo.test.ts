/**
 * T-0072: avançar lateral (240 ms) nas telas de módulo do shell, sem animação na troca de aba e nenhum deslocamento
 * com "reduzir movimento" (docs/design/componentes.md §6).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  animacaoDeEntrada,
  chaveDaRota,
  FRACAO_DESLOCAMENTO,
  LIMITE_HISTORICO,
  limparHistoricoDoShell,
  marcarTrocaDeAba,
  proximaNavegacao,
  registrarTelaAberta,
  VALIDADE_MARCA_ABA_MS,
} from './transicao-modulo';

describe('chave da rota de módulo', () => {
  it('caminho + parâmetros em ordem, sem o próprio caminho', () => {
    expect(chaveDaRota(['pedido'], { caminho: ['pedido'], id: '7', aba: 'itens' })).toBe('pedido?aba=itens&id=7');
    expect(chaveDaRota('pedidos', {})).toBe('pedidos');
    expect(chaveDaRota(['treinamento', 'licao'], { caminho: ['treinamento', 'licao'], x: undefined })).toBe('treinamento/licao');
    expect(chaveDaRota(undefined, {})).toBe('');
  });
});

describe('direção da navegação', () => {
  it('tela nova avança; a anterior volta; a mesma não anima', () => {
    let h: string[] = [];
    let r = proximaNavegacao(h, 'pedidos', false);
    expect(r.direcao).toBe('nenhuma');
    h = r.historico;
    r = proximaNavegacao(h, 'pedido?id=1', false);
    expect(r).toEqual({ historico: ['pedidos', 'pedido?id=1'], direcao: 'avancar' });
    h = r.historico;
    expect(proximaNavegacao(h, 'pedido?id=1', false).direcao).toBe('nenhuma');
    r = proximaNavegacao(h, 'pedidos', false);
    expect(r).toEqual({ historico: ['pedidos'], direcao: 'voltar' });
  });
  it('troca de aba recomeça o histórico e não anima', () => {
    expect(proximaNavegacao(['pedidos', 'pedido?id=1'], 'clientes', true)).toEqual({ historico: ['clientes'], direcao: 'nenhuma' });
  });
  it('histórico limitado', () => {
    let h: string[] = ['a'];
    for (let i = 0; i < LIMITE_HISTORICO + 10; i++) h = proximaNavegacao(h, `t${i}`, false).historico;
    expect(h).toHaveLength(LIMITE_HISTORICO);
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

describe('estado do shell', () => {
  beforeEach(() => limparHistoricoDoShell());
  it('a marca da barra de abas vale só para a navegação seguinte', () => {
    expect(registrarTelaAberta('pedidos', 0)).toBe('nenhuma');
    expect(registrarTelaAberta('pedido?id=1', 10)).toBe('avancar');
    marcarTrocaDeAba(100);
    expect(registrarTelaAberta('clientes', 200)).toBe('nenhuma');
    expect(registrarTelaAberta('cliente?id=9', 300)).toBe('avancar');
  });
  it('marca vencida (aba tocada já era a atual) não come a animação seguinte', () => {
    registrarTelaAberta('pedidos', 0);
    marcarTrocaDeAba(100);
    expect(registrarTelaAberta('pedido?id=1', 100 + VALIDADE_MARCA_ABA_MS + 1)).toBe('avancar');
  });
});
