/**
 * RN-CAT-19 (palavra inteira, nome de veículo da base e começo de palavra só na última palavra) na busca completa, sem LLM.
 * Casos do §5 da auditoria `docs/modulos/catalogo/auditoria-busca-modelo-bap.md` que dependem da etapa 3. anoAtual = 2026.
 * Os mesmos casos rodam pela lista inteira, pela pré-seleção do índice e pela consulta do aparelho (a mesma conta de "é veículo").
 */
import { describe, expect, it } from 'vitest';
import { caminhos, prod } from './__fixtures__/busca-bap';
import { interpretarConsulta } from './consulta';
import { PARAMETROS_PADRAO } from './parametros';
import { rankear } from './ranking';
import { docDeBusca } from './vitrine';
import { trechoServeEm } from './serve-em';
import { expandirSinonimos } from './texto';
import { MINIMO_APLICACOES_VEICULO, nomesDeVeiculo, RAZAO_VEICULO, veiculosDe } from './veiculos';

/** Base do roteiro: "gol" e "polo" aparecem muito nas aplicações (veículos); "Golf" e "polos" são palavras de outro produto. */
function base() {
  const GOL_G5 = prod('Amortecedor Gol G5', 'Volkswagen Gol G5 2014–2019');
  const GOL_KYB = prod('Amortecedor Gol KYB 441126', 'Volkswagen Gol 2007–2011');
  const GOLF = prod('Amortecedor Golf', 'Volkswagen Golf 2010–2014');
  const POLO = prod('Bucha Polo Classic', 'Volkswagen Polo Classic 1996–2002');
  const VELA = prod('Cabo de vela 4 polos', 'Motor 1.0 flex');
  const JUNTA = prod('Junta homocinética', 'Honda Civic 2007–2011');
  const PALIO = prod('Amortecedor dianteiro', 'Fiat Palio 2010–2014');
  // aplicações de outros produtos: a base mostra que "gol" e "polo" são nomes de veículo (muito mais na aplicação do que no nome)
  const enchimento = [...Array.from({ length: 12 }, (_, i) => prod(`Filtro de ar ${i}`, 'Volkswagen Gol 2008–2012')), ...Array.from({ length: 6 }, (_, i) => prod(`Filtro de óleo ${i}`, 'Volkswagen Polo 2003–2007'))];
  return { GOL_G5, GOL_KYB, GOLF, POLO, VELA, JUNTA, PALIO, todos: [GOL_G5, GOL_KYB, GOLF, POLO, VELA, JUNTA, PALIO, ...enchimento] };
}

const CAMINHOS = caminhos(50);
const pelaLista = CAMINHOS[0]![1];

describe.each(CAMINHOS)('RN-CAT-19 (%s): casos do §5 da auditoria', (_nome, buscar) => {
  const { todos } = base();
  const soGol = ['Amortecedor Gol G5', 'Amortecedor Gol KYB 441126'];

  it('RN-CAT-19: "gol" traz Gol G5 e Gol KYB, sem o Golf', () => {
    const achados = buscar(todos, 'gol');
    expect(achados).toEqual(expect.arrayContaining(soGol));
    expect(achados).not.toContain('Amortecedor Golf');
  });

  it('RN-CAT-19: "polo" traz só a Bucha Polo Classic (não o "Cabo de vela 4 polos")', () => {
    const achados = buscar(todos, 'polo');
    expect(achados).toContain('Bucha Polo Classic');
    expect(achados).not.toContain('Cabo de vela 4 polos');
  });

  it('RN-CAT-19: "homoc" acha a junta homocinética (começo de palavra na última palavra)', () => {
    expect(buscar(todos, 'homoc')).toEqual(['Junta homocinética']);
  });

  it('RN-CAT-19: "amortecedor para gol" = "amortecedor gol", sem o Golf', () => {
    expect(buscar(todos, 'amortecedor para gol')).toEqual(buscar(todos, 'amortecedor gol'));
    expect(buscar(todos, 'amortecedor gol')).toEqual(soGol);
  });

  it('RN-CAT-19: "amortecedor pal" acha o Palio (começo de palavra na última palavra, na aplicação)', () => {
    expect(buscar(todos, 'amortecedor pal')).toEqual(['Amortecedor dianteiro']);
  });

  it('RN-CAT-19: o começo de palavra vale só na última palavra: "pal amortecedor" não acha o Palio', () => {
    expect(buscar(todos, 'pal amortecedor')).toEqual([]);
    expect(buscar(todos, 'homoc junta')).toEqual([]);
    expect(buscar(todos, 'junta homoc')).toEqual(['Junta homocinética']);
  });

  it('RN-CAT-19: o erro de digitação nos campos de texto continua, em qualquer palavra', () => {
    expect(buscar(todos, 'junta homocinetica')).toEqual(['Junta homocinética']);
    expect(buscar(todos, 'jnta homocinética')).toEqual(['Junta homocinética']);
    expect(buscar(todos, 'amortecedr dianteiro')).toEqual(['Amortecedor dianteiro']);
  });

  it('RN-CAT-19: palavra inteira na aplicação: "palio" não traz "Palios" e o erro de digitação não vale na aplicação', () => {
    // "palio" é veículo da base (muitas aplicações, nenhum nome); "Palios" é outra palavra
    const outro = [...todos, ...Array.from({ length: 4 }, (_, i) => prod(`Filtro de cabine ${i}`, 'Fiat Palio 2012–2016')), prod('Coxim do motor', 'Fiat Palios 2010–2014')];
    expect(buscar(outro, 'coxim palio')).toEqual([]);
    expect(buscar(outro, 'coxim pali')).toEqual(['Coxim do motor']); // não é veículo, e "pali" é o começo da última palavra
    expect(buscar(todos, 'amortecedor paliio')).toEqual([]);
  });
});

describe('RN-CAT-19: nome de veículo tirado da base', () => {
  const fonte = (nomeEDescricao: string, aplicacao = '') => ({ nomeEDescricao, aplicacao });
  const repetir = (k: number, f: ReturnType<typeof fonte>) => Array.from({ length: k }, () => f);

  it(`RN-CAT-19: é veículo a palavra com ${RAZAO_VEICULO}× mais ocorrências nas aplicações do que nos nomes e descrições`, () => {
    const v = nomesDeVeiculo([...repetir(10, fonte('Filtro', 'Polo 2010')), fonte('Bucha Polo'), fonte('Cabo de vela 4 polos')]);
    expect(v.has('polo')).toBe(true); // 10 nas aplicações × 1 no nome ("polos" é outra palavra, não conta) = 10×
    expect(v.has('polos')).toBe(false);
    expect(nomesDeVeiculo([...repetir(5, fonte('Bucha Polo', 'Polo')), ...repetir(1, fonte('Filtro'))]).has('polo')).toBe(false); // 5 na aplicação, 5 no nome: 1×
  });

  it('RN-CAT-19: a razão exata de 5× vale; abaixo dela não', () => {
    const com = (apl: number, nome: number) => nomesDeVeiculo([...repetir(apl, fonte('Filtro', 'Fusca')), ...repetir(nome, fonte('Capa Fusca'))]).has('fusca');
    expect(com(5, 1)).toBe(true);
    expect(com(4, 1)).toBe(false);
    expect(com(10, 2)).toBe(true);
    expect(com(9, 2)).toBe(false);
  });

  it(`RN-CAT-19: premissa — com menos de ${MINIMO_APLICACOES_VEICULO} produtos com a palavra na aplicação ela não vira veículo (base pequena)`, () => {
    expect(nomesDeVeiculo(repetir(MINIMO_APLICACOES_VEICULO - 1, fonte('Filtro', 'Fusca'))).has('fusca')).toBe(false);
    expect(nomesDeVeiculo(repetir(MINIMO_APLICACOES_VEICULO, fonte('Filtro', 'Fusca'))).has('fusca')).toBe(true);
  });

  it('RN-CAT-19: a descrição conta como nome; palavra repetida no mesmo produto conta uma vez; número e palavra curta ficam de fora', () => {
    const v = nomesDeVeiculo([...repetir(4, fonte('Filtro Fusca Fusca Fusca', 'Fusca Fusca 1972')), ...repetir(3, fonte('Filtro', 'Fusca 1.6 up'))]);
    expect(v.has('fusca')).toBe(false); // 7 nas aplicações × 4 nos nomes
    expect(v.has('1972')).toBe(false);
    expect(v.has('up')).toBe(false);
  });

  it('RN-CAT-19: produto inativo não entra na base, e a lista é memorizada', () => {
    const lista = [prod('Filtro', 'Fusca'), prod('Filtro', 'Fusca'), prod('Filtro', 'Fusca'), prod('Filtro', 'Fusca', { ativo: false })];
    expect(veiculosDe(lista.slice(0, 3)).has('fusca')).toBe(true);
    expect(veiculosDe(lista)).toBe(veiculosDe(lista));
    expect(veiculosDe([lista[0]!, lista[1]!, lista[3]!]).has('fusca')).toBe(false);
  });

  it('RN-CAT-19: nome de veículo não passa pelo singular, o resto sim ("filtros" acha "Filtro")', () => {
    const { todos } = base();
    expect(pelaLista(todos, 'filtros ar 3')).toContain('Filtro de ar 3');
    expect(pelaLista(todos, 'polos')).toEqual(pelaLista(todos, 'polo'));
  });

  it('RN-CAT-19: "Serve em" também não marca "Golf" para "gol"', () => {
    const veic = new Set(['gol']);
    expect(trechoServeEm('Volkswagen Golf 2010–2014', expandirSinonimos('gol', []), { anoAtual: 2026, veiculos: veic })).toBeNull();
    expect(trechoServeEm('Volkswagen Gol 2010–2014', expandirSinonimos('gol', []), { anoAtual: 2026, veiculos: veic })?.marcas).toEqual([[11, 14]]);
    expect(trechoServeEm('Fiat Palio 2010–2014', expandirSinonimos('pal', []), { anoAtual: 2026 })?.marcas).toEqual([[5, 10]]);
    expect(trechoServeEm('Fiat Palio 2010–2014', expandirSinonimos('pal 2012', []), { anoAtual: 2026 })?.marcas).not.toContainEqual([5, 10]); // "pal" não é a última palavra
  });

  it('RN-CAT-19: rankear sem `veiculos` conta só os docs ativos (2 inativos + 1 ativo com "gol" na aplicação não bastam para veículo)', () => {
    const docs = [prod('Filtro A', 'Gol 2010'), prod('Cabo 1', 'Gol 2011', { ativo: false }), prod('Cabo 2', 'Gol 2012', { ativo: false }), prod('Mola Golf', 'Golf 2010')].map((p) => docDeBusca(p, null));
    const filtros = interpretarConsulta('gol', { marcas: [], linhas: [] });
    // "gol" não é veículo (1 ativo < 3): vale por começo de palavra e acha o Golf
    expect(rankear(docs, { filtros, sinonimos: [], parametros: PARAMETROS_PADRAO, anoAtual: 2026 }).map((r) => r.doc.nome)).toContain('Mola Golf');
  });
});
