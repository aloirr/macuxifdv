import { describe, expect, it } from 'vitest';
import { escolherProdutosDeVitrine } from './selecao-fotos';

const item = (n: number, line: string | null) => ({ id: `id-${n}`, description: `Produto ${n}`, line });

describe('escolha dos produtos de vitrine para as fotos da demo (T-0097)', () => {
  it('RF-CAT-03: distribui por categoria (uma de cada vez) até o limite e mantém a ordem dentro da categoria', () => {
    const itens = [item(1, 'A'), item(2, 'A'), item(3, 'A'), item(4, 'B'), item(5, 'B'), item(6, 'C')];
    expect(escolherProdutosDeVitrine(itens, 4).map((i) => i.id)).toEqual(['id-1', 'id-4', 'id-6', 'id-2']);
  });

  it('RF-CAT-03: sem categoria cai no grupo neutro; limite maior que o catálogo devolve tudo, sem repetir', () => {
    const itens = [item(1, null), item(2, ''), item(3, 'A')];
    const r = escolherProdutosDeVitrine(itens, 30);
    expect(r.map((i) => i.id).sort()).toEqual(['id-1', 'id-2', 'id-3']);
    expect(new Set(r.map((i) => i.id)).size).toBe(3);
  });
});
