import { describe, expect, it } from 'vitest';

import { coresDoSino, destinoDaTarefa, destinoVerTodos, leituraDoSino, numeroDoSino } from './sino';

describe('T-0170 — sino do shell', () => {
  it('número escondido com 0, igual até 9 e "9+" acima de 9', () => {
    expect(numeroDoSino(0)).toBeNull();
    expect(numeroDoSino(-1)).toBeNull();
    expect(numeroDoSino(1)).toBe('1');
    expect(numeroDoSino(9)).toBe('9');
    expect(numeroDoSino(10)).toBe('9+');
  });

  it('leitura do TalkBack com o número', () => {
    expect(leituraDoSino(0)).toBe('Recados e tarefas');
    expect(leituraDoSino(1)).toBe('Recados e tarefas, 1 novo');
    expect(leituraDoSino(3)).toBe('Recados e tarefas, 3 novos');
  });

  it('"Ver todos" abre Recados e tarefas; sem a página, a central de notificações', () => {
    expect(destinoVerTodos(() => true)).toBe('/m/recados-e-tarefas');
    expect(destinoVerTodos((c) => c === 'notificacoes')).toBe('/m/notificacoes');
    expect(destinoDaTarefa('a1')).toBe('/m/tarefa?id=a1');
  });

  it('MC-0009: na faixa, contador Sol claro com número grafite e ícone branco; fora dela, contador laranja com número branco', () => {
    expect(coresDoSino(true)).toEqual({
      botaoFundo: 'transparente',
      botaoBorda: 'faixaTrilho',
      icone: 'faixaTitulo',
      contadorFundo: 'graficoEscuro',
      contadorNumero: 'ink',
      contadorAro: 'faixa',
    });
    expect(coresDoSino(false)).toMatchObject({ botaoFundo: 'surface', icone: 'ink', contadorFundo: 'grafico', contadorNumero: 'surface' });
  });
});
