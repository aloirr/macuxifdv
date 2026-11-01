import { describe, expect, it } from 'vitest';

import {
  CARTEIRA_FORA,
  dataDoPreco,
  decidirAprovacao,
  MOTIVO_REJEICAO_MIN,
  montarPedidoAprovado,
  nivelDaAlcada,
  politicaDosParametros,
  quemDecide,
  resultadoDoRecebimento,
  revalidarPedido,
  statusDoContrato,
  textoPendencia,
  type RevalidarEntrada,
} from './aprovacao';
import { canTransition, orderActions, validateOrder, type DiscountPolicy } from './order';

const policy: DiscountPolicy = { seller_pct: 5, supervisor_pct: 10, manager_pct: 15, above_manager: 'director', exceptions: {} };
const credit = { credit_limit_cents: 0, open_receivables_cents: 0, overdue_cents: 0, open_orders_cents: 0 };
const AGORA = new Date('2026-11-01T15:00:00.000Z');

function entrada(over: Partial<RevalidarEntrada> = {}): RevalidarEntrada {
  return {
    perfil: 'vendedor',
    vendedor_id: 'v1',
    cliente_id: 'c1',
    carteira: ['c1', 'c2'],
    desconto_pct: 3,
    itens: [
      { product_id: 'p1', sku: 'PST-1', quantity: 10 },
      { product_id: 'p2', sku: 'FLT-2', quantity: 2 },
    ],
    precos: { p1: 10_000, p2: 5_000 },
    policy,
    ...over,
  };
}

describe('statusDoContrato (ADR 0011 / RN-VEN-30)', () => {
  it('RN-VEN-30: mapeia ORDER_STATUSES para o vocabulário do doc 03', () => {
    expect(statusDoContrato('received')).toBe('recebido');
    expect(statusDoContrato('pending_approval')).toBe('em_aprovacao');
    expect(statusDoContrato('approved')).toBe('aprovado');
    expect(statusDoContrato('rejected')).toBe('rejeitado');
    expect(statusDoContrato('cancelled')).toBe('cancelado');
    expect(statusDoContrato('integrated')).toBe('integrado_erp');
    expect(statusDoContrato('invoiced_partial')).toBe('faturado_parcial');
    expect(statusDoContrato('invoiced')).toBe('faturado_total');
    expect(statusDoContrato('queued')).toBe('na_fila');
    expect(statusDoContrato('draft')).toBe('rascunho');
  });
});

describe('transição received → approved (ADR 0011)', () => {
  it('RN-VEN-30: recebido pode virar aprovado (dentro da alçada) e aprovado pode ser cancelado', () => {
    expect(canTransition('received', 'approved')).toBe(true);
    expect(orderActions('approved').can_cancel).toBe(true);
  });
});

describe('nivelDaAlcada e política dos parâmetros (RN-VEN-10)', () => {
  it('RN-VEN-10: supervisor→supervisor, manager→gerente, director→analista', () => {
    expect(nivelDaAlcada('supervisor')).toBe('supervisor');
    expect(nivelDaAlcada('manager')).toBe('gerente');
    expect(nivelDaAlcada('director')).toBe('analista');
  });
  it('RN-VEN-10: lê alcada.* do tenant; acima_gerente=bloquear bloqueia', () => {
    const p = politicaDosParametros({ 'alcada.vendedor_pct': 5, 'alcada.supervisor_pct': '10', 'alcada.gerente_pct': 15, 'alcada.acima_gerente': 'analista' });
    expect(p).toMatchObject({ seller_pct: 5, supervisor_pct: 10, manager_pct: 15, above_manager: 'director' });
    expect(politicaDosParametros({ 'alcada.acima_gerente': 'bloquear' }).above_manager).toBe('block');
  });
  it('RN-VEN-10: parâmetro ausente cai nos padrões do doc 03 (5/10/15, analista)', () => {
    expect(politicaDosParametros({})).toMatchObject({ seller_pct: 5, supervisor_pct: 10, manager_pct: 15, above_manager: 'director' });
  });
});

describe('dataDoPreco (RN-VEN-01, P-4)', () => {
  it('RN-VEN-01: usa a data do aparelho', () => {
    expect(dataDoPreco('2026-10-31T10:00:00.000Z', AGORA)).toBe('2026-10-31T10:00:00.000Z');
  });
  it('RN-VEN-01: no máximo 7 dias para trás', () => {
    expect(dataDoPreco('2026-09-01T10:00:00.000Z', AGORA)).toBe('2026-10-25T15:00:00.000Z');
  });
  it('RN-VEN-01: nunca no futuro; sem data ou data inválida usa agora', () => {
    expect(dataDoPreco('2027-01-01T00:00:00.000Z', AGORA)).toBe(AGORA.toISOString());
    expect(dataDoPreco(null, AGORA)).toBe(AGORA.toISOString());
    expect(dataDoPreco('lixo', AGORA)).toBe(AGORA.toISOString());
  });
});

describe('textoPendencia', () => {
  it('RN-VEN-10: texto do motivo com o nível', () => {
    expect(textoPendencia('supervisor', 8, 5)).toBe('Desconto de 8,0% acima da alçada de 5,0%: aguardando supervisor');
    expect(textoPendencia('analista', 20, 5)).toBe('Desconto de 20,0% acima da alçada de 5,0%: aguardando analista');
  });
});

describe('revalidarPedido (servidor)', () => {
  it('RN-PRO-01: promotor nunca cria pedido (403)', () => {
    const r = revalidarPedido(entrada({ perfil: 'promotor' }));
    expect(r).toMatchObject({ ok: false, codigo: 'RN-PRO-01', http: 403 });
  });
  it('RN-VEN-35: perfil sem pedido.criar é recusado', () => {
    expect(revalidarPedido(entrada({ perfil: 'analista' }))).toMatchObject({ ok: false, codigo: 'PERFIL_SEM_ACESSO' });
  });
  it('RN-CORE-04: cliente fora da carteira é recusado', () => {
    expect(revalidarPedido(entrada({ cliente_id: 'c9' }))).toMatchObject({ ok: false, codigo: CARTEIRA_FORA });
  });
  it('RN-CAT-06: item sem preço para o cliente bloqueia, com o SKU na mensagem; nunca cai na tabela padrão', () => {
    const r = revalidarPedido(entrada({ precos: { p1: 10_000, p2: null } }));
    expect(r).toMatchObject({ ok: false, codigo: 'RN-CAT-06' });
    expect(r.ok === false && r.mensagem).toContain('FLT-2');
    const r2 = revalidarPedido(entrada({ precos: { p1: 10_000 } }));
    expect(r2).toMatchObject({ ok: false, codigo: 'RN-CAT-06' });
  });
  it('RN-VEN-10: dentro da alçada = aprovado na hora, automático (P-1)', () => {
    const r = revalidarPedido(entrada({ desconto_pct: 3 }));
    expect(r).toMatchObject({ ok: true, status: 'approved', nivel: null, aprovacao_automatica: true, motivos: [] });
    if (r.ok) {
      expect(r.total_tabela_cents).toBe(110_000);
      expect(r.total_cents).toBe(110_000 - 3300);
      expect(r.historico.map((h) => [h.de, h.para])).toEqual([[null, 'received'], ['received', 'approved']]);
      expect(r.historico[1]?.motivo).toBe('Dentro da alçada (5,0%)');
    }
  });
  it('RN-VEN-10: 8% vai para o supervisor; 12% para o gerente; 20% para o analista (P-1)', () => {
    expect(revalidarPedido(entrada({ desconto_pct: 8 }))).toMatchObject({ ok: true, status: 'pending_approval', nivel: 'supervisor', aprovacao_automatica: false, motivos: ['desconto'] });
    expect(revalidarPedido(entrada({ desconto_pct: 12 }))).toMatchObject({ status: 'pending_approval', nivel: 'gerente' });
    const r = revalidarPedido(entrada({ desconto_pct: 20 }));
    expect(r).toMatchObject({ status: 'pending_approval', nivel: 'analista' });
    if (r.ok) expect(r.historico[1]).toMatchObject({ de: 'received', para: 'pending_approval', motivo: 'Desconto de 20,0% acima da alçada de 5,0%: aguardando analista' });
  });
  it('RN-VEN-10: acima da alçada do gerente com bloquear = recusado', () => {
    const r = revalidarPedido(entrada({ desconto_pct: 20, policy: { ...policy, above_manager: 'block' } }));
    expect(r).toMatchObject({ ok: false, codigo: 'RN-VEN-10' });
  });
  it('RN-VEN-02: o total do servidor vale; o do aparelho é ignorado', () => {
    const r = revalidarPedido(entrada({ total_aparelho_cents: 1 }));
    expect(r.ok && r.total_cents).toBe(106_700);
  });
  it('RN-VEN-21: item repetido soma a quantidade', () => {
    const r = revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 1 }, { product_id: 'p1', sku: 'A', quantity: 2 }], precos: { p1: 100 }, desconto_pct: 0 }));
    expect(r.ok && r.total_cents).toBe(300);
    expect(r.ok && r.itens).toHaveLength(1);
  });
  it('item vazio ou quantidade inválida = PAYLOAD_INVALIDO', () => {
    expect(revalidarPedido(entrada({ itens: [] }))).toMatchObject({ ok: false, codigo: 'PAYLOAD_INVALIDO' });
    expect(revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 0.5 }] }))).toMatchObject({ ok: false, codigo: 'PAYLOAD_INVALIDO' });
  });
});

describe('resultadoDoRecebimento', () => {
  it('RN-VEN-30: ok vira approved com histórico null→received→approved', () => {
    const v = validateOrder({ seller_id: 'v1', discount_pct: 2, lines: [{ product_id: 'p', quantity: 1, unit_price_cents: 100 }], policy, credit });
    expect(resultadoDoRecebimento(v)).toMatchObject({ aceito: true, status: 'approved', nivel: null });
  });
  it('RN-VEN-10: rejeitado pela validação traz código do primeiro bloqueio', () => {
    const v = validateOrder({ seller_id: 'v1', discount_pct: 50, lines: [{ product_id: 'p', quantity: 1, unit_price_cents: 100 }], policy: { ...policy, above_manager: 'block' }, credit });
    expect(resultadoDoRecebimento(v)).toMatchObject({ aceito: false, codigo: 'RN-VEN-10' });
  });
});

describe('quemDecide (P-3, RN-GES-04)', () => {
  it('RN-GES-04: supervisor decide só supervisor; gerente decide gerente e supervisor (acima do nível)', () => {
    expect(quemDecide('supervisor', 'supervisor')).toEqual({ pode: true, acima_do_nivel: false });
    expect(quemDecide('supervisor', 'gerente')).toEqual({ pode: false, acima_do_nivel: false });
    expect(quemDecide('gerente', 'gerente')).toEqual({ pode: true, acima_do_nivel: false });
    expect(quemDecide('gerente', 'supervisor')).toEqual({ pode: true, acima_do_nivel: true });
    expect(quemDecide('gerente', 'analista')).toEqual({ pode: false, acima_do_nivel: false });
  });
  it('P-3: analista decide só o nível analista (acima do gerente)', () => {
    expect(quemDecide('analista', 'analista').pode).toBe(true);
    expect(quemDecide('analista', 'gerente').pode).toBe(false);
    expect(quemDecide('analista', 'supervisor').pode).toBe(false);
  });
  it('RN-PRO-01 e matriz: vendedor, assistente, promotor e admin não decidem', () => {
    for (const p of ['vendedor', 'assistente', 'promotor', 'admin']) expect(quemDecide(p, 'supervisor').pode).toBe(false);
  });
});

describe('decidirAprovacao', () => {
  const base = { status: 'pending_approval' as const, nivel: 'supervisor' as const, perfil: 'supervisor' };
  it('RN-GES-08: aprovar não exige comentário', () => {
    expect(decidirAprovacao({ ...base, decisao: 'aprovar' })).toMatchObject({ tipo: 'ok', para: 'approved', acima_do_nivel: false });
  });
  it('RN-GES-08: rejeitar exige motivo de 3+ caracteres depois do trim', () => {
    expect(MOTIVO_REJEICAO_MIN).toBe(3);
    for (const texto of [undefined, '', '  ', 'ab', ' a '])
      expect(decidirAprovacao({ ...base, decisao: 'rejeitar', texto })).toMatchObject({ tipo: 'recusa', codigo: 'RN-GES-08', http: 422 });
    expect(decidirAprovacao({ ...base, decisao: 'rejeitar', texto: ' sem verba ' })).toMatchObject({ tipo: 'ok', para: 'rejected', motivo: 'sem verba' });
  });
  it('RN-VEN-30: fora de pending_approval recusa 422; repetição da mesma decisão é idempotente', () => {
    expect(decidirAprovacao({ ...base, status: 'cancelled', decisao: 'aprovar' })).toMatchObject({ tipo: 'recusa', codigo: 'RN-VEN-30', http: 422 });
    expect(decidirAprovacao({ ...base, status: 'approved', decisao: 'rejeitar', texto: 'xxx' })).toMatchObject({ tipo: 'recusa', codigo: 'RN-VEN-30' });
    expect(decidirAprovacao({ ...base, status: 'approved', decisao: 'aprovar' })).toEqual({ tipo: 'repetida' });
    expect(decidirAprovacao({ ...base, status: 'rejected', decisao: 'rejeitar', texto: 'xxx' })).toEqual({ tipo: 'repetida' });
  });
  it('RN-VEN-10: fora da alçada do perfil = 422 com o nível exigido', () => {
    const r = decidirAprovacao({ ...base, nivel: 'gerente', decisao: 'aprovar' });
    expect(r).toMatchObject({ tipo: 'recusa', codigo: 'RN-VEN-10', http: 422 });
    expect(r.tipo === 'recusa' && r.mensagem).toBe('Este pedido precisa de aprovação do nível gerente.');
  });
  it('RN-GES-04: gerente decidindo nível supervisor marca acima_do_nivel', () => {
    expect(decidirAprovacao({ ...base, perfil: 'gerente', decisao: 'aprovar' })).toMatchObject({ tipo: 'ok', acima_do_nivel: true });
  });
  it('RN-PRO-01 e matriz: promotor 403 RN-PRO-01; vendedor 403 PERFIL_SEM_ACESSO', () => {
    expect(decidirAprovacao({ ...base, perfil: 'promotor', decisao: 'aprovar' })).toMatchObject({ tipo: 'recusa', codigo: 'RN-PRO-01', http: 403 });
    expect(decidirAprovacao({ ...base, perfil: 'vendedor', decisao: 'aprovar' })).toMatchObject({ tipo: 'recusa', codigo: 'PERFIL_SEM_ACESSO', http: 403 });
  });
});

describe('montarPedidoAprovado (aprovado@1, RN-INT-08)', () => {
  it('RN-INT-08: monta o payload da fila do ERP com chaves anuláveis e itens com sequência', () => {
    const e = montarPedidoAprovado({
      pedido_uuid: '11111111-1111-4111-8111-111111111111',
      cliente_external_id: null,
      vendedor_external_id: 'V01',
      condicao_pagamento_codigo: '28',
      criado_em: '2026-11-01T14:00:00.000Z',
      aprovado_em: '2026-11-01T14:00:01.000Z',
      observacao: null,
      itens: [
        { produto_external_id: 'P1', quantidade: 10, preco_tabela_cents: 10_000, total_cents: 97_000 },
        { produto_external_id: null, quantidade: 2, preco_tabela_cents: 5_000, total_cents: 9_700 },
      ],
    });
    expect(e.itens.map((i) => i.sequencia)).toEqual([1, 2]);
    expect(e.itens[0]).toMatchObject({ preco_unitario_cents: 10_000, desconto_cents: 3_000, total_cents: 97_000 });
    expect(e.desconto_total_cents).toBe(3_000 + 300);
    expect(e.total_cents).toBe(106_700);
    expect(e.cliente_external_id).toBeNull();
  });
});

describe('RN-VEN-33: conteúdo canônico do envio (hash_envio)', () => {
  it('RN-VEN-33: a ordem das chaves e o total informativo do aparelho não mudam o conteúdo', async () => {
    const { conteudoDoEnvio } = await import('./aprovacao');
    const a = conteudoDoEnvio({ id: 'x', customer_id: 'c', items: [{ product_id: 'p', quantity: 2 }], total_cents: 100, discount_pct: 4 });
    const b = conteudoDoEnvio({ discount_pct: 4, total_cents: 999, items: [{ quantity: 2, product_id: 'p' }], customer_id: 'c', id: 'x' });
    expect(a).toBe(b);
  });
  it('RN-VEN-33: quantidade diferente muda o conteúdo (reenvio com outro conteúdo = conflito)', async () => {
    const { conteudoDoEnvio } = await import('./aprovacao');
    expect(conteudoDoEnvio({ items: [{ product_id: 'p', quantity: 2 }] })).not.toBe(conteudoDoEnvio({ items: [{ product_id: 'p', quantity: 3 }] }));
  });
});

describe('RN-PRO-01 / matriz §2: perfil que cria pedido pelo aparelho', () => {
  it('RN-PRO-01: promotor recebe 403 RN-PRO-01', async () => {
    const { recusaDePerfil } = await import('./aprovacao');
    expect(recusaDePerfil('promotor')).toMatchObject({ codigo: 'RN-PRO-01', http: 403 });
  });
  it('matriz §2: só o vendedor cria pelo aparelho nesta fatia; supervisor recebe PERFIL_SEM_ACESSO', async () => {
    const { recusaDePerfil } = await import('./aprovacao');
    expect(recusaDePerfil('vendedor')).toBeNull();
    expect(recusaDePerfil('supervisor')).toMatchObject({ codigo: 'PERFIL_SEM_ACESSO', http: 403 });
  });
});
