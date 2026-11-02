import { describe, expect, it } from 'vitest';
import { ClienteAtualizadoSchema } from './eventos';

const base = { cliente_id: '11111111-1111-4111-8111-111111111111', campos: ['vendedor_id'], origem: 'erp' as const };

describe('core.cliente.atualizado@1: campos de carteira opcionais (RN-GES-01/02)', () => {
  it('RN-GES-01: payload antigo (sem os campos novos) continua válido', () => {
    expect(ClienteAtualizadoSchema.safeParse(base).success).toBe(true);
  });

  it('RN-GES-01: aceita vendedor_id, ativo, frequencia_visita e na_carteira_desde, inclusive nulos', () => {
    expect(ClienteAtualizadoSchema.safeParse({ ...base, vendedor_id: base.cliente_id, ativo: true, frequencia_visita: 'quinzenal', na_carteira_desde: '2026-10-01T12:00:00.000Z' }).success).toBe(true);
    expect(ClienteAtualizadoSchema.safeParse({ ...base, vendedor_id: null, frequencia_visita: null, na_carteira_desde: null }).success).toBe(true);
  });

  it('RN-GES-01: valores inválidos são recusados', () => {
    expect(ClienteAtualizadoSchema.safeParse({ ...base, frequencia_visita: 'diaria' }).success).toBe(false);
    expect(ClienteAtualizadoSchema.safeParse({ ...base, vendedor_id: 'x' }).success).toBe(false);
    expect(ClienteAtualizadoSchema.safeParse({ ...base, na_carteira_desde: 'ontem' }).success).toBe(false);
  });
});
