import { describe, expect, it } from 'vitest';

import {
  bairrosDaRota,
  cidadesDaRota,
  comCidade,
  comData,
  contarFiltrosRota,
  dataDaRota,
  etiquetasDaRota,
  FILTRO_ROTA_PADRAO,
  filtrarParadas,
  semFiltroRota,
  situacaoNaLinha,
  subtituloDaCarteira,
  subtituloDaRota,
  textoDaDataDaRota,
  textoDasFeitas,
  textoVerClientes,
  textoVerVisitas,
  tituloDaRota,
  type FiltroRota,
} from './filtro-padrao';

const HOJE = '2026-11-15';
const parada = (seq: number, nome: string, cidade: string, bairro: string, status = 'pending', codigo = `C-${seq}`) => ({
  sequence: seq,
  status,
  customer: { trade_name: nome, legal_name: `${nome} Ltda`, erp_code: codigo, city: cidade, district: bairro },
});
const PARADAS = [
  parada(1, 'Mercadinho Paraviana', 'Boa Vista', 'Paraviana', 'done'),
  parada(2, 'Mercadinho São Jorge', 'Boa Vista', 'Centro', 'done'),
  parada(5, 'Auto Peças Centro', 'Boa Vista', 'Centro', 'done'),
  parada(7, 'Oficina do Raimundo', 'Boa Vista', 'Centro', 'next', 'OF-77'),
  parada(9, 'Casa das Baterias', 'Boa Vista', 'Centro'),
  parada(11, 'Posto Mucajaí', 'Mucajaí', 'Centro'),
  parada(12, 'Lubrificantes Pricumã', 'Boa Vista', 'Pricumã'),
];
const f = (p: Partial<FiltroRota>): FiltroRota => ({ ...FILTRO_ROTA_PADRAO, ...p });

describe('Filtro padrão da Rota (R-20261115-072200; spec filtro-padrao-campo §2)', () => {
  it('cidades e bairros saem das paradas, sem repetição e em ordem; o bairro segue a cidade', () => {
    expect(cidadesDaRota(PARADAS)).toEqual(['Boa Vista', 'Mucajaí']);
    expect(bairrosDaRota(PARADAS, null)).toEqual(['Centro', 'Paraviana', 'Pricumã']);
    expect(bairrosDaRota(PARADAS, 'Mucajaí')).toEqual(['Centro']);
  });

  it('trocar a cidade tira o bairro que não é dela', () => {
    expect(comCidade(f({ bairro: 'Pricumã' }), 'Mucajaí', PARADAS)).toEqual(f({ cidade: 'Mucajaí', bairro: null }));
    expect(comCidade(f({ bairro: 'Centro' }), 'Mucajaí', PARADAS)).toEqual(f({ cidade: 'Mucajaí', bairro: 'Centro' }));
  });

  it('cidade e bairro filtram; a numeração da rota continua (2, 5, 7, 9)', () => {
    expect(filtrarParadas(PARADAS, f({ cidade: 'Boa Vista', bairro: 'Centro' })).map((p) => p.sequence)).toEqual([2, 5, 7, 9]);
  });

  it('cliente por nome (sem acento, sem caixa) ou código', () => {
    expect(filtrarParadas(PARADAS, f({ cliente: 'pecas' })).map((p) => p.sequence)).toEqual([5]);
    expect(filtrarParadas(PARADAS, f({ cliente: ' of-77 ' })).map((p) => p.sequence)).toEqual([7]);
    expect(filtrarParadas(PARADAS, f({ cliente: 'nada disso' }))).toEqual([]);
  });

  it('o padrão (hoje, sem filtro) não conta; cada filtro conta um', () => {
    expect(contarFiltrosRota(FILTRO_ROTA_PADRAO)).toBe(0);
    expect(contarFiltrosRota(f({ cidade: 'Boa Vista', bairro: 'Centro' }))).toBe(2);
    expect(contarFiltrosRota(f({ cliente: 'x', cidade: 'a', bairro: 'b', data: '2026-11-17' }))).toBe(4);
    expect(contarFiltrosRota(f({ cliente: '   ' }))).toBe(0);
  });

  it('escolher hoje volta ao padrão; a data em vigor é hoje sem filtro', () => {
    expect(comData(FILTRO_ROTA_PADRAO, HOJE, HOJE).data).toBeNull();
    expect(comData(FILTRO_ROTA_PADRAO, '2026-11-17', HOJE).data).toBe('2026-11-17');
    expect(dataDaRota(FILTRO_ROTA_PADRAO, HOJE)).toBe(HOJE);
    expect(dataDaRota(f({ data: '2026-11-17' }), HOJE)).toBe('2026-11-17');
  });

  it('título: "Rota de hoje" ou "Rota de ter, 17/11"; etiqueta da data "Ter, 17/11"', () => {
    expect(tituloDaRota(FILTRO_ROTA_PADRAO)).toBe('Rota de hoje');
    expect(tituloDaRota(f({ data: '2026-11-17' }))).toBe('Rota de ter, 17/11');
    expect(textoDaDataDaRota('2026-11-17', true)).toBe('Ter, 17/11');
  });

  it('etiquetas na ordem da folha; o ✕ tira só aquele filtro', () => {
    const cheio = f({ cliente: 'Oficina do Raimundo', cidade: 'Boa Vista', bairro: 'Centro', data: '2026-11-17' });
    expect(etiquetasDaRota(cheio).map((e) => e.texto)).toEqual(['Oficina do Raimundo', 'Boa Vista', 'Centro', 'Ter, 17/11']);
    expect(etiquetasDaRota(FILTRO_ROTA_PADRAO)).toEqual([]);
    expect(semFiltroRota(cheio, 'cidade')).toEqual({ ...cheio, cidade: null });
    expect(semFiltroRota(cheio, 'data')).toEqual({ ...cheio, data: null });
    expect(semFiltroRota(cheio, 'cliente')).toEqual({ ...cheio, cliente: '' });
  });

  it('RD-0499: subtítulo "4 de 12 visitas · 38 km" com filtro, sem a região; sem filtro, com ela', () => {
    expect(subtituloDaRota({ filtradas: 4, total: 12, totalKm: 37.6, regiao: 'Centro-Sul', comFiltro: true })).toBe('4 de 12 visitas · 38 km');
    expect(subtituloDaRota({ filtradas: 12, total: 12, totalKm: 37.6, regiao: 'Centro-Sul', comFiltro: false })).toBe('12 visitas · 38 km · Centro-Sul');
    expect(subtituloDaRota({ filtradas: 1, total: 1, totalKm: 0, regiao: '', comFiltro: false })).toBe('1 visita · 0 km');
  });

  it('a tag conta as feitas entre as filtradas; o botão da folha acompanha a contagem', () => {
    const filtradas = filtrarParadas(PARADAS, f({ cidade: 'Boa Vista', bairro: 'Centro' }));
    expect(textoDasFeitas(filtradas)).toBe('2 feitas');
    expect(textoDasFeitas(PARADAS.slice(0, 1))).toBe('1 feita');
    expect(textoVerVisitas(4)).toBe('Ver 4 visitas');
    expect(textoVerVisitas(1)).toBe('Ver 1 visita');
  });
});

describe('Filtro padrão de Clientes (spec filtro-padrao-campo §3)', () => {
  it('RD-0501: carteira vazia sem subtítulo; com filtro, "5 de 86 na carteira"', () => {
    expect(subtituloDaCarteira(0, 0)).toBeUndefined();
    expect(subtituloDaCarteira(86, 86)).toBe('86 na carteira');
    expect(subtituloDaCarteira(5, 86)).toBe('5 de 86 na carteira');
  });

  it('RD-0500: a situação garantida pelo filtro sai da linha; a que distingue fica', () => {
    expect(situacaoNaLinha('devendo', ['devendo'])).toBeNull();
    expect(situacaoNaLinha('bloqueado', ['devendo'])).toBe('bloqueado');
    expect(situacaoNaLinha('em_dia', [])).toBe('em_dia');
  });

  it('o botão da folha: "Ver 5 clientes", "Ver 1 cliente"', () => {
    expect(textoVerClientes(5)).toBe('Ver 5 clientes');
    expect(textoVerClientes(1)).toBe('Ver 1 cliente');
  });
});
