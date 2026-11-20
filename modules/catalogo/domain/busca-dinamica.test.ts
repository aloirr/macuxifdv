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

function buscar(q: string, comIndice = false): string[] {
  const filtros = interpretarConsulta(q, vocabularioDe(PRODUTOS));
  const base = { contexto, filtros, sinonimos: [], limit: 50, offset: 0, anoAtual: 2026 };
  if (comIndice) {
    const pre = candidatosDaBusca({ produtos: PRODUTOS, contexto, filtros, sinonimos: [], anoAtual: 2026, minimo: 0 });
    if (pre) return buscarProdutos({ ...base, produtos: pre.produtos, maxVendas: pre.maxVendas }).items.map((x) => x.id);
  }
  return buscarProdutos({ ...base, produtos: PRODUTOS }).items.map((x) => x.id);
}

describe.each([false, true])('R-20261120-101755: busca palavra por palavra em qualquer campo (índice: %s)', (comIndice) => {
  it('RN-CAT-08/09/11: "AMORTECEDOR GOL 2007 MAHLE 33000" traz o amortecedor do Gol 2007 com a referência Mahle 33000 em primeiro', () => {
    expect(buscar('AMORTECEDOR GOL 2007 MAHLE 33000', comIndice)[0]).toBe(ALVO.id);
  });
  it('RN-CAT-09: com outro código ("MAHLE 99999"), o produto que casa tudo vem antes do alvo', () => {
    const r = buscar('AMORTECEDOR GOL 2007 MAHLE 99999', comIndice);
    expect(r[0]).toBe(uuid(3));
    expect(r).toContain(ALVO.id);
    expect(r.indexOf(ALVO.id)).toBeGreaterThan(r.indexOf(uuid(3)));
  });
  it('RN-CAT-09: o filtro de marca "mahle" traz quem tem a Mahle como marca própria e como marca concorrente', () => {
    expect(buscar('mahle', comIndice)).toEqual(expect.arrayContaining([ALVO.id, uuid(5)]));
  });
  it('a ordem das palavras não importa', () => {
    expect(buscar('33000 MAHLE 2007 GOL AMORTECEDOR', comIndice)[0]).toBe(ALVO.id);
  });
});

describe('R-20261120-101755: pré-nota do índice vê o ano da consulta', () => {
  it('RN-CAT-12: a pré-nota zera o Gol 2012 a 2016 para "gol 2007" e não zera o Gol 2005 a 2010', () => {
    const filtros = interpretarConsulta('amortecedor gol 2007', vocabularioDe(PRODUTOS));
    const pre = candidatosDaBusca({ produtos: PRODUTOS, contexto, filtros, sinonimos: [], anoAtual: 2026, minimo: 0 })!;
    const nota = (id: string) => pre.pre![pre.produtos.findIndex((p) => p.id === id)]?.pontos;
    expect(nota(ALVO.id)).toBeGreaterThan(0);
    const idx = pre.produtos.findIndex((p) => p.id === uuid(2));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(pre.pre![idx]!.pontos).toBe(0);
  });
});
