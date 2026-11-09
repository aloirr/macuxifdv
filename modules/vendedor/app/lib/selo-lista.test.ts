import { describe, expect, it } from 'vitest';

import type { PedidoDaLista } from './pedidos';
import { seloDaLinha } from './selo-lista';

const base = { tipo: 'orcamento', status: 'received', received_at: '2026-11-03T14:00:00.000Z', validade_data: '2026-11-10', validade_ate: '2026-11-11T04:00:00.000Z', convertido_pedido_id: null } as unknown as PedidoDaLista;
const p = (agora: string) => ({ agora: new Date(agora), fuso: 'America/Manaus', dias: 7, numeroDoPedido: (id: string) => (id === 'p9' ? '000015' : null) });

describe('selo do orçamento na lista (T-0071 V7, RN-VEN-18)', () => {
  it('RN-VEN-18: aberto mostra o dia do preço (D = validade − 7); passados os 7 dias o selo é o mesmo, sem "Vencido"', () => {
    expect(seloDaLinha(base, p('2026-11-05T12:00:00.000Z'))).toEqual({ texto: 'Orçamento · preço de 03/11', tom: 'roxo' });
    expect(seloDaLinha(base, p('2026-11-12T12:00:00.000Z'))).toEqual({ texto: 'Orçamento · preço de 03/11', tom: 'roxo' });
  });

  it('RN-VEN-18: convertido mostra o número do pedido; pedido comum não tem selo', () => {
    expect(seloDaLinha({ ...base, convertido_pedido_id: 'p9' }, p('2026-11-05T12:00:00.000Z'))?.texto).toBe('Virou pedido 000015');
    expect(seloDaLinha({ ...base, tipo: 'pedido' } as PedidoDaLista, p('2026-11-05T12:00:00.000Z'))).toBeNull();
  });
});
