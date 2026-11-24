import { describe, expect, it } from 'vitest';
import type { ArmazenamentoSync } from '@macuxi/platform-sdk';

import { contarRascunhosParaAtualizar } from './rascunhos-para-atualizar';

const AGORA = new Date('2026-11-24T12:00:00Z');
const horasAntes = (h: number) => new Date(AGORA.getTime() - h * 3_600_000).toISOString();

function armazenamento(inicial: Record<string, unknown> = {}): ArmazenamentoSync {
  const dados = new Map(Object.entries(inicial));
  return {
    ler: async <T>(k: string) => (dados.has(k) ? (dados.get(k) as T) : null),
    gravar: async (k, v) => {
      if (v == null) dados.delete(k);
      else dados.set(k, v);
    },
    remover: async (k) => {
      dados.delete(k);
    },
    chaves: async (p) => [...dados.keys()].filter((k) => k.startsWith(p)).sort(),
  };
}

describe('contarRascunhosParaAtualizar (T-0195, ADR 0070 D8)', () => {
  it('RN-VEN-39: sem rascunho no aparelho, conta 0', async () => {
    expect(await contarRascunhosParaAtualizar(armazenamento(), AGORA)).toBe(0);
  });

  it('RN-VEN-38: rascunho vivo com itens e edição de registro salvo contam', async () => {
    const arm = armazenamento({
      rascunhos: {
        'c-1': { customer_id: 'c-1', lines: { p1: 2 }, updated_at: horasAntes(1) },
        'edit:o-9': { customer_id: 'c-2', lines: {}, updated_at: horasAntes(23), edit_order_id: 'o-9' },
      },
    });
    expect(await contarRascunhosParaAtualizar(arm, AGORA)).toBe(2);
  });

  it('RN-VEN-39: rascunho vencido (24 h) e rascunho novo sem itens não contam', async () => {
    const arm = armazenamento({
      rascunhos: {
        'c-1': { customer_id: 'c-1', lines: { p1: 1 }, updated_at: horasAntes(24) },
        'c-2': { customer_id: 'c-2', lines: { p1: 0 }, updated_at: horasAntes(1) },
        'c-3': { customer_id: 'c-3', lines: { p1: 3 }, updated_at: horasAntes(2) },
      },
    });
    expect(await contarRascunhosParaAtualizar(arm, AGORA)).toBe(1);
  });
});
