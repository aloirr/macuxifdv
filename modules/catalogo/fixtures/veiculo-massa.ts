/**
 * Massa de teste do filtro por veículo (RN-CAT-22): 16 produtos com aplicação variada, o Gol 2018 e as escolhas de referência.
 * Usada pelo teste de igualdade do catálogo e pelo `tests/` (ponta a ponta).
 */
import type { VeiculoEscolhido } from '../contracts';

export const uuid = (n: number) => `0ca00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const NOMES = ['Amortecedor dianteiro', 'Amortecedor traseiro', 'Pastilha de freio', 'Disco de freio', 'Coxim do motor', 'Bucha da bandeja', 'Terminal de direção', 'Barra axial', 'Pivô da suspensão', 'Kit de embreagem', 'Correia dentada', 'Bomba de combustível', 'Filtro de ar', 'Vela de ignição', 'Junta do cabeçote', 'Fluido de freio'];
export const APLICACOES = [
  ...Array(4).fill('VW Gol 2017–2019 1.0/1.6 Highline'),
  ...Array(3).fill('Volkswagen Gol 2018 1.0 Trendline'),
  'VW Gol',
  'Gol 2020>',
  ...Array(3).fill('Ford EcoSport 2012–2016 1.6'),
  ...Array(3).fill('Civic 07–11 · Fit 2003>'),
  '',
] as string[];
export const LINHAS = NOMES.map((nome, i) => ({ id: uuid(i + 1), nome, aplicacao: APLICACOES[i]! }));

export const GOL_2018: VeiculoEscolhido = { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: null, versao: null };
export const ESCOLHAS: VeiculoEscolhido[] = [
  GOL_2018,
  { ...GOL_2018, motor: '1.0', versao: 'Highline' },
  { ...GOL_2018, ano: null },
  { ...GOL_2018, ano: 2020 },
  { montadora: null, modelo: 'Civic', ano: 2009, motor: null, versao: null },
  { montadora: 'Ford', modelo: 'EcoSport', ano: 2014, motor: '1.6', versao: null },
];

/** Os produtos que o cliente pode comprar (têm preço na tabela dele): Gol Highline (2), Civic (1) e o fluido universal (1). */
export const VENDAVEIS = [0, 1, 12, 15].map((i) => LINHAS[i]!.id);
