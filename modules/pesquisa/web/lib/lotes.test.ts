import { describe, expect, it } from 'vitest';
import { buscarEmLotes } from './lotes';

const e404 = (e: unknown) => (e as { status?: number }).status === 404;

describe('UX-34: nomes do público em lotes', () => {
  it('120 ids: todos são buscados, em lotes de até 10 em paralelo', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `c${i}`);
    let ativos = 0;
    let pico = 0;
    const r = await buscarEmLotes(
      ids,
      async (id) => {
        ativos++;
        pico = Math.max(pico, ativos);
        await Promise.resolve();
        ativos--;
        return id.toUpperCase();
      },
      e404,
    );
    expect(Object.keys(r)).toHaveLength(120);
    expect(r['c119']).toBe('C119');
    expect(pico).toBe(10);
  });

  it('só o 404 vira "sem cadastro" (null); outra falha fica fora e não derruba os demais', async () => {
    const r = await buscarEmLotes(
      ['a', 'b', 'c'],
      async (id) => {
        if (id === 'a') throw Object.assign(new Error('x'), { status: 404 });
        if (id === 'b') throw Object.assign(new Error('x'), { status: 500 });
        return 'ok';
      },
      e404,
    );
    expect(r).toEqual({ a: null, c: 'ok' });
    expect('b' in r).toBe(false);
  });
});
