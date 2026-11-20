import { describe, expect, it, vi } from 'vitest';
import { criarArmazenamentoPorChave } from './armazenamento-por-chave';

const espera = () => new Promise((r) => setTimeout(r, 0));

describe('RN-CORE-52: armazenamento compartilhado do complemento da parada', () => {
  it('RN-CORE-52: N pedidos com a mesma chave chamam o carregador uma vez só; chave nova chama de novo', async () => {
    const carregar = vi.fn(async () => new Map([['c', 'Vera']]));
    const a = criarArmazenamentoPorChave<ReadonlyMap<string, string>>(new Map());
    for (let i = 0; i < 30; i++) a.solicitar('k1', carregar);
    await espera();
    expect(carregar).toHaveBeenCalledTimes(1);
    a.solicitar('k2', carregar);
    await espera();
    expect(carregar).toHaveBeenCalledTimes(2);
  });
  it('RN-CORE-52: todos recebem a mesma referência, e dado igual com chave nova não troca a referência nem avisa', async () => {
    const ouvinte = vi.fn();
    const a = criarArmazenamentoPorChave<ReadonlyMap<string, string>>(new Map(), (x, y) => x.size === y.size && [...x].every(([k, v]) => y.get(k) === v));
    a.assinar(ouvinte);
    a.solicitar('k1', async () => new Map([['c', 'Vera']]));
    await espera();
    const ref = a.obter();
    expect(a.obter()).toBe(ref);
    expect(ouvinte).toHaveBeenCalledTimes(1);
    a.solicitar('k2', async () => new Map([['c', 'Vera']]));
    await espera();
    expect(a.obter()).toBe(ref);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });
  it('RN-CORE-52: resposta de chave antiga que chega depois é descartada', async () => {
    const a = criarArmazenamentoPorChave<string>('');
    let soltar: (v: string) => void = () => undefined;
    a.solicitar('velha', () => new Promise<string>((r) => (soltar = r)));
    a.solicitar('nova', async () => 'nova');
    await espera();
    soltar('velha');
    await espera();
    expect(a.obter()).toBe('nova');
  });
});
