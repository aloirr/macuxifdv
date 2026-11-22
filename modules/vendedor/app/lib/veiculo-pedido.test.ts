import { describe, expect, it } from 'vitest';

import { buscarNoCatalogoComReserva } from './busca-catalogo';
import * as apoio from './veiculo-pedido';

import {
  escolhaAntesDoPasso,
  escolhaDoResultadoDaBusca,
  escolherOpcao,
  leituraDaEtiquetaVeiculo,
  leituraDoBotaoVeiculo,
  escopoDoCliente,
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

describe('RN-CAT-22 e RN-CAT-06 (aba Itens): escopo do cliente na cascata', () => {
  it('com cliente, a cascata leva o mesmo cliente_id da busca de itens', () => {
    expect(escopoDoCliente('c1', ['a', 'b'])).toEqual({ cliente_id: 'c1' });
  });
  it('sem cliente, leva os mesmos produto_ids da busca; sem nenhum dos dois, não leva escopo', () => {
    expect(escopoDoCliente(undefined, ['a', 'b'])).toEqual({ produto_ids: ['a', 'b'] });
    expect(escopoDoCliente(undefined, null)).toEqual({});
  });
});

describe('RN-CAT-22 (aba Itens): a lista filtrada não tem a linha 3', () => {
  it('o apoio da linha 3 (Compatível / Serve em do veículo) não existe mais', () => {
    expect('linhaDoVeiculoNoItem' in apoio).toBe(false);
    expect('compativel' in apoio.TEXTOS_VEICULO_PEDIDO).toBe(false);
  });
  it('o item da busca guarda só o "Serve em" do texto, sem dado do veículo', async () => {
    const r = await buscarNoCatalogoComReserva(async () => ({ itens: [{ produto_id: 'p1', serve_em: null, veiculo: { compatibilidade: 'compativel' } } as never] }), () => false, () => undefined);
    expect(r).toEqual({ tipo: 'ok', itens: [{ produto_id: 'p1', serve_em: null }], total: 1, sugestao: null });
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
