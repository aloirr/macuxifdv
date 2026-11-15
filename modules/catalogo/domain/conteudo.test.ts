import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import { agruparTermosSemResultado, conflitoDeSinonimo, montarFicha, normalizarSinonimo, termoDeBusca } from './conteudo';
import { PARAMETROS_PADRAO } from './parametros';
import { itemDaVitrine, type ProdutoCatalogo } from './vitrine';

const relogio = criarRelogio();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('normalizarSinonimo — BKO de sinônimos (RF-CAT-07, RF-CAT-02)', () => {
  it('RF-CAT-07: tira espaços, repetidos (sem acento/caixa/plural) e o próprio termo da lista', () => {
    const r = normalizarSinonimo({ term: '  Refrigerante ', synonyms: ['refri', 'Refri', 'refrigerantes', ' soda '], active: true });
    expect(r).toEqual({ ok: true, valor: { term: 'Refrigerante', synonyms: ['refri', 'soda'], active: true } });
  });

  it('RF-CAT-07: grupo sem nenhum sinônimo de verdade é recusado com a ação seguinte', () => {
    const r = normalizarSinonimo({ term: 'café', synonyms: ['Cafe', 'cafés'], active: true });
    expect(r).toMatchObject({ ok: false, codigo: 'SINONIMO_VAZIO' });
    expect(r.ok ? '' : r.mensagem).toMatch(/Informe ao menos um sinônimo diferente do termo/);
  });
});

describe('conflitoDeSinonimo (RF-CAT-02: um termo vivo por tenant; o índice sinonimo_termo_uk vale também para grupo inativo)', () => {
  const existentes = [
    { id: id(1), term: 'refrigerante', synonyms: ['refri'], active: true },
    { id: id(2), term: 'bolacha', synonyms: ['biscoito'], active: false },
  ];
  it('RF-CAT-07: termo já usado por outro grupo ativo = conflito (mensagem diz qual editar)', () => {
    expect(conflitoDeSinonimo(id(9), { term: 'Refrigerantes', synonyms: ['soda'], active: true }, existentes)).toMatch(/Já existe um grupo ativo para "refrigerante"/);
  });
  it('RF-CAT-02: termo de um grupo INATIVO também conflita (o banco recusa; a mensagem manda reativar ou editar o existente)', () => {
    expect(conflitoDeSinonimo(id(9), { term: 'bolacha', synonyms: ['cookie'], active: true }, existentes)).toMatch(/Já existe um grupo inativo para "bolacha"/);
  });
  it('RF-CAT-02: o novo grupo inativo com o termo de um ativo também conflita', () => {
    expect(conflitoDeSinonimo(id(9), { term: 'refrigerante', synonyms: ['soda'], active: false }, existentes)).toMatch(/Já existe um grupo ativo para "refrigerante"/);
  });
  it('RF-CAT-07: o próprio grupo e termo livre não conflitam', () => {
    expect(conflitoDeSinonimo(id(1), { term: 'refrigerante', synonyms: ['soda'], active: true }, existentes)).toBeNull();
    expect(conflitoDeSinonimo(id(2), { term: 'bolacha', synonyms: ['cookie'], active: false }, existentes)).toBeNull();
    expect(conflitoDeSinonimo(id(9), { term: 'suco', synonyms: ['néctar'], active: true }, existentes)).toBeNull();
  });
});

describe('termos sem resultado (RF-CAT-07)', () => {
  it('RF-CAT-07: o termo é guardado normalizado (sem acento, caixa e plural); vazio ou só símbolo não entra', () => {
    expect(termoDeBusca('  Açúcares  Cristal ')).toBe('acucar cristal');
    expect(termoDeBusca('   ')).toBeNull();
    expect(termoDeBusca('???')).toBeNull();
    expect(termoDeBusca('x'.repeat(300))!.length).toBe(100);
  });

  it('RF-CAT-07: soma por termo só as buscas sem resultado na janela, mais buscados primeiro', () => {
    const r = (termo: string, resultados: number, dias: number) => ({ termo, resultados, em: relogio.relativo({ dias: -dias }).toISOString() });
    const registros = [r('cuscuz', 0, 1), r('cuscuz', 0, 2), r('tapioca', 0, 1), r('cafe', 3, 1), r('farofa', 0, 40), r('cuscuz', 0, 0)];
    const desde = relogio.relativo({ dias: -30 }).toISOString();
    const lista = agruparTermosSemResultado(registros, desde, 10);
    expect(lista.map((t) => [t.term, t.count])).toEqual([
      ['cuscuz', 3],
      ['tapioca', 1],
    ]);
    expect(lista[0]!.last_searched_at).toBe(registros[5]!.em);
    expect(agruparTermosSemResultado(registros, desde, 1)).toHaveLength(1);
  });
});

describe('montarFicha — ficha rica (RF-CAT-03)', () => {
  const produto: ProdutoCatalogo = {
    id: id(1), sku: 'CAF-500', ean: null, nome: 'Café 500 g', marca: 'Aroma', categoria: 'Mercearia', unidade: 'UN', ativo: true,
    atributos: [{ name: 'Torra', value: 'Média' }, { name: 'Peso', value: '500 g' }], thumbnail_url: null, campanha: false, vendas: 0,
  };
  const ctx = { perfil: 'promotor' as const, parametros: PARAMETROS_PADRAO, agora: relogio.iso(), clienteId: null, tabelaClienteId: null, itensPreco: [], promocoes: [], saldos: new Map(), filiais: null };

  it('RF-CAT-03: atributos em ordem de nome, mídias pela ordem cadastrada e conteúdo vazio quando nunca enriquecido', () => {
    const midias = [
      { id: id(3), type: 'foto' as const, url: 'b.jpg', title: null, order: 2 },
      { id: id(2), type: 'foto' as const, url: 'a.jpg', title: 'Frente', order: 1 },
    ];
    const f = montarFicha(produto, itemDaVitrine(produto, ctx), null, midias);
    expect(f.attributes.map((a) => a.name)).toEqual(['Peso', 'Torra']);
    expect(f.media.map((m) => m.url)).toEqual(['a.jpg', 'b.jpg']);
    expect(f.content).toEqual({ description: null, selling_points: [], faq: [] });
    expect(f.content_updated_at).toBeNull();
  });

  it('RN-CAT-05: a ficha do promotor tem conteúdo, fotos e estoque, sem preço', () => {
    const conteudo = { description: 'Torra média, moagem fina.', selling_points: ['Mais vendido da região'], faq: [], updated_at: relogio.iso() };
    const f = montarFicha(produto, itemDaVitrine(produto, ctx), conteudo, []);
    expect(f.product).toMatchObject({ price: null, price_stock_visible: false });
    expect(f.product.availability).not.toBeNull();
    expect(f.content.description).toBe('Torra média, moagem fina.');
    expect(f.content_updated_at).toBe(conteudo.updated_at);
  });
});
