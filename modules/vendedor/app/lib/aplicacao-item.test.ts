import { describe, expect, it } from 'vitest';

import type { Product } from '@macuxi/catalogo/contracts';
import { montarPedidoAprovado, revalidarPedido } from '../../domain/aprovacao';
import type { DiscountPolicy } from '../../domain/order';
import { buildOrderPdfHtml, pdfDoPedido, type OrderPdfContext } from '../../domain/pdf-pedido';
import { rascunhoDaCopia } from './documento';
import { alternarAplicacao, calcularPedido, linhasParaPush, type EntradaCalculo } from './novo-pedido';
import { politicaApi } from './pull';

const longa = Array.from({ length: 80 }, (_, i) => `modelo${i}`).join(' ');
const P = (id: string, aplicacao: string): Product =>
  ({ id, erp_code: id.toUpperCase(), description: `Produto ${id}`, unit: 'UN', price_cents: 1000, stock_total: 1_000_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: aplicacao, is_campaign: false }) as Product;

const entrada = (o: Partial<EntradaCalculo> = {}): EntradaCalculo => ({
  lines: { a: 1, b: 1, c: 1 },
  ajustes: {},
  acrescimo_pct: 0,
  desconto_pct: 0,
  catalogo: [P('a', longa), P('b', 'Fiat Uno 2010–2014'), P('c', '')],
  unidades: [],
  politica: politicaApi({}),
  vendedor_id: 'v1',
  aplicacao: { padrao: true, max: 300 },
  ...o,
});

describe('RN-VEN-19: aplicação por item no Novo pedido', () => {
  it('RN-VEN-19: a caixa vem marcada pelo padrão do tenant e o texto longo é cortado em 300 na palavra inteira com "…"', () => {
    const c = calcularPedido(entrada());
    const a = c.linhas.find((l) => l.product_id === 'a')!;
    expect(a.aplicacao_marcada).toBe(true);
    expect(a.aplicacao!.length).toBeLessThanOrEqual(300);
    expect(a.aplicacao!.endsWith('…')).toBe(true);
    expect(c.linhas.find((l) => l.product_id === 'b')!.aplicacao).toBe('Fiat Uno 2010–2014');
  });

  it('RN-VEN-19: item desmarcado grava nulo e não vai no payload', () => {
    const c = calcularPedido(entrada({ ajustes: { b: { aplicacao_marcada: false } } }));
    expect(c.linhas.find((l) => l.product_id === 'b')!).toMatchObject({ aplicacao: null, aplicacao_marcada: false });
    const push = linhasParaPush(c.linhas);
    expect(push.find((i) => i.product_id === 'b')).not.toHaveProperty('aplicacao');
    expect(push.find((i) => i.product_id === 'a')!.aplicacao).toBe(c.linhas[0]!.aplicacao);
  });

  it('RN-VEN-19: padrão do tenant desligado deixa a caixa desmarcada até o vendedor marcar, item a item', () => {
    const c = calcularPedido(entrada({ aplicacao: { padrao: false, max: 300 }, ajustes: { b: { aplicacao_marcada: true } } }));
    expect(c.linhas.find((l) => l.product_id === 'a')!.aplicacao).toBeNull();
    expect(c.linhas.find((l) => l.product_id === 'b')!.aplicacao).toBe('Fiat Uno 2010–2014');
  });

  it('RN-VEN-19: produto sem aplicação grava nulo e a caixa conta como desmarcada', () => {
    const l = calcularPedido(entrada()).linhas.find((x) => x.product_id === 'c')!;
    expect(l).toMatchObject({ aplicacao: null, aplicacao_marcada: false });
  });

  it('RN-VEN-19: o parâmetro (até 1.000) muda o corte', () => {
    const l = calcularPedido(entrada({ aplicacao: { padrao: true, max: 1000 } })).linhas.find((x) => x.product_id === 'a')!;
    expect(l.aplicacao!.length).toBeGreaterThan(300);
    expect(l.aplicacao!.length).toBeLessThanOrEqual(1000);
  });

  it('RN-VEN-19: na edição o retrato gravado fica; desmarcar e marcar de novo pega o texto atual do cadastro', () => {
    const retrato = 'Texto antigo do retrato';
    const c = calcularPedido(entrada({ lines: { b: 1 }, ajustes: { b: { aplicacao_marcada: true, aplicacao_retrato: retrato } } }));
    expect(c.linhas[0]!.aplicacao).toBe(retrato);
    const desmarcado = alternarAplicacao({ aplicacao_marcada: true, aplicacao_retrato: retrato }, true);
    expect(desmarcado).toEqual({ aplicacao_marcada: false });
    const remarcado = alternarAplicacao(desmarcado, false);
    expect(calcularPedido(entrada({ lines: { b: 1 }, ajustes: { b: remarcado } })).linhas[0]!.aplicacao).toBe('Fiat Uno 2010–2014');
  });

  it('RN-VEN-19: Editar mantém o retrato (e o desmarcado); Duplicar tira retrato novo', () => {
    const copia = { id: 'o1', cliente_id: 'c1', desconto_pct: 0, condicao_pagamento_id: null, observacao: null, visita_id: null, itens: [{ product_id: 'a', quantity: 1, aplicacao: 'Retrato antigo' }, { product_id: 'b', quantity: 1 }] };
    const edit = rascunhoDaCopia(copia, [P('a', 'novo'), P('b', 'novo b')], { manterAplicacao: true }).rascunho;
    expect(edit.ajustes).toMatchObject({ a: { aplicacao_marcada: true, aplicacao_retrato: 'Retrato antigo' }, b: { aplicacao_marcada: false } });
    const dup = rascunhoDaCopia(copia, [P('a', 'novo'), P('b', 'novo b')]).rascunho;
    expect(dup.ajustes).toEqual({});
  });
});

describe('RN-VEN-19: a API corta de novo e nunca troca pelo cadastro', () => {
  const policy: DiscountPolicy = { seller_pct: 5, supervisor_pct: 10, manager_pct: 15, above_manager: 'director', exceptions: {} };
  const base = { perfil: 'vendedor', vendedor_id: 'v1', cliente_id: 'c1', carteira: ['c1'], desconto_pct: 0, precos: { p1: 1000 }, policy };

  it('RN-VEN-19: texto recebido grava cortado no parâmetro atual do tenant; ausente grava nulo', () => {
    const r = revalidarPedido({ ...base, aplicacao_max: 100, itens: [{ product_id: 'p1', sku: 'A', quantity: 1, aplicacao: longa }, { product_id: 'p1', sku: 'A', quantity: 2, unidade: 'UN', fator: 1 }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0]!.aplicacao!.length).toBeLessThanOrEqual(100);
    expect(r.itens[0]!.aplicacao!.endsWith('…')).toBe(true);
    expect(r.itens[1]!.aplicacao).toBeNull();
  });

  it('RN-VEN-19: nunca recusa por tamanho (pedido offline feito com outro parâmetro)', () => {
    const r = revalidarPedido({ ...base, itens: [{ product_id: 'p1', sku: 'A', quantity: 1, aplicacao: 'x'.repeat(900) }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.itens[0]!.aplicacao!.length).toBe(300);
  });

  it('RN-VEN-19: o evento aprovado@1 leva a aplicação do item quando existe', () => {
    const p = montarPedidoAprovado({
      pedido_uuid: 'p',
      cliente_external_id: 'C',
      vendedor_external_id: 'V',
      condicao_pagamento_codigo: '1',
      criado_em: 'x',
      aprovado_em: 'y',
      observacao: null,
      itens: [
        { produto_external_id: 'A', quantidade: 1, preco_tabela_cents: 1000, total_cents: 1000, fator: 1, unidade: 'UN', aplicacao: 'Uno' },
        { produto_external_id: 'B', quantidade: 1, preco_tabela_cents: 1000, total_cents: 1000, fator: 1, unidade: 'UN', aplicacao: null },
      ],
    });
    expect(p.itens[0]).toMatchObject({ aplicacao: 'Uno' });
    expect(p.itens[1]).not.toHaveProperty('aplicacao');
  });
});

describe('RN-VEN-19: PDFs do cliente e do BKO', () => {
  const ctx: OrderPdfContext = { tenant_name: 'Distribuidora Exemplo Norte', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: '2026-11-05T18:00:00.000Z' };
  const detalhe = {
    status: 'approved',
    number: '12',
    created_offline_at: null,
    received_at: '2026-11-05T12:00:00Z',
    customer_name: 'Mercado',
    seller_name: 'Ana',
    payment_terms: '28 dias',
    discount_pct: 0,
    subtotal_cents: 2000,
    discount_cents: 0,
    total_cents: 2000,
    pending_reason: '',
    rejection_reason: '',
    erp_order_code: '',
    price_table_id: null,
    history: [],
    items: [
      { erp_code: 'A1', description: 'Pastilha', quantity: 1, unit_price_cents: 1000, total_cents: 1000, application: 'Fiat Uno 2010–2014 & Palio' },
      { erp_code: 'B1', description: 'Filtro', quantity: 1, unit_price_cents: 1000, total_cents: 1000, application: null },
    ],
  } as unknown as Parameters<typeof pdfDoPedido>[0];

  it.each(['customer', 'bko'] as const)('RN-VEN-19: "Aplicação: …" abaixo da descrição do item no PDF %s, só nos itens com retrato', (visao) => {
    const html = buildOrderPdfHtml(pdfDoPedido(detalhe), visao, ctx);
    expect(html).toContain('Aplicação: Fiat Uno 2010–2014 &amp; Palio');
    expect(html.match(/Aplicação:/g)).toHaveLength(1);
  });
});
