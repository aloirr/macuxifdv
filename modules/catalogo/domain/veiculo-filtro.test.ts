import { describe, expect, it } from 'vitest';
import { construirIndiceVeiculos, segmentosDeVeiculo, indiceTemVeiculo, restringirIndice } from './veiculo-indice';
import { compatibilidadeDoProduto, contarChipsFiltrar, filtrarPorVeiculo, leveTambemDoVeiculo, navegarCascata, POLITICA_CONFERIR, produtosDoModelo, rotulosDoVeiculo } from './veiculo-filtro';
import { nomesDeVeiculo } from './veiculos';
import type { VeiculoEscolhido } from '../contracts';

const VEICULOS = new Set(['gol', 'polo', 'civic', 'fit', 'highline', 'trendline', 'ecosport', 'fox', 'volkswagen', 'honda', 'ford']);
const OPC = { anoAtual: 2026, veiculos: VEICULOS };

const APLICACOES: Record<string, string> = {
  amortecedor: 'VW Gol 2017–2019 1.0/1.6 Highline',
  pastilha: 'VW Gol',
  bucha: 'Polo Classic 2005–2008',
  fluido: '',
  filtro: 'Civic 07–11 · Fit 2003>',
  coxim: 'Volkswagen Gol 2018 1.0 Highline · Gol 2018 1.0 Trendline',
  correia: 'Ford EcoSport 2012–2016 1.6',
  vela: 'Gol 2016–2020 1.0',
  bomba: 'Gol 2020>',
  motor: 'Vedação do cabeçote universal',
};
const indice = () => construirIndiceVeiculos(Object.entries(APLICACOES).map(([id, aplicacao]) => ({ id, aplicacao })), OPC);
const GOL_2018: VeiculoEscolhido = { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: null, versao: null };

describe('RN-CAT-22: índice de veículos', () => {
  it('RN-CAT-22: o segmento tem montadora, modelo, anos, motores e versões, e o "·" separa trechos (RN-CAT-16)', () => {
    const [s] = segmentosDeVeiculo('VW Gol 2017–2019 1.0/1.6 Highline', OPC);
    expect(s).toMatchObject({ montadora: 'volkswagen', modelo: 'gol', anos: [2017, 2018, 2019], motores: ['1.0', '1.6'], versoes: ['highline'] });
    expect(segmentosDeVeiculo('Civic 07–11 · Fit 2003>', OPC).map((x) => x.modelo)).toEqual(['civic', 'fit']);
    expect(segmentosDeVeiculo('Civic 07–11 · Fit 2003>', OPC)[0]!.anos).toContain(2009);
  });
  it('RN-CAT-22: aplicação vazia ou sem nome de veículo não tem segmento (universal)', () => {
    expect(segmentosDeVeiculo('', OPC)).toEqual([]);
    expect(segmentosDeVeiculo('Vedação do cabeçote universal', OPC)).toEqual([]);
  });
  it('RN-CAT-22: modelo sem montadora escrita recebe a mais frequente do mesmo modelo; a grafia de exibição é a mais frequente', () => {
    const i = indice();
    const gol = i.entradas.find((e) => e.produto === 'vela')!;
    expect(gol.montadora).toBe('volkswagen');
    expect(i.nomes.get('gol')).toBe('Gol');
    expect(i.nomes.get('volkswagen')).toBe('Volkswagen');
    expect(indiceTemVeiculo(i)).toBe(true);
    expect(indiceTemVeiculo(construirIndiceVeiculos([{ id: 'a', aplicacao: 'universal' }], OPC))).toBe(false);
  });
  it('RN-CAT-19/20: o modelo sai dos nomes de veículo da base (e o derivado inteiro, CrossFox)', () => {
    const fontes = Array.from({ length: 6 }, (_, k) => ({ nomeEDescricao: `Peça ${k}`, aplicacao: k % 2 ? 'Gol 2012 CrossFox 2010' : 'Gol 2014 Polo 2016' }));
    const veic = nomesDeVeiculo(fontes);
    const [s] = segmentosDeVeiculo('Gol CrossFox 2010', { anoAtual: 2026, veiculos: veic });
    expect(s?.modelo).toBe('gol');
    expect(s?.versoes).toEqual(['crossfox']);
  });
});

describe('RN-CAT-22: cascata', () => {
  it('RN-CAT-22: só mostra montadoras e modelos que existem nas aplicações, em ordem alfabética', () => {
    const i = indice();
    const r = navegarCascata(i, {});
    expect(r.nivel).toBe('montadora');
    expect(r.opcoes.map((o) => o.valor)).toEqual(['Ford', 'Volkswagen']);
    const vw = navegarCascata(i, { montadora: 'Volkswagen' });
    expect(vw.trilha.map((p) => [p.nivel, p.automatico])).toEqual([['montadora', false], ['modelo', true]]);
    expect(vw.nivel).toBe('ano');
  });
  it('RN-CAT-22: nível com uma opção só se preenche sozinho e vai na trilha como automático (Ford só tem o EcoSport)', () => {
    const r = navegarCascata(indice(), { montadora: 'Ford' });
    expect(r.trilha).toEqual([
      { nivel: 'montadora', valor: 'Ford', rotulo: 'Ford', automatico: false },
      { nivel: 'modelo', valor: 'EcoSport', rotulo: 'EcoSport', automatico: true },
    ]);
    expect(r.nivel).toBe('ano');
    expect(r.opcoes.map((o) => o.valor)).toEqual(['2016', '2015', '2014', '2013', '2012']);
  });
  it('RN-CAT-22: o ano vem do mais novo ao mais velho; motor e versão só do que existe, e nível sem opção é pulado', () => {
    const i = indice();
    const ano = navegarCascata(i, { montadora: 'Volkswagen', modelo: 'Gol' });
    expect(ano.nivel).toBe('ano');
    expect(ano.opcoes[0]!.valor).toBe('2027');
    expect(navegarCascata(i, { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018 }).opcoes.map((o) => o.valor)).toEqual(['1.0', '1.6']);
    const v = navegarCascata(i, { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: '1.0' });
    expect(v.nivel).toBe('versao');
    expect(v.opcoes.map((o) => o.valor)).toEqual(['Highline', 'Trendline']);
    expect(v.ultimo).toBe(true);
    // EcoSport 2014 não tem versão: nada a escolher depois do motor automático
    const eco = navegarCascata(i, { montadora: 'Ford', modelo: 'EcoSport', ano: 2014 });
    expect(eco.nivel).toBeNull();
    expect(eco.escolha).toMatchObject({ motor: '1.6', versao: null });
    expect(eco.rotulos?.curto).toBe('EcoSport 2014 1.6');
  });
  it('RN-CAT-15: a busca da folha acha Volkswagen por "vw" e Gol por "gol", sem passar pela montadora', () => {
    const i = indice();
    const apelidos = new Map([['vw', 'Volkswagen']]);
    expect(navegarCascata(i, {}, 'vw', apelidos).busca).toEqual([{ valor: 'Volkswagen', rotulo: 'Volkswagen', apoio: null, nivel: 'montadora' }]);
    expect(navegarCascata(i, {}, 'gol').busca).toEqual([{ valor: 'Gol', rotulo: 'Gol', apoio: 'Volkswagen', nivel: 'modelo' }]);
    expect(navegarCascata(i, {}, 'xyz').busca).toEqual([]);
    expect(navegarCascata(i, {}).busca).toBeNull();
  });
  it('RN-CAT-22: rótulos curto (etiqueta, sem a montadora) e completo (leitor de tela)', () => {
    expect(rotulosDoVeiculo({ montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: '1.0', versao: 'Trendline' })).toEqual({ curto: 'Gol 2018 1.0 Trendline', completo: 'Volkswagen Gol 2018 1.0 Trendline' });
    expect(rotulosDoVeiculo({ montadora: 'Volkswagen' })).toBeNull();
  });
});

describe('RN-CAT-22: compatível, conferir e fora', () => {
  const i = indice();
  const situacao = (id: string, v = GOL_2018) => compatibilidadeDoProduto(i, id, APLICACOES[id], v);
  it('RN-CAT-22: Gol 2018 sem motor nem versão em "Gol 2017–2019 1.0/1.6 Highline" é conferir (versão restrita), com o trecho sem a montadora', () => {
    const r = situacao('amortecedor');
    expect(r.situacao).toBe('conferir');
    expect(r.serve_em).toEqual({ texto: 'Gol 2017–2019 1.0/1.6 Highline', marcas: [[0, 3]], inclui_ano: null });
  });
  it('RN-CAT-22: Gol 2018 1.0 Highline é compatível; Gol 2020 está fora', () => {
    expect(situacao('amortecedor', { ...GOL_2018, motor: '1.0', versao: 'Highline' }).situacao).toBe('compativel');
    expect(situacao('amortecedor', { ...GOL_2018, ano: 2020 }).situacao).toBe('nao_serve');
  });
  it('RN-CAT-22: versão ou motor escolhidos que o trecho contradiz tiram o produto', () => {
    expect(situacao('amortecedor', { ...GOL_2018, versao: 'Trendline' }).situacao).toBe('nao_serve');
    expect(situacao('correia', { montadora: 'Ford', modelo: 'EcoSport', ano: 2014, motor: '1.0', versao: null }).situacao).toBe('nao_serve');
  });
  it('RN-CAT-22: aplicação sem ano ("VW Gol") é conferir e sem "Serve em" quando o trecho é só o nome do modelo', () => {
    const r = situacao('pastilha');
    expect(r).toMatchObject({ situacao: 'conferir', serve_em: null });
  });
  it('RN-CAT-22: aplicação vazia ou sem veículo é universal', () => {
    expect(situacao('fluido').situacao).toBe('universal');
    expect(situacao('motor').situacao).toBe('universal');
  });
  it('RN-CAT-22: sem ano escolhido nenhum item é compatível', () => {
    for (const id of Object.keys(APLICACOES)) expect(situacao(id, { ...GOL_2018, ano: null }).situacao).not.toBe('compativel');
  });
  it('RN-CAT-16: "Civic 07–11 · Fit 2003>" com Civic 2015 está fora e com Civic 2009 é compatível; o outro trecho não vaza', () => {
    const civic: VeiculoEscolhido = { montadora: null, modelo: 'Civic', ano: 2015, motor: null, versao: null };
    expect(situacao('filtro', civic).situacao).toBe('nao_serve');
    expect(situacao('filtro', { ...civic, ano: 2009 }).situacao).toBe('compativel');
    expect(situacao('filtro', { montadora: null, modelo: 'Fit', ano: 2020, motor: null, versao: null }).situacao).toBe('compativel');
  });
  it('RN-CAT-22: o produto fica com o melhor dos trechos (Highline 1.0 e Trendline 1.0)', () => {
    expect(situacao('coxim', { ...GOL_2018, motor: '1.0', versao: 'Trendline' }).situacao).toBe('compativel');
    // cada trecho restringe a versão: sem versão escolhida, nenhum cobre todas as opções
    expect(situacao('coxim', { ...GOL_2018, motor: '1.0' }).situacao).toBe('conferir');
  });
  it('RN-CAT-22: a montadora escolhida diferente da escrita tira o produto', () => {
    expect(situacao('amortecedor', { ...GOL_2018, montadora: 'Ford' }).situacao).toBe('nao_serve');
  });
  it('RN-CAT-22: o trecho de conferir longo é cortado em 90 caracteres com o modelo à vista', () => {
    const longa = `Gol ${'2010 '.repeat(2)}${'Highline Trendline '.repeat(8)}`;
    const idx = construirIndiceVeiculos([{ id: 'x', aplicacao: longa }, { id: 'y', aplicacao: 'Gol 2010 Polo' }], OPC);
    const r = compatibilidadeDoProduto(idx, 'x', longa, { montadora: null, modelo: 'Gol', ano: 2010, motor: null, versao: null });
    expect(r.serve_em!.texto.length).toBeLessThanOrEqual(90);
    expect(r.serve_em!.marcas).toEqual([[0, 3]]);
  });
});

describe('RN-CAT-22: lista com veículo', () => {
  const i = indice();
  const itens = Object.keys(APLICACOES).map((id) => ({ produto_id: id, aplicacao: APLICACOES[id]! }));
  it('RN-CAT-22: compatíveis primeiro e os de conferir no fim, cada grupo na ordem que veio; universais e fora saem', () => {
    expect(POLITICA_CONFERIR).toBe('fim');
    const r = filtrarPorVeiculo(itens, i, { ...GOL_2018, motor: '1.0', versao: 'Highline' });
    expect(r.map((x) => [x.produto_id, x.veiculo.compatibilidade])).toEqual([
      ['amortecedor', 'compativel'],
      ['coxim', 'compativel'],
      ['vela', 'compativel'],
      ['pastilha', 'conferir'],
    ]);
  });
  it('RN-CAT-22 (D4): com a política "esconder" os de conferir saem; com "fim" ficam no fim', () => {
    const v = { ...GOL_2018, motor: '1.0', versao: 'Highline' };
    expect(filtrarPorVeiculo(itens, i, v, 'esconder').map((x) => x.produto_id)).toEqual(['amortecedor', 'coxim', 'vela']);
    expect(filtrarPorVeiculo(itens, i, v, 'fim').map((x) => x.produto_id)).toEqual(['amortecedor', 'coxim', 'vela', 'pastilha']);
  });
  it('RN-CAT-22: o conjunto de partida da lista sem texto são os produtos que citam o modelo', () => {
    expect([...produtosDoModelo(i, { modelo: 'Gol' })].sort()).toEqual(['amortecedor', 'bomba', 'coxim', 'pastilha', 'vela']);
  });
  it('RN-CAT-22 (D3): "Leve também" sem veículo é a lista de hoje; com veículo, só compatíveis e universais', () => {
    const junto = ['bucha', 'fluido', 'vela', 'amortecedor'].map((produto_id) => ({ produto_id }));
    expect(leveTambemDoVeiculo(junto, i, null)).toHaveLength(4);
    expect(leveTambemDoVeiculo(junto, i, { ...GOL_2018, motor: '1.0', versao: 'Highline' }).map((x) => x.produto_id)).toEqual(['fluido', 'vela', 'amortecedor']);
  });
});

describe('RN-CAT-22 (D1): chips da Filtrar com contagem', () => {
  const grupos = [
    { grupo: 'sistema' as const, rotulo: 'Sistema', opcoes: [{ id: 's1', nome: 'Suspensão', produtos: new Set(['a', 'b', 'c']) }, { id: 's2', nome: 'Freio', produtos: new Set(['d']) }, { id: 's3', nome: 'Elétrica', produtos: new Set(['z']) }] },
    { grupo: 'linha' as const, rotulo: 'Linha', opcoes: [{ id: 'l1', nome: 'Leve', produtos: new Set(['a', 'b', 'c', 'd']) }] },
    { grupo: 'categoria' as const, rotulo: 'Categoria', opcoes: [{ id: 'c1', nome: 'Amortecedor', produtos: new Set(['a', 'b']) }, { id: 'c2', nome: 'Bucha', produtos: new Set(['c', 'd']) }] },
  ];
  it('RN-CAT-22: a contagem é a da lista de agora; chip com 0 sai e grupo de uma opção só sai', () => {
    const r = contarChipsFiltrar(['a', 'b', 'c', 'd'], grupos, {});
    expect(r.map((g) => g.grupo)).toEqual(['sistema', 'categoria']);
    expect(r[0]!.chips.map((c) => [c.nome, c.contagem])).toEqual([['Suspensão', 3], ['Freio', 1]]);
  });
  it('RN-CAT-22: o chip marcado fica mesmo com 0, e a contagem de um grupo respeita os outros grupos marcados', () => {
    const r = contarChipsFiltrar(['a', 'b', 'c', 'd'], grupos, { sistema: 's3', categoria: 'c1' });
    expect(r.find((g) => g.grupo === 'sistema')!.chips.find((c) => c.id === 's3')).toMatchObject({ contagem: 0, marcado: true });
    const so = contarChipsFiltrar(['a', 'b', 'c', 'd'], grupos, { sistema: 's1' });
    expect(so.find((g) => g.grupo === 'categoria')!.chips.map((c) => [c.nome, c.contagem])).toEqual([['Amortecedor', 2], ['Bucha', 1]]);
  });
  it('RN-CAT-22: em cascata (cruzar: false) o marcado mais fundo não zera os irmãos dos grupos de cima', () => {
    const cascata = [
      { grupo: 'sistema' as const, rotulo: 'Sistema', opcoes: [{ id: 's1', nome: 'Suspensão', produtos: new Set(['a', 'b']) }, { id: 's2', nome: 'Freio', produtos: new Set(['c']) }] },
      { grupo: 'familia' as const, rotulo: 'Grupo', opcoes: [{ id: 'f1', nome: 'Dianteira', produtos: new Set(['a']) }, { id: 'f2', nome: 'Traseira', produtos: new Set(['b']) }] },
    ];
    const marcados = { sistema: 's1', familia: 'f1' };
    expect(contarChipsFiltrar(['a', 'b', 'c'], cascata, marcados).map((g) => g.grupo)).toEqual(['familia']);
    const r = contarChipsFiltrar(['a', 'b', 'c'], cascata, marcados, { cruzar: false });
    expect(r.map((g) => g.grupo)).toEqual(['sistema', 'familia']);
    expect(r[0]!.chips.map((c) => [c.nome, c.contagem, c.marcado])).toEqual([['Suspensão', 2, true], ['Freio', 1, false]]);
    expect(r[1]!.chips.map((c) => [c.nome, c.contagem, c.marcado])).toEqual([['Dianteira', 1, true], ['Traseira', 1, false]]);
  });
});

describe('RN-CAT-22: escopo do cliente (só o que se pode vender a ele)', () => {
  const dentro = new Set(['amortecedor', 'correia']); // Gol Highline e EcoSport
  it('RN-CAT-22: a cascata só mostra o que existe nos produtos do escopo', () => {
    expect(navegarCascata(restringirIndice(indice(), dentro), {}).opcoes.map((o) => o.valor).sort()).toEqual(['Ford', 'Volkswagen']);
    const sem = navegarCascata(restringirIndice(indice(), new Set(['correia'])), {});
    expect(sem.trilha.map((p) => [p.nivel, p.valor, p.automatico])).toEqual([['montadora', 'Ford', true], ['modelo', 'EcoSport', true]]);
    expect(navegarCascata(restringirIndice(indice(), new Set(['amortecedor'])), {}).trilha[0]).toMatchObject({ valor: 'Volkswagen', automatico: true });
  });
  it('RN-CAT-22: a busca da folha só acha modelo que tem produto no escopo', () => {
    const r = restringirIndice(indice(), dentro);
    expect(navegarCascata(r, {}, 'civic').busca).toEqual([]);
    expect(navegarCascata(r, {}, 'gol').busca!.map((o) => o.rotulo)).toEqual(['Gol']);
    expect(navegarCascata(indice(), {}, 'civic').busca!.length).toBeGreaterThan(0);
  });
  it('RN-CAT-22: disponivel só conta o escopo (escopo sem nenhum produto com veículo = sem o botão)', () => {
    expect(indiceTemVeiculo(restringirIndice(indice(), dentro))).toBe(true);
    expect(indiceTemVeiculo(restringirIndice(indice(), new Set(['fluido', 'motor'])))).toBe(false);
    expect(indiceTemVeiculo(restringirIndice(indice(), new Set()))).toBe(false);
  });
  it('RN-CAT-22: produtosDoModelo e a compatibilidade ignoram o que está fora do escopo', () => {
    const r = restringirIndice(indice(), new Set(['amortecedor', 'vela']));
    expect([...produtosDoModelo(r, { modelo: 'Gol' })].sort()).toEqual(['amortecedor', 'vela']);
    expect(produtosDoModelo(indice(), { modelo: 'Gol' }).size).toBeGreaterThan(2);
  });
  it('RN-CAT-22: o índice original não muda e os nomes de exibição são os mesmos', () => {
    const i = indice();
    const antes = i.entradas.length;
    const r = restringirIndice(i, dentro);
    expect(i.entradas).toHaveLength(antes);
    expect(r.nomes).toBe(i.nomes);
    expect(r.entradas.every((e) => dentro.has(e.produto))).toBe(true);
  });
});
