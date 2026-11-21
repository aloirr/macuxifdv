/**
 * RN-CAT-17 (lista vazia quando ninguém casa todas as palavras) junto com a etapa 1 (RN-CAT-15 apelidos e RN-CAT-16 faixas de ano).
 * Auditoria `docs/modulos/catalogo/auditoria-busca-modelo-bap.md` §4 e §5. anoAtual = 2026.
 */
import { describe, expect, it } from 'vitest';
import { interpretarConsulta } from './consulta';
import { PARAMETROS_PADRAO } from './parametros';
import { rankear, type DocBusca } from './ranking';

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
const ids = (docs: DocBusca[], q: string, vocab = { marcas: [] as string[], linhas: [] as string[] }) =>
  rankear(docs, { filtros: interpretarConsulta(q, vocab), sinonimos: [], parametros: PARAMETROS_PADRAO, anoAtual: 2026 }).map((i) => i.doc.id);

const GOL = doc({ id: 'gol', nome: 'Amortecedor dianteiro', marca: 'BAP', aplicacao: 'Volkswagen Gol G5 2014–2019' });
const CIVIC = doc({ id: 'civic', nome: 'Pastilha de freio', aplicacao: 'Honda Civic 2007 até 2011' });
const OUTRO = doc({ id: 'outro', nome: 'Filtro de óleo', aplicacao: 'Fiat Uno 2010–2014' });

describe('RN-CAT-17: lista vazia com a etapa 1 (apelidos e faixas)', () => {
  it('RN-CAT-17: "xyzqwk amortecedor" → lista vazia (uma palavra não casa, o amortecedor não vem como "mais próximo")', () => {
    expect(ids([GOL, CIVIC, OUTRO], 'xyzqwk amortecedor')).toEqual([]);
  });

  it('RN-CAT-17: uma palavra que não casa esvazia a lista; o SKU exato sozinho acha o produto', () => {
    expect(ids([GOL, CIVIC, OUTRO], 'gol xyzqwk')).toEqual([]);
    expect(ids([GOL, CIVIC, OUTRO], 'CIVIC')).toEqual(['civic']); // SKU exato
  });

  it('RN-CAT-17 (auditoria §5, "BAP amortecedor palio"): C2 (amortecedor BAP sem Palio) e C3 (pastilha BAP Palio) → vazio; com o Palio na aplicação, só ele', () => {
    const vocab = { marcas: ['BAP'], linhas: [] };
    const c2 = doc({ id: 'c2', nome: 'Amortecedor dianteiro', marca: 'BAP', aplicacao: 'Ford EcoSport 2010–2014' });
    const c3 = doc({ id: 'c3', nome: 'Pastilha de freio Palio', marca: 'BAP' });
    expect(ids([c2, c3], 'BAP amortecedor palio', vocab)).toEqual([]);
    const ok = doc({ id: 'ok', nome: 'Amortecedor dianteiro', marca: 'BAP', aplicacao: 'FIAT - Palio 2010–2014' });
    expect(ids([c2, c3, ok], 'BAP amortecedor palio', vocab)).toEqual(['ok']);
  });
});
