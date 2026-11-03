import { describe, expect, it } from 'vitest';
import { contagem, pct } from './formato';

describe('formatos do app do Gestor', () => {
  it('percentual em pt-BR com vírgula e até 1 casa; sem dado = traço', () => {
    expect(pct(7.5)).toBe('7,5%');
    expect(pct(7.54)).toBe('7,5%');
    expect(pct(80)).toBe('80%');
    expect(pct(0)).toBe('0%');
    expect(pct(null)).toBe('—');
  });

  it('singular só para 1; zero e demais no plural', () => {
    expect(contagem(1, 'pedido', 'pedidos')).toBe('1 pedido');
    expect(contagem(0, 'pedido', 'pedidos')).toBe('0 pedidos');
    expect(contagem(2, 'pedido', 'pedidos')).toBe('2 pedidos');
  });
});
