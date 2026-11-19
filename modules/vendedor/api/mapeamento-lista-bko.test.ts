import { describe, expect, it } from 'vitest';
import { Order } from '../contracts';
import { type LinhaPedido, paraOrder } from './mapeamento';

const linha = (over: Partial<LinhaPedido> = {}): LinhaPedido => ({
  id: '11111111-1111-4111-8111-111111111111', numero: '000021', vendedor_id: '22222222-2222-4222-8222-222222222222', vendedor_nome: 'Carla Lima',
  cliente_id: '33333333-3333-4333-8333-333333333333', cliente_nome: 'Mercado Bom Preço',
  cliente_resumo: { razao_social: 'Mercado Bom Preço Ltda', nome_fantasia: 'Mercado Bom Preço', documento: '', endereco: '', bairro: '', cidade: 'Boa Vista', uf: 'RR', codigo_erp: 'C5007' },
  tabela_preco_id: null, condicao_pagamento: null, condicao_pagamento_descricao: null, status: 'pending_approval', desconto_pct: 12, total_tabela_cents: 1000, total_cents: 880,
  nivel_aprovacao: 'gerente', motivos_aprovacao: ['desconto'], motivo_rejeicao: null, numero_erp: null, criado_no_aparelho_em: null, recebido_em: '2026-11-18T13:12:00.000Z',
  created_at: '2026-11-18T13:12:00.000Z', updated_at: '2026-11-18T13:12:00.000Z', itens: 1, unidades: 1, observacao: 'Entregar pela manhã', ...over,
});

describe('BKO > Pedidos: a lista já traz os dados da tabela (R-20261118-214740, aditivo)', () => {
  it('devolve código, UF, cidade do retrato do cliente, a observação e os motivos', () => {
    const o = paraOrder(linha(), {}, 'gerente');
    expect(o).toMatchObject({ customer_code: 'C5007', customer_uf: 'RR', customer_city: 'Boa Vista', order_note: 'Entregar pela manhã', approval_reasons: ['desconto'] });
    expect(Order.safeParse(o).success).toBe(true);
  });
  it('pedido antigo sem retrato nem observação continua válido (campos ausentes)', () => {
    const o = paraOrder(linha({ cliente_resumo: null, observacao: null, motivos_aprovacao: null }), {}, 'gerente');
    expect(o.customer_code).toBeUndefined();
    expect(o.order_note).toBeUndefined();
    expect(o.approval_reasons).toBeUndefined();
    expect(Order.safeParse(o).success).toBe(true);
  });
  it('motivos só aparecem enquanto o pedido espera aprovação (RF-VEN-09)', () => {
    expect(paraOrder(linha({ status: 'approved' }), {}, 'gerente').approval_reasons).toBeUndefined();
  });
});
