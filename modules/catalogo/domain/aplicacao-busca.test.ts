/**
 * RN-CAT-12 (busca pela aplicação), RN-CAT-09 (referência cruzada) e critério 4 da T-0084 (tenant sem aplicação).
 * Caminho completo SEM LLM: interpretar → sinônimos → ranking → trecho "Serve em".
 */
import { describe, expect, it } from 'vitest';
import type { FiltrosInterpretados, Referencia } from '../contracts';
import { interpretarConsulta } from './consulta';
import { PARAMETROS_PADRAO } from './parametros';
import { rankear, codigosDaConsulta, type DocBusca } from './ranking';
import { trechoServeEm } from './serve-em';
import { equivaleA } from './vitrine';
import { expandirSinonimos } from './texto';

const ANO = 2026;
const VOCAB = { marcas: [], linhas: [] };
const doc = (o: Partial<DocBusca> & { id: string }): DocBusca => ({
  sku: o.id.toUpperCase(),
  ean: null,
  nome: 'Produto',
  marca: '',
  categoria: '',
  atributos: '',
  aplicacao: '',
  referencias: [],
  estoque: 0,
  vendas: 0,
  campanha: false,
  preco_cents: 1000,
  ...o,
});
const buscar = (docs: DocBusca[], q: string, sinonimos: { term: string; synonyms: string[] }[] = [], parametros = PARAMETROS_PADRAO) =>
  rankear(docs, { filtros: interpretarConsulta(q, VOCAB), sinonimos, parametros, anoAtual: ANO });
const ids = (docs: DocBusca[], q: string, sin: { term: string; synonyms: string[] }[] = []) => buscar(docs, q, sin).map((i) => i.doc.id);
const grupos = (q: string) => expandirSinonimos(interpretarConsulta(q, VOCAB).text, []);

const PASTILHA = doc({ id: 'pastilha', nome: 'Pastilha de freio dianteira', aplicacao: 'Fiat Uno 1.0/1.4 2010–2014' });
const FILTRO = doc({ id: 'filtro', nome: 'Filtro de óleo', aplicacao: 'VW Gol G5/G6 1.0/1.6 2009–2016' });

describe('RN-CAT-12: busca pela aplicação', () => {
  it('RN-CAT-12: "pastilha uno 2012" acha a pastilha do Uno 2010–2014', () => {
    expect(ids([PASTILHA, FILTRO], 'pastilha uno 2012')).toEqual(['pastilha']);
  });

  it('RN-CAT-12 + R-20261120-103142: "pastilha uno 2015" (ano fora da faixa): ninguém casa tudo, a pastilha vem como a mais próxima', () => {
    expect(ids([PASTILHA, FILTRO], 'pastilha uno 2015')).toEqual(['pastilha']);
  });

  it('RN-CAT-12 + R-20261120-103142: "pastilha uno 2015" com outra pastilha do Uno que cobre 2015: só ela aparece, a de 2010–2014 some', () => {
    const outra = doc({ id: 'outra', nome: 'Pastilha de freio traseira', aplicacao: 'Fiat Uno 2014–2018' });
    expect(ids([PASTILHA, FILTRO, outra], 'pastilha uno 2015')).toEqual(['outra']);
  });

  it('RN-CAT-12: "filtro gol 2014" acha o filtro do Gol 2009–2016', () => {
    expect(ids([PASTILHA, FILTRO], 'filtro gol 2014')).toEqual(['filtro']);
  });

  it('RN-CAT-12: "1.0/1.4" e "G5/G6" não viram faixa de anos', () => {
    // nenhum ano é gerado: a consulta "1014" ou "56" não acha nada pela faixa
    expect(ids([PASTILHA, FILTRO], '1014')).toEqual([]);
    expect(ids([PASTILHA, FILTRO], 'filtro g5 g6')).toEqual(['filtro']);
  });

  it('RN-CAT-12: sinônimo do tenant vale na aplicação ("volkswagen" = VW)', () => {
    expect(ids([PASTILHA, FILTRO], 'filtro volkswagen gol', [{ term: 'VW', synonyms: ['Volkswagen'] }])).toEqual(['filtro']);
  });

  it('RN-CAT-12: quem casa pelo nome vem antes de quem casa só pela aplicação, mesmo com campanha e estoque', () => {
    const c = doc({ id: 'c', nome: 'Pastilha Uno' });
    const d = doc({ id: 'd', nome: 'Pastilha', aplicacao: 'Uno', campanha: true, estoque: 50, vendas: 99 });
    expect(ids([d, c], 'pastilha uno')).toEqual(['c', 'd']);
    const soAplicacao = doc({ id: 'e', nome: 'Disco', aplicacao: 'Pastilha Uno', campanha: true, estoque: 50, vendas: 99 });
    const r = buscar([soAplicacao, c], 'pastilha uno');
    expect(r.map((i) => i.doc.id)).toEqual(['c', 'e']);
    expect(r.map((i) => i.so_aplicacao)).toEqual([false, true]);
  });

  it('RN-CAT-12: o peso da aplicação vem do parâmetro peso_aplicacao (padrão 0,5)', () => {
    const solo = doc({ id: 'x', nome: 'Disco', aplicacao: 'Uno' });
    const padrao = buscar([solo], 'uno')[0]!.textual;
    const zero = buscar([solo], 'uno', [], { ...PARAMETROS_PADRAO, peso_aplicacao: 0 });
    expect(padrao).toBe(0.5);
    expect(zero).toEqual([]);
    expect(buscar([solo], 'uno', [], { ...PARAMETROS_PADRAO, peso_aplicacao: 1 })[0]!.textual).toBe(1);
  });

  it('RN-CAT-12: faixa aberta ("a partir de 2018") usa o ano atual + 1 do relógio injetado', () => {
    const novo = doc({ id: 'novo', nome: 'Amortecedor', aplicacao: 'Onix a partir de 2018' });
    expect(ids([novo], 'amortecedor 2027')).toEqual(['novo']);
  });

  it('RN-CAT-12: o ano da consulta que casa em outro campo conta como palavra casada', () => {
    const d = doc({ id: 'd', nome: 'Pastilha 2015', aplicacao: 'Fiat Uno 2010–2014' });
    expect(ids([d], 'pastilha 2015')).toEqual(['d']);
  });

  it('RN-CAT-12: interpretar mantém modelo, motor e ano no texto da consulta', () => {
    const t = interpretarConsulta('pastilha uno 1.0 2012', VOCAB).text;
    expect(t).toContain('uno');
    expect(t).toContain('1.0');
    expect(t).toContain('2012');
  });

  it('RN-CAT-12: produto sem aplicação não muda de resultado nem de nota (tenant sem aplicação)', () => {
    const sem = [doc({ id: 'a', nome: 'Pastilha de freio', estoque: 3 }), doc({ id: 'b', nome: 'Pastilha traseira', vendas: 4 }), doc({ id: 'c', nome: 'Disco de freio' })];
    const com = sem.map((d) => ({ ...d, aplicacao: '' }));
    const filtros: FiltrosInterpretados = interpretarConsulta('pastilha freio', VOCAB);
    const e = { filtros, sinonimos: [], parametros: PARAMETROS_PADRAO, anoAtual: ANO };
    expect(rankear(com, e)).toEqual(rankear(sem, e));
    expect(rankear(com, e).every((i) => !i.so_aplicacao)).toBe(true);
  });
});

describe('RN-CAT-12: trecho "Serve em"', () => {
  const opc = { anoAtual: ANO };

  it('RN-CAT-12: "pastilha uno 2012" devolve o segmento do Uno com marcas em "Uno" e "2010–2014" e inclui 2012', () => {
    const t = trechoServeEm('Fiat Uno 1.0/1.4 2010–2014; Palio 1.0 2012–2016', grupos('pastilha uno 2012'), opc)!;
    expect(t.texto).toBe('Fiat Uno 1.0/1.4 2010–2014');
    expect(t.marcas.map(([a, b]) => t.texto.slice(a, b))).toEqual(['Uno', '2010–2014']);
    expect(t.inclui_ano).toBe(2012);
  });

  it('RN-CAT-12: ano literal na consulta ("2010") não gera inclui_ano', () => {
    const t = trechoServeEm('Fiat Uno 1.0/1.4 2010–2014', grupos('uno 2010'), opc)!;
    expect(t.inclui_ano).toBeNull();
    expect(t.marcas.map(([a, b]) => t.texto.slice(a, b))).toEqual(['Uno', '2010']);
  });

  it('RN-CAT-12: texto de 300 caracteres sem separador sai com até 90 e reticências', () => {
    const longo = `Aplicação geral ${'linha leve nacional importado '.repeat(8)}Fiat Uno ${'modelo variante '.repeat(5)}final`;
    expect(longo.length).toBeGreaterThan(300);
    const t = trechoServeEm(longo, grupos('uno'), opc)!;
    expect(t.texto.length).toBeLessThanOrEqual(90);
    expect(t.texto).toContain('…');
    expect(t.marcas.map(([a, b]) => t.texto.slice(a, b))).toEqual(['Uno']);
  });

  it('RN-CAT-12: consulta que só casa no nome devolve nulo', () => {
    expect(trechoServeEm('Fiat Uno 2010–2014', grupos('pastilha'), opc)).toBeNull();
    expect(trechoServeEm('', grupos('uno'), opc)).toBeNull();
    expect(trechoServeEm(null, grupos('uno'), opc)).toBeNull();
  });

  it('RN-CAT-12: o trecho do contrato respeita 90 caracteres e 20 marcas', () => {
    const t = trechoServeEm('Uno '.repeat(100), grupos('uno'), opc)!;
    expect(t.texto.length).toBeLessThanOrEqual(90);
    expect(t.marcas.length).toBeLessThanOrEqual(20);
  });
});

describe('RN-CAT-09: referência cruzada do concorrente', () => {
  const REF: Referencia = { marca_id: '11111111-1111-4111-8111-111111111111', marca_nome: 'Freiomax', codigo: 'CB 3401' };
  const X = doc({ id: 'x', nome: 'Pastilha de freio dianteira', referencias: [REF] });
  const OUTRO = doc({ id: 'outro', nome: 'Pastilha de freio traseira' });

  it.each(['cb3401', 'CB-3401', 'cb 3401'])('RN-CAT-09: "%s" acha o produto como exato', (q) => {
    const r = buscar([OUTRO, X], q);
    expect(r[0]!.doc.id).toBe('x');
    expect(r[0]!.exato).toBe(true);
    expect(r[0]!.referencia_casada).toBe(0);
  });

  it('RN-CAT-09: "pastilha cb3401" acha o produto com a referência', () => {
    expect(ids([OUTRO, X], 'pastilha cb3401')[0]).toBe('x');
  });

  it('RN-CAT-09: "CB3401" acha a referência gravada como "cb-3401"', () => {
    const y = doc({ id: 'y', referencias: [{ ...REF, codigo: 'cb-3401' }] });
    expect(buscar([y], 'CB3401')[0]!.exato).toBe(true);
  });

  it('RN-CAT-09: "3401" sozinho não é exato (um termo só, dígito sem letra) e casa só pelo termo', () => {
    expect(codigosDaConsulta('3401')).toEqual([]);
    const r = buscar([X], '3401');
    expect(r).toHaveLength(1);
    expect(r[0]!.exato).toBe(false);
    expect(r[0]!.referencia_casada).toBe(0);
  });

  it('RN-CAT-09: n-gramas pegam 1 a 3 palavras, de 3 a 30 caracteres compactos', () => {
    expect(codigosDaConsulta('cb 3401')).toContain('cb3401');
    expect(codigosDaConsulta('pastilha cb3401')).toContain('cb3401');
    expect(codigosDaConsulta('a1')).toEqual([]);
    expect(codigosDaConsulta('x'.repeat(31) + '1')).toEqual([]);
  });

  it('RN-CAT-09: "Equivale a" leva a marca e o código marcado', () => {
    const e = equivaleA(REF)!;
    const texto = `${e.marca_nome} ${e.codigo}`;
    expect(e.marcas.map(([a, b]) => texto.slice(a, b))).toEqual(['CB 3401']);
    expect(equivaleA(undefined)).toBeNull();
  });

  it('RN-CAT-09: tenant sem referência dá o mesmo resultado de antes', () => {
    const com = buscar([OUTRO, { ...X, referencias: [] }], 'pastilha freio');
    expect(com.every((i) => i.referencia_casada === null)).toBe(true);
    expect(buscar([OUTRO, X], 'pastilha freio').map((i) => i.doc.id)).toEqual(com.map((i) => i.doc.id));
  });
});
