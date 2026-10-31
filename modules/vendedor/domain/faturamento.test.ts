import { describe, expect, it } from 'vitest';
import { PedidoFaturadoEvento } from '../contracts/eventos';
import { montarEventoFaturado } from './faturamento';
import { aceitaCancelamentoDoErp, canTransition, normalizarStatus, verificarCancelamento } from './order';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PED = '33333333-3333-4333-8333-333333333333';
const VEN = '44444444-4444-4444-8444-444444444444';
const pedido = { id: PED, seller_id: VEN, items: [{ product_id: A, quantity: 10 }, { product_id: B, quantity: 4 }] };
const em = '2026-10-31T12:00:00.000Z';

describe('vendedor.pedido.faturado@1 (RN-TRE-08, RN-INT-08)', () => {
  it('RN-TRE-08: faturado_total gera evento com todos os itens do pedido e parcial=false', () => {
    const ev = montarEventoFaturado({ status: 'faturado_total', ocorrido_em: em }, pedido)!;
    expect(PedidoFaturadoEvento.parse(ev)).toEqual({
      pedido_id: PED, vendedor_id: VEN, faturado_em: em, parcial: false,
      itens: [{ produto_id: A, quantidade: 10 }, { produto_id: B, quantidade: 4 }],
    });
  });
  it('RN-TRE-08: faturado_total desconta o que já foi faturado em retornos parciais', () => {
    const ev = montarEventoFaturado({ status: 'faturado_total', ocorrido_em: em }, pedido, { jaFaturados: [{ product_id: A, quantity: 10 }, { product_id: B, quantity: 1 }] })!;
    expect(ev.itens).toEqual([{ produto_id: B, quantidade: 3 }]);
  });
  it('RN-TRE-08: faturado_parcial usa os itens deste retorno e parcial=true', () => {
    const ev = montarEventoFaturado({ status: 'faturado_parcial', ocorrido_em: em }, pedido, { itensFaturados: [{ product_id: A, quantity: 6 }] })!;
    expect(ev.parcial).toBe(true);
    expect(ev.itens).toEqual([{ produto_id: A, quantidade: 6 }]);
  });
  it('RN-TRE-08: faturado_parcial sem itens faturados é erro', () => {
    expect(() => montarEventoFaturado({ status: 'faturado_parcial', ocorrido_em: em }, pedido)).toThrow();
  });
  it('RN-INT-08: status sem faturamento (integrado, cancelado) não gera evento', () => {
    expect(montarEventoFaturado({ status: 'integrado', ocorrido_em: em }, pedido)).toBeNull();
    expect(montarEventoFaturado({ status: 'cancelado', ocorrido_em: em }, pedido)).toBeNull();
  });
  it('RN-TRE-08: retorno repetido sem nada a faturar não publica evento vazio', () => {
    const ja = pedido.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity }));
    expect(montarEventoFaturado({ status: 'faturado_total', ocorrido_em: em }, pedido, { jaFaturados: ja })).toBeNull();
  });
});

describe('OrderStatus com os status do ERP (RN-INT-08)', () => {
  it('RN-INT-08: normalizarStatus mapeia faturado_* e cancelado do ERP para o OrderStatus', () => {
    expect(normalizarStatus('faturado_parcial')).toBe('invoiced_partial');
    expect(normalizarStatus('faturado_total')).toBe('invoiced');
    expect(normalizarStatus('cancelado')).toBe('cancelled');
  });
  it('RN-INT-08: cancelado vindo do ERP é aceito de enviado em diante; o Macuxi segue sem cancelar (422)', () => {
    expect(aceitaCancelamentoDoErp('invoiced')).toBe(true);
    expect(aceitaCancelamentoDoErp('approved')).toBe(false);
    expect(canTransition('integrated', 'invoiced_partial')).toBe(true);
    expect(verificarCancelamento('invoiced')).toMatchObject({ ok: false, status: 422 });
  });
});
