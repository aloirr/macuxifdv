import { describe, expect, it } from 'vitest';
import { podeLerPedidos } from './leitura-pedido';

describe('podeLerPedidos: decisão de leitura de pedidos pelo promotor', () => {
  it('RN-PRO-01: ve=true lê', () => {
    expect(podeLerPedidos(true)).toEqual({ ok: true });
  });

  it('RN-PRO-01: ve=false é 403 com orientação ao administrador', () => {
    const r = podeLerPedidos(false);
    expect(r).toMatchObject({ ok: false, http: 403, codigo: 'RN-PRO-01' });
    if (!r.ok) expect(r.mensagem).toMatch(/administrador/);
  });
});
