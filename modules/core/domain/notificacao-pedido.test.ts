import { describe, expect, it } from 'vitest';
import { entidadesDoPush, notificacaoDePedido } from './notificacao-pedido';

const ID = '0e500000-0000-4000-8000-000000000001';

describe('RN-CORE-23 item 3: notificação de pedido', () => {
  it('RN-CORE-23: aprovado vira "Pedido aprovado" para o vendedor, com link do pedido e entidades', () => {
    const n = notificacaoDePedido({ tipo: 'status', para: 'aprovado', pedidoId: ID, motivo: null });
    expect(n).toMatchObject({ destino: 'vendedor', titulo: 'Pedido aprovado', link: `/m/pedido?id=${ID}`, prioridade: 'alta' });
  });
  it('RN-CORE-23: rejeitado leva o motivo no texto', () => {
    const n = notificacaoDePedido({ tipo: 'status', para: 'rejeitado', pedidoId: ID, motivo: 'Desconto acima da alçada' });
    expect(n?.titulo).toBe('Pedido rejeitado');
    expect(n?.corpo).toContain('Desconto acima da alçada');
  });
  it('RN-CORE-23: para aprovar vai ao aprovador', () => {
    expect(notificacaoDePedido({ tipo: 'aprovacao_solicitada', pedidoId: ID })?.destino).toBe('aprovador');
  });
  it('RN-CORE-23: integrado e faturado notificam o vendedor; outros status não notificam', () => {
    expect(notificacaoDePedido({ tipo: 'status', para: 'integrado_erp', pedidoId: ID, motivo: null })?.titulo).toBe('Pedido integrado ao ERP');
    expect(notificacaoDePedido({ tipo: 'status', para: 'faturado_total', pedidoId: ID, motivo: null })?.titulo).toBe('Pedido faturado');
    expect(notificacaoDePedido({ tipo: 'status', para: 'na_fila', pedidoId: ID, motivo: null })).toBeNull();
  });
  it('RN-CORE-23: entidades do push por tipo de notificação', () => {
    expect(entidadesDoPush('pedido')).toEqual(['pedido', 'notificacao']);
    expect(entidadesDoPush('recado')).toEqual(['notificacao']);
  });
});
