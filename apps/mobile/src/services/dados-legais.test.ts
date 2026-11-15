/**
 * Leitura dos dados legais do rodapé (docs/design/telas/rodape-legal.md §3.5): endereço da rota pública no servidor em uso,
 * resposta conferida pelo contrato, e qualquer falha (rede, 503, formato) vira `null` sem lançar. Dados fictícios.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined } }));

const { buscarDadosLegais, urlDosDadosLegais } = await import('./dados-legais');

const resposta = (status: number, corpo: unknown) => (async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;

describe('dados legais no app', () => {
  it('rota pública no mesmo servidor do login', () => {
    expect(urlDosDadosLegais('https://api.exemplo.com.br/v1')).toBe('https://api.exemplo.com.br/v1/publico/dados-legais');
    expect(urlDosDadosLegais('http://10.0.0.5:8100/v1/')).toBe('http://10.0.0.5:8100/v1/publico/dados-legais');
  });
  it('resposta válida volta como veio', async () => {
    const dados = { razao_social: 'Empresa Teste Ltda.', cnpj: '11444777000161', site: 'macuxifdv.com.br' };
    expect(await buscarDadosLegais('http://x/v1', resposta(200, dados))).toEqual(dados);
  });
  it('503, formato errado ou sem rede: null', async () => {
    expect(await buscarDadosLegais('http://x/v1', resposta(503, { codigo: 'DADOS_LEGAIS_INDISPONIVEIS' }))).toBeNull();
    expect(await buscarDadosLegais('http://x/v1', resposta(200, { cnpj: 'abc' }))).toBeNull();
    const semRede = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    expect(await buscarDadosLegais('http://x/v1', semRede)).toBeNull();
  });
});
