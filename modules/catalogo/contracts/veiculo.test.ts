import { describe, expect, it } from 'vitest';
import type { NavegacaoCascata, TextosFolhaVeiculo } from '@macuxi/ui/mobile';
import {
  escolhaAntesDoPasso,
  escolhaDoResultadoDaBusca,
  escolherOpcao,
  leituraDaEtiquetaVeiculo,
  leituraDoBotaoVeiculo,
  NAVEGACAO_VEICULO,
  textoDaBuscaComVeiculo,
  TEXTOS_VEICULO,
  veiculoDaEscolha,
  type VeiculoEscolhido,
  type VeiculoParcial,
} from './veiculo';

const GOL = { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: '1.0', versao: null };
const ROTULOS = { curto: 'Gol 2018 1.0', completo: 'Volkswagen Gol 2018 1.0' };

describe('RN-CAT-22: apoios da folha Veículo (o Catálogo e o Vendedor passam `NAVEGACAO_VEICULO` e `TEXTOS_VEICULO`)', () => {
  it('RN-CAT-22: a trilha volta ao passo tocado (o nível preenchido sozinho não vira escolha) e a escolha da busca leva ao nível certo', () => {
    const trilha = [
      { nivel: 'montadora' as const, valor: 'Volkswagen', rotulo: 'Volkswagen', automatico: false },
      { nivel: 'modelo' as const, valor: 'Gol', rotulo: 'Gol', automatico: false },
      { nivel: 'ano' as const, valor: '2018', rotulo: '2018', automatico: true },
      { nivel: 'motor' as const, valor: '1.0', rotulo: '1.0', automatico: false },
    ];
    expect(escolhaAntesDoPasso(trilha, 1)).toEqual({ montadora: 'Volkswagen' });
    expect(escolhaAntesDoPasso(trilha, 0)).toEqual({});
    expect(escolhaAntesDoPasso(trilha, 3)).toEqual({ montadora: 'Volkswagen', modelo: 'Gol' });
    expect(escolherOpcao({ montadora: 'Volkswagen', modelo: 'Gol' }, 'ano', '2018')).toEqual({ montadora: 'Volkswagen', modelo: 'Gol', ano: 2018 });
    expect(escolhaDoResultadoDaBusca({ valor: 'Gol', rotulo: 'Gol', apoio: 'Volkswagen', nivel: 'modelo' })).toEqual({ montadora: 'Volkswagen', modelo: 'Gol' });
    expect(escolhaDoResultadoDaBusca({ valor: 'Volkswagen', rotulo: 'Volkswagen', apoio: null, nivel: 'montadora' })).toEqual({ montadora: 'Volkswagen' });
    expect(veiculoDaEscolha({ montadora: 'Volkswagen' })).toBeNull();
    expect(veiculoDaEscolha({ modelo: 'Gol' })).toEqual({ montadora: null, modelo: 'Gol', ano: null, motor: null, versao: null });
  });
  it('RN-CAT-22: `NAVEGACAO_VEICULO` junta os apoios no formato do kit', () => {
    expect(NAVEGACAO_VEICULO.vazia).toEqual({});
    expect(NAVEGACAO_VEICULO.nivelEmGrade).toBe('ano');
    expect(NAVEGACAO_VEICULO.niveisComVerPecas).toEqual(['ano', 'motor', 'versao']);
    expect(NAVEGACAO_VEICULO.doVeiculo(GOL)).toEqual(GOL);
    expect(NAVEGACAO_VEICULO.veiculoDe({ modelo: 'Gol' })?.modelo).toBe('Gol');
  });
  it('RN-CAT-22: os textos da spec §12 (leitor de tela com a montadora; nível e vazio da busca)', () => {
    expect(leituraDaEtiquetaVeiculo(ROTULOS)).toBe('Remover veículo Volkswagen Gol 2018 1.0');
    expect(leituraDoBotaoVeiculo(ROTULOS)).toBe('Veículo: Volkswagen Gol 2018 1.0');
    expect(leituraDoBotaoVeiculo(null)).toBe('Veículo');
    expect(TEXTOS_VEICULO.nenhumModeloCom('xyz')).toBe('Nenhum modelo com "xyz".');
    expect(TEXTOS_VEICULO.rotuloDoNivel.versao).toBe('Versão');
    expect(TEXTOS_VEICULO.nadaEncontradoPara('traseiro')).toBe('Nada encontrado para "traseiro"');
    expect(TEXTOS_VEICULO.placeholderBusca).toBe('Peça ou código…');
    expect(TEXTOS_VEICULO.dicaBusca).toBe('Também acha por marca, aplicação e referência cruzada.');
  });
  it('RN-CAT-22: encaixe com a `FolhaVeiculo` do kit: os apoios reais cabem em `NavegacaoCascata` e `TextosFolhaVeiculo` (o typecheck é o teste)', () => {
    const _navegacao: NavegacaoCascata<VeiculoParcial, VeiculoEscolhido> = NAVEGACAO_VEICULO;
    const _textos: TextosFolhaVeiculo = TEXTOS_VEICULO;
    expect([_navegacao.nivelEmGrade, _textos.titulo]).toEqual(['ano', 'Veículo']);
  });
  it('RN-CAT-22: com veículo, texto de menos de 3 caracteres vale como sem texto; sem veículo, o texto é o que veio', () => {
    expect(textoDaBuscaComVeiculo('ab', GOL)).toBe('');
    expect(textoDaBuscaComVeiculo(' a b ', GOL)).toBe('');
    expect(textoDaBuscaComVeiculo('amortecedor', GOL)).toBe('amortecedor');
    expect(textoDaBuscaComVeiculo('ab', undefined)).toBe('ab');
  });
});
