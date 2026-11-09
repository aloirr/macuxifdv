/**
 * T-0119 (D-T0107b): a pré-seleção por índice não pode mudar o resultado da busca. Catálogo gerado (500 produtos, com o mínimo do índice zerado; o limite padrão é testado à parte, com
 * aplicação, referências cruzadas, EAN e vendas) e 30 consultas: a busca sobre a lista inteira e a sobre os candidatos têm de
 * dar os mesmos itens, na mesma ordem, com o mesmo total e as mesmas notas.
 */
import { describe, expect, it } from 'vitest';
import { interpretarConsulta } from './consulta';
import { candidatosDaBusca, construirIndiceBusca, cortarCandidatos, indiceDe, MINIMO_PARA_INDICE, posicoesDaPalavra } from './indice-busca';
import { PARAMETROS_PADRAO } from './parametros';
import { buscarProdutos, docDeBusca, itemDaVitrine, temEstoqueParaBusca, vocabularioDe, type ContextoVitrine, type ProdutoCatalogo } from './vitrine';

const AGORA = '2026-11-08T12:00:00.000Z';
const TABELA = '00000000-0000-4000-8000-0000000000a1';
const CLIENTE = '00000000-0000-4000-8000-0000000000c1';
const FILIAL = '00000000-0000-4000-8000-0000000000f1';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let semente = 20261108;
const aleatorio = (n: number) => {
  semente = (semente * 1664525 + 1013904223) >>> 0;
  return semente % n;
};

const PECAS = ['Pastilha de freio', 'Disco de freio', 'Filtro de óleo', 'Filtro de ar', 'Amortecedor dianteiro', 'Correia dentada', 'Vela de ignição', 'Bateria 60 Ah', 'Lâmpada farol', 'Bomba de combustível'];
const MARCAS = ['Cobreq', 'Fremax', 'Tecfil', 'Bosch', 'NGK', 'Moura', 'Cofap', 'Gates'];
const LINHAS = ['Freios', 'Filtros', 'Suspensão', 'Motor', 'Elétrica'];
const CARROS = ['Fiat Uno 2010-2014', 'VW Gol 2008-2016', 'Chevrolet Onix 2013-2020', 'Ford Ka 2015-', 'Honda Civic 2012-2016; Honda Fit 2010-2014'];

function gerar(n: number): ProdutoCatalogo[] {
  return Array.from({ length: n }, (_, i): ProdutoCatalogo => {
    const peca = PECAS[aleatorio(PECAS.length)]!;
    const marca = MARCAS[aleatorio(MARCAS.length)]!;
    const linha = LINHAS[aleatorio(LINHAS.length)]!;
    return {
      id: uuid(i + 1),
      sku: `SK${String(i + 1).padStart(6, '0')}`,
      ean: i % 3 === 0 ? `78910${String(i).padStart(8, '0')}` : null,
      nome: `${peca} ${marca} ${100 + aleatorio(900)}`,
      marca,
      categoria: linha,
      unidade: 'UN',
      ativo: i % 50 !== 7,
      atributos: i % 4 === 0 ? [{ name: 'Posição', value: aleatorio(2) ? 'dianteiro' : 'traseiro' }] : [],
      aplicacao: i % 2 === 0 ? CARROS[aleatorio(CARROS.length)]! : '',
      referencias: i % 5 === 0 ? [{ marca_id: uuid(900000 + aleatorio(5)), marca_nome: 'Concorrente', codigo: `CB-${3000 + aleatorio(500)}-X` }] : [],
      thumbnail_url: null,
      campanha: i % 97 === 0,
      vendas: aleatorio(500),
    };
  });
}

const PRODUTOS = gerar(500);
const contexto = (o: Partial<ContextoVitrine> = {}): ContextoVitrine => ({
  perfil: 'vendedor',
  parametros: PARAMETROS_PADRAO,
  agora: AGORA,
  clienteId: CLIENTE,
  tabelaClienteId: TABELA,
  itensPreco: PRODUTOS.filter((_, i) => i % 8 === 0).map((p) => ({ price_table_id: TABELA, product_id: p.id, price_cents: 1000 + (Number(p.id.slice(-6)) % 90) * 100, valid_from: '2026-01-01T00:00:00.000Z', valid_to: null })),
  promocoes: [],
  saldos: new Map(PRODUTOS.filter((_, i) => i % 4 === 0).map((p) => [p.id, [{ branch_id: FILIAL, branch_name: 'CD', quantity: Number(p.id.slice(-3)) % 40, updated_at: AGORA }]])),
  filiais: null,
  ...o,
});

const CONSULTAS = [
  'pastilha de freio',
  'pastilha freio cobreq',
  'pastilha fremax dianteiro',
  'filtro de oleo',
  'filtro ar tecfil',
  'amortecedor cofap traseiro',
  'amortecedor dianteiro gol 2012',
  'correia dentada civic 2014',
  'vela ignicao ngk',
  'bateria 60 ah moura',
  'lampada farol',
  'bomba combustivel bosch',
  'pastilha onix 2019',
  'disco de freio uno 2011',
  'pastlha de freio',
  'filtro de olio',
  'amortecdor',
  'freios',
  'suspensão',
  'cb 3100',
  'CB-3250-X',
  'cb3300x',
  'SK000042',
  'sk001500',
  '7891000000000',
  'pastilha ka 2022',
  'civic fit 2010',
  'xyz inexistente',
  'disco freio gates 500',
  'eletrica motor',
];

describe('T-0119: índice de busca (pré-seleção dos candidatos)', () => {
  it.each(CONSULTAS)('T-0119: "%s" dá o mesmo resultado com e sem pré-seleção', (q) => {
    const filtros = interpretarConsulta(q, vocabularioDe(PRODUTOS));
    const base = { contexto: contexto(), filtros, sinonimos: [{ id: 's1', term: 'pastilha', synonyms: ['sapata'], active: true, external_id: null }], limit: 500, offset: 0 };
    const cheia = buscarProdutos({ ...base, produtos: PRODUTOS });
    const pre = candidatosDaBusca({ produtos: PRODUTOS, contexto: base.contexto, filtros, sinonimos: base.sinonimos, minimo: 0 });
    if (pre === null) return; // sem texto nem código: usa a lista inteira
    expect(pre.produtos.length).toBeLessThan(PRODUTOS.length);
    const reduzida = buscarProdutos({ ...base, produtos: pre.produtos, maxVendas: pre.maxVendas });
    expect(reduzida.total).toBe(cheia.total);
    expect(reduzida.items.map((x) => [x.id, x.score])).toEqual(cheia.items.map((x) => [x.id, x.score]));
  });

  it('T-0119: a pré-seleção enxuga de verdade (consulta específica fica longe do catálogo inteiro)', () => {
    const filtros = interpretarConsulta('pastilha fremax dianteiro', vocabularioDe(PRODUTOS));
    const pre = candidatosDaBusca({ produtos: PRODUTOS, contexto: contexto(), filtros, sinonimos: [], minimo: 0 })!;
    expect(pre.produtos.length).toBeGreaterThan(0);
    expect(pre.produtos.length).toBeLessThan(PRODUTOS.length * 0.6);
  });

  it('T-0119: SKU exato pré-seleciona só o produto', () => {
    const filtros = interpretarConsulta('SK000042', vocabularioDe(PRODUTOS));
    const pre = candidatosDaBusca({ produtos: PRODUTOS, contexto: contexto(), filtros, sinonimos: [], minimo: 0 })!;
    expect(pre.produtos.map((p) => p.sku)).toEqual(['SK000042']);
  });

  it('T-0119: faixa de preço, estoque, só vendáveis e nota semântica não pré-selecionam (dependem do cartão)', () => {
    const vocab = vocabularioDe(PRODUTOS);
    const entrada = { produtos: PRODUTOS, contexto: contexto(), sinonimos: [], minimo: 0 };
    expect(candidatosDaBusca({ ...entrada, filtros: interpretarConsulta('pastilha até R$ 20', vocab) })).toBeNull();
    expect(candidatosDaBusca({ ...entrada, filtros: interpretarConsulta('pastilha com estoque', vocab) })).toBeNull();
    expect(candidatosDaBusca({ ...entrada, filtros: interpretarConsulta('pastilha', vocab), chips: { only_sellable: true } })).toBeNull();
    expect(candidatosDaBusca({ ...entrada, filtros: interpretarConsulta('pastilha', vocab), semantica: new Map([[PRODUTOS[0]!.id, 0.9]]) })).toBeNull();
  });

  it('T-0119: catálogo pequeno ou consulta vazia não pré-seleciona', () => {
    const vocab = vocabularioDe(PRODUTOS);
    expect(candidatosDaBusca({ produtos: PRODUTOS, contexto: contexto(), filtros: interpretarConsulta('pastilha', vocab), sinonimos: [] })).toBeNull(); // 500 < MINIMO_PARA_INDICE (2000)
    expect(MINIMO_PARA_INDICE).toBeGreaterThan(PRODUTOS.length);
    expect(candidatosDaBusca({ produtos: PRODUTOS, contexto: contexto(), filtros: interpretarConsulta('', vocab), sinonimos: [], minimo: 0 })).toBeNull();
  });

  it('T-0119: o índice é reaproveitado para a mesma lista e refeito para outra', () => {
    expect(indiceDe(PRODUTOS, 2026)).toBe(indiceDe(PRODUTOS, 2026));
    expect(indiceDe(PRODUTOS, 2027)).not.toBe(indiceDe(PRODUTOS, 2026));
  });

  it('T-0119: a palavra casa por exato, prefixo (3+ letras) e erro de digitação (4+), como nivelDaPalavra', () => {
    const idx = construirIndiceBusca([{ ...PRODUTOS[0]!, nome: 'Amortecedor dianteiro', marca: 'Cofap', categoria: 'X', atributos: [], aplicacao: '', referencias: [] }], 2026);
    const acha = (w: string) => {
      const s = new Set<number>();
      posicoesDaPalavra(idx, w, s);
      return s.size === 1;
    };
    expect(acha('amortecedor')).toBe(true);
    expect(acha('amort')).toBe(true);
    expect(acha('amortecdor')).toBe(true);
    expect(acha('am')).toBe(false);
    expect(acha('cobap')).toBe(true);
    expect(acha('zzzz')).toBe(false);
  });
});

describe('T-0119 (D-T0107b): teto de candidatos antes do ranking completo', () => {
  const sinonimos = [{ id: 's1', term: 'pastilha', synonyms: ['sapata'], active: true, external_id: null }];

  it.each(CONSULTAS)('T-0119: "%s" — com teto de 60 candidatos a primeira página (20) é a mesma do ranking completo', (q) => {
    const filtros = interpretarConsulta(q, vocabularioDe(PRODUTOS));
    const base = { contexto: contexto(), filtros, sinonimos, limit: 20, offset: 0 };
    const cheia = buscarProdutos({ ...base, produtos: PRODUTOS });
    const pre = candidatosDaBusca({ produtos: PRODUTOS, contexto: base.contexto, filtros, sinonimos, minimo: 0 });
    if (pre === null) return;
    const corte = cortarCandidatos(pre, base.contexto, 60);
    expect(corte.produtos.length).toBeLessThanOrEqual(60);
    const reduzida = buscarProdutos({ ...base, produtos: corte.produtos, maxVendas: corte.maxVendas });
    expect(reduzida.items.map((x) => x.id)).toEqual(cheia.items.map((x) => x.id));
    // o total é o que cabe no corte (alguns da nota barata podem ficar com nota 0 no ranking, por exemplo pelo trecho da aplicação): nunca passa do completo
    expect(reduzida.total).toBeLessThanOrEqual(Math.min(cheia.total, corte.produtos.length));
    if (cheia.total <= 60) expect(reduzida.total).toBe(cheia.total);
  });

  it('T-0119: até o teto nada é cortado; acima dele fica o teto, na ordem do catálogo', () => {
    const filtros = interpretarConsulta('freio', vocabularioDe(PRODUTOS));
    const pre = candidatosDaBusca({ produtos: PRODUTOS, contexto: contexto(), filtros, sinonimos: [], minimo: 0 })!;
    expect(cortarCandidatos(pre, contexto(), pre.produtos.length)).toBe(pre);
    const corte = cortarCandidatos(pre, contexto(), 25);
    expect(corte.produtos).toHaveLength(25);
    const posicoes = corte.produtos.map((p) => PRODUTOS.indexOf(p));
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
    expect(corte.pre).toHaveLength(25);
    expect(corte.maxVendas).toBe(pre.maxVendas);
  });

  it('T-0119: o empate de texto é decidido pelo estoque (o boost do ranking), não pela posição no cadastro', () => {
    const iguais = Array.from({ length: 40 }, (_, i): ProdutoCatalogo => ({ ...PRODUTOS[0]!, id: uuid(5000 + i), sku: `ZZ${i}`, ean: null, nome: 'Pastilha igual', marca: 'Cobreq', categoria: 'Freios', ativo: true, atributos: [], aplicacao: '', referencias: [], campanha: false, vendas: 0 }));
    const emEstoque = iguais[37]!;
    const ctx = contexto({ saldos: new Map([[emEstoque.id, [{ branch_id: FILIAL, branch_name: 'CD', quantity: 9, updated_at: AGORA }]]]) });
    const filtros = interpretarConsulta('pastilha igual', vocabularioDe(iguais));
    const pre = candidatosDaBusca({ produtos: iguais, contexto: ctx, filtros, sinonimos: [], minimo: 0 })!;
    expect(cortarCandidatos(pre, ctx, 5).produtos).toContain(emEstoque);
    const cheia = buscarProdutos({ produtos: iguais, contexto: ctx, filtros, sinonimos: [], limit: 1, offset: 0 });
    expect(cheia.items[0]!.id).toBe(emEstoque.id);
  });

  it('RN-CAT-05/07: temEstoqueParaBusca diz o mesmo que o estoque do documento do ranking (filiais do usuário, perfil sem estoque, número escondido)', () => {
    const p = PRODUTOS[0]!;
    const saldos = (...q: number[]) => new Map([[p.id, q.map((quantity, i) => ({ branch_id: i === 0 ? FILIAL : `f${i}`, branch_name: `F${i}`, quantity, updated_at: AGORA }))]]);
    const casos = [
      contexto({ saldos: saldos(0, 0) }),
      contexto({ saldos: saldos(0, 3) }),
      contexto({ saldos: saldos(5) }),
      contexto({ saldos: saldos(0, 3), filiais: [FILIAL] }),
      contexto({ saldos: saldos(2, 3), filiais: [] }),
      contexto({ saldos: new Map() }),
      contexto({ saldos: saldos(4), parametros: { ...PARAMETROS_PADRAO, estoque_mostrar_quantidade: false } }),
      contexto({ saldos: saldos(4), perfil: 'promotor', parametros: { ...PARAMETROS_PADRAO, promotor_ve_preco_estoque: false } }),
    ];
    for (const ctx of casos) expect(temEstoqueParaBusca(p, ctx)).toBe(docDeBusca(p, itemDaVitrine(p, ctx)).estoque > 0);
  });

  it('T-0119: o código exato nunca é cortado', () => {
    const filtros = interpretarConsulta('pastilha SK000042', vocabularioDe(PRODUTOS));
    const pre = candidatosDaBusca({ produtos: PRODUTOS, contexto: contexto(), filtros, sinonimos: [], minimo: 0 })!;
    expect(cortarCandidatos(pre, contexto(), 3).produtos.map((p) => p.sku)).toContain('SK000042');
  });
});
