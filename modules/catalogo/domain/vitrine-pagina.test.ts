/** RN-CAT-21 (T-0192): a página leve da vitrine é idêntica à de `listarVitrine` (ids, ordem, total, next_offset). */
import { describe, expect, it } from 'vitest';
import { PARAMETROS_PADRAO } from './parametros';
import { listarVitrine, paginaDaOrdem, type ContextoVitrine, type ProdutoCatalogo } from './vitrine';
import { ordemDaVitrine } from './vitrine-pagina';

const AGORA = '2026-11-08T12:00:00.000Z';
const TABELA = '00000000-0000-4000-8000-0000000000a1';
const FILIAL = '00000000-0000-4000-8000-0000000000f1';
const OUTRA = '00000000-0000-4000-8000-0000000000f2';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const NOMES = ['Pastilha', 'Disco', 'Filtro', 'Correia', 'Vela', 'Bateria', 'Lâmpada', 'Bomba'];
const PRODUTOS: ProdutoCatalogo[] = Array.from({ length: 300 }, (_, i) => ({
  id: uuid(i + 1),
  sku: `SK${String(i + 1).padStart(5, '0')}`,
  ean: null,
  nome: `${NOMES[(i * 7) % NOMES.length]} ${(i * 13) % 50}`,
  marca: i % 3 === 0 ? 'Fremax' : 'Cobreq',
  categoria: i % 2 === 0 ? 'Freios' : 'Motor',
  unidade: 'UN',
  ativo: i % 41 !== 5,
  atributos: [],
  thumbnail_url: null,
  campanha: i % 17 === 0,
  vendas: (i * 31) % 90,
}));

const contexto = (o: Partial<ContextoVitrine> = {}): ContextoVitrine => ({
  perfil: 'vendedor',
  parametros: PARAMETROS_PADRAO,
  agora: AGORA,
  clienteId: null,
  tabelaClienteId: null,
  itensPreco: PRODUTOS.filter((_, i) => i % 3 === 0).map((p) => ({ price_table_id: TABELA, product_id: p.id, price_cents: 1000, valid_from: '2026-01-01T00:00:00.000Z', valid_to: null })),
  promocoes: [],
  saldos: new Map(PRODUTOS.filter((_, i) => i % 4 === 0).map((p, k) => [p.id, [{ branch_id: k % 2 ? FILIAL : OUTRA, branch_name: 'CD', quantity: k % 5, updated_at: AGORA }]])),
  filiais: null,
  ...o,
});

const CASOS: [string, Partial<ContextoVitrine>, Parameters<typeof listarVitrine>[0]['chips']][] = [
  ['sem filtro', {}, {}],
  ['só com estoque', {}, { only_in_stock: true }],
  ['campanha', {}, { campaign: true }],
  ['filiais do usuário', { filiais: [FILIAL] }, {}],
  ['sem filial de venda', { filiais: [], filiaisFolha: [] }, {}],
  ['marca e linha', {}, { brand: 'Fremax', line: 'Freios' }],
  ['nó da árvore', {}, { only_product_ids: new Set(PRODUTOS.slice(40, 120).map((p) => p.id)) }],
  ['promotor sem ver estoque', { perfil: 'promotor', parametros: { ...PARAMETROS_PADRAO, promotor_ve_preco_estoque: false } }, {}],
  ['número escondido', { parametros: { ...PARAMETROS_PADRAO, estoque_mostrar_quantidade: false } }, {}],
];

describe('RN-CAT-21: a página da vitrine sai na mesma ordem da vitrine inteira', () => {
  for (const [nome, o, chips] of CASOS) {
    it(`RN-CAT-21: ${nome}`, () => {
      const ctx = contexto(o);
      for (const [limit, offset] of [[20, 0], [20, 20], [60, 0], [7, 33], [1000, 0]] as const) {
        const cheia = listarVitrine({ produtos: PRODUTOS, contexto: ctx, chips: chips ?? {}, sinonimos: [], limit, offset });
        const leve = paginaDaOrdem(ordemDaVitrine({ produtos: PRODUTOS, contexto: ctx, chips: chips ?? {} }), limit, offset);
        expect(leve.itens).toEqual(cheia.items.map((i) => i.id));
        expect(leve.total).toBe(cheia.total);
        expect(leve.next_offset).toBe(cheia.next_offset);
      }
    });
  }
});
