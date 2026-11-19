import { describe, expect, it } from 'vitest';

import { buscarDocumento, buscarNota, buscarNotas, falhaDaConsulta } from './ficha-online';
import type { ClienteHttp } from './http';

const ID = '11111111-1111-4111-8111-111111111111';

function http(resposta: unknown): { cliente: ClienteHttp; chamadas: Array<{ caminho: string; query?: Record<string, unknown> }> } {
  const chamadas: Array<{ caminho: string; query?: Record<string, unknown> }> = [];
  return { chamadas, cliente: { get: async <T>(caminho: string, query?: Record<string, string | number | undefined>) => (chamadas.push({ caminho, query }), resposta as T) } };
}

describe('T-0186 / P17 e P15: consultas online da ficha', () => {
  it('P17: a lista de notas vem do servidor pela rota do contrato, com o período', async () => {
    const h = http({ de: '2026-08-21', ate: '2026-11-19', itens: [], cortadas: 0, formas_pagamento: ['Boleto 28 dias'] });
    const r = await buscarNotas(h.cliente, ID, { de: '2026-08-21', ate: '2026-11-19' });
    expect(r.formas_pagamento).toEqual(['Boleto 28 dias']);
    expect(h.chamadas[0]).toEqual({ caminho: `/core/clientes/${ID}/notas`, query: { de: '2026-08-21', ate: '2026-11-19', limite: 200 } });
  });
  it('P17: ao tocar, a NF é buscada pelo id da nota; resposta fora do contrato é recusada', async () => {
    const h = http({ id: ID });
    await expect(buscarNota(h.cliente, ID, ID)).rejects.toThrow();
    expect(h.chamadas[0]?.caminho).toBe(`/core/clientes/${ID}/notas/${ID}`);
  });
  it('P15: o documento abre pelo arquivo que a API devolve (só ver)', async () => {
    const h = http({ id: ID, nome: 'Alvará', formato: 'pdf', arquivo_id: ID });
    expect((await buscarDocumento(h.cliente, ID, ID)).arquivo_id).toBe(ID);
    expect(h.chamadas[0]?.caminho).toBe(`/core/clientes/${ID}/documentos/${ID}`);
  });
  it('P17: falha de rede vira "Sem internet" e 403 mostra a mensagem da API', () => {
    expect(falhaDaConsulta(new Error('rede'))).toEqual({ semInternet: true, mensagem: 'Sem internet' });
    expect(falhaDaConsulta({ status: 403, message: 'Seu perfil não vê o Histórico.' })).toEqual({ semInternet: false, mensagem: 'Seu perfil não vê o Histórico.' });
  });
});
