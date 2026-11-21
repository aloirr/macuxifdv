/**
 * RN-CAT-19 (modelo derivado e vizinhas juntas no texto) na busca completa, sem LLM. Casos do §5 da auditoria
 * `docs/modulos/catalogo/auditoria-busca-modelo-bap.md` que dependem da etapa 4. anoAtual = 2026.
 * Os mesmos casos rodam pela lista inteira e pela pré-seleção do índice.
 */
import { describe, expect, it } from 'vitest';
import { construirIndiceBusca } from './indice-busca';
import { codigosDaConsulta, planejarGrupos } from './ranking';
import { trechoServeEm } from './serve-em';
import { expandirSinonimos } from './texto';
import { nomesDeVeiculo, veiculosDe } from './veiculos';
import { caminhos, prod } from './__fixtures__/busca-bap';

const COXIM_FOX = 'Coxim Fox';
const SPACE_NOME = 'Amortecedor SPACE-FOX';
const CROSS_APL = 'Amortecedor dianteiro CrossFox';
const SPACE_APL = 'Amortecedor traseiro SpaceFox';
const GOL = 'Amortecedor Gol G5';
const GOLF = 'Amortecedor Golf';
const FILTRO_FOX = 'Filtro de ar';

/** "fox" e "gol" aparecem muito nas aplicações (veículos); "CrossFox" e "SpaceFox" só grudados, na aplicação. */
function base() {
  const todos = [
    prod(COXIM_FOX, 'Volkswagen Fox 2010–2014'),
    prod(SPACE_NOME, ''),
    prod(CROSS_APL, 'Volkswagen CrossFox 2010–2014'),
    prod(SPACE_APL, 'Volkswagen SpaceFox 2010–2014'),
    prod(GOL, 'Volkswagen Gol G5 2014–2019'),
    prod(GOLF, 'Volkswagen Golf 2010–2014'),
    ...Array.from({ length: 12 }, (_, i) => prod(`${FILTRO_FOX} ${i}`, 'Volkswagen Fox 2008–2012')),
    ...Array.from({ length: 12 }, (_, i) => prod(`Filtro de óleo ${i}`, 'Volkswagen Gol 2008–2012')),
  ];
  return todos;
}

const semFiltro = (todos: string[]) => todos.filter((x) => !x.startsWith(FILTRO_FOX) && !x.startsWith('Filtro de óleo')).sort();
const CAMINHOS = caminhos(100);
const pelaLista = CAMINHOS[0]![1];

describe.each(CAMINHOS)('RN-CAT-19 (%s): casos do §5 da auditoria', (_nome, buscar) => {
  const todos = base();

  it('RN-CAT-19: "fox" acha Fox, CrossFox e SpaceFox (da aplicação e do nome)', () => {
    expect(semFiltro(buscar(todos, 'fox'))).toEqual([COXIM_FOX, CROSS_APL, SPACE_APL, SPACE_NOME].sort());
    expect(buscar(todos, 'fox')).toHaveLength(4 + 12);
  });

  it('RN-CAT-19: "space fox" acha os dois SpaceFox (aplicação e nome), e só eles', () => {
    expect(buscar(todos, 'space fox').sort()).toEqual([SPACE_APL, SPACE_NOME].sort());
  });

  it('RN-CAT-19: "space fox" com outra palavra: "amortecedor space fox" também junta as vizinhas', () => {
    expect(buscar(todos, 'amortecedor space fox').sort()).toEqual([SPACE_APL, SPACE_NOME].sort());
  });

  it('RN-CAT-19: a palavra junta é a última digitada e vale por começo de palavra ("space fox" acha o "spacefoxtrot")', () => {
    expect(buscar([...todos, prod('Capa spacefoxtrot')], 'space fox')).toContain('Capa spacefoxtrot');
  });

  it('RN-CAT-19: "crossfox" e "cross fox" acham o CrossFox', () => {
    expect(buscar(todos, 'crossfox')).toEqual([CROSS_APL]);
    expect(buscar(todos, 'cross fox')).toEqual([CROSS_APL]);
  });

  it('RN-CAT-19: "gol f" não junta ("f" tem menos de 3 letras); "golf" inteiro acha o Golf', () => {
    expect(buscar(todos, 'gol f')).not.toContain(GOLF);
    expect(buscar(todos, 'golf')).toContain(GOLF);
  });
});

describe('RN-CAT-19: modelo derivado tirado da base', () => {
  const fonte = (nomeEDescricao: string, aplicacao = '') => ({ nomeEDescricao, aplicacao });
  const repetir = (k: number, f: ReturnType<typeof fonte>) => Array.from({ length: k }, () => f);
  const derivadasDe = (v: string, fontes: ReturnType<typeof fonte>[]) => [...((nomesDeVeiculo(fontes) as { derivadas?: ReadonlyMap<string, readonly string[]> }).derivadas?.get(v) ?? [])].sort();

  it('RN-CAT-19: as palavras da base que começam ou terminam com o nome de veículo (outro pedaço com 3+ letras) são derivadas dele', () => {
    const f = [...repetir(10, fonte('Filtro', 'Fox 2010')), fonte('Coxim CrossFox'), fonte('Bucha SpaceFox'), fonte('Cabo foxtrot')];
    expect(derivadasDe('fox', f)).toEqual(['crossfox', 'foxtrot', 'spacefox']);
  });

  it('RN-CAT-19: outro pedaço com menos de 3 caracteres não deriva ("golf" não é derivada de "gol"; "xfox" não é de "fox")', () => {
    const f = [...repetir(10, fonte('Filtro', 'Gol Fox 2010')), fonte('Amortecedor Golf'), fonte('Capa xfox'), fonte('Capa foxy')];
    expect(derivadasDe('gol', f)).toEqual([]);
    expect(derivadasDe('fox', f)).toEqual([]);
  });

  it('RN-CAT-19: a palavra que não é nome de veículo não tem derivadas', () => {
    const f = [fonte('Coxim CrossFox'), fonte('Bucha Fox')];
    expect(derivadasDe('fox', f)).toEqual([]);
    expect(nomesDeVeiculo(f).has('fox')).toBe(false);
  });

  it('RN-CAT-19: o índice calcula as derivadas na carga e a lista de produtos usa as mesmas', () => {
    const todos = base();
    const indice = construirIndiceBusca(todos, 2026);
    const d = (indice.veiculos as { derivadas?: ReadonlyMap<string, readonly string[]> }).derivadas;
    expect([...(d?.get('fox') ?? [])].sort()).toEqual(['crossfox', 'spacefox']);
    expect(veiculosDe(todos)).toBe(indice.veiculos);
  });

  it('RN-CAT-19: o plano da palavra de veículo leva as derivadas como equivalentes', () => {
    const veic = nomesDeVeiculo([...repetir(10, fonte('Filtro', 'Fox 2010')), fonte('Coxim CrossFox')]);
    expect(planejarGrupos([['fox']], veic)[0]![0]![0]).toMatchObject({ q: 'fox', modo: 'v', ou: ['crossfox'] });
  });
});

describe('RN-CAT-19: vizinhas juntas reaproveitam o n-grama do código', () => {
  it('RN-CAT-19: o n-grama de código segue igual (precisa de dígito) e as vizinhas só de letras não viram código', () => {
    expect(codigosDaConsulta('cb 3401')).toEqual(['cb3401']);
    expect(codigosDaConsulta('space fox')).toEqual([]);
  });

  it('RN-CAT-19: vizinha com menos de 3 letras não junta ("ab cde" não acha "abcde")', () => {
    const todos = [prod('Peça abcde'), prod('Peça ab cde')];
    expect(pelaLista(todos, 'ab cde')).toEqual(['Peça ab cde']);
    expect(pelaLista([prod('Peça abcdef')], 'abc def')).toEqual(['Peça abcdef']); // 3+ letras de cada lado juntam
  });

  it('RN-CAT-19: "Serve em" marca o SpaceFox da aplicação para "space fox" e o CrossFox para "fox"', () => {
    const veic = nomesDeVeiculo([...Array.from({ length: 10 }, () => ({ nomeEDescricao: 'Filtro', aplicacao: 'Fox 2010' })), { nomeEDescricao: 'Coxim CrossFox', aplicacao: '' }, { nomeEDescricao: 'Bucha SpaceFox', aplicacao: '' }]);
    const apl = 'Volkswagen SpaceFox 2010–2014';
    expect(trechoServeEm(apl, expandirSinonimos('space fox', []), { anoAtual: 2026, veiculos: veic })?.marcas).toEqual([[11, 19]]);
    expect(trechoServeEm(apl, expandirSinonimos('fox', []), { anoAtual: 2026, veiculos: veic })?.marcas).toEqual([[11, 19]]);
  });
});
