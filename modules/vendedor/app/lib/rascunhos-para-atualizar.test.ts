import { describe, expect, it, vi } from 'vitest';
import { criarArmazenamentoEmMemoria, type ArmazenamentoSync } from '@macuxi/platform-sdk';

vi.mock('expo-router', () => ({ router: {} }));

import { pendenciasRascunhosParaAtualizar } from './rascunhos-para-atualizar';

const AGORA = new Date('2026-11-24T12:00:00Z');
const horasAntes = (h: number) => new Date(AGORA.getTime() - h * 3_600_000).toISOString();

describe('pendenciasRascunhosParaAtualizar (T-0195, ADR 0070 D8)', () => {
  const chamar = (arm: ArmazenamentoSync) => pendenciasRascunhosParaAtualizar({ armazenamento: arm, agora: AGORA });

  it('RN-VEN-39: sem rascunho no aparelho, devolve null', async () => {
    expect(await chamar(criarArmazenamentoEmMemoria())).toBeNull();
  });

  it('RN-VEN-38: rascunho vivo e edição de registro salvo contam; devolve o href da tela Rascunhos', async () => {
    const arm = criarArmazenamentoEmMemoria({
      'mod:vendedor:rascunhos': {
        'c-1': { customer_id: 'c-1', lines: { p1: 2 }, updated_at: horasAntes(1) },
        'edit:o-9': { customer_id: 'c-2', lines: {}, updated_at: horasAntes(23), edit_order_id: 'o-9' },
      },
    });
    expect(await chamar(arm)).toEqual({ total: 2, href: '/m/rascunhos' });
  });

  it('RN-VEN-38: lê só `mod:vendedor:rascunhos`; a chave `rascunhos` sem prefixo não conta', async () => {
    const arm = criarArmazenamentoEmMemoria({ rascunhos: { 'c-1': { customer_id: 'c-1', lines: { p1: 2 }, updated_at: horasAntes(1) } } });
    expect(await chamar(arm)).toBeNull();
  });
});
