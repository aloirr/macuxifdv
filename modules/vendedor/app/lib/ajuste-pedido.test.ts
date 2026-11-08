import { describe, expect, it } from 'vitest';
import { ajusteDoPedidoDoRascunho, rascunhoComTextoDoPedido, rascunhoComTipoDoPedido, textoDoAjuste, valorDoTexto } from './ajuste-pedido';
import { rascunhoVazio } from './pedidos';

const r0 = rascunhoVazio('c1');

describe('RN-VEN-02 (T-0137): desconto do pedido numa linha, o mesmo do item', () => {
  it('RN-VEN-02: sem valor o tipo é Desc % ou Desc R$ pelo modo', () => {
    expect(ajusteDoPedidoDoRascunho(r0)).toEqual({ tipo: 'desc_pct', valor: 0 });
    expect(ajusteDoPedidoDoRascunho({ ...r0, ajuste_em: 'valor' }).tipo).toBe('desc_reais');
  });
  it('RN-VEN-02: digitar 1,5 em Desc % grava 1,5% e lê de volta', () => {
    const r = rascunhoComTextoDoPedido(r0, 'desc_pct', '1,5');
    expect(r.discount_pct).toBe(1.5);
    expect(ajusteDoPedidoDoRascunho(r)).toEqual({ tipo: 'desc_pct', valor: 1.5 });
  });
  it('RN-VEN-02: digitar 2,50 em Acrésc R$ grava 250 centavos de acréscimo e zera o desconto', () => {
    const r = rascunhoComTextoDoPedido({ ...r0, discount_pct: 3 }, 'acresc_reais', '2,50');
    expect(r).toMatchObject({ ajuste_em: 'valor', acrescimo_valor_cents: 250, desconto_valor_cents: 0, discount_pct: 0 });
  });
  it('RN-VEN-02: o R$ não passa do teto (total dos itens) e o % não passa de 100', () => {
    expect(rascunhoComTextoDoPedido(r0, 'desc_reais', '999,00', 1990).desconto_valor_cents).toBe(1990);
    expect(rascunhoComTextoDoPedido(r0, 'desc_pct', '250').discount_pct).toBe(100);
  });
  it('RN-VEN-02: campo vazio tira o ajuste', () => {
    expect(rascunhoComTextoDoPedido({ ...r0, discount_pct: 2 }, 'desc_pct', '').discount_pct).toBe(0);
  });
  it('RN-VEN-02: trocar o tipo com valor converte pelo equivalente (1% = R$ 0,20)', () => {
    const r1 = rascunhoComTextoDoPedido(r0, 'desc_pct', '1');
    const r2 = rascunhoComTipoDoPedido(r1, 'desc_reais', { cents: 20, pct: 1 });
    expect(r2).toMatchObject({ ajuste_em: 'valor', desconto_valor_cents: 20, discount_pct: 0 });
  });
  it('RN-VEN-02: trocar só o sentido mantém o número; sem valor nada muda', () => {
    const r1 = rascunhoComTextoDoPedido(r0, 'desc_pct', '4');
    expect(rascunhoComTipoDoPedido(r1, 'acresc_pct', { cents: 80, pct: 4 })).toMatchObject({ acrescimo_pct: 4, discount_pct: 0 });
    expect(rascunhoComTipoDoPedido(r0, 'acresc_reais', null)).toBe(r0);
  });
  it('RN-VEN-02: textos do campo', () => {
    expect(textoDoAjuste('desc_pct', 1.5)).toBe('1,5');
    expect(textoDoAjuste('desc_reais', 250)).toBe('2,50');
    expect(textoDoAjuste('desc_pct', 0)).toBe('');
    expect(valorDoTexto('desc_reais', '0,20')).toBe(20);
  });
});
