import { describe, expect, it } from 'vitest';
import { escolhaAntesDoPasso, escolherOpcao, escolhaDoResultadoDaBusca, leituraDaEtiquetaVeiculo, leituraDoBotaoVeiculo, nadaEncontradoPara, nenhumModeloCom, partirTrecho, textoDaEtiquetaVeiculo, textoDaFichaCompativel, vazioComVeiculo, veiculoDaEscolha } from './veiculo-tela';

const GOL = { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: '1.0', versao: null };

describe('RN-CAT-22: apoio das telas do veículo', () => {
  it('RN-CAT-22: os textos da spec §12 (etiqueta sem a montadora, leitor com ela, ficha com o veículo escrito)', () => {
    expect(textoDaEtiquetaVeiculo(GOL)).toBe('Gol 2018 1.0');
    expect(leituraDaEtiquetaVeiculo(GOL)).toBe('Remover veículo Volkswagen Gol 2018 1.0');
    expect(leituraDoBotaoVeiculo(GOL)).toBe('Veículo: Volkswagen Gol 2018 1.0');
    expect(leituraDoBotaoVeiculo(null)).toBe('Veículo');
    expect(textoDaFichaCompativel(GOL)).toBe('Compatível com Gol 2018 1.0');
    expect(nadaEncontradoPara('traseiro')).toBe('Nada encontrado para "traseiro"');
    expect(nenhumModeloCom('xyz')).toBe('Nenhum modelo com "xyz".');
  });
  it('RN-CAT-22: o vazio com veículo: com texto, o título leva o texto; sem texto, "Nenhum produto com esses filtros"; chip marcado pede Limpar filtros', () => {
    expect(vazioComVeiculo({ consulta: 'traseiro', chipMarcado: false })).toEqual({ titulo: 'Nada encontrado para "traseiro"', acao: 'tirar_veiculo' });
    expect(vazioComVeiculo({ consulta: '', chipMarcado: true })).toEqual({ titulo: 'Nenhum produto com esses filtros', acao: 'limpar_filtros' });
  });
  it('RN-CAT-22: a trilha volta ao passo tocado e a escolha da busca leva ao nível certo', () => {
    const trilha = [
      { nivel: 'montadora' as const, valor: 'Volkswagen', rotulo: 'Volkswagen', automatico: false },
      { nivel: 'modelo' as const, valor: 'Gol', rotulo: 'Gol', automatico: false },
      { nivel: 'ano' as const, valor: '2018', rotulo: '2018', automatico: false },
    ];
    expect(escolhaAntesDoPasso(trilha, 1)).toEqual({ montadora: 'Volkswagen' });
    expect(escolhaAntesDoPasso(trilha, 0)).toEqual({});
    expect(escolherOpcao({ montadora: 'Volkswagen', modelo: 'Gol' }, 'ano', '2018')).toEqual({ montadora: 'Volkswagen', modelo: 'Gol', ano: 2018 });
    expect(escolhaDoResultadoDaBusca({ valor: 'Gol', rotulo: 'Gol', apoio: 'Volkswagen', nivel: 'modelo' })).toEqual({ montadora: 'Volkswagen', modelo: 'Gol' });
    expect(escolhaDoResultadoDaBusca({ valor: 'Volkswagen', rotulo: 'Volkswagen', apoio: null, nivel: 'montadora' })).toEqual({ montadora: 'Volkswagen' });
    expect(veiculoDaEscolha({ montadora: 'Volkswagen' })).toBeNull();
    expect(veiculoDaEscolha({ modelo: 'Gol' })).toEqual({ montadora: null, modelo: 'Gol', ano: null, motor: null, versao: null });
  });
  it('RN-CAT-22: o trecho é partido nas marcas, com o modelo em negrito', () => {
    expect(partirTrecho('Gol 2017–2019 1.0', [[0, 3]])).toEqual([{ texto: 'Gol', marcado: true }, { texto: ' 2017–2019 1.0', marcado: false }]);
    expect(partirTrecho('Gol', [])).toEqual([{ texto: 'Gol', marcado: false }]);
  });
});
