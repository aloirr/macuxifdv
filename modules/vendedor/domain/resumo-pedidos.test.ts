/** T-0170: os 3 cards da tela Pedidos (RN-VEN-43; decisões D5 e D6). Dinheiro em centavos; datas em UTC, período no fuso do tenant. */
import { describe, expect, it } from 'vitest';
import { TODOS_OS_VENDEDORES } from './filtro-vendedor';
import { pedidoEnviado, resumoDePedidos, STATUS_ENVIADO, totalDoResumo, type DocumentoDoResumo } from './resumo-pedidos';

const TZ = 'America/Manaus';
const NOVEMBRO = { periodo: { tipo: 'mes', valor: '2026-11' }, tz: TZ } as const;

const doc = (o: Partial<DocumentoDoResumo>): DocumentoDoResumo => ({
  tipo: 'pedido',
  status: 'approved',
  total_cents: 1000,
  convertido_pedido_id: null,
  local: false,
  emitido_em: '2026-11-10T15:00:00Z',
  seller_id: 'v1',
  ...o,
});
const orc = (o: Partial<DocumentoDoResumo>): DocumentoDoResumo => doc({ tipo: 'orcamento', status: 'received', ...o });

describe('T-0170: resumo dos cards de Pedidos (RN-VEN-43)', () => {
  it('RN-VEN-43: o mock aprovado dá R$ 2.446,00 em Pedidos enviados; o recusado fica fora e o "Em aprovação" entra', () => {
    const r = resumoDePedidos(
      [
        doc({ status: 'approved', total_cents: 81_240 }),
        doc({ status: 'invoiced', total_cents: 12_664 }),
        doc({ status: 'pending_approval', total_cents: 113_000 }),
        doc({ status: 'integrated', total_cents: 17_696 }),
        doc({ status: 'received', total_cents: 20_000 }),
        doc({ status: 'rejected', total_cents: 45_510 }),
      ],
      NOVEMBRO,
    );
    expect(r.enviados).toEqual({ quantidade: 5, valor_cents: 244_600 });
    expect(r.orcamentos).toEqual({ quantidade: 0, valor_cents: 0 });
    expect(r.total).toEqual({ quantidade: 5, valor_cents: 244_600 });
  });

  it('RN-VEN-43: enviado = do "Enviado" em diante (recebido até faturado), inclusive o faturado parcial pelo valor do pedido', () => {
    expect([...STATUS_ENVIADO]).toEqual(['received', 'pending_approval', 'approved', 'sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced']);
    for (const status of STATUS_ENVIADO) expect(pedidoEnviado(doc({ status }))).toBe(true);
    const r = resumoDePedidos([doc({ status: 'invoiced_partial', total_cents: 50_000 })], NOVEMBRO);
    expect(r.enviados).toEqual({ quantidade: 1, valor_cents: 50_000 });
  });

  it('RN-VEN-43: rascunho, na fila (inclui o "Não aceito"), recusado e cancelado não são enviados', () => {
    for (const status of ['draft', 'queued', 'rejected', 'cancelled']) expect(pedidoEnviado(doc({ status }))).toBe(false);
    const r = resumoDePedidos(
      [doc({ status: 'draft' }), doc({ status: 'queued' }), doc({ status: 'rejected' }), doc({ status: 'cancelled' })],
      NOVEMBRO,
    );
    expect(r.enviados).toEqual({ quantidade: 0, valor_cents: 0 });
  });

  it('RN-VEN-43: pedido ainda na fila do aparelho não chegou ao servidor, qualquer que seja o status da linha', () => {
    expect(pedidoEnviado(doc({ status: 'received', local: true }))).toBe(false);
  });

  it('RN-VEN-43: orçamento nunca é pedido enviado; pedido sem tipo (linha antiga) é pedido', () => {
    expect(pedidoEnviado(orc({ status: 'approved' }))).toBe(false);
    expect(pedidoEnviado(doc({ tipo: undefined, status: 'approved' }))).toBe(true);
  });

  it('RN-VEN-43: orçamento em aberto = não convertido e não cancelado (RN-VEN-18), com quantidade e valor', () => {
    const r = resumoDePedidos(
      [
        orc({ total_cents: 50_000 }),
        orc({ total_cents: 65_000 }),
        orc({ total_cents: 7_000, convertido_pedido_id: 'p1' }),
        orc({ total_cents: 9_000, status: 'cancelled' }),
      ],
      NOVEMBRO,
    );
    expect(r.orcamentos).toEqual({ quantidade: 2, valor_cents: 115_000 });
    expect(r.enviados).toEqual({ quantidade: 0, valor_cents: 0 });
  });

  it('RN-VEN-43: o total soma as quantidades e os valores dos dois cards', () => {
    const r = resumoDePedidos(
      [orc({ total_cents: 30_000 }), orc({ total_cents: 1_500 }), doc({ status: 'approved', total_cents: 100_000 })],
      NOVEMBRO,
    );
    expect(r.orcamentos).toEqual({ quantidade: 2, valor_cents: 31_500 });
    expect(r.enviados).toEqual({ quantidade: 1, valor_cents: 100_000 });
    expect(r.total).toEqual({ quantidade: 3, valor_cents: 131_500 });
  });

  it('RN-VEN-43: o total do resumo do servidor (fora da janela) é a mesma soma', () => {
    expect(totalDoResumo({ quantidade: 2, valor_cents: 31_500 }, { quantidade: 4, valor_cents: 100_000 })).toEqual({ quantidade: 6, valor_cents: 131_500 });
  });

  it('RN-VEN-43: o valor é o total_cents do documento, sem frete', () => {
    const comFrete = { ...doc({ status: 'approved', total_cents: 10_000 }), frete_cents: 2_500 };
    expect(resumoDePedidos([comFrete], NOVEMBRO).enviados.valor_cents).toBe(10_000);
  });

  it('RN-VEN-43: período pela data de emissão no fuso do tenant (31/10 22h em Manaus é outubro)', () => {
    const docs = [
      doc({ emitido_em: '2026-11-01T02:00:00Z', total_cents: 111 }), // 31/10 22h00 em Manaus
      doc({ emitido_em: '2026-11-01T04:00:00Z', total_cents: 222 }), // 01/11 00h00 em Manaus
      doc({ emitido_em: '2026-12-01T03:59:00Z', total_cents: 333 }), // 30/11 23h59 em Manaus
    ];
    expect(resumoDePedidos(docs, NOVEMBRO).enviados).toEqual({ quantidade: 2, valor_cents: 555 });
    expect(resumoDePedidos(docs, { periodo: { tipo: 'mes', valor: '2026-10' }, tz: TZ }).enviados).toEqual({ quantidade: 1, valor_cents: 111 });
  });

  it('RN-VEN-43 (D5): pedido emitido em outubro e faturado em novembro não entra nos cards de novembro', () => {
    const faturadoDepois = { ...doc({ status: 'invoiced', emitido_em: '2026-10-20T15:00:00Z' }), status_alterado_em: '2026-11-05T15:00:00Z' };
    expect(resumoDePedidos([faturadoDepois], NOVEMBRO).enviados).toEqual({ quantidade: 0, valor_cents: 0 });
    expect(resumoDePedidos([faturadoDepois], { periodo: { tipo: 'mes', valor: '2026-10' }, tz: TZ }).enviados.quantidade).toBe(1);
  });

  it('RN-VEN-43: orçamento em aberto também conta pelo período (data em que foi salvo)', () => {
    const docs = [orc({ emitido_em: '2026-10-30T15:00:00Z', total_cents: 900 }), orc({ emitido_em: '2026-11-02T15:00:00Z', total_cents: 400 })];
    expect(resumoDePedidos(docs, NOVEMBRO).orcamentos).toEqual({ quantidade: 1, valor_cents: 400 });
  });

  it('RN-VEN-43: vale para dia, semana (domingo a sábado) e ano', () => {
    const docs = [
      doc({ emitido_em: '2026-11-08T15:00:00Z', total_cents: 1 }), // domingo
      doc({ emitido_em: '2026-11-14T15:00:00Z', total_cents: 2 }), // sábado
      doc({ emitido_em: '2026-11-15T15:00:00Z', total_cents: 4 }), // domingo seguinte
      doc({ emitido_em: '2025-12-31T15:00:00Z', total_cents: 8 }),
    ];
    expect(resumoDePedidos(docs, { periodo: { tipo: 'dia', valor: '2026-11-14' }, tz: TZ }).enviados.valor_cents).toBe(2);
    expect(resumoDePedidos(docs, { periodo: { tipo: 'semana', valor: '2026-11-08' }, tz: TZ }).enviados.valor_cents).toBe(3);
    expect(resumoDePedidos(docs, { periodo: { tipo: 'ano', valor: '2026' }, tz: TZ }).enviados.valor_cents).toBe(7);
  });

  it('RN-VEN-43 (D6): sem vendedor, ou com "Todos os vendedores", soma a equipe; com vendedor, só ele', () => {
    const docs = [
      doc({ seller_id: 'v1', total_cents: 100 }),
      doc({ seller_id: 'v2', total_cents: 200 }),
      orc({ seller_id: 'v2', total_cents: 50 }),
    ];
    const equipe = { quantidade: 3, valor_cents: 350 };
    expect(resumoDePedidos(docs, NOVEMBRO).total).toEqual(equipe);
    expect(resumoDePedidos(docs, { ...NOVEMBRO, vendedorId: TODOS_OS_VENDEDORES }).total).toEqual(equipe);
    const v2 = resumoDePedidos(docs, { ...NOVEMBRO, vendedorId: 'v2' });
    expect(v2.enviados).toEqual({ quantidade: 1, valor_cents: 200 });
    expect(v2.orcamentos).toEqual({ quantidade: 1, valor_cents: 50 });
  });

  it('RN-VEN-43: sem documento no período, os três cards ficam zerados', () => {
    const zero = { quantidade: 0, valor_cents: 0 };
    expect(resumoDePedidos([], NOVEMBRO)).toEqual({ orcamentos: zero, enviados: zero, total: zero });
  });
});
