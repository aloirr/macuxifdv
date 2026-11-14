import { describe, expect, it } from 'vitest';

import { coresDoSino, destinoDaTarefa, destinoVerTodos, leituraDoSino, temNovoNoSino } from './sino';

describe('T-0170 — sino do shell', () => {
  it('bolinha apagada com 0, negativo ou NaN; acesa com qualquer total positivo', () => {
    expect(temNovoNoSino(0)).toBe(false);
    expect(temNovoNoSino(-1)).toBe(false);
    expect(temNovoNoSino(Number.NaN)).toBe(false);
    expect(temNovoNoSino(1)).toBe(true);
    expect(temNovoNoSino(12)).toBe(true);
  });

  it('leitura do TalkBack sem número', () => {
    expect(leituraDoSino(0)).toBe('Recados e tarefas');
    expect(leituraDoSino(1)).toBe('Recados e tarefas, há novos');
    expect(leituraDoSino(12)).toBe('Recados e tarefas, há novos');
  });

  it('"Ver todos" abre Recados e tarefas; sem a página, a central de notificações', () => {
    expect(destinoVerTodos(() => true)).toBe('/m/recados-e-tarefas');
    expect(destinoVerTodos((c) => c === 'notificacoes')).toBe('/m/notificacoes');
    expect(destinoDaTarefa('a1')).toBe('/m/tarefa?id=a1');
  });

  it('MC-0009: na faixa, bolinha Sol claro com aro da faixa e ícone branco; fora dela, bolinha laranja com aro Pérola', () => {
    expect(coresDoSino(true)).toEqual({
      botaoFundo: 'transparente',
      botaoBorda: 'faixaTrilho',
      icone: 'faixaTitulo',
      bolinhaFundo: 'graficoEscuro',
      bolinhaAro: 'faixa',
    });
    expect(coresDoSino(false)).toEqual({
      botaoFundo: 'surface',
      botaoBorda: 'line',
      icone: 'ink',
      bolinhaFundo: 'grafico',
      bolinhaAro: 'ground',
    });
  });
});
