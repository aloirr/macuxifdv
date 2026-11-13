import { describe, expect, it } from 'vitest';
import { politicaDosParametros, revalidarPedido } from './aprovacao';
import { decisaoDoDesconto, limiteDoUsuario, mensagemPedidoAcimaDoLimite, minimoDoItem, pedidoAcimaDoLimite, permilDoDescontoExibido } from './limite-desconto';
import { pctExibicao } from './preco-pedido';

const L = (item: boolean, pedido: boolean, permil: number | null = null) => ({ desconto_limita_item: item, desconto_limita_pedido: pedido, desconto_maximo_pedido_permil: permil });
const POLITICA = politicaDosParametros({});

const T = (total_tabela_cents: number, total_cents: number) => ({ total_tabela_cents, total_cents });

describe('RN-VEN-11a: trava do pedido pelo valor exibido nos Totais (inteiros)', () => {
  it('RN-VEN-11a: R$ 100,00 → R$ 91,96 (8,0%) não trava; R$ 91,95 (8,1%) trava num limite de 8,0%', () => {
    expect(permilDoDescontoExibido(T(10_000, 9_196))).toBe(80);
    expect(permilDoDescontoExibido(T(10_000, 9_195))).toBe(81);
    expect(pedidoAcimaDoLimite(permilDoDescontoExibido(T(10_000, 9_196)), L(true, true, 80))).toBe(false);
    expect(pedidoAcimaDoLimite(permilDoDescontoExibido(T(10_000, 9_195)), L(true, true, 80))).toBe(true);
  });
  it('RN-VEN-11a: a fórmula é a mesma da linha "Desconto (%)" (pctExibicao)', () => {
    for (const [tab, tot] of [[10_000, 9_196], [39_830, 37_979], [2_000, 1_999], [10_000, 10_500]] as const) {
      expect(permilDoDescontoExibido(T(tab, tot)) / 10).toBe(pctExibicao(tab - tot, tab));
    }
    expect(permilDoDescontoExibido(T(0, 0))).toBe(0);
  });
  it('RN-VEN-11a: acréscimo e desconto zero nunca travam, nem com limite 0,0%', () => {
    expect(pedidoAcimaDoLimite(-30, L(true, true, 0))).toBe(false);
    expect(pedidoAcimaDoLimite(0, L(true, true, 0))).toBe(false);
    expect(pedidoAcimaDoLimite(1, L(true, true, 0))).toBe(true);
    expect(pedidoAcimaDoLimite(permilDoDescontoExibido(T(10_000, 9_996)), L(true, true, 0))).toBe(false);
  });
  it('RN-VEN-11a: "por pedido" desligada mantém o número e não trava', () => {
    expect(pedidoAcimaDoLimite(50, limiteDoUsuario({ desconto_limita_pedido: false, desconto_maximo_pedido_permil: 80 }))).toBe(false);
  });
  it('RN-VEN-11a: a frase usa 1 casa e não leva o autor', () => {
    expect(mensagemPedidoAcimaDoLimite(80)).toBe('Pedido acima do desconto máximo (8,0%)');
    expect(mensagemPedidoAcimaDoLimite(75)).toBe('Pedido acima do desconto máximo (7,5%)');
  });
  it('RN-VEN-11a: limite ausente ou sem número vira o padrão', () => {
    expect(limiteDoUsuario(null)).toEqual(L(true, false, null));
    expect(limiteDoUsuario({ desconto_limita_pedido: true })).toEqual(L(true, false, null));
  });
  it('RN-VEN-11: "por item" desligada tira o mínimo', () => {
    expect(minimoDoItem(800, L(false, false))).toBeNull();
    expect(minimoDoItem(800, L(true, false))).toBe(800);
  });
});

describe('RN-VEN-11a com RN-VEN-10: decisão', () => {
  const d = (pct: number, limite = L(true, true, 80), extra = {}) => decisaoDoDesconto({ tipo: 'pedido', limite, skus_acima_do_maximo: [], desconto_efetivo_alcada_pct: pct, desconto_exibido_permil: Math.round(pct * 10), policy: POLITICA, vendedor_id: 'v', ...extra });
  it('RN-VEN-11a: até 5% aprova, até 8,0% vai ao supervisor, acima trava sem alçada', () => {
    expect(d(5)).toEqual({ travas: [], nivel: null, pode_enviar: true });
    expect(d(8).nivel).toBe('supervisor');
    expect(d(8.04, L(true, true, 80), { desconto_exibido_permil: 80 }).nivel).toBe('supervisor');
    expect(d(8.05, L(true, true, 80), { desconto_exibido_permil: 81 })).toEqual({ travas: [{ codigo: 'desconto_pedido_acima_limite', limite_permil: 80 }], nivel: null, pode_enviar: false });
  });
  it('RN-VEN-11a: duas travas, item e depois pedido; orçamento nunca trava', () => {
    expect(d(9, L(true, true, 80), { skus_acima_do_maximo: ['A'] }).travas.map((t) => t.codigo)).toEqual(['preco_abaixo_minimo', 'desconto_pedido_acima_limite']);
    expect(d(20, L(true, true, 80), { tipo: 'orcamento', skus_acima_do_maximo: ['A'] })).toEqual({ travas: [], nivel: null, pode_enviar: true });
  });
  it('RN-VEN-11: sem "por item" o item acima do máximo não trava e fica só a alçada', () => {
    expect(d(12, L(false, false), { skus_acima_do_maximo: ['A'] })).toEqual({ travas: [], nivel: 'gerente', pode_enviar: true });
  });
});

describe('RN-VEN-11a: revalidarPedido (API)', () => {
  const rev = (desconto_pct: number, extra: Record<string, unknown> = {}) =>
    revalidarPedido({ perfil: 'vendedor', vendedor_id: 'v', cliente_id: 'c', carteira: ['c'], desconto_pct: 0, itens: [{ product_id: 'p', sku: 'P1', quantity: 1, desconto_pct, ...(extra['min'] !== undefined ? { preco_minimo_base_cents: extra['min'] as number } : {}) }], precos: { p: 10_000 }, policy: POLITICA, ...extra } as Parameters<typeof revalidarPedido>[0]) as { ok: boolean; codigo?: string; http?: number; mensagem?: string; status?: string };
  it('RN-VEN-11a: acima do limite recusa 422 desconto_pedido_acima_limite com a frase', () => {
    expect(rev(9, { tipo: 'pedido', limite: L(true, true, 80) })).toMatchObject({ ok: false, codigo: 'desconto_pedido_acima_limite', http: 422, mensagem: 'Pedido acima do desconto máximo (8,0%)' });
  });
  it('RN-VEN-11a: em nome usa a mesma frase; no limite vai ao supervisor; sem limite vale o padrão', () => {
    expect(rev(9, { perfil: 'supervisor', em_nome: true, limite: L(true, true, 80) }).mensagem).toBe('Pedido acima do desconto máximo (8,0%)');
    expect(rev(8, { limite: L(true, true, 80) })).toMatchObject({ ok: true, status: 'pending_approval' });
    expect(rev(9)).toMatchObject({ ok: true, status: 'pending_approval' });
  });
  it('RN-VEN-11a: orçamento não trava, nem pelo mínimo do item (RN-VEN-11)', () => {
    expect(rev(20, { tipo: 'orcamento', limite: L(true, true, 80) }).ok).toBe(true);
    expect(rev(20, { tipo: 'orcamento', min: 9_000 }).ok).toBe(true);
    expect(rev(20, { tipo: 'pedido', min: 9_000 })).toMatchObject({ ok: false, codigo: 'preco_abaixo_minimo' });
    expect(rev(12, { tipo: 'pedido', min: 9_000, limite: L(false, false) }).ok).toBe(true);
  });
  it('RN-VEN-11a: 1 item de R$ 10,00 com 8,05% no item exibe 8,0% e não trava; alçada continua pelo nominal', () => {
    expect(rev(8.05, { precos: { p: 1_000 }, limite: L(true, true, 80) })).toMatchObject({ ok: true, status: 'pending_approval' });
  });
  it('RN-VEN-11a: limite de 0,0% com 0,04% nominal envia (exibe 0,0%)', () => {
    expect(rev(0.04, { precos: { p: 10_000 }, limite: L(true, true, 0) }).ok).toBe(true);
    expect(rev(0.05, { precos: { p: 10_000 }, limite: L(true, true, 0) })).toMatchObject({ ok: false, codigo: 'desconto_pedido_acima_limite' });
  });
});
