import { describe, expect, it } from 'vitest';
import type { PedidoDaLista } from './pedidos';
import { linhaOrcamentos, orcamentosEmAberto, resumoDoInicio, textoCartaoAFaturar, textoCartaoOrcamentos } from './resumo-inicio';

const ped = (o: Partial<PedidoDaLista>): PedidoDaLista => ({ id: 'x', seller_id: 'v1', status: 'approved', total_cents: 1000, received_at: '2026-11-04T12:00:00.000Z', local: false, local_error: '', ...o }) as PedidoDaLista;
const base = { vendedorId: 'v1', preVendaLigada: true };

describe('T-0076: resumo do Início no aparelho', () => {
  it('RN-VEN-18: o card conta o orçamento aberto a qualquer tempo, sem "vence amanhã"', () => {
    const r = resumoDoInicio([ped({ tipo: 'orcamento', status: 'received', total_cents: 115_000, received_at: '2026-01-04T12:00:00.000Z' })], base);
    expect(r.orcamentos).toEqual({ quantidade: 1, valor_cents: 115_000 });
  });

  it('escopo da carteira: pedido de outro vendedor não entra', () => {
    const r = resumoDoInicio([ped({ seller_id: 'v2' }), ped({})], base);
    expect(r.aFaturar.quantidade).toBe(1);
  });

  it('pré-venda desligada no tenant: sem card de orçamentos', () => {
    expect(resumoDoInicio([], { ...base, preVendaLigada: false }).orcamentos).toBeNull();
  });

  it('orçamento ainda na fila conta como aberto', () => {
    const r = resumoDoInicio([ped({ tipo: 'orcamento', status: 'queued', local: true, received_at: '2026-10-29T15:00:00.000Z' })], base);
    expect(r.orcamentos?.quantidade).toBe(1);
  });

  it('RN-VEN-18: lista vinda do card = contagem do card (convertido e cancelado ficam de fora)', () => {
    const lista = [
      ped({ id: 'a', tipo: 'orcamento', status: 'received' }),
      ped({ id: 'b', tipo: 'orcamento', status: 'received', received_at: '2026-01-01T12:00:00.000Z' }),
      ped({ id: 'c', tipo: 'orcamento', status: 'cancelled' }),
      ped({ id: 'd', tipo: 'orcamento', status: 'received', convertido_pedido_id: 'p9' }),
      ped({ id: 'e', tipo: 'orcamento', status: 'received' }),
      ped({ id: 'f' }),
    ];
    const abertos = orcamentosEmAberto(lista);
    expect(abertos.map((p) => p.id)).toEqual(['a', 'b', 'e']);
    expect(abertos.length).toBe(resumoDoInicio(lista, base).orcamentos?.quantidade);
  });

  it('textos dos cards: valor sem centavos e o destaque do que pede atenção', () => {
    expect(linhaOrcamentos({ quantidade: 3, valor_cents: 115_000 })).toBe('R$ 1.150');
    expect(textoCartaoAFaturar({ quantidade: 6, valor_cents: 398_900, aguardando_aprovacao: 1 })).toBe('6 · R$ 3.989 (1 aguardando aprovação)');
    expect(textoCartaoAFaturar({ quantidade: 5, valor_cents: 298_000, aguardando_aprovacao: 0 })).toBe('5 · R$ 2.980');
  });

  it('RD-0010: sem orçamento ou sem pedido a faturar o cartão diz só "nenhum" (sem R$ 0)', () => {
    expect(textoCartaoOrcamentos({ quantidade: 0, valor_cents: 0 })).toBe('nenhum');
    expect(textoCartaoAFaturar({ quantidade: 0, valor_cents: 0, aguardando_aprovacao: 0 })).toBe('nenhum');
    expect(textoCartaoOrcamentos({ quantidade: 3, valor_cents: 115_000 })).toBe('3 · R$ 1.150');
  });
});
