import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import { interpretarConsulta } from './consulta';
import { PARAMETROS_PADRAO, resolverParametros } from './parametros';
import { MENSAGEM_SEM_PRECO_CLIENTE } from './preco';
import { buscarProdutos, docDeBusca, itemDaVitrine, listarVitrine, MENSAGEM_SEM_PRECO_CATALOGO, vocabularioDe, type ContextoVitrine, type ProdutoCatalogo } from './vitrine';

const relogio = criarRelogio();
const AGORA = relogio.iso();
const ONTEM = relogio.relativo({ dias: -1 }).toISOString();
const HA_UMA_HORA = relogio.relativo({ horas: -1 }).toISOString();

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TABELA = id(900);
const CLIENTE = id(800);
const FILIAL = id(700);

const p = (n: number, nome: string, marca: string, categoria: string, o: Partial<ProdutoCatalogo> = {}): ProdutoCatalogo => ({
  id: id(n),
  sku: `SKU-${n}`,
  ean: null,
  nome,
  marca,
  categoria,
  unidade: 'UN',
  ativo: true,
  atributos: [],
  thumbnail_url: null,
  campanha: false,
  vendas: 0,
  ...o,
});

const PRODUTOS: ProdutoCatalogo[] = [
  p(1, 'Café torrado e moído 500 g', 'Aroma da Serra', 'Mercearia', { vendas: 50 }),
  p(2, 'Arroz tipo 1 5 kg', 'Grão Nobre', 'Mercearia', { vendas: 80, campanha: true }),
  p(3, 'Feijão carioca 1 kg', 'Grão Nobre', 'Mercearia'),
  p(4, 'Detergente líquido 500 ml', 'Brilho', 'Limpeza'),
  p(5, 'Desinfetante 2 L', 'Brilho', 'Limpeza', { ativo: false }),
];

const preco = (n: number, cents: number) => ({ price_table_id: TABELA, product_id: id(n), price_cents: cents, valid_from: ONTEM, valid_to: null });
const saldo = (n: number, q: number) => [{ branch_id: FILIAL, branch_name: 'CD Manaus', quantity: q, updated_at: HA_UMA_HORA }];

const ctx = (o: Partial<ContextoVitrine> = {}): ContextoVitrine => ({
  perfil: 'vendedor',
  parametros: PARAMETROS_PADRAO,
  agora: AGORA,
  clienteId: CLIENTE,
  tabelaClienteId: TABELA,
  itensPreco: [preco(1, 1890), preco(2, 2690), preco(4, 239)],
  promocoes: [],
  saldos: new Map([
    [id(1), saldo(1, 40)],
    [id(2), saldo(2, 5)],
    [id(3), saldo(3, 0)],
    [id(4), saldo(4, 100)],
  ]),
  filiais: null,
  ...o,
});

describe('itemDaVitrine — preço e estoque do cartão (RF-CAT-03)', () => {
  it('RN-CAT-06: com cliente em contexto, o preço é o da tabela dele; fora dela, "Sem preço para este cliente." e não vendável', () => {
    const cafe = itemDaVitrine(PRODUTOS[0]!, ctx());
    expect(cafe).toMatchObject({ id: id(1), erp_code: 'SKU-1', description: 'Café torrado e moído 500 g', brand: 'Aroma da Serra', line: 'Mercearia', unit: 'UN', price_stock_visible: true });
    expect(cafe.price).toMatchObject({ price_cents: 1890, sellable: true, source: 'cliente', notice: null });
    const feijao = itemDaVitrine(PRODUTOS[2]!, ctx());
    expect(feijao.price).toMatchObject({ price_cents: null, sellable: false, notice: MENSAGEM_SEM_PRECO_CLIENTE });
  });

  it('RN-CAT-06: cliente SEM tabela de preço = nenhum produto vendável para ele (nunca cai na tabela padrão)', () => {
    const padrao = { price_table_id: null, product_id: id(1), price_cents: 999, valid_from: null, valid_to: null };
    const cafe = itemDaVitrine(PRODUTOS[0]!, ctx({ tabelaClienteId: null, itensPreco: [padrao] }));
    expect(cafe.price).toMatchObject({ price_cents: null, sellable: false, notice: MENSAGEM_SEM_PRECO_CLIENTE });
  });

  it('RF-CAT-03: sem cliente em contexto e sem tabela padrão, o cartão pede para escolher o cliente', () => {
    const cafe = itemDaVitrine(PRODUTOS[0]!, ctx({ clienteId: null, tabelaClienteId: null, itensPreco: [] }));
    expect(cafe.price).toMatchObject({ price_cents: null, sellable: false, notice: MENSAGEM_SEM_PRECO_CATALOGO });
  });

  it('RN-CAT-07: estoque em faixas com a hora da atualização; filial fora do escopo do usuário não conta', () => {
    expect(itemDaVitrine(PRODUTOS[1]!, ctx()).availability).toMatchObject({ band: 'baixo', quantity: 5, stale: false, updated_at: HA_UMA_HORA });
    expect(itemDaVitrine(PRODUTOS[0]!, ctx({ filiais: [id(1)] })).availability).toMatchObject({ band: 'sem_estoque', quantity: 0 });
  });

  it('RN-CAT-05: o promotor vê a ficha sem preço e sem estoque (padrão); com o parâmetro ligado, vê como o vendedor', () => {
    const promotor = itemDaVitrine(PRODUTOS[0]!, ctx({ perfil: 'promotor' }));
    expect(promotor).toMatchObject({ price: null, availability: null, price_stock_visible: false, description: 'Café torrado e moído 500 g' });
    const ligado = itemDaVitrine(PRODUTOS[0]!, ctx({ perfil: 'promotor', parametros: resolverParametros({ promotor_ve_preco_estoque: true }) }));
    expect(ligado.price?.price_cents).toBe(1890);
  });
});

describe('docDeBusca — o que o ranking enxerga', () => {
  it('RN-CAT-05: para quem não vê estoque, todo produto entra com estoque 0 e sem preço (a ordem da lista não revela nada)', () => {
    const doc = docDeBusca(PRODUTOS[0]!, itemDaVitrine(PRODUTOS[0]!, ctx({ perfil: 'promotor' })));
    expect(doc).toMatchObject({ estoque: 0, preco_cents: null, nome: 'Café torrado e moído 500 g', sku: 'SKU-1' });
  });

  it('RN-CAT-07: com o número escondido pelo tenant, a faixa ainda diz se tem estoque', () => {
    const c = ctx({ parametros: resolverParametros({ estoque_mostrar_quantidade: false }) });
    expect(docDeBusca(PRODUTOS[0]!, itemDaVitrine(PRODUTOS[0]!, c)).estoque).toBe(1);
    expect(docDeBusca(PRODUTOS[2]!, itemDaVitrine(PRODUTOS[2]!, c)).estoque).toBe(0);
  });
});

describe('buscarProdutos — busca paginada (RF-CAT-01, RF-CAT-02)', () => {
  const buscar = (q: string, o: Partial<Parameters<typeof buscarProdutos>[0]> = {}) =>
    buscarProdutos({ produtos: PRODUTOS, contexto: ctx(), filtros: interpretarConsulta(q, vocabularioDe(PRODUTOS)), sinonimos: [], limit: 20, offset: 0, ...o });

  it('RF-CAT-01: acha pelo nome, devolve a nota e o cartão completo', () => {
    const r = buscar('cafe');
    expect(r.items.map((i) => i.id)).toEqual([id(1)]);
    expect(r.items[0]!.score).toBeGreaterThan(0);
    expect(r).toMatchObject({ total: 1, next_offset: null });
  });

  it('RN-CAT-01: produto inativo nunca aparece', () => {
    expect(buscar('desinfetante').items).toEqual([]);
  });

  it('RF-CAT-02: sinônimo do tenant acha o produto nos dois sentidos', () => {
    const r = buscar('feijao', { sinonimos: [{ term: 'feijão', synonyms: ['carioquinha'] }] });
    expect(r.items.map((i) => i.id)).toEqual([id(3)]);
    expect(buscar('carioquinha', { sinonimos: [{ term: 'feijão', synonyms: ['carioquinha'] }] }).items.map((i) => i.id)).toEqual([id(3)]);
  });

  it('RF-CAT-01: chips da tela somam aos filtros da frase (marca e só com estoque)', () => {
    // "mercearia" fica no texto (categoria só vira filtro com palavra de apoio) e casa pela categoria; o feijão sai sem estoque
    expect(buscar('mercearia', { chips: { brand: 'Grão Nobre', only_in_stock: true } }).items.map((i) => i.id)).toEqual([id(2)]);
    expect(buscar('mercearia', { chips: { brand: 'Grão Nobre' } }).items.map((i) => i.id).sort()).toEqual([id(2), id(3)]);
    expect(buscar('mercearia', { chips: { line: 'Limpeza' } }).items).toEqual([]);
  });

  it('RN-CAT-05: o promotor não filtra nem ordena por preço/estoque (o filtro some e a lista não muda pela regra)', () => {
    const promotor = buscarProdutos({ produtos: PRODUTOS, contexto: ctx({ perfil: 'promotor' }), filtros: interpretarConsulta('grão nobre com estoque até R$ 10', vocabularioDe(PRODUTOS)), sinonimos: [], limit: 20, offset: 0 });
    expect(promotor.items.map((i) => i.id).sort()).toEqual([id(2), id(3)]);
    expect(promotor.items.every((i) => i.price === null && i.availability === null)).toBe(true);
    const vendedor = buscarProdutos({ produtos: PRODUTOS, contexto: ctx(), filtros: interpretarConsulta('grão nobre com estoque até R$ 30', vocabularioDe(PRODUTOS)), sinonimos: [], limit: 20, offset: 0 });
    expect(vendedor.items.map((i) => i.id)).toEqual([id(2)]);
  });

  it('paginação: limit e offset sobre a lista ordenada; next_offset nulo no fim', () => {
    const todos = buscarProdutos({ produtos: PRODUTOS, contexto: ctx(), filtros: interpretarConsulta('', vocabularioDe(PRODUTOS)), sinonimos: [], limit: 2, offset: 0 });
    expect(todos).toMatchObject({ total: 4, next_offset: 2 });
    const resto = buscarProdutos({ produtos: PRODUTOS, contexto: ctx(), filtros: interpretarConsulta('', vocabularioDe(PRODUTOS)), sinonimos: [], limit: 2, offset: 2 });
    expect(resto).toMatchObject({ total: 4, next_offset: null });
    expect(new Set([...todos.items, ...resto.items].map((i) => i.id)).size).toBe(4);
  });
});

describe('listarVitrine — navegar sem texto (RF-CAT-01)', () => {
  it('RN-CAT-08: sem texto ordenam os boosts (estoque, mais vendido, campanha); desempate pelo nome', () => {
    const r = listarVitrine({ produtos: PRODUTOS, contexto: ctx(), chips: {}, sinonimos: [], limit: 50, offset: 0 });
    expect(r.items.map((i) => i.description)).toEqual(['Arroz tipo 1 5 kg', 'Café torrado e moído 500 g', 'Detergente líquido 500 ml', 'Feijão carioca 1 kg']);
  });

  it('RF-CAT-01: filtro de campanha e de categoria', () => {
    expect(listarVitrine({ produtos: PRODUTOS, contexto: ctx(), chips: { campaign: true }, sinonimos: [], limit: 50, offset: 0 }).items.map((i) => i.id)).toEqual([id(2)]);
    expect(listarVitrine({ produtos: PRODUTOS, contexto: ctx(), chips: { line: 'limpeza' }, sinonimos: [], limit: 50, offset: 0 }).items.map((i) => i.id)).toEqual([id(4)]);
  });
});

describe('vocabularioDe', () => {
  it('RN-CAT-01: marcas e categorias só dos produtos ativos do tenant, sem repetir, em ordem alfabética', () => {
    expect(vocabularioDe(PRODUTOS)).toEqual({ marcas: ['Aroma da Serra', 'Brilho', 'Grão Nobre'], linhas: ['Limpeza', 'Mercearia'] });
  });
});

describe('RF-CAT-04: navegação pela árvore filtra a vitrine', () => {
  it('RF-CAT-04: o nó escolhido limita a vitrine aos produtos dele (e dos níveis abaixo), somando aos chips de marca e estoque', () => {
    const sNo = new Set([id(1), id(2), id(3)]);
    expect(listarVitrine({ produtos: PRODUTOS, contexto: ctx(), chips: { only_product_ids: sNo }, sinonimos: [], limit: 20, offset: 0 }).items.map((i) => i.id).sort()).toEqual([id(1), id(2), id(3)]);
    const comEstoque = listarVitrine({ produtos: PRODUTOS, contexto: ctx(), chips: { only_product_ids: sNo, only_in_stock: true }, sinonimos: [], limit: 20, offset: 0 });
    expect(comEstoque.items.map((i) => i.id).sort()).toEqual([id(1), id(2)]);
    const marca = listarVitrine({ produtos: PRODUTOS, contexto: ctx(), chips: { only_product_ids: sNo, brand: 'Grão Nobre' }, sinonimos: [], limit: 20, offset: 0 });
    expect(marca.items.map((i) => i.id).sort()).toEqual([id(2), id(3)]);
  });

  it('RF-CAT-04: nó sem produto devolve lista vazia (não a vitrine inteira)', () => {
    expect(listarVitrine({ produtos: PRODUTOS, contexto: ctx(), chips: { only_product_ids: new Set() }, sinonimos: [], limit: 20, offset: 0 }).total).toBe(0);
  });

  it('RN-CAT-06: dentro do pedido (só da tabela do cliente) saem os produtos sem preço vigente na tabela dele', () => {
    const r = listarVitrine({ produtos: PRODUTOS, contexto: ctx(), chips: { only_sellable: true }, sinonimos: [], limit: 20, offset: 0 });
    expect(r.items.map((i) => i.id).sort()).toEqual([id(1), id(2), id(4)]);
  });

  it('RN-CAT-06: cliente sem tabela, dentro do pedido, não tem produto vendável', () => {
    const r = listarVitrine({ produtos: PRODUTOS, contexto: ctx({ tabelaClienteId: null, itensPreco: [] }), chips: { only_sellable: true }, sinonimos: [], limit: 20, offset: 0 });
    expect(r.total).toBe(0);
  });

  it('RN-CAT-05: para o promotor (sem preço) o nó filtra do mesmo jeito, só leitura, e o filtro de vendável não revela preço', () => {
    const r = listarVitrine({ produtos: PRODUTOS, contexto: ctx({ perfil: 'promotor' }), chips: { only_product_ids: new Set([id(1), id(3)]) }, sinonimos: [], limit: 20, offset: 0 });
    expect(r.items.map((i) => i.id).sort()).toEqual([id(1), id(3)]);
    expect(r.items.every((i) => i.price === null)).toBe(true);
  });
});
