import { describe, expect, it } from 'vitest';

import {
  escolhaAntesDoPasso,
  escolhaDoResultadoDaBusca,
  escolherOpcao,
  leituraDaEtiquetaVeiculo,
  leituraDoBotaoVeiculo,
  linhaDoVeiculoNoItem,
  modoDaListaDoPedido,
  textoDaBuscaComVeiculo,
  veiculoDaEscolha,
  type VeiculoDoPedido,
} from './veiculo-pedido';

const gol: VeiculoDoPedido = { veiculo: { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: '1.0', versao: 'Trendline' }, rotulos: { curto: 'Gol 2018 1.0 Trendline', completo: 'Volkswagen Gol 2018 1.0 Trendline' } };

describe('RN-CAT-22 (aba Itens): lista com e sem veículo', () => {
  it('sem veículo e sem texto, a lista é a dos itens do pedido', () => {
    expect(modoDaListaDoPedido({ veiculo: false, texto: '' })).toBe('itens');
    expect(modoDaListaDoPedido({ veiculo: false, texto: 'ab' })).toBe('itens');
  });
  it('com veículo e sem texto (ou com menos de 3 letras), a lista mostra as peças do veículo', () => {
    expect(modoDaListaDoPedido({ veiculo: true, texto: '' })).toBe('veiculo');
    expect(modoDaListaDoPedido({ veiculo: true, texto: ' ab ' })).toBe('veiculo');
  });
  it('com 3 letras ou mais, é busca, com ou sem veículo', () => {
    expect(modoDaListaDoPedido({ veiculo: false, texto: 'pastilha' })).toBe('busca');
    expect(modoDaListaDoPedido({ veiculo: true, texto: 'pastilha' })).toBe('busca');
  });
  it('com veículo, texto de menos de 3 letras vai como sem texto', () => {
    expect(textoDaBuscaComVeiculo('  ab ', true)).toBe('');
    expect(textoDaBuscaComVeiculo(' pastilha ', true)).toBe('pastilha');
    expect(textoDaBuscaComVeiculo(' ab ', false)).toBe('ab');
  });
});

describe('RN-CAT-22 (aba Itens): linha 3 do produto', () => {
  it('compatível vira o chip "Compatível"', () => {
    expect(linhaDoVeiculoNoItem({ compatibilidade: 'compativel', serve_em: null })).toEqual({ tipo: 'compativel' });
  });
  it('de conferir leva o trecho "Serve em"', () => {
    const trecho = { texto: 'Gol 2017–2019', marcas: [[0, 3]] as [number, number][], inclui_ano: null };
    expect(linhaDoVeiculoNoItem({ compatibilidade: 'conferir', serve_em: trecho })).toEqual({ tipo: 'serve_em', trecho });
  });
  it('de conferir com o trecho só do modelo (serve_em nulo) não tem linha 3', () => {
    expect(linhaDoVeiculoNoItem({ compatibilidade: 'conferir', serve_em: null })).toBeNull();
  });
  it('sem veículo na consulta, nenhuma linha 3', () => {
    expect(linhaDoVeiculoNoItem(undefined)).toBeNull();
  });
});

describe('RN-CAT-22 (aba Itens): textos do botão e da etiqueta', () => {
  it('botão sem veículo e com veículo (leitor de tela)', () => {
    expect(leituraDoBotaoVeiculo(null)).toBe('Veículo');
    expect(leituraDoBotaoVeiculo(gol)).toBe('Veículo: Volkswagen Gol 2018 1.0 Trendline');
  });
  it('etiqueta removível lê "Remover veículo ..."', () => {
    expect(leituraDaEtiquetaVeiculo(gol)).toBe('Remover veículo Volkswagen Gol 2018 1.0 Trendline');
  });
});

describe('RN-CAT-22 (aba Itens): passos da cascata', () => {
  it('só há veículo quando há modelo', () => {
    expect(veiculoDaEscolha({ montadora: 'Fiat' })).toBeNull();
    expect(veiculoDaEscolha({ modelo: 'Uno' })).toEqual({ montadora: null, modelo: 'Uno', ano: null, motor: null, versao: null });
  });
  it('escolher ano guarda número; voltar pela trilha mantém os passos antes', () => {
    expect(escolherOpcao({ montadora: 'Fiat', modelo: 'Uno' }, 'ano', '2012')).toEqual({ montadora: 'Fiat', modelo: 'Uno', ano: 2012 });
    const trilha = [
      { nivel: 'montadora', valor: 'Fiat', rotulo: 'Fiat', automatico: false },
      { nivel: 'modelo', valor: 'Uno', rotulo: 'Uno', automatico: false },
      { nivel: 'ano', valor: '2012', rotulo: '2012', automatico: false },
    ] as const;
    expect(escolhaAntesDoPasso(trilha, 2)).toEqual({ montadora: 'Fiat', modelo: 'Uno' });
    expect(escolhaAntesDoPasso(trilha, 0)).toEqual({});
  });
  it('resultado da busca: montadora leva ao modelo; modelo traz a montadora do apoio', () => {
    expect(escolhaDoResultadoDaBusca({ valor: 'Fiat', rotulo: 'Fiat', apoio: null, nivel: 'montadora' })).toEqual({ montadora: 'Fiat' });
    expect(escolhaDoResultadoDaBusca({ valor: 'Gol', rotulo: 'Gol', apoio: 'Volkswagen', nivel: 'modelo' })).toEqual({ montadora: 'Volkswagen', modelo: 'Gol' });
  });
});
