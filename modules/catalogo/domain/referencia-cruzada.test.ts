import { describe, expect, it } from 'vitest';
import type { FiltrosInterpretados } from '../contracts';
import { PARAMETROS_PADRAO } from './parametros';
import { indiceDaReferenciaCruzada, rankear, codigosDaConsulta, type DocBusca } from './ranking';

const REFS = [
  { marca_id: 'm1', marca_nome: 'Cobreq', codigo: 'CB-3401' },
  { marca_id: 'm2', marca_nome: null, codigo: 'N 1234/X' },
];

describe('RN-CAT-09: a busca acha o produto pela referência cruzada', () => {
  it('RN-CAT-09: o código inteiro casa ignorando espaço, hífen, ponto e caixa', () => {
    expect(indiceDaReferenciaCruzada(['cb3401'], REFS)).toBe(0);
    expect(indiceDaReferenciaCruzada(['n1234x'], REFS)).toBe(1);
  });
  it('RN-CAT-09: um pedaço do código (4 caracteres ou mais, com dígito) também casa', () => {
    expect(indiceDaReferenciaCruzada(["3401"], REFS)).toBe(0);
    expect(indiceDaReferenciaCruzada(['b340'], REFS)).toBe(0);
    expect(indiceDaReferenciaCruzada(['1234'], REFS)).toBe(1);
  });
  it('RN-CAT-09: pedaço curto ou sem dígito não casa (evita ruído)', () => {
    expect(indiceDaReferenciaCruzada(['340'], REFS)).toBeNull();
    expect(indiceDaReferenciaCruzada(['cobreq'], REFS)).toBeNull();
  });
  it('RN-CAT-09: sem referência ou sem pedaço no código, nada casa', () => {
    expect(indiceDaReferenciaCruzada(['cb3401'], [])).toBeNull();
    expect(indiceDaReferenciaCruzada(['9999'], REFS)).toBeNull();
  });
});

describe('RN-CAT-09: códigos da consulta e busca pelo código do concorrente', () => {
  it('RN-CAT-09: só código com letra e dígito vira trecho; número sozinho e palavra comum não', () => {
    expect(codigosDaConsulta('pastilha cb340')).toContain('cb340');
    expect(codigosDaConsulta('pastilha 3401')).not.toContain('3401');
    expect(codigosDaConsulta('pastilha freio')).toEqual([]);
  });
  it('RN-CAT-09: o ranking acha o produto por um pedaço do código do concorrente e mostra "Equivale a"', () => {
    const doc = (id: string, codigo: string | null): DocBusca => ({
      id, sku: id.toUpperCase(), ean: null, nome: `Pastilha ${id}`, marca: 'Fremax', categoria: 'Freios', atributos: '', aplicacao: '', estoque: 1, vendas: 0, campanha: false, preco_cents: 1000,
      referencias: codigo ? [{ marca_id: 'm1', marca_nome: 'Cobreq', codigo }] : [],
    });
    const filtros = { text: 'b340', brand: null, line: null, min_price_cents: null, max_price_cents: null, stock: null, code: null, sort: null } as FiltrosInterpretados;
    const r = rankear([doc('a', 'CB-3401-X'), doc('b', null)], { filtros, sinonimos: [], parametros: PARAMETROS_PADRAO, anoAtual: 2026 });
    expect(r.map((x) => x.doc.id)).toEqual(['a']);
    expect(r[0]!.exato).toBe(true);
    expect(r[0]!.referencia_casada).toBe(0);
  });
});
