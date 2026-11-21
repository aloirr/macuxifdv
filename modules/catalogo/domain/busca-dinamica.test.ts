/**
 * R-20261120-101755-alexandre (v1.0.17): a busca casa palavra por palavra, cada palavra em qualquer campo do produto —
 * descrição (RN-CAT-08), aplicação com veículo e ano (RN-CAT-11/12), marca, marca concorrente e código da referência
 * cruzada (RN-CAT-09). "AMORTECEDOR GOL 2007 MAHLE 33000" traz o amortecedor do Gol 2007 com a referência Mahle 33000.
 * Valor × regra pelo caminho do aparelho e da API: `interpretarConsulta` → `buscarProdutos`, com e sem a pré-seleção do índice.
 */
import { describe, expect, it } from 'vitest';
import { interpretarConsulta } from './consulta';
import { candidatosDaBusca } from './indice-busca';
import { PARAMETROS_PADRAO } from './parametros';
import { buscarProdutos, vocabularioDe, type ContextoVitrine, type ProdutoCatalogo } from './vitrine';

const AGORA = '2026-11-20T12:00:00.000Z';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MAHLE = uuid(900001);

const produto = (n: number, o: Partial<ProdutoCatalogo>): ProdutoCatalogo => ({
  id: uuid(n), sku: `SK${n}`, ean: null, nome: '', marca: 'Cofap', categoria: 'Suspensão', unidade: 'UN', ativo: true, atributos: [],
  aplicacao: '', referencias: [], thumbnail_url: null, campanha: false, vendas: 0, ...o,
});

/** O produto do exemplo do dono do produto. */
const ALVO = produto(1, { nome: 'AMORTECEDOR DIANTEIRO', aplicacao: 'GOL 2005 A 2010', referencias: [{ marca_id: MAHLE, marca_nome: 'MAHLE', codigo: '33000' }] });
const PRODUTOS: ProdutoCatalogo[] = [
  ALVO,
  produto(2, { nome: 'AMORTECEDOR DIANTEIRO', aplicacao: 'GOL 2012 A 2016', referencias: [{ marca_id: MAHLE, marca_nome: 'MAHLE', codigo: '33100' }] }),
  produto(3, { nome: 'AMORTECEDOR TRASEIRO', aplicacao: 'GOL 2005 A 2010', referencias: [{ marca_id: MAHLE, marca_nome: 'MAHLE', codigo: '99999' }] }),
  produto(4, { nome: 'AMORTECEDOR DIANTEIRO', aplicacao: 'UNO 2005 A 2010' }),
  // Mahle também é marca própria de outro produto do tenant: vira palavra do vocabulário de marcas
  produto(5, { nome: 'FILTRO DE OLEO', marca: 'MAHLE', categoria: 'Filtros', aplicacao: 'GOL 2005 A 2010' }),
];

const contexto: ContextoVitrine = {
  perfil: 'vendedor', parametros: PARAMETROS_PADRAO, agora: AGORA, clienteId: null, tabelaClienteId: null, itensPreco: [], promocoes: [], saldos: new Map(), filiais: null,
};

function buscarPagina(q: string, comIndice = false) {
  const filtros = interpretarConsulta(q, vocabularioDe(PRODUTOS));
  const base = { contexto, filtros, sinonimos: [], limit: 50, offset: 0, anoAtual: 2026 };
  if (comIndice) {
    const pre = candidatosDaBusca({ produtos: PRODUTOS, contexto, filtros, sinonimos: [], anoAtual: 2026, minimo: 0 })!;
    return buscarProdutos({ ...base, produtos: pre.produtos, maxVendas: pre.maxVendas });
  }
  return buscarProdutos({ ...base, produtos: PRODUTOS });
}
const buscar = (q: string, comIndice = false): string[] => buscarPagina(q, comIndice).items.map((x) => x.id);

describe.each([false, true])('R-20261120-101755: busca palavra por palavra em qualquer campo (índice: %s)', (comIndice) => {
  it('RN-CAT-09 + R-20261120-103142: com outro código ("MAHLE 99999"), só aparece quem casa tudo (o alvo casa em parte e some)', () => {
    expect(buscar('AMORTECEDOR GOL 2007 MAHLE 99999', comIndice)).toEqual([uuid(3)]);
  });
  it('a ordem das palavras não importa', () => {
    expect(buscar('33000 MAHLE 2007 GOL AMORTECEDOR', comIndice)[0]).toBe(ALVO.id);
  });
});

it('RN-CAT-09: o filtro de marca "mahle" traz quem tem a Mahle como marca própria e como marca concorrente', () => {
  expect(buscar('mahle')).toEqual(expect.arrayContaining([ALVO.id, uuid(5)]));
});

/**
 * Premissa (R-20261120-194335): "casar a palavra" = grupo de sinônimos com nota > 0; produto exato por código (SKU, EAN, n-grama,
 * referência) casa tudo; o ano da consulta fora dos anos da aplicação é só "o grupo do ano não casa".
 */
describe.each([false, true])('R-20261120-194335: só quem casa tudo; sem ninguém, lista vazia (índice: %s)', (comIndice) => {
  it('RN-CAT-12: "AMORTECEDOR GOL 2015 MAHLE 33000" (ano fora de 2005 a 2010): ninguém casa tudo, lista vazia', () => {
    expect(buscar('AMORTECEDOR GOL 2015 MAHLE 33000', comIndice)).toEqual([]);
  });
  it('RN-CAT-08: "AMORTECEDOR GOL 2007 MAHLE 33000": o alvo casa tudo e o Uno (só "amortecedor") não aparece', () => {
    const r = buscar('AMORTECEDOR GOL 2007 MAHLE 33000', comIndice);
    expect(r).toEqual([ALVO.id]);
  });
  it('RN-CAT-08: quem casa só em parte não aparece e o total conta só quem casa tudo', () => {
    const pagina = buscarPagina('amortecedor traseiro gol', comIndice);
    expect(pagina.items.map((x) => x.id)).toEqual([uuid(3)]);
    expect(pagina.total).toBe(1);
  });
  it('R-20261120-103142: "amortecedor 2007" não traz o Gol 2012 a 2016', () => {
    expect(buscar('amortecedor 2007', comIndice)).not.toContain(uuid(2));
  });
});

describe('R-20261120-101755: pré-nota do índice vê o ano da consulta', () => {
  it('RN-CAT-12: a pré-seleção descarta o Gol 2012 a 2016 (2 de 3 palavras) para "amortecedor gol 2007" e mantém o Gol 2005 a 2010', () => {
    const filtros = interpretarConsulta('amortecedor gol 2007', vocabularioDe(PRODUTOS));
    const pre = candidatosDaBusca({ produtos: PRODUTOS, contexto, filtros, sinonimos: [], anoAtual: 2026, minimo: 0 })!;
    const daPre = (id: string) => pre.pre![pre.produtos.findIndex((p) => p.id === id)]!;
    // R-20261120-194335: quem casa só 2 de 3 palavras (ano fora) já sai da pré-seleção
    const ids = pre.produtos.map((p) => p.id);
    expect(ids).toContain(ALVO.id);
    expect(ids).not.toContain(uuid(2));
    expect(daPre(ALVO.id).pontos).toBeGreaterThan(0);
  });
});
