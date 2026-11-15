import { describe, expect, it } from 'vitest';
import type { MonitorResumo } from '@macuxi/integracao/contracts';
import { cardsPedidosErp } from './cards-erp';

const pedidos = (p: Partial<MonitorResumo['pedidos']> = {}): MonitorResumo['pedidos'] => ({ por_estado: {}, presos: 0, retidos: 0, ...p });

describe('cards "Pedidos no ERP" no início de Pedidos (T-0173; RN-INT-08, RN-VEN-42)', () => {
  it('RN-INT-08: mostra os 5 cards na ordem da spec, só com o número', () => {
    const c = cardsPedidosErp(pedidos({ por_estado: { pendente: 7, enviado: 3, rejeitado_erp: 2 }, presos: 1, retidos: 4 }));
    expect(c.map((x) => [x.id, x.rotulo, x.valor])).toEqual([
      ['na_fila', 'Na fila', 7],
      ['entregue', 'Entregue ao Conector', 3],
      ['rejeitado', 'Rejeitado pelo ERP', 2],
      ['presos', 'Presos sem retorno', 1],
      ['retidos', 'Retidos sem mapeamento', 4],
    ]);
  });

  it('RN-INT-08: estado sem pedido conta zero', () => {
    expect(cardsPedidosErp(pedidos()).map((x) => x.valor)).toEqual([0, 0, 0, 0, 0]);
  });

  it('RN-VEN-42: Rejeitado e Presos ficam em perigo e Retidos em aviso só quando maiores que zero', () => {
    const c = cardsPedidosErp(pedidos({ por_estado: { rejeitado_erp: 1 }, presos: 2, retidos: 3 }));
    expect(c.map((x) => x.tom)).toEqual([undefined, undefined, 'danger', 'danger', 'warning']);
    expect(cardsPedidosErp(pedidos()).map((x) => x.tom)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('RN-VEN-42: Integrado, Faturado e Cancelado não viram card (já estão na coluna Situação)', () => {
    const ids = cardsPedidosErp(pedidos({ por_estado: { integrado: 9, faturado_total: 5, cancelado: 1 } })).map((x) => x.id);
    expect(ids).toEqual(['na_fila', 'entregue', 'rejeitado', 'presos', 'retidos']);
  });
});
