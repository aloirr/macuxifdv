/**
 * RN-CAT-15 (apelidos de montadora) e RN-CAT-16 (ano) na busca completa, sem LLM: interpretar → sinônimos → ranking → "Serve em".
 * Casos do §5 da auditoria `docs/modulos/catalogo/auditoria-busca-modelo-bap.md` que dependem da etapa 1. anoAtual = 2026.
 */
import { describe, expect, it } from 'vitest';
import { interpretarConsulta } from './consulta';
import { APELIDOS_MONTADORA } from './montadoras';
import { PARAMETROS_PADRAO } from './parametros';
import { rankear, type DocBusca } from './ranking';
import { expandirSinonimos } from './texto';

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
type Sin = { term: string; synonyms: string[] };
const ids = (docs: DocBusca[], q: string, sinonimos: Sin[] = []) =>
  rankear(docs, { filtros: interpretarConsulta(q, VOCAB), sinonimos, parametros: PARAMETROS_PADRAO, anoAtual: 2026 }).map((i) => i.doc.id);
const grupos = (q: string, sin: Sin[] = []) => expandirSinonimos(q, sin);

describe('RN-CAT-15: apelidos de montadora', () => {
  it('RN-CAT-15: VW, Volkswagen e Volks são o mesmo grupo, nos dois sentidos', () => {
    expect(grupos('vw')[0]).toEqual(['vw', 'volk', 'volkswagen']); // grupo no singular de busca (volks → volk)
    expect(grupos('volkswagen')[0]).toContain('vw');
  });

  it('RN-CAT-15: GM, Chevrolet e Chevy são o mesmo grupo', () => {
    for (const q of ['gm', 'chevrolet', 'chevy']) expect(grupos(q)[0]).toEqual(expect.arrayContaining(['gm', 'chevrolet', 'chevy']));
  });

  it('RN-CAT-15: MB, Mercedes e Mercedes-Benz são o mesmo grupo, inclusive a frase com hífen', () => {
    for (const q of ['mb', 'mercedes', 'mercedes-benz', 'mercedes benz']) expect(grupos(q)[0]).toEqual(expect.arrayContaining(['mb', 'mercede', 'mercede benz']));
  });

  it('RN-CAT-15: sem sinônimo do tenant a lista padrão já vale', () => {
    expect(grupos('vw gol').map((g) => g[0])).toEqual(['vw', 'gol']);
    expect(grupos('vw gol')[0]).toContain('volkswagen');
  });

  it('RN-CAT-15: sinônimo do tenant soma ao apelido padrão e não o apaga', () => {
    const g = grupos('vw', [{ term: 'vw', synonyms: ['volkswagem'] }])[0]!;
    expect(g).toEqual(expect.arrayContaining(['vw', 'volkswagen', 'volk', 'volkswagem']));
    const h = grupos('volkswagen', [{ term: 'volkswagen', synonyms: ['wolks'] }])[0]!;
    expect(h).toEqual(expect.arrayContaining(['vw', 'wolk']));
  });

  it('RN-CAT-15: sinônimo inativo do tenant continua ignorado; o padrão fica', () => {
    const g = grupos('vw', [{ term: 'vw', synonyms: ['xpto'], active: false } as Sin])[0]!;
    expect(g).not.toContain('xpto');
    expect(g).toContain('volkswagen');
  });

  it('RN-CAT-15: a lista padrão não colide com palavra comum de produto', () => {
    const palavras = ['gol', 'ka', 'up', 'fox', 'polo', 'ford', 'fiat', 'honda', 'toyota', 'filtro', 'oleo', 'freio', 'bateria', 'mb5', 'gm5'];
    const usados = new Set(APELIDOS_MONTADORA.flatMap((a) => [a.term, ...a.synonyms]));
    for (const p of palavras) expect(usados.has(p)).toBe(false);
  });

  it.each(['vw gol 2018', '2018 gol vw', 'gol 2018 volkswagen', 'volks gol 2018'])('RN-CAT-15 + RN-CAT-16: "%s" acha o Amortecedor Gol G5 cadastrado como Volkswagen', (q) => {
    const gol = doc({ id: 'gol', nome: 'Amortecedor Gol G5', marca: 'Volkswagen', aplicacao: 'Gol G5 2014–2019' });
    const outro = doc({ id: 'palio', nome: 'Amortecedor Palio', marca: 'Fiat', aplicacao: 'Palio 2012–2018' });
    expect(ids([gol, outro], q)).toEqual(['gol']);
  });

  it('RN-CAT-15: o apelido vale na aplicação ("gm onix" acha "Chevrolet Onix")', () => {
    const d = doc({ id: 'onix', nome: 'Pastilha de freio', aplicacao: 'Chevrolet Onix 2013–2019' });
    expect(ids([d], 'gm onix')).toEqual(['onix']);
    expect(ids([d], 'chevy onix 2015')).toEqual(['onix']);
  });

  it('RN-CAT-15: o apelido do tenant continua valendo junto do padrão', () => {
    const d = doc({ id: 'x', nome: 'Filtro de ar', marca: 'Volkswagen' });
    expect(ids([d], 'volks filtro', [{ term: 'volks', synonyms: ['vokswagen'] }])).toEqual(['x']);
    expect(ids([d], 'vokswagen filtro', [{ term: 'volks', synonyms: ['vokswagen'] }])).toEqual(['x']);
  });
});

describe('RN-CAT-16: ano na busca completa', () => {
  const PASTILHA = doc({ id: 'pastilha', nome: 'Pastilha de freio', aplicacao: 'Civic 2007 até 2011' });
  const ABERTA = doc({ id: 'aberta', nome: 'Filtro de ar', aplicacao: 'Civic 2006>' });
  const ANTIGA = doc({ id: 'antiga', nome: 'Junta', aplicacao: 'Civic 1992–1995' });
  const DISCO = doc({ id: 'disco', nome: 'Disco de freio', aplicacao: 'Civic 07–11 · Fit 2003>' });

  it('RN-CAT-16: "civic 2008" acha "Civic 2007 até 2011", "Civic 2006>" e o disco "Civic 07–11", sem o Civic 1992–1995', () => {
    const r = ids([PASTILHA, ABERTA, ANTIGA, DISCO], 'civic 2008');
    expect(r.sort()).toEqual(['aberta', 'disco', 'pastilha']);
  });

  it('RN-CAT-16: "civic 2015" não acha faixa fechada antiga (2007 até 2011, 07–11, 1992–1995): só "Civic 2006>"', () => {
    expect(ids([PASTILHA, ABERTA, ANTIGA, DISCO], 'civic 2015')).toEqual(['aberta']);
  });

  it('RN-CAT-16: "·" separa trechos da aplicação: o "Fit 2003>" não vale para o Civic', () => {
    expect(ids([DISCO, ABERTA], 'civic 2015')).toEqual(['aberta']);
    expect(ids([DISCO, ABERTA], 'fit 2015')).toEqual(['disco']);
  });

  it('RN-CAT-16: ano de 2 dígitos e mês/ano na busca ("santana 1990" acha "01/89 - 12/97")', () => {
    const d = doc({ id: 'sant', nome: 'Bomba de combustível', aplicacao: 'Santana 01/89 - 12/97' });
    const outro = doc({ id: 'outro', nome: 'Bomba de combustível', aplicacao: 'Santana 1999–2006' });
    expect(ids([d, outro], 'santana 1990')).toEqual(['sant']);
    expect(ids([d, outro], 'santana 2000')).toEqual(['outro']);
  });
});
