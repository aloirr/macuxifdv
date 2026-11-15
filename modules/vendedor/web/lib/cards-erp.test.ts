import { describe, expect, it } from 'vitest';
import type { ResumoPedidosErp } from '@macuxi/integracao/contracts';
import { cardsPedidosErp } from './cards-erp';

const pedidos = (p: Partial<ResumoPedidosErp> = {}): ResumoPedidosErp => ({ na_fila: 0, entregue_ao_conector: 0, rejeitado_pelo_erp: 0, presos_sem_retorno: 0, retidos_sem_mapeamento: 0, ...p });

describe('cards "Pedidos no ERP" no início de Pedidos (T-0173; RN-INT-08, RN-VEN-42)', () => {
  it('RN-INT-08: mostra os 5 cards na ordem da spec, só com o número', () => {
    const c = cardsPedidosErp(pedidos({ na_fila: 7, entregue_ao_conector: 3, rejeitado_pelo_erp: 2, presos_sem_retorno: 1, retidos_sem_mapeamento: 4 }));
    expect(c.map((x) => [x.id, x.rotulo, x.valor])).toEqual([
      ['na_fila', 'Na fila', 7],
      ['entregue', 'Entregue ao Conector', 3],
      ['rejeitado', 'Rejeitado pelo ERP', 2],
      ['presos', 'Presos sem retorno', 1],
      ['retidos', 'Retidos sem mapeamento', 4],
    ]);
  });

  it('RN-INT-08: o texto do número usa separador de milhar pt-BR (1234 vira "1.234", 0 vira "0")', () => {
    const c = cardsPedidosErp(pedidos({ entregue_ao_conector: 1234 }));
    expect(c.find((x) => x.id === 'entregue')?.texto).toBe('1.234');
    expect(c.find((x) => x.id === 'na_fila')?.texto).toBe('0');
  });

  it('RN-INT-08: estado sem pedido conta zero', () => {
    expect(cardsPedidosErp(pedidos()).map((x) => x.valor)).toEqual([0, 0, 0, 0, 0]);
  });

  it('RN-VEN-42: Rejeitado e Presos ficam em perigo e Retidos em aviso só quando maiores que zero', () => {
    const c = cardsPedidosErp(pedidos({ rejeitado_pelo_erp: 1, presos_sem_retorno: 2, retidos_sem_mapeamento: 3 }));
    expect(c.map((x) => x.tom)).toEqual([undefined, undefined, 'danger', 'danger', 'warning']);
    expect(cardsPedidosErp(pedidos()).map((x) => x.tom)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('RN-VEN-42: Integrado, Faturado e Cancelado não viram card (só os 5 do contrato; a coluna Situação já mostra)', () => {
    const ids = cardsPedidosErp(pedidos()).map((x) => x.id);
    expect(ids).toEqual(['na_fila', 'entregue', 'rejeitado', 'presos', 'retidos']);
  });
});
