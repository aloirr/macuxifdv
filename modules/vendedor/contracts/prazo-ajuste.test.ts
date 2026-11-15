import { describe, expect, it } from 'vitest';

import { PrazoPagamentoSyncSchema, PedidoPush } from './index';

const prazo = { id: '11111111-1111-4111-8111-111111111111', external_id: null, updated_at: '2026-11-15T10:00:00.000Z', deleted_at: null, forma_pagamento_id: '33333333-3333-4333-8333-333333333333', codigo: 'AV', descricao: 'À vista', parcelas_dias: [0], prazo_medio_dias: 0, ativo: true, ordem: 1 };

describe('RN-VEN-43: percentual do prazo no pull', () => {
  it('RN-VEN-43: ausente vale 0 e o campo novo não quebra o schema', () => {
    const r = PrazoPagamentoSyncSchema.safeParse(prazo);
    expect(r.success && r.data.percentual_ajuste).toBe(0);
  });
  it('RN-VEN-43: aceita -99,99..+99,99 com 2 casas e recusa fora da faixa ou com 3 casas', () => {
    expect(PrazoPagamentoSyncSchema.safeParse({ ...prazo, percentual_ajuste: -1.71 }).success).toBe(true);
    expect(PrazoPagamentoSyncSchema.safeParse({ ...prazo, percentual_ajuste: 100 }).success).toBe(false);
    expect(PrazoPagamentoSyncSchema.safeParse({ ...prazo, percentual_ajuste: 1.234 }).success).toBe(false);
  });
  it('RN-VEN-43: o pull segue estrito (campo desconhecido é rejeitado; percentual_ajuste é explícito)', () => {
    expect(PrazoPagamentoSyncSchema.safeParse({ ...prazo, campo_futuro: 1 }).success).toBe(false);
    expect(PrazoPagamentoSyncSchema.safeParse({ ...prazo, percentual_ajuste: 2 }).success).toBe(true);
  });
  it('RN-VEN-45: o push aceita o percentual congelado do prazo, opcional', () => {
    expect('prazo_percentual_ajuste' in PedidoPush.shape).toBe(true);
  });
});
