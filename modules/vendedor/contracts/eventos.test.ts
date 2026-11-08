import { describe, expect, it } from 'vitest';
import { conferirEventosPublicados } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import * as contracts from './index';
import { EVENTO_PEDIDO_APROVACAO_SOLICITADA, EVENTO_PEDIDO_CANCELADO } from './index';

describe('T-0024: eventos do Vendedor no contracts', () => {
  it('todo evento publicado tem definição exportada e nenhuma é de evento alheio', () => {
    expect(conferirEventosPublicados(manifest, contracts)).toEqual([]);
  });

  const base = {
    pedido_id: '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b',
    vendedor_id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e2f',
    cliente_id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e20',
    solicitada_em: '2026-11-05T12:00:00.000Z',
    nivel: 'supervisor',
    motivos: ['desconto'],
    desconto_efetivo_pct: 12.5,
    total_cents: 10000,
    credito: null,
    historico: null,
  };

  it('aprovacao_solicitada@1: credito e historico null (fatia) ou no formato do Gestor', () => {
    const s = EVENTO_PEDIDO_APROVACAO_SOLICITADA.schema;
    expect(s.safeParse(base).success).toBe(true);
    const cheio = {
      ...base,
      credito: { limite_cents: 100000, saldo_aberto_cents: 120000, disponivel_cents: -20000 },
      historico: { ultima_compra_em: '2026-10-01T10:00:00.000Z', pedidos_90d: 3, ticket_medio_cents: 5000 },
    };
    expect(s.safeParse(cheio).success).toBe(true);
    expect(s.safeParse({ ...cheio, historico: { ultima_compra_em: null, pedidos_90d: 0, ticket_medio_cents: null } }).success).toBe(true);
    expect(s.safeParse({ ...cheio, credito: { ...cheio.credito, limite_cents: -1 } }).success).toBe(false);
    expect(s.safeParse({ ...cheio, historico: { ...cheio.historico, pedidos_90d: 1.5 } }).success).toBe(false);
  });

  it('RN-VEN-31 (T-0114): cancelado@1 leva ids, número, external_id do ERP, motivo, autor e data UTC; sem dado pessoal', () => {
    const s = EVENTO_PEDIDO_CANCELADO.schema;
    const ok = {
      tenant_id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e21',
      pedido_id: base.pedido_id,
      numero: '000010',
      external_id: null,
      enviado_ao_erp: false,
      motivo: 'Cliente desistiu',
      cancelado_por: base.vendedor_id,
      cancelado_em: '2026-11-07T12:00:00.000Z',
    };
    expect(EVENTO_PEDIDO_CANCELADO.nome).toBe('vendedor.pedido.cancelado@1');
    expect(s.safeParse(ok).success).toBe(true);
    expect(s.safeParse({ ...ok, external_id: 'ERP-123', enviado_ao_erp: true, motivo: null }).success).toBe(true);
    expect(s.safeParse({ ...ok, motivo: 'x'.repeat(501) }).success).toBe(false);
    const { cancelado_por: _, ...sem } = ok;
    expect(s.safeParse(sem).success).toBe(false);
  });
});
