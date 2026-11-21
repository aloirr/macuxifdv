/**
 * RN-CAT-19 no aparelho: o modelo derivado e as vizinhas juntas valem na aba (`buscarLocal`), no seletor (`catalogo.busca_produtos@1`)
 * e na pré-seleção do FTS5 (a consulta ao FTS5 é expandida com as derivadas e com a palavra junta).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConsultaTexto } from '@macuxi/platform-sdk';
import { aparelhoCom } from './__fixtures__/busca-bap-aparelho';
import { esquecerMemoriaLocal, LIMIAR_PRESELECAO_FTS, preselecionar, type LeitorLocal } from './lib/local';
import { esquecerMemoriaTextos } from './texto-consultas';
import { nomesDeVeiculo } from '../domain/veiculos';

const LINHAS: { nome: string; aplicacao: string }[] = [
  { nome: 'Coxim Fox', aplicacao: 'Volkswagen Fox 2010–2014' },
  { nome: 'Amortecedor SPACE-FOX', aplicacao: '' },
  { nome: 'Amortecedor dianteiro CrossFox', aplicacao: 'Volkswagen CrossFox 2010–2014' },
  { nome: 'Amortecedor traseiro SpaceFox', aplicacao: 'Volkswagen SpaceFox 2010–2014' },
  { nome: 'Amortecedor Gol G5', aplicacao: 'Volkswagen Gol G5 2014–2019' },
  { nome: 'Amortecedor Golf', aplicacao: 'Volkswagen Golf 2010–2014' },
  ...Array.from({ length: 12 }, (_, i) => ({ nome: `Filtro de ar ${i}`, aplicacao: 'Volkswagen Fox 2008–2012' })),
  ...Array.from({ length: 12 }, (_, i) => ({ nome: `Filtro de óleo ${i}`, aplicacao: 'Volkswagen Gol 2008–2012' })),
];
const { pelaConsulta, pelaAba } = aparelhoCom(LINHAS);
const ESPERADO_FOX = ['Coxim Fox', 'Amortecedor dianteiro CrossFox', 'Amortecedor traseiro SpaceFox', 'Amortecedor SPACE-FOX'];
const semFiltros = (x: string[]) => x.filter((n) => !n.startsWith('Filtro')).sort();

describe.each([
  ['consulta do seletor', pelaConsulta],
  ['aba', pelaAba],
] as const)('RN-CAT-19 no aparelho (%s)', (_nome, buscar) => {
  beforeEach(() => {
    esquecerMemoriaLocal();
    esquecerMemoriaTextos();
  });

  it('RN-CAT-19: "fox" acha Fox, CrossFox e SpaceFox', async () => {
    expect(semFiltros(await buscar('fox'))).toEqual([...ESPERADO_FOX].sort());
  });

  it('RN-CAT-19: "space fox" acha os dois SpaceFox', async () => {
    expect((await buscar('space fox')).sort()).toEqual(['Amortecedor SPACE-FOX', 'Amortecedor traseiro SpaceFox']);
  });
});

describe('RN-CAT-19: pré-seleção do FTS5 do aparelho', () => {
  const veiculos = nomesDeVeiculo([
    ...Array.from({ length: 10 }, () => ({ nomeEDescricao: 'Filtro', aplicacao: 'Fox 2010' })),
    { nomeEDescricao: 'Coxim CrossFox', aplicacao: '' },
    { nomeEDescricao: 'Bucha SpaceFox', aplicacao: '' },
  ]);
  const consultas = async (texto: string): Promise<ConsultaTexto[]> => {
    const feitas: ConsultaTexto[] = [];
    const l = {
      linhas: async () => [],
      buscarComDesfecho: async (_i: string, c: ConsultaTexto) => {
        feitas.push(c);
        return { buscou: true as const, resultados: [] };
      },
    } as unknown as LeitorLocal;
    await preselecionar(l, texto, null, [], LIMIAR_PRESELECAO_FTS + 10, undefined, veiculos);
    return feitas;
  };
  const alternativas = (c: ConsultaTexto[]) => new Set(c.flatMap((x) => x.grupos.flat()));

  it('RN-CAT-19: "fox" pede ao FTS5 também as derivadas (crossfox, spacefox)', async () => {
    expect([...alternativas(await consultas('fox'))]).toEqual(expect.arrayContaining(['fox', 'crossfox', 'spacefox']));
  });

  it('RN-CAT-19: "space fox" pede ao FTS5 a palavra junta "spacefox" (consulta própria, fora do AND)', async () => {
    const feitas = await consultas('space fox');
    expect(feitas.some((c) => c.grupos.length === 1 && c.grupos[0]!.includes('spacefox'))).toBe(true);
    expect(feitas.some((c) => c.grupos.length === 2 && c.grupos.flat().includes('space'))).toBe(true);
  });

  it('RN-CAT-19: o que não é veículo nem tem vizinha de 3+ letras não ganha alternativa nova', async () => {
    expect([...alternativas(await consultas('cabo'))].sort()).toEqual(['cab', 'cabo']); // "cab" = prefixo tolerante de sempre
    expect([...alternativas(await consultas('ab cde'))].sort()).toEqual(['ab', 'cde']);
  });
});
