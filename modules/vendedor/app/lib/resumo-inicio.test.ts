import { describe, expect, it } from 'vitest';
import type { PedidoDaLista } from './pedidos';
import { linhaAFaturar, linhaOrcamentos, orcamentosEmAberto, resumoDoInicio } from './resumo-inicio';

const AGORA = new Date('2026-11-04T18:00:00.000Z');
const ped = (o: Partial<PedidoDaLista>): PedidoDaLista => ({ id: 'x', seller_id: 'v1', status: 'approved', total_cents: 1000, received_at: '2026-11-04T12:00:00.000Z', local: false, local_error: '', ...o }) as PedidoDaLista;
const base = { agora: AGORA, fuso: 'America/Manaus', diasValidade: 7, vendedorId: 'v1', preVendaLigada: true };

describe('T-0076: resumo do Início no aparelho', () => {
  it('RN-VEN-18: validade_data no fuso do tenant decide quem vence amanhã (04/11 em Manaus)', () => {
    const r = resumoDoInicio([ped({ tipo: 'orcamento', status: 'received', validade_data: '2026-11-05', total_cents: 115_000 })], base);
    expect(r.orcamentos).toEqual({ quantidade: 1, valor_cents: 115_000, vencem_amanha: 1 });
  });

  it('escopo da carteira: pedido de outro vendedor não entra', () => {
    const r = resumoDoInicio([ped({ seller_id: 'v2' }), ped({})], base);
    expect(r.aFaturar.quantidade).toBe(1);
  });

  it('pré-venda desligada no tenant: sem card de orçamentos', () => {
    expect(resumoDoInicio([], { ...base, preVendaLigada: false }).orcamentos).toBeNull();
  });

  it('orçamento ainda na fila usa a validade pela criação + dias do parâmetro', () => {
    const r = resumoDoInicio([ped({ tipo: 'orcamento', status: 'queued', local: true, received_at: '2026-10-29T15:00:00.000Z' })], { ...base, diasValidade: 7 });
    expect(r.orcamentos?.quantidade).toBe(1);
  });

  it('RN-VEN-18: lista vinda do card = contagem do card (vencido e cancelado ficam de fora)', () => {
    const lista = [
      ped({ id: 'a', tipo: 'orcamento', status: 'received', validade_data: '2026-11-05' }),
      ped({ id: 'b', tipo: 'orcamento', status: 'received', validade_data: '2026-11-01' }),
      ped({ id: 'c', tipo: 'orcamento', status: 'cancelled', validade_data: '2026-11-20' }),
      ped({ id: 'd', tipo: 'orcamento', status: 'received', validade_data: '2026-11-20', convertido_pedido_id: 'p9' }),
      ped({ id: 'e', tipo: 'orcamento', status: 'received', validade_data: '2026-11-20' }),
      ped({ id: 'f' }),
    ];
    const abertos = orcamentosEmAberto(lista, base);
    expect(abertos.map((p) => p.id)).toEqual(['a', 'e']);
    expect(abertos.length).toBe(resumoDoInicio(lista, base).orcamentos?.quantidade);
  });

  it('textos dos cards: valor sem centavos e o destaque do que pede atenção', () => {
    expect(linhaOrcamentos({ quantidade: 3, valor_cents: 115_000, vencem_amanha: 1 })).toBe('R$ 1.150 · 1 vence amanhã');
    expect(linhaOrcamentos({ quantidade: 3, valor_cents: 115_000, vencem_amanha: 2 })).toBe('R$ 1.150 · 2 vencem amanhã');
    expect(linhaOrcamentos({ quantidade: 3, valor_cents: 115_000, vencem_amanha: 0 })).toBe('R$ 1.150');
    expect(linhaAFaturar({ quantidade: 5, valor_cents: 298_000, aguardando_aprovacao: 1 })).toBe('R$ 2.980 · 1 aguardando aprovação');
    expect(linhaAFaturar({ quantidade: 5, valor_cents: 298_000, aguardando_aprovacao: 0 })).toBe('R$ 2.980');
  });
});
