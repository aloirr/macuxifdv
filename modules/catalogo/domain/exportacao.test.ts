import { describe, expect, it } from 'vitest';
import { LIMITE_EXPORTACAO, montarExportacao } from './exportacao';
import type { ProdutoCatalogo } from './vitrine';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const prod = (n: number, o: Partial<ProdutoCatalogo> = {}): ProdutoCatalogo => ({ id: U(n), sku: `P${String(n).padStart(5, '0')}`, ean: null, nome: `Produto ${n}`, marca: '', categoria: '', unidade: 'UN', ativo: true, atributos: [], thumbnail_url: null, campanha: false, vendas: 0, ...o });
const no = (n: number, pai: number | null, nivel: number, nome: string) => ({ id: U(n), pai_id: pai === null ? null : U(pai), nivel, codigo: `N${n}`, nome, ordem: n, ativo: true });
const nos = [no(101, null, 1, 'Freios'), no(102, 101, 2, 'Discos'), no(103, 102, 3, 'Linha Leve'), no(104, 103, 4, 'Sub')];

describe('RF-CAT-09: dados da exportação', () => {
  it('RF-CAT-09: sistema, grupo e linha vêm dos níveis 1 a 3 da trilha mais funda do produto', () => {
    const r = montarExportacao({ produtos: [prod(1)], nos, vinculos: [{ produto_id: U(1), no_id: U(102) }, { produto_id: U(1), no_id: U(104) }], ofereceJunto: new Map() });
    expect(r.produtos[0]!.hierarquia).toEqual({ sistema: 'Freios', grupo: 'Discos', linha: 'Linha Leve' });
  });
  it('RF-CAT-09: produto sem vínculo vem com hierarquia nula; inativo não sai; ordem por código', () => {
    const r = montarExportacao({ produtos: [prod(2), prod(1), prod(3, { ativo: false })], nos, vinculos: [], ofereceJunto: new Map() });
    expect(r.produtos.map((p) => p.codigo)).toEqual(['P00001', 'P00002']);
    expect(r.produtos[0]!.hierarquia).toEqual({ sistema: null, grupo: null, linha: null });
  });
  it('RN-CAT-09: no máximo 3 referências e 5 oferece junto, sem o próprio produto nem inativo', () => {
    const refs = Array.from({ length: 4 }, (_, i) => ({ marca_id: U(900 + i), marca_nome: 'M', codigo: `R${i}` }));
    const outros = [2, 3, 4, 5, 6, 7, 8];
    const r = montarExportacao({
      produtos: [prod(1, { referencias: refs }), ...outros.map((n) => prod(n, n === 3 ? { ativo: false } : {}))],
      nos: [],
      vinculos: [],
      ofereceJunto: new Map([[U(1), [U(1), ...outros.map(U)]]]),
    });
    const p = r.produtos.find((x) => x.id === U(1))!;
    expect(p.referencias).toHaveLength(3);
    expect(p.oferece_junto).toEqual([U(2), U(4), U(5), U(6), U(7)]);
  });
  it('RN-CAT-11: aplicação vazia vira nula', () => {
    expect(montarExportacao({ produtos: [prod(1, { aplicacao: '  ' }), prod(2, { aplicacao: 'Motor 1.0' })], nos: [], vinculos: [], ofereceJunto: new Map() }).produtos.map((p) => p.aplicacao)).toEqual([null, 'Motor 1.0']);
  });
  it('RN-CAT-09: a exportação esconde a referência de marca inativa ou ausente e mantém a sem marca, como a ficha', () => {
    const refs = [
      { marca_id: U(901), marca_nome: 'Ativa', codigo: 'A1' },
      { marca_id: U(902), marca_nome: 'Velha', codigo: 'B2' },
      { marca_id: U(903), marca_nome: 'Fantasma', codigo: 'C3' },
      { marca_id: null, marca_nome: null, codigo: 'D4' },
    ];
    const marcas = new Map([[U(901), { nome: 'Nova', ativo: true }], [U(902), { nome: 'Velha', ativo: false }]]);
    const r = montarExportacao({ produtos: [prod(1, { referencias: refs })], nos: [], vinculos: [], ofereceJunto: new Map(), marcas });
    expect(r.produtos[0]!.referencias).toEqual([{ marca_id: U(901), marca_nome: 'Nova', codigo: 'A1' }, { marca_id: null, marca_nome: null, codigo: 'D4' }]);
  });

  it('RF-CAT-09: acima do teto de 20 mil a resposta é cortada e marcada como truncada', () => {
    const produtos = Array.from({ length: LIMITE_EXPORTACAO + 1 }, (_, i) => prod(i + 1));
    const r = montarExportacao({ produtos, nos: [], vinculos: [], ofereceJunto: new Map() });
    expect(r.produtos).toHaveLength(LIMITE_EXPORTACAO);
    expect(r.truncado).toBe(true);
  });
});
