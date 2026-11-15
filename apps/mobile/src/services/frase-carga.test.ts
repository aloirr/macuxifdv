/**
 * T-0174 (spec carga-aviso-frases §2): a lista das frases vem no sync e fica no aparelho; a falha (rede, 503, resposta fora do
 * contrato) não quebra o sync e mantém a lista anterior.
 */
import { FRASES_CARGA_INICIAIS, ROTA_SYNC_FRASES_CARGA } from '@macuxi/platform-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gravados = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/services/storage', () => ({
  writeJson: (k: string, v: unknown) => {
    gravados.set(k, v);
    return Promise.resolve();
  },
}));
vi.mock('@/services/api', () => ({}));

const { atualizarFrasesDaCarga } = await import('./frase-carga');
const { CHAVE_FRASES_CARGA } = await import('@/lib/frase-sorteio');

const api = (fn: () => Promise<{ status: number; data: unknown }>) => {
  const request = vi.fn((_metodo: string, _rota: string) => fn());
  return { request: request as never, chamadas: request };
};

beforeEach(() => {
  gravados.clear();
  gravados.set(CHAVE_FRASES_CARGA, [{ id: 'anterior', texto: 'Anterior' }]);
});

describe('atualizarFrasesDaCarga', () => {
  it('guarda as ativas que vieram do servidor, pela ordem', async () => {
    const [p1] = FRASES_CARGA_INICIAIS;
    const a = api(() => Promise.resolve({ status: 200, data: { frases: [{ id: p1?.id, texto: 'Nova', ordem: 1 }] } }));
    await atualizarFrasesDaCarga(a);
    expect(a.chamadas).toHaveBeenCalledWith('GET', ROTA_SYNC_FRASES_CARGA);
    expect(gravados.get(CHAVE_FRASES_CARGA)).toEqual([{ id: p1?.id, texto: 'Nova' }]);
  });

  it('503 ou sem rede: não lança e mantém a lista anterior', async () => {
    await expect(atualizarFrasesDaCarga(api(() => Promise.reject(new Error('HTTP 503'))))).resolves.toBeUndefined();
    expect(gravados.get(CHAVE_FRASES_CARGA)).toEqual([{ id: 'anterior', texto: 'Anterior' }]);
  });

  it('resposta fora do contrato: mantém a lista anterior', async () => {
    await atualizarFrasesDaCarga(api(() => Promise.resolve({ status: 200, data: { outra: 1 } })));
    expect(gravados.get(CHAVE_FRASES_CARGA)).toEqual([{ id: 'anterior', texto: 'Anterior' }]);
  });
});
