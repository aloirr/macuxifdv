import { describe, expect, it } from 'vitest';

import { destinoDaTarefa, destinoVerTodos } from './sino';

describe('T-0170 — sino do shell', () => {
  it('"Ver todos" abre Recados e tarefas; sem a página, a central de notificações', () => {
    expect(destinoVerTodos(() => true)).toBe('/m/recados-e-tarefas');
    expect(destinoVerTodos((c) => c === 'notificacoes')).toBe('/m/notificacoes');
    expect(destinoDaTarefa('a1')).toBe('/m/tarefa?id=a1');
  });
});
