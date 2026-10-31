import { describe, expect, it } from 'vitest';
import { avaliarPedidoNoDesafio, candidatoDoDesafio, type DesafioVendas, type PedidoLido } from './desafio';
import { processarLote } from './xp';

const desafio: DesafioVendas = {
  id: 'D1',
  tenant_id: 'tenant-1',
  nome: 'Semana do Café',
  ativo: true,
  produto_ids: ['cafe-250', 'cafe-500'],
  vigencia_inicio: '2026-10-26',
  vigencia_fim: '2026-11-01',
  xp_por_unidade: 2,
  xp_max_por_pedido: 20,
};
const pedido = (extra: Partial<PedidoLido> = {}): PedidoLido => ({
  pedido_id: 'P1',
  tenant_id: 'tenant-1',
  vendedor_id: 'u1',
  criado_em: '2026-10-28T14:00:00Z',
  itens: [{ produto_id: 'cafe-250', quantidade: 3 }, { produto_id: 'outro', quantidade: 10 }],
  ...extra,
});

describe('RF-TRE-06: desafio de vendas ligado a campanha', () => {
  it('RF-TRE-06: XP = unidades dos itens da campanha × XP por unidade (3 × 2 = 6); itens fora da campanha não contam', () => {
    expect(avaliarPedidoNoDesafio(desafio, pedido())).toEqual({ elegivel: true, unidades: 3, pontos_base: 6 });
  });

  it('RF-TRE-06: soma itens repetidos e produtos diferentes da campanha', () => {
    const p = pedido({ itens: [{ produto_id: 'cafe-250', quantidade: 2 }, { produto_id: 'cafe-500', quantidade: 1 }, { produto_id: 'cafe-250', quantidade: 1 }] });
    expect(avaliarPedidoNoDesafio(desafio, p)).toMatchObject({ unidades: 4, pontos_base: 8 });
  });

  it('RF-TRE-06: o XP por pedido é limitado ao máximo do desafio (50 unidades × 2 → 20)', () => {
    expect(avaliarPedidoNoDesafio(desafio, pedido({ itens: [{ produto_id: 'cafe-500', quantidade: 50 }] }))).toMatchObject({ unidades: 50, pontos_base: 20 });
  });

  it('RF-TRE-06: pedido sem item da campanha não pontua', () => {
    expect(avaliarPedidoNoDesafio(desafio, pedido({ itens: [{ produto_id: 'outro', quantidade: 5 }] }))).toEqual({ elegivel: false, motivo: 'SEM_ITENS_DA_CAMPANHA' });
  });

  it('RF-TRE-06: vigência inclusiva nas duas pontas, no fuso do tenant (26/10 00:00 Manaus = 04:00Z)', () => {
    expect(avaliarPedidoNoDesafio(desafio, pedido({ criado_em: '2026-10-26T04:00:00Z' })).elegivel).toBe(true);
    expect(avaliarPedidoNoDesafio(desafio, pedido({ criado_em: '2026-10-26T03:59:00Z' }))).toEqual({ elegivel: false, motivo: 'FORA_DA_VIGENCIA' });
    expect(avaliarPedidoNoDesafio(desafio, pedido({ criado_em: '2026-11-02T03:59:00Z' })).elegivel).toBe(true); // ainda 01/11 em Manaus
    expect(avaliarPedidoNoDesafio(desafio, pedido({ criado_em: '2026-11-02T04:00:00Z' }))).toEqual({ elegivel: false, motivo: 'FORA_DA_VIGENCIA' });
  });

  it('RF-TRE-06: desafio inativo ou de outro tenant não pontua', () => {
    expect(avaliarPedidoNoDesafio({ ...desafio, ativo: false }, pedido())).toEqual({ elegivel: false, motivo: 'DESAFIO_INATIVO' });
    expect(avaliarPedidoNoDesafio(desafio, pedido({ tenant_id: 'tenant-2' }))).toEqual({ elegivel: false, motivo: 'OUTRO_TENANT' });
  });

  it('RF-TRE-06: quantidade inválida (zero, negativa) é ignorada', () => {
    expect(avaliarPedidoNoDesafio(desafio, pedido({ itens: [{ produto_id: 'cafe-250', quantidade: 0 }, { produto_id: 'cafe-500', quantidade: -2 }] }))).toEqual({ elegivel: false, motivo: 'SEM_ITENS_DA_CAMPANHA' });
  });

  it('RF-TRE-06: unidades fracionadas (kg) arredondam o XP para baixo — XP é inteiro', () => {
    const r = avaliarPedidoNoDesafio({ ...desafio, xp_por_unidade: 3 }, pedido({ itens: [{ produto_id: 'cafe-250', quantidade: 1.5 }] }));
    expect(r).toMatchObject({ unidades: 1.5, pontos_base: 4 });
  });

  it('RF-TRE-06: vira candidato de XP para o vendedor, na hora do pedido, com referência desafio:pedido', () => {
    expect(candidatoDoDesafio(desafio, pedido(), 'lanc-1')).toEqual({
      id: 'lanc-1',
      tenant_id: 'tenant-1',
      usuario_id: 'u1',
      origem: 'desafio_vendas',
      referencia_id: 'D1:P1',
      pontos_base: 6,
      ocorrido_em: '2026-10-28T14:00:00Z',
    });
    expect(candidatoDoDesafio(desafio, pedido({ itens: [] }), 'lanc-2')).toBeNull();
  });

  it('RF-TRE-06: o mesmo pedido entregue duas vezes (evento repetido) pontua uma vez só', () => {
    const c1 = candidatoDoDesafio(desafio, pedido(), 'lanc-1')!;
    const c2 = candidatoDoDesafio(desafio, pedido(), 'lanc-2')!;
    const r1 = processarLote([], [c1]);
    expect(r1.lancamentos).toHaveLength(1);
    const r2 = processarLote(r1.lancamentos, [c2]);
    expect(r2.lancamentos).toEqual([]);
    expect(r2.duplicados).toEqual([{ id: 'lanc-2', motivo: 'EVENTO' }]);
  });

  it('RF-TRE-06: dois desafios diferentes podem pontuar o mesmo pedido', () => {
    const outro = { ...desafio, id: 'D2' };
    const r = processarLote([], [candidatoDoDesafio(desafio, pedido(), 'a')!, candidatoDoDesafio(outro, pedido(), 'b')!]);
    expect(r.lancamentos).toHaveLength(2);
  });
});
