import { describe, expect, it } from 'vitest';
import { LIMITE_SUGESTOES, sugestoesDoPedido, type RelacaoProduto, type Vendavel } from './sugestoes';

const id = (n: number) => `0b000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [CAFE, AGUA, ACUCAR, FILTRO, LEITE, AGUA15, X1, X2, X3, X4] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id) as [string, string, string, string, string, string, string, string, string, string];
const rel = (produto_id: string, relacionado_id: string, tipo: RelacaoProduto['tipo'], ordem = 0, extra: Partial<RelacaoProduto> = {}): RelacaoProduto => ({ produto_id, relacionado_id, tipo, ordem, ativo: true, ...extra });
const vend = (...ids: string[]): Map<string, Vendavel> => new Map(ids.map((i) => [i, { preco_cents: 500, estoque: 10 }]));

describe('catalogo.sugestoes_pedido@1 (domain)', () => {
  it('RF-CAT-03: segue a ordem das linhas do pedido e, dentro do produto, a ordem da relação', () => {
    const r = sugestoesDoPedido(
      [rel(AGUA, AGUA15, 'superior'), rel(CAFE, LEITE, 'complementar', 3), rel(CAFE, ACUCAR, 'complementar', 1), rel(CAFE, FILTRO, 'complementar', 2)],
      [CAFE, AGUA],
      vend(ACUCAR, FILTRO, LEITE, AGUA15),
      5,
    );
    expect(r.complementares.map((s) => s.produto_id)).toEqual([ACUCAR, FILTRO, LEITE]);
    expect(r.complementares.every((s) => s.origem_produto_id === CAFE && s.tipo === 'complementar')).toBe(true);
    expect(r.superiores).toEqual([{ produto_id: AGUA15, tipo: 'superior', origem_produto_id: AGUA, preco_cents: 500 }]);
    // outra ordem de linhas muda a ordem da saída
    const inv = sugestoesDoPedido([rel(CAFE, ACUCAR, 'complementar'), rel(AGUA, FILTRO, 'complementar')], [AGUA, CAFE], vend(ACUCAR, FILTRO), 5);
    expect(inv.complementares.map((s) => s.produto_id)).toEqual([FILTRO, ACUCAR]);
  });

  it('RF-CAT-03: tira o que já está no pedido', () => {
    const r = sugestoesDoPedido([rel(CAFE, ACUCAR, 'complementar'), rel(CAFE, FILTRO, 'complementar')], [CAFE, ACUCAR], vend(ACUCAR, FILTRO), 5);
    expect(r.complementares.map((s) => s.produto_id)).toEqual([FILTRO]);
  });

  it('RN-CAT-06: tira o que não tem preço na tabela do cliente', () => {
    const v = vend(FILTRO);
    v.set(ACUCAR, { preco_cents: null, estoque: 10 });
    const r = sugestoesDoPedido([rel(CAFE, ACUCAR, 'complementar'), rel(CAFE, FILTRO, 'complementar'), rel(CAFE, LEITE, 'complementar')], [CAFE], v, 5);
    expect(r.complementares.map((s) => s.produto_id)).toEqual([FILTRO]);
  });

  it('RN-CAT-07: tira o que não tem estoque (saldo ≤ 0)', () => {
    const v = vend(FILTRO);
    v.set(ACUCAR, { preco_cents: 499, estoque: 0 });
    v.set(LEITE, { preco_cents: 1690, estoque: -3 });
    const r = sugestoesDoPedido([rel(CAFE, ACUCAR, 'complementar'), rel(CAFE, LEITE, 'complementar'), rel(CAFE, FILTRO, 'complementar')], [CAFE], v, 5);
    expect(r.complementares.map((s) => s.produto_id)).toEqual([FILTRO]);
  });

  it('RF-CAT-03: não repete (mesmo relacionado vindo de dois itens, ou nos dois blocos)', () => {
    const r = sugestoesDoPedido(
      [rel(CAFE, ACUCAR, 'complementar'), rel(AGUA, ACUCAR, 'complementar'), rel(AGUA, ACUCAR, 'superior'), rel(CAFE, ACUCAR, 'complementar', 9)],
      [CAFE, AGUA],
      vend(ACUCAR),
      5,
    );
    expect(r.complementares).toHaveLength(1);
    expect(r.complementares[0]!.origem_produto_id).toBe(CAFE);
    expect(r.superiores).toEqual([]);
  });

  it('RF-CAT-03: limite de 5 por bloco (e nunca acima de 5, mesmo se pedirem mais)', () => {
    const rels = [ACUCAR, FILTRO, LEITE, X1, X2, X3, X4].map((p, i) => rel(CAFE, p, 'complementar', i));
    const v = vend(ACUCAR, FILTRO, LEITE, X1, X2, X3, X4);
    expect(sugestoesDoPedido(rels, [CAFE], v, 5).complementares).toHaveLength(5);
    expect(sugestoesDoPedido(rels, [CAFE], v, 2).complementares.map((s) => s.produto_id)).toEqual([ACUCAR, FILTRO]);
    expect(sugestoesDoPedido(rels, [CAFE], v, 99).complementares).toHaveLength(LIMITE_SUGESTOES);
    expect(LIMITE_SUGESTOES).toBe(5);
  });

  it('RF-CAT-03: ignora relação inativa, removida, substituto e auto-relação', () => {
    const r = sugestoesDoPedido(
      [
        rel(CAFE, ACUCAR, 'complementar', 0, { ativo: false }),
        rel(CAFE, FILTRO, 'complementar', 0, { deleted_at: '2026-11-01T00:00:00.000000Z' }),
        rel(CAFE, LEITE, 'substituto'),
        rel(CAFE, CAFE, 'complementar'),
        rel(CAFE, X1, 'complementar'),
      ],
      [CAFE],
      vend(ACUCAR, FILTRO, LEITE, X1, CAFE),
      5,
    );
    expect(r.complementares.map((s) => s.produto_id)).toEqual([X1]);
    expect(r.superiores).toEqual([]);
  });

  it('RN-CAT-05: perfil sem preço (promotor) recebe saída vazia', () => {
    const r = sugestoesDoPedido([rel(CAFE, ACUCAR, 'complementar')], [CAFE], vend(ACUCAR), 5, false);
    expect(r).toEqual({ complementares: [], superiores: [] });
  });

  it('RF-CAT-03: sem relações ou sem produtos vendáveis, saída vazia', () => {
    expect(sugestoesDoPedido([], [CAFE], vend(ACUCAR), 5)).toEqual({ complementares: [], superiores: [] });
    expect(sugestoesDoPedido([rel(CAFE, ACUCAR, 'complementar')], [CAFE], new Map(), 5)).toEqual({ complementares: [], superiores: [] });
  });
});
