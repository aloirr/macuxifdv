import { describe, expect, it, vi } from 'vitest';
import { chaveDoCiclo, criarArmazenamentoPorChave } from './armazenamento-por-chave';

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
  it('RN-CORE-52: chaveDoCiclo é igual para o mesmo motor e ciclo, e muda com o ciclo ou o motor', () => {
    const m1 = {};
    const m2 = {};
    expect(chaveDoCiclo(m1, 't1')).toBe(chaveDoCiclo(m1, 't1'));
    expect(chaveDoCiclo(m1, 't1')).not.toBe(chaveDoCiclo(m1, 't2'));
    expect(chaveDoCiclo(m1, 't1')).not.toBe(chaveDoCiclo(m2, 't1'));
  });
  it('RN-CORE-52: a visão carregada N vezes com a mesma chave chama o loader uma vez, mantém a referência e uma chave nova relê', async () => {
    const m = {};
    const visao = (calculado_em: string) => ({ calculado_em }) as never;
    const carregar = vi.fn(async () => visao('a'));
    const a = criarArmazenamentoPorChave<ReturnType<typeof visao> | null>(null, (x, y) => x === y || (!!x && !!y && (x as { calculado_em: string }).calculado_em === (y as { calculado_em: string }).calculado_em));
    for (let i = 0; i < 20; i++) a.solicitar(chaveDoCiclo(m, 't1'), carregar);
    await espera();
    const ref = a.obter();
    expect(carregar).toHaveBeenCalledTimes(1);
    a.solicitar(chaveDoCiclo(m, 't2'), carregar);
    await espera();
    expect(carregar).toHaveBeenCalledTimes(2);
    expect(a.obter()).toBe(ref);
  });
});
