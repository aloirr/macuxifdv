/**
 * T-0053: pré-venda no aparelho (RF-VEN-03, RN-VEN-32). Instantes fixos só como dado (o "agora" é argumento).
 */
import { describe, expect, it } from 'vitest';
import { PedidoPush } from '../../contracts';
import { acoesNaTela, pedidoDaConversao, preVendaAtiva, rotuloDoDocumento, situacaoNaTela } from './pre-venda';

const CRIADO = new Date('2026-11-02T12:00:00.000Z');
const depois = (dias: number) => new Date(CRIADO.getTime() + dias * 86_400_000);
const orc = { status: 'received' as const, tipo: 'orcamento' as const, validade_ate: depois(7).toISOString(), convertido_pedido_id: null };

describe('T-0053: pré-venda no app', () => {
  it('RF-VEN-03: o orçamento vem LIGADO por padrão (T-0071 §1.4 a) e o tenant pode desligar com orcamento.ativo = false', () => {
    expect(preVendaAtiva({})).toBe(true);
    expect(preVendaAtiva({ 'orcamento.ativo': false })).toBe(false);
    expect(preVendaAtiva({ 'orcamento.ativo': 'false' })).toBe(false);
    expect(preVendaAtiva({ 'orcamento.ativo': 0 })).toBe(false);
    expect(preVendaAtiva({ 'orcamento.ativo': true })).toBe(true);
    expect(preVendaAtiva({ 'orcamento.ativo': 'true' })).toBe(true);
  });

  it('RN-VEN-32: offline, a situação sai da validade; pedido continua com o rótulo do status', () => {
    expect(situacaoNaTela(orc, depois(1))).toBe('aberto');
    expect(rotuloDoDocumento(orc, depois(1))).toBe('Orçamento');
    expect(rotuloDoDocumento(orc, depois(8))).toBe('Vencido');
    expect(rotuloDoDocumento({ ...orc, convertido_pedido_id: 'x' }, depois(1))).toBe('Virou pedido');
    expect(situacaoNaTela({ status: 'approved' }, depois(1))).toBeNull();
    expect(rotuloDoDocumento({ status: 'integrated', tipo: 'pedido' }, depois(1))).toBe('Integrado');
  });

  it('RF-VEN-03: converter e cancelar só para o vendedor dono; gestão só vê', () => {
    expect(acoesNaTela(orc, depois(1), true)).toMatchObject({ pode_converter: true, pode_cancelar: true });
    expect(acoesNaTela(orc, depois(1), false)).toMatchObject({ pode_converter: false, pode_cancelar: false, pode_duplicar: true });
    expect(acoesNaTela({ status: 'approved' }, depois(1), true)).toBeNull();
  });

  it('RF-VEN-03 / RN-VEN-33: a conversão gera um PedidoPush válido com novo UUID e a origem (sem preço copiado)', () => {
    const p = pedidoDaConversao(
      { id: '00000000-0000-4000-8000-000000000001', customer_id: '00000000-0000-4000-8000-0000000000c1', discount_pct: 2, payment_terms: '28 dias', items: [{ id: 'i', product_id: '00000000-0000-4000-8000-0000000000a1', erp_code: 'A', description: 'A', quantity: 3, unit_price_cents: 999, discount_pct: 2, total_cents: 2937 }] },
      { condicaoId: null, observacao: null, novoId: '00000000-0000-4000-8000-0000000000ff', agora: CRIADO.toISOString() },
    );
    expect(PedidoPush.parse(p)).toMatchObject({ id: '00000000-0000-4000-8000-0000000000ff', tipo: 'pedido', orcamento_origem_id: '00000000-0000-4000-8000-000000000001', items: [{ quantity: 3 }] });
    expect(JSON.stringify(p)).not.toMatch(/999|2937/);
  });
});
