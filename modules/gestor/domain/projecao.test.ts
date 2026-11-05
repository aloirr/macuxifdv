import { describe, expect, it } from 'vitest';
import { apuracaoDoPedido, statusAtual, vendasApuradas } from './apuracao';
import { CLIENTE_A, CLIENTE_B, checkin, checkout, ev, pedidoCriado, PROMOTOR, statusAlterado, u, VENDEDOR, meta } from './fixtures';
import { aplicarEvento, aplicarEventos, estadoInicial } from './projecao';

describe('projeção idempotente dos eventos consumidos (read-model painel_vendedor_dia)', () => {
  it('RF-GES-01: reentrega do mesmo evento_id não muda o estado (dedup por evento)', () => {
    const e = pedidoCriado({ total: 10_000 }, 'ev-fixo-1');
    const a = aplicarEvento(estadoInicial(), e);
    const b = aplicarEvento(a.estado, e);
    expect(a.situacao).toBe('aplicado');
    expect(b.situacao).toBe('duplicado');
    expect(b.estado).toEqual(a.estado);
  });

  it('reaplicar toda a sequência duas vezes dá o mesmo resultado', () => {
    const eventos = [
      pedidoCriado({ total: 10_000 }),
      statusAlterado({ para: 'aprovado', em: '2026-10-30T15:00:00Z' }),
      checkin({ em: '2026-10-30T13:00:00Z' }),
      checkout({ em: '2026-10-30T13:30:00Z' }),
    ];
    const uma = aplicarEventos(estadoInicial(), eventos).estado;
    const duas = aplicarEventos(uma, eventos).estado;
    expect(duas).toEqual(uma);
  });

  it('fora de ordem: status/checkout chegando antes de criado/check-in dá o mesmo estado', () => {
    const eventos = [
      pedidoCriado({ total: 10_000 }, 'p1'),
      statusAlterado({ para: 'em_aprovacao', em: '2026-10-30T14:10:00Z' }, 'p2'),
      statusAlterado({ para: 'aprovado', em: '2026-10-30T15:00:00Z' }, 'p3'),
      checkin({ em: '2026-10-30T13:00:00Z' }),
      checkout({ em: '2026-10-30T13:30:00Z' }),
    ];
    const emOrdem = aplicarEventos(estadoInicial(), eventos).estado;
    const invertido = aplicarEventos(estadoInicial(), [...eventos].reverse()).estado;
    const embaralhado = aplicarEventos(estadoInicial(), [eventos[2]!, eventos[4]!, eventos[0]!, eventos[3]!, eventos[1]!]).estado;
    expect(invertido).toEqual(emOrdem);
    expect(embaralhado).toEqual(emOrdem);
  });

  it('mesma chave de negócio com evento_id novo: vence a versão mais recente, em qualquer ordem', () => {
    const v1 = meta(VENDEDOR, '2026-10', 100_000, '2026-10-01T08:00:00Z', 'm1');
    const v2 = meta(VENDEDOR, '2026-10', 150_000, '2026-10-15T08:00:00Z', 'm2');
    const a = aplicarEventos(estadoInicial(), [v1, v2]).estado;
    const b = aplicarEventos(estadoInicial(), [v2, v1]).estado;
    expect(a).toEqual(b);
    expect(Object.values(a.metas)[0]!.meta_cents).toBe(150_000);
  });

  it('payload inválido é recusado sem alterar o estado; evento desconhecido é ignorado', () => {
    const s0 = estadoInicial();
    const ruim = aplicarEvento(s0, ev('vendedor.pedido.criado@1', '2026-10-30T14:00:00Z', { pedido_id: 'x' }));
    expect(ruim.situacao).toBe('invalido');
    expect(ruim.motivo).toBeTruthy();
    expect(ruim.estado).toBe(s0);
    const desconhecido = aplicarEvento(s0, ev('catalogo.produto.visualizado@1', '2026-10-30T14:00:00Z', {}));
    expect(desconhecido.situacao).toBe('ignorado');
    expect(desconhecido.estado).toBe(s0);
  });
});

describe('apuração do pedido (RN-CORE-21, RN-VEN-30)', () => {
  const montar = (eventos: ReturnType<typeof ev>[]) => aplicarEventos(estadoInicial(), eventos).estado;

  it('RN-CORE-21: base aprovado conta o pedido na data em que foi aprovado, não na de criação', () => {
    const s = montar([pedidoCriado({ total: 10_000, em: '2026-10-29T14:00:00Z' }), statusAlterado({ para: 'aprovado', em: '2026-10-30T15:00:00Z' })]);
    const p = s.pedidos[u(1000)]!;
    expect(apuracaoDoPedido(p, 'aprovado')).toEqual({ conta: true, desde: '2026-10-30T15:00:00Z' });
    expect(apuracaoDoPedido(p, 'faturado')).toEqual({ conta: false, desde: null });
  });

  it('RN-CORE-21: base faturado só conta com faturado_parcial ou faturado_total', () => {
    const s = montar([
      pedidoCriado({ total: 10_000 }),
      statusAlterado({ para: 'aprovado', em: '2026-10-30T15:00:00Z' }),
      statusAlterado({ para: 'integrado_erp', em: '2026-10-30T16:00:00Z' }),
      statusAlterado({ para: 'faturado_total', em: '2026-11-02T09:00:00Z' }),
    ]);
    const p = s.pedidos[u(1000)]!;
    expect(apuracaoDoPedido(p, 'faturado').desde).toBe('2026-11-02T09:00:00Z');
    expect(apuracaoDoPedido(p, 'aprovado').desde).toBe('2026-10-30T15:00:00Z');
  });

  it('RN-CORE-21: líquido de cancelamentos — pedido cancelado depois de aprovado deixa de contar', () => {
    const s = montar([pedidoCriado({ total: 10_000 }), statusAlterado({ para: 'aprovado', em: '2026-10-30T15:00:00Z' }), statusAlterado({ para: 'cancelado', em: '2026-10-31T09:00:00Z' })]);
    expect(statusAtual(s.pedidos[u(1000)]!)).toBe('cancelado');
    expect(vendasApuradas(s, 'aprovado')).toEqual([]);
  });

  it('RN-VEN-31: editar pedido aprovado volta para revalidação; a data de apuração é a da última aprovação', () => {
    const s = montar([
      pedidoCriado({ total: 10_000 }),
      statusAlterado({ para: 'aprovado', em: '2026-10-28T15:00:00Z' }),
      statusAlterado({ para: 'em_aprovacao', em: '2026-10-29T10:00:00Z' }),
      statusAlterado({ para: 'aprovado', em: '2026-10-30T10:00:00Z' }),
    ]);
    expect(apuracaoDoPedido(s.pedidos[u(1000)]!, 'aprovado').desde).toBe('2026-10-30T10:00:00Z');
    const emRevalidacao = montar([pedidoCriado({ total: 10_000 }), statusAlterado({ para: 'aprovado', em: '2026-10-28T15:00:00Z' }), statusAlterado({ para: 'em_aprovacao', em: '2026-10-29T10:00:00Z' })]);
    expect(apuracaoDoPedido(emRevalidacao.pedidos[u(1000)]!, 'aprovado').conta).toBe(false);
  });

  it('T-0024: instante do Vendedor que não é data válida deixa o evento inválido (o schema do dono aceita texto livre)', () => {
    const base = pedidoCriado({ total: 10_000 }).payload as Record<string, unknown>;
    const r = aplicarEvento(estadoInicial(), ev('vendedor.pedido.criado@1', '2026-10-30T14:00:00Z', { ...base, criado_em: '30/10/2026' }));
    expect(r.situacao).toBe('invalido');
    expect(r.motivo).toContain('criado_em');
    expect(r.estado).toEqual(estadoInicial());
  });

  it('T-0024: id do Vendedor que não é UUID deixa o evento inválido (o schema do dono aceita texto livre)', () => {
    const base = pedidoCriado({ total: 10_000 }).payload as Record<string, unknown>;
    const r = aplicarEvento(estadoInicial(), ev('vendedor.pedido.criado@1', '2026-10-30T14:00:00Z', { ...base, pedido_id: 'x' }));
    expect(r.situacao).toBe('invalido');
    expect(r.motivo).toContain('pedido_id');
  });

  it('RN-VEN-32: orçamento não é venda (o contrato do Vendedor só publica tipo pedido; orçamento é evento inválido)', () => {
    const orcamento = ev('vendedor.pedido.criado@1', '2026-10-30T14:00:00Z', { ...(pedidoCriado({ total: 10_000 }).payload as Record<string, unknown>), tipo: 'orcamento' });
    const s = montar([orcamento, statusAlterado({ para: 'aprovado', em: '2026-10-30T15:00:00Z' })]);
    expect(vendasApuradas(s, 'aprovado')).toEqual([]);
  });

  it('RN-VEN-35: pedido em nome do gestor conta para o vendedor (vendedor_id), não para o autor', () => {
    const s = montar([pedidoCriado({ total: 8_000, vendedor: VENDEDOR, autor: u(300) }), statusAlterado({ para: 'aprovado', em: '2026-10-30T15:00:00Z' })]);
    const [v] = vendasApuradas(s, 'aprovado');
    expect(v!.vendedor_id).toBe(VENDEDOR);
  });

  it('status sem o pedido criado ainda (fora de ordem) não gera venda até o criado chegar', () => {
    const so = montar([statusAlterado({ para: 'aprovado', em: '2026-10-30T15:00:00Z' })]);
    expect(vendasApuradas(so, 'aprovado')).toEqual([]);
    const completo = aplicarEvento(so, pedidoCriado({ total: 5_000 })).estado;
    expect(vendasApuradas(completo, 'aprovado')).toHaveLength(1);
  });

  it('visitas: check-in e checkout casam por visita_id e guardam clientes distintos', () => {
    const s = montar([checkin({ em: '2026-10-30T13:00:00Z', cliente: CLIENTE_A }), checkout({ em: '2026-10-30T13:20:00Z', cliente: CLIENTE_A }), checkin({ visita: u(2001), em: '2026-10-30T14:00:00Z', cliente: CLIENTE_B, usuario: PROMOTOR })]);
    expect(Object.keys(s.visitas)).toHaveLength(2);
    expect(s.visitas[u(2000)]!.checkout?.checkout_em).toBe('2026-10-30T13:20:00Z');
  });
});
