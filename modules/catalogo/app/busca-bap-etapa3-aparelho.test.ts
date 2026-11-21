/**
 * RN-CAT-19 no aparelho: "é nome de veículo" calculado na carga dos produtos locais (a aplicação nem fica na memória em catálogo
 * grande) e usado pela consulta do seletor (`catalogo.busca_produtos@1`) e pela aba (`buscarLocal`). Mesmos casos da lista inteira.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { aparelhoCom } from './__fixtures__/busca-bap-aparelho';
import { esquecerMemoriaLocal } from './lib/local';
import { esquecerMemoriaTextos } from './texto-consultas';

const LINHAS: { nome: string; aplicacao: string }[] = [
  { nome: 'Amortecedor Gol G5', aplicacao: 'Volkswagen Gol G5 2014–2019' },
  { nome: 'Amortecedor Gol KYB 441126', aplicacao: 'Volkswagen Gol 2007–2011' },
  { nome: 'Amortecedor Golf', aplicacao: 'Volkswagen Golf 2010–2014' },
  { nome: 'Bucha Polo Classic', aplicacao: 'Volkswagen Polo Classic 1996–2002' },
  { nome: 'Cabo de vela 4 polos', aplicacao: 'Motor 1.0 flex' },
  { nome: 'Junta homocinética', aplicacao: 'Honda Civic 2007–2011' },
  { nome: 'Amortecedor dianteiro', aplicacao: 'Fiat Palio 2010–2014' },
  ...Array.from({ length: 12 }, (_, i) => ({ nome: `Filtro de ar ${i}`, aplicacao: 'Volkswagen Gol 2008–2012' })),
  ...Array.from({ length: 6 }, (_, i) => ({ nome: `Filtro de óleo ${i}`, aplicacao: 'Volkswagen Polo 2003–2007' })),
];
const { pelaConsulta, pelaAba } = aparelhoCom(LINHAS);

describe.each([
  ['consulta do seletor', pelaConsulta],
  ['aba', pelaAba],
] as const)('RN-CAT-19 no aparelho (%s)', (_nome, buscar) => {
  beforeEach(() => {
    esquecerMemoriaLocal();
    esquecerMemoriaTextos();
  });

  it('RN-CAT-19: "gol" traz Gol G5 e Gol KYB, sem o Golf', async () => {
    const achados = await buscar('gol');
    expect(achados).toEqual(expect.arrayContaining(['Amortecedor Gol G5', 'Amortecedor Gol KYB 441126']));
    expect(achados).not.toContain('Amortecedor Golf');
  });

  it('RN-CAT-19: "polo" traz só a Bucha Polo Classic, sem o "Cabo de vela 4 polos"', async () => {
    const achados = await buscar('polo');
    expect(achados).toContain('Bucha Polo Classic');
    expect(achados).not.toContain('Cabo de vela 4 polos');
  });

  it('RN-CAT-19: "homoc" acha a junta; "amortecedor pal" acha o Palio; "pal amortecedor" não', async () => {
    expect(await buscar('homoc')).toEqual(['Junta homocinética']);
    expect(await buscar('amortecedor pal')).toEqual(['Amortecedor dianteiro']);
    expect(await buscar('pal amortecedor')).toEqual([]);
  });

  it('RN-CAT-19: "amortecedor para gol" = "amortecedor gol", sem o Golf', async () => {
    expect(await buscar('amortecedor para gol')).toEqual(await buscar('amortecedor gol'));
    expect(await buscar('amortecedor gol')).toEqual(['Amortecedor Gol G5', 'Amortecedor Gol KYB 441126']);
  });
});
