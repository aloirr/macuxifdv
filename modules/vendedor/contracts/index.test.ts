import { describe, expect, it } from 'vitest';
import { CreateOrderRequest, RejectRequest, SyncPushRequest } from './index';

describe('contracts', () => {
  const order = {
    id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e2f',
    customer_id: 'c1',
    discount_pct: 4,
    items: [{ product_id: 'p1', quantity: 2 }],
  };
  it('pedido válido recebe prazo padrão', () => {
    expect(CreateOrderRequest.parse(order).payment_terms).toBe('28/56 dias');
  });
  it('pedido sem item ou com quantidade zero é inválido', () => {
    expect(CreateOrderRequest.safeParse({ ...order, items: [] }).success).toBe(false);
    expect(CreateOrderRequest.safeParse({ ...order, items: [{ product_id: 'p', quantity: 0 }] }).success).toBe(false);
  });
  it('id do pedido precisa ser UUID gerado no aparelho', () => {
    expect(CreateOrderRequest.safeParse({ ...order, id: '123' }).success).toBe(false);
  });
  it('recusa exige motivo', () => {
    expect(RejectRequest.safeParse({ reason: '' }).success).toBe(false);
  });
  it('push aceita pedido e visita', () => {
    const r = SyncPushRequest.safeParse({
      items: [
        { kind: 'order', idempotency_key: 'k1', payload: order },
        { kind: 'visit', idempotency_key: 'k2', payload: { id: order.id, customer_id: 'c1', checkin_at: '2026-10-12T13:00:00Z' } },
      ],
    });
    expect(r.success).toBe(true);
  });
});

import { CORPO_DA_DECISAO, MOTIVO_REJEICAO_MIN, ROTA_DA_DECISAO, ROTULO_MOTIVO_APROVACAO, corpoDaDecisao, maiorNivel, quemDecide, AprovacaoMotivo, AprovacaoSolicitadaEvento, AprovarPedidoRequest, RecusarPedidoRequest, DECISOES_APROVADOR, ESTADOS_APROVACAO_MOTIVO, MOTIVOS_APROVACAO, DiscountPolicy as AlcadaApiSchema, PedidoAprovadoEvento, PedidoEventoSyncSchema, PedidoPush, PedidoStatusAlteradoEvento, RejeitarPedidoRequest } from './index';

describe('contracts do pedido no servidor (T-0029)', () => {
  const push = { id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e2f', customer_id: 'c1', discount_pct: 4, items: [{ product_id: 'p1', quantity: 2 }] };
  it('PedidoPush aceita a fila antiga (campos novos opcionais) e os novos', () => {
    expect(PedidoPush.safeParse(push).success).toBe(true);
    expect(PedidoPush.safeParse({ ...push, condicao_pagamento_id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e2f', observacao: 'x', visita_id: null }).success).toBe(true);
  });
  it('PedidoPush limita 200 itens e quantidade positiva', () => {
    const muitos = Array.from({ length: 201 }, (_, i) => ({ product_id: `p${i}`, quantity: 1 }));
    expect(PedidoPush.safeParse({ ...push, items: muitos }).success).toBe(false);
    expect(PedidoPush.safeParse({ ...push, items: [{ product_id: 'p', quantity: 0 }] }).success).toBe(false);
  });
  it('RN-GES-08: aprovar sem comentário é válido; o mínimo de 3 caracteres do motivo é do domínio (422)', () => {
    expect(AprovarPedidoRequest.safeParse({}).success).toBe(true);
    expect(RejeitarPedidoRequest.safeParse({ motivo: 'abc' }).success).toBe(true);
    expect(RejeitarPedidoRequest.safeParse({ motivo: 'ab' }).success).toBe(true);
    expect(RejeitarPedidoRequest.safeParse({}).success).toBe(false);
    expect(RejeitarPedidoRequest.safeParse({ motivo: 'x'.repeat(501) }).success).toBe(false);
  });
  it('status_alterado@1 usa o vocabulário do doc 03 (RN-VEN-30)', () => {
    const base = { pedido_id: 'a', vendedor_id: 'b', de: null, alterado_em: '2026-11-01T14:00:00.000Z', autor_id: null, motivo: null };
    expect(PedidoStatusAlteradoEvento.safeParse({ ...base, para: 'recebido' }).success).toBe(true);
    expect(PedidoStatusAlteradoEvento.safeParse({ ...base, para: 'approved' }).success).toBe(false);
  });
  it('RF-CORE-09: pedido_numero é opcional e compatível em status_alterado@1 e aprovacao_solicitada@1', () => {
    const base = { pedido_id: 'a', vendedor_id: 'b', de: null, para: 'recebido', alterado_em: '2026-11-01T14:00:00.000Z', autor_id: null, motivo: null };
    expect(PedidoStatusAlteradoEvento.safeParse(base).success).toBe(true);
    expect(PedidoStatusAlteradoEvento.parse({ ...base, pedido_numero: '000010' }).pedido_numero).toBe('000010');
    const apr = { pedido_id: 'a', vendedor_id: 'b', cliente_id: 'c', solicitada_em: '2026-11-01T14:00:00.000Z', nivel: 'supervisor', motivos: ['desconto'], desconto_efetivo_pct: 8, total_cents: 100, credito: null, historico: null };
    expect(AprovacaoSolicitadaEvento.safeParse(apr).success).toBe(true);
    expect(AprovacaoSolicitadaEvento.parse({ ...apr, pedido_numero: '000010' }).pedido_numero).toBe('000010');
  });
  it('aprovado@1 aceita chaves do ERP nulas e exige ao menos um item', () => {
    const e = { pedido_uuid: 'a', cliente_external_id: null, vendedor_external_id: null, condicao_pagamento_codigo: null, criado_em: 'x', aprovado_em: 'y', observacao: null, desconto_total_cents: 0, total_cents: 100, itens: [{ sequencia: 1, produto_external_id: null, quantidade: 1, preco_unitario_cents: 100, desconto_cents: 0, total_cents: 100 }] };
    expect(PedidoAprovadoEvento.safeParse(e).success).toBe(true);
    expect(PedidoAprovadoEvento.safeParse({ ...e, itens: [] }).success).toBe(false);
  });
  it('T-0149 (RN-CORE-39): aprovado@1 declara filial opcional e a mantém na publicação', () => {
    const e = { pedido_uuid: 'a', cliente_external_id: null, vendedor_external_id: null, condicao_pagamento_codigo: null, criado_em: 'x', aprovado_em: 'y', observacao: null, desconto_total_cents: 0, total_cents: 100, itens: [{ sequencia: 1, produto_external_id: null, quantidade: 1, preco_unitario_cents: 100, desconto_cents: 0, total_cents: 100 }] };
    const filial = { codigo: '01', external_id: 'F01', nome: 'Matriz', padrao: true };
    expect(PedidoAprovadoEvento.parse({ ...e, filial }).filial).toEqual(filial);
    expect(PedidoAprovadoEvento.safeParse(e).success).toBe(true);
    expect(PedidoAprovadoEvento.safeParse({ ...e, filial: null }).success).toBe(true);
  });
  it('pedido_evento do pull exige os campos da linha do tempo', () => {
    expect(PedidoEventoSyncSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});

describe('T-0184: contratos da aprovação por motivo', () => {
  it('vocabulário: inadimplencia entra nos motivos; estados e decisões do aprovador', () => {
    expect(MOTIVOS_APROVACAO).toEqual(['desconto', 'credito', 'inadimplencia', 'estoque', 'preco_minimo']);
    expect(ESTADOS_APROVACAO_MOTIVO).toEqual(['pendente', 'aprovada', 'rejeitada', 'devolvida', 'encerrada']);
    expect(DECISOES_APROVADOR).toEqual(['aprovar', 'devolver', 'recusar']);
  });
  it('RN-GES-08 e ADR 0062: aprovar aceita comentario e motivo_aprovacao; rejeitar e recusar exigem motivo (texto livre, 3+) e aceitam motivo_aprovacao', () => {
    expect(AprovarPedidoRequest.safeParse({ comentario: 'ok', motivo_aprovacao: 'credito' }).success).toBe(true);
    expect(AprovarPedidoRequest.safeParse({ motivo_aprovacao: 'outro' }).success).toBe(false);
    expect(RecusarPedidoRequest.safeParse({ motivo: 'sem verba', motivo_aprovacao: 'inadimplencia' }).success).toBe(true);
    expect(RecusarPedidoRequest.safeParse({ motivo_aprovacao: 'credito' }).success).toBe(false);
    expect(RejeitarPedidoRequest.safeParse({ motivo: 'abc', motivo_aprovacao: 'desconto' }).success).toBe(true);
    expect(RejeitarPedidoRequest.safeParse({ motivo: 'abc', motivo_aprovacao: 'x' }).success).toBe(false);
  });
  it('exports para o Gestor: rota da decisão, corpo de cada rota, mínimo do texto, estados, rótulos e maior nível', () => {
    expect(ROTA_DA_DECISAO).toEqual({ aprovar: 'aprovar', devolver: 'rejeitar', recusar: 'recusar' });
    expect(CORPO_DA_DECISAO.aprovar).toBe(AprovarPedidoRequest);
    expect(CORPO_DA_DECISAO.devolver).toBe(RejeitarPedidoRequest);
    expect(CORPO_DA_DECISAO.recusar).toBe(RecusarPedidoRequest);
    expect(MOTIVO_REJEICAO_MIN).toBe(3);
    expect(Object.keys(ROTULO_MOTIVO_APROVACAO)).toEqual([...MOTIVOS_APROVACAO]);
    expect(ROTULO_MOTIVO_APROVACAO.inadimplencia).toBe('Inadimplente');
    expect(maiorNivel(['supervisor', 'analista', 'gerente'])).toBe('analista');
    expect(maiorNivel([])).toBeNull();
  });
  it('corpoDaDecisao monta o corpo que a rota aceita (RN-GES-08)', () => {
    expect(corpoDaDecisao('aprovar', '')).toEqual({});
    expect(corpoDaDecisao('aprovar', ' ok ', 'credito')).toEqual({ comentario: 'ok', motivo_aprovacao: 'credito' });
    expect(corpoDaDecisao('devolver', ' sem verba ')).toEqual({ motivo: 'sem verba' });
    expect(corpoDaDecisao('recusar', 'cliente bloqueado', 'inadimplencia')).toEqual({ motivo: 'cliente bloqueado', motivo_aprovacao: 'inadimplencia' });
    for (const d of DECISOES_APROVADOR) expect(CORPO_DA_DECISAO[d].safeParse(corpoDaDecisao(d, 'texto ok')).success).toBe(true);
  });
  it('AprovacaoMotivo: estado, nível, texto e quem decidiu', () => {
    const ok = { motivo: 'credito', nivel: 'gerente', estado: 'aprovada', texto_pendencia: 'x', decidida_por_id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e2f', decidida_em: '2026-11-05T12:00:00.000Z', texto_decisao: null };
    expect(AprovacaoMotivo.safeParse(ok).success).toBe(true);
    expect(AprovacaoMotivo.safeParse({ ...ok, estado: 'x' }).success).toBe(false);
  });
  it('AlcadaApi: aprovador_credito e aprovador_inadimplencia são aditivos (o app antigo, sem eles, segue válido)', () => {
    const base = { seller_pct: 5, supervisor_pct: 10, manager_pct: 15, above_manager: 'director', exceptions: [] };
    expect(AlcadaApiSchema.safeParse(base).success).toBe(true);
    expect(AlcadaApiSchema.safeParse({ ...base, aprovador_credito: 'gerente', aprovador_inadimplencia: 'analista' }).success).toBe(true);
    expect(AlcadaApiSchema.safeParse({ ...base, aprovador_credito: 'diretor' }).success).toBe(false);
  });

  it('RN-GES-04: quemDecide é público no contrato (gestor decide até a alçada; analista só o seu nível)', () => {
    expect(quemDecide('gerente', 'supervisor')).toEqual({ pode: true, acima_do_nivel: true });
    expect(quemDecide('supervisor', 'gerente').pode).toBe(false);
    expect(quemDecide('vendedor', 'supervisor').pode).toBe(false);
  });
  it('T-0184: decidida_por_nome é aditivo no AprovacaoMotivo', () => {
    const base = { motivo: 'credito', nivel: 'gerente', estado: 'aprovada', texto_pendencia: '', decidida_por_id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e2f', decidida_em: '2026-11-18T14:05:00.000Z', texto_decisao: null };
    expect(AprovacaoMotivo.safeParse(base).success).toBe(true);
    expect(AprovacaoMotivo.parse({ ...base, decidida_por_nome: 'Rui Matos' }).decidida_por_nome).toBe('Rui Matos');
  });
});
