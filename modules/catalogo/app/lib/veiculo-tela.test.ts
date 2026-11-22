import { describe, expect, it } from 'vitest';
import { partirTrecho, textoDaFichaCompativel, vazioComVeiculo } from './veiculo-tela';

const GOL = { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: '1.0', versao: null };

describe('RN-CAT-22: apoio das telas do veículo', () => {
  it('RN-CAT-22: o texto da ficha da spec §12 (o veículo escrito, sem a montadora)', () => {
    expect(textoDaFichaCompativel(GOL)).toBe('Compatível com Gol 2018 1.0');
  });
  it('RN-CAT-22: o vazio com veículo: com texto, o título leva o texto; sem texto, "Nenhum produto com esses filtros"; chip marcado pede Limpar filtros', () => {
    expect(vazioComVeiculo({ consulta: 'traseiro', chipMarcado: false })).toEqual({ titulo: 'Nada encontrado para "traseiro"', acao: 'tirar_veiculo' });
    expect(vazioComVeiculo({ consulta: '', chipMarcado: true })).toEqual({ titulo: 'Nenhum produto com esses filtros', acao: 'limpar_filtros' });
  });
  it('RN-CAT-22: o trecho é partido nas marcas, com o modelo em negrito', () => {
    expect(partirTrecho('Gol 2017–2019 1.0', [[0, 3]])).toEqual([{ texto: 'Gol', marcado: true }, { texto: ' 2017–2019 1.0', marcado: false }]);
    expect(partirTrecho('Gol', [])).toEqual([{ texto: 'Gol', marcado: false }]);
  });
});
