import { describe, expect, it } from 'vitest';
import { canTransition, MSG_CANCELAR_APOS_ENVIO, MSG_ENVIADO_NAO_EDITA, checkDiscount, orderActions, verificarCancelamento, computeOrderTotals, type DiscountPolicy, validateOrder } from './order';

const policy: DiscountPolicy = { seller_pct: 5, supervisor_pct: 8, manager_pct: 12, above_manager: 'block', exceptions: { 'seller-x': 6 } };
const credit = { credit_limit_cents: 2_000_000, open_receivables_cents: 0, overdue_cents: 0, open_orders_cents: 0 };

describe('computeOrderTotals', () => {
  it('pedido do mockup: 10 pastilhas, 24 filtros, 4 amortecedores, 4%', () => {
    const t = computeOrderTotals(
      [
        { product_id: 'a', quantity: 10, unit_price_cents: 8990 },
        { product_id: 'b', quantity: 24, unit_price_cents: 2450 },
        { product_id: 'c', quantity: 4, unit_price_cents: 21800 },
      ],
      4,
    );
    expect(t.units).toBe(38);
    expect(t.subtotal_cents).toBe(89900 + 58800 + 87200);
    expect(t.subtotal_cents - t.discount_cents).toBe(t.total_cents);
    expect(t.discount_cents).toBe(3596 + 2352 + 3488);
  });

  it('ignora linha com quantidade zero', () => {
    const t = computeOrderTotals([{ product_id: 'a', quantity: 0, unit_price_cents: 100 }], 0);
    expect(t.lines).toHaveLength(0);
    expect(t.total_cents).toBe(0);
  });

  it('desconto negativo vira zero e acima de 100 vira 100', () => {
    expect(computeOrderTotals([{ product_id: 'a', quantity: 1, unit_price_cents: 1000 }], -5).total_cents).toBe(1000);
    expect(computeOrderTotals([{ product_id: 'a', quantity: 1, unit_price_cents: 1000 }], 150).total_cents).toBe(0);
  });
});

describe('checkDiscount (alçada)', () => {
  it.each([
    [0, 'within'],
    [5, 'within'],
    [5.01, 'needs_approval'],
    [7, 'needs_approval'],
    [12, 'needs_approval'],
    [12.5, 'blocked'],
  ])('desconto %s%% → %s', (pct, level) => {
    expect(checkDiscount(pct, policy, 'seller-1').level).toBe(level);
  });

  it('usa a exceção do vendedor', () => {
    expect(checkDiscount(6, policy, 'seller-x').level).toBe('within');
    expect(checkDiscount(6, policy, 'seller-1').level).toBe('needs_approval');
  });

  it('acima do gestor vai para a diretoria quando configurado', () => {
    const c = checkDiscount(15, { ...policy, above_manager: 'director' }, 'seller-1');
    expect(c).toMatchObject({ level: 'needs_approval', approver: 'director' });
  });

  it('aprovador conforme a faixa', () => {
    expect(checkDiscount(7, policy, 'seller-1')).toMatchObject({ approver: 'supervisor', exceeded_by_pct: 2 });
    expect(checkDiscount(10, policy, 'seller-1')).toMatchObject({ approver: 'manager' });
  });
});

describe('validateOrder', () => {
  const lines = [{ product_id: 'a', quantity: 10, unit_price_cents: 10000 }];

  it('dentro da alçada e do crédito: ok', () => {
    const v = validateOrder({ seller_id: 's', discount_pct: 4, lines, policy, credit });
    expect(v.outcome).toBe('ok');
    expect(v.issues).toHaveLength(0);
    expect(v.totals.total_cents).toBe(96000);
  });

  it('desconto acima da alçada: aprovação', () => {
    const v = validateOrder({ seller_id: 's', discount_pct: 7, lines, policy, credit });
    expect(v.outcome).toBe('pending_approval');
    expect(v.issues[0]?.code).toBe('discount_above_limit');
    expect(v.issues[0]?.message).toContain('7,0%');
  });

  it('desconto acima do máximo: rejeitado', () => {
    expect(validateOrder({ seller_id: 's', discount_pct: 20, lines, policy, credit }).outcome).toBe('rejected');
  });

  it('limite de crédito excedido: aprovação com valor excedido', () => {
    const v = validateOrder({
      seller_id: 's',
      discount_pct: 0,
      lines,
      policy,
      credit: { credit_limit_cents: 100000, open_receivables_cents: 10000, overdue_cents: 0, open_orders_cents: 2000 },
    });
    expect(v.available_credit_cents).toBe(88000);
    expect(v.outcome).toBe('pending_approval');
    expect(v.issues[0]?.message).toContain('R$ 120,00');
  });

  it('cliente com título vencido: aprovação', () => {
    const v = validateOrder({ seller_id: 's', discount_pct: 0, lines, policy, credit: { ...credit, overdue_cents: 500 } });
    expect(v.issues.map((i) => i.code)).toContain('overdue_receivables');
  });

  it('pedido vazio e quantidade inválida: rejeitado', () => {
    expect(validateOrder({ seller_id: 's', discount_pct: 0, lines: [], policy, credit }).outcome).toBe('rejected');
    const v = validateOrder({ seller_id: 's', discount_pct: 0, lines: [{ product_id: 'a', quantity: 1.5, unit_price_cents: 100 }], policy, credit });
    expect(v.issues.map((i) => i.code)).toContain('invalid_quantity');
  });

  it('produto sem preço: rejeitado', () => {
    const v = validateOrder({ seller_id: 's', discount_pct: 0, lines: [{ product_id: 'a', quantity: 1, unit_price_cents: null }], policy, credit });
    expect(v.outcome).toBe('rejected');
  });
});

describe('máquina de status', () => {
  it.each([
    ['queued', 'received', true],
    ['rejected', 'received', true],
    ['received', 'rejected', true],
    ['pending_approval', 'approved', true],
    ['pending_approval', 'integrated', false],
    ['integrated', 'cancelled', false],
    ['sent_to_erp', 'integrated', true],
  ] as const)('%s → %s = %s', (a, b, ok) => expect(canTransition(a, b)).toBe(ok));
});

describe('ações do pedido (duplicar, editar, excluir)', () => {
  it.each([
    ['queued', true],
    ['pending_approval', true],
    ['rejected', true],
    ['received', true],
    ['sent_to_erp', false],
    ['integrated', false],
    ['cancelled', false],
  ] as const)('%s → editar/excluir = %s', (st, ok) => {
    const a = orderActions(st);
    expect(a.can_edit).toBe(ok);
    expect(a.can_cancel).toBe(ok);
    expect(a.can_duplicate).toBe(true);
    expect(a.locked_reason === '').toBe(ok);
  });
  it('RN-VEN-31 / matriz §2: integrado mostra a mensagem de cancelar no ERP e continua duplicável', () => {
    expect(orderActions('integrated').locked_reason).toBe('Pedido já enviado ao ERP — cancele no ERP');
    expect(orderActions('integrated').can_duplicate).toBe(true);
  });
});

describe('pedido.cancelar depois do envio ao ERP (doc 03 §4, matriz §2)', () => {
  it.each(['sent_to_erp', 'integrated', 'enviado', 'integrado_erp', 'faturado_parcial', 'faturado_total'])(
    'RN-VEN-CANCELAR-APOS-ENVIO: %s é negado com 422 e a mensagem',
    (st) => {
      expect(verificarCancelamento(st)).toEqual({ ok: false, codigo: 'RN-VEN-CANCELAR-APOS-ENVIO', status: 422, mensagem: 'Pedido já enviado ao ERP — cancele no ERP' });
      expect(orderActions(st as never).can_cancel).toBe(false);
    },
  );
  it.each(['draft', 'queued', 'received', 'pending_approval', 'approved', 'rejected'])('RN-VEN-31: %s ainda pode ser cancelado pela regra', (st) => {
    expect(verificarCancelamento(st)).toEqual({ ok: true });
  });
});

import { ehStatusFinal as _ehFinal, ORDER_STATUSES as _TODOS } from './order';
describe('janela do pull de pedido', () => {
  it('RN-VEN-30: só faturado e cancelado são finais; os demais status seguem no aparelho além dos 90 dias', () => {
    expect(_TODOS.filter(_ehFinal)).toEqual(['invoiced', 'cancelled']);
    expect(_ehFinal('rejected')).toBe(false);
    expect(_ehFinal('qualquer')).toBe(false);
  });
});

describe('P-2 (T-0029): pedido aprovado não é editável nesta fatia', () => {
  it('P-2: aprovado não edita, mas duplica e cancela antes do envio ao ERP (doc 03 §4)', async () => {
    const { orderActions: acoes } = await import('./order');
    const a = acoes('approved');
    expect(a.can_edit).toBe(false);
    expect(a.can_duplicate).toBe(true);
    expect(a.can_cancel).toBe(true);
    expect(a.locked_reason).toMatch(/não pode ser editado/);
  });
  it.each([
    ['draft', true],
    ['queued', true],
    ['received', false],
    ['pending_approval', false],
    ['approved', false],
    ['rejected', false],
    ['cancelled', false],
  ] as const)('P-2: %s é editável pela tela = %s (só o que ainda está no aparelho)', async (st, ok) => {
    const { editavelNaFatia } = await import('./order');
    expect(editavelNaFatia(st)).toBe(ok);
  });
  it('RN-VEN-30: recebido pode virar aprovado (aprovação automática dentro da alçada)', () => {
    expect(canTransition('received', 'approved')).toBe(true);
  });
  it('RN-VEN-30: o pedido devolvido (rejected) reenviado com o conteúdo corrigido volta a received e abre o ciclo seguinte', () => {
    expect(canTransition('rejected', 'received')).toBe(true);
    expect(canTransition('cancelled', 'received')).toBe(false);
  });
  it('RN-VEN-31: aprovado cancela, mas depois do envio ao ERP não', () => {
    expect(canTransition('approved', 'cancelled')).toBe(true);
    expect(canTransition('sent_to_erp', 'cancelled')).toBe(false);
  });
});

describe('RN-VEN-31 (exceção T-0114): cancelar pedido já integrado ao ERP', () => {
  it.each(['sent_to_erp', 'integrated', 'enviado', 'integrado_erp'])('RN-VEN-31: %s cancela só se o conector aceita (cancelamento solicitado)', (st) => {
    expect(verificarCancelamento(st, { erpAceitaCancelamento: true })).toEqual({ ok: true, solicitado_ao_erp: true });
    expect(orderActions(st as never, { erpAceitaCancelamento: true }).can_cancel).toBe(true);
  });
  it('RN-VEN-31: sem aceite segue 422 RN-VEN-CANCELAR-APOS-ENVIO', () => {
    expect(verificarCancelamento('integrated', { erpAceitaCancelamento: false })).toMatchObject({ ok: false, status: 422, codigo: 'RN-VEN-CANCELAR-APOS-ENVIO' });
    expect(orderActions('integrated', { erpAceitaCancelamento: false }).can_cancel).toBe(false);
  });
  it('RN-VEN-31: antes do envio o aceite é irrelevante (cancela na hora)', () => {
    expect(verificarCancelamento('approved', { erpAceitaCancelamento: true })).toEqual({ ok: true });
  });
  it('RN-VEN-31: faturado não cancela mesmo com aceite', () => {
    expect(verificarCancelamento('invoiced', { erpAceitaCancelamento: true })).toMatchObject({ ok: false, status: 422 });
    expect(verificarCancelamento('faturado_parcial', { erpAceitaCancelamento: true })).toMatchObject({ ok: false });
  });
});

describe('RN-VEN-31 (T-0114/T-0138 D1): ação liberada e texto do bloqueio dizem a mesma coisa', () => {
  it.each(['sent_to_erp', 'integrated'] as const)('RN-VEN-31: %s com o aceite do conector cancela, não edita e o texto NÃO manda cancelar no ERP', (st) => {
    const a = orderActions(st, { erpAceitaCancelamento: true });
    expect(a).toMatchObject({ can_cancel: true, can_edit: false });
    expect(a.locked_reason).toBe(MSG_ENVIADO_NAO_EDITA);
    expect(a.locked_reason).not.toMatch(/cancele no ERP/i);
  });
  it('RN-VEN-31: sem o aceite e faturado com o aceite mantêm "cancele no ERP"', () => {
    expect(orderActions('integrated', { erpAceitaCancelamento: false })).toMatchObject({ can_cancel: false, locked_reason: MSG_CANCELAR_APOS_ENVIO });
    expect(orderActions('invoiced', { erpAceitaCancelamento: true })).toMatchObject({ can_cancel: false, locked_reason: MSG_CANCELAR_APOS_ENVIO });
  });
});
