/** T-0084 C9 (RN-CAT-12, RN-VEN-19): o seletor do Novo pedido usa a busca do Catálogo; funções puras. */
import { describe, expect, it } from 'vitest';
import { idsSemTexto, partirTrecho, resolverBusca } from './busca-seletor';

describe('RN-CAT-12: trecho "Serve em" com termos marcados', () => {
  it('parte o texto nas marcas [início, fim)', () => {
    expect(
      partirTrecho('Uno 2010–2014', [
        [0, 3],
        [4, 8],
      ]),
    ).toEqual([
      { texto: 'Uno', marcado: true },
      { texto: ' ', marcado: false },
      { texto: '2010', marcado: true },
      { texto: '–2014', marcado: false },
    ]);
  });
  it('sem marcas devolve o texto inteiro; marca fora do texto é cortada; marcas sobrepostas se fundem', () => {
    expect(partirTrecho('Gol G5', [])).toEqual([{ texto: 'Gol G5', marcado: false }]);
    expect(partirTrecho('Gol', [[1, 99]])).toEqual([
      { texto: 'G', marcado: false },
      { texto: 'ol', marcado: true },
    ]);
    expect(
      partirTrecho('abcdef', [
        [0, 3],
        [2, 5],
      ]),
    ).toEqual([
      { texto: 'abcde', marcado: true },
      { texto: 'f', marcado: false },
    ]);
  });
});

describe('RN-CAT-12: resultado do seletor na ordem do ranking do Catálogo', () => {
  const porId = new Map([
    ['a', { id: 'a' }],
    ['b', { id: 'b' }],
  ]);
  it('mantém a ordem, junta o "Serve em" e descarta produto fora da tabela do cliente', () => {
    const serve = { texto: 'Uno 2010–2014', marcas: [] as Array<[number, number]>, inclui_ano: 2012 };
    const r = resolverBusca(
      [
        { produto_id: 'x', serve_em: null },
        { produto_id: 'b', serve_em: serve },
        { produto_id: 'a', serve_em: null },
      ],
      porId,
      40,
    );
    expect(r.map((i) => i.produto.id)).toEqual(['b', 'a']);
    expect(r[0]!.serveEm?.inclui_ano).toBe(2012);
  });
  it('respeita o limite', () => {
    expect(
      resolverBusca(
        [
          { produto_id: 'a', serve_em: null },
          { produto_id: 'b', serve_em: null },
        ],
        porId,
        1,
      ),
    ).toHaveLength(1);
  });
});

describe('RN-VEN-19: a aplicação é lida só dos itens visíveis, não da tabela inteira', () => {
  it('pede só o que falta no cache, sem repetir, até 500 ids', () => {
    const cache = new Map([['a', 'texto']]);
    expect(idsSemTexto(['a', 'b', 'b', 'c'], cache)).toEqual(['b', 'c']);
    const muitos = Array.from({ length: 700 }, (_, i) => `p${i}`);
    expect(idsSemTexto(muitos, new Map())).toHaveLength(500);
  });
});
