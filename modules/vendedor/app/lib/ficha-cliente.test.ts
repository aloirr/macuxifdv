import { describe, expect, it } from 'vitest';
import { CreateOrderRequest } from '../../contracts';
import { manifest } from '../../manifest';
import { ligarRascunho, montarPedido, rascunhoVazio, somarAoRascunho, ultimosPedidosDoCliente, type PedidoDaLista } from './pedidos';

const ped = (id: string, customer_id: string, received_at: string) => ({ id, customer_id, received_at }) as PedidoDaLista;

describe('ficha do cliente (slots cliente.abas / cliente.acoes)', () => {
  it('RN-PRO-01: as ações registradas na ficha exigem pedido.criar, que o promotor não tem', () => {
    expect(manifest.acoes['pedido.criar']!.perfis).not.toContain('promotor');
    expect(manifest.usaExtensoes).toEqual(expect.arrayContaining(['cliente.abas', 'cliente.acoes']));
  });

  it('últimos pedidos: só do cliente, mais recentes primeiro, no máximo 3', () => {
    const r = ultimosPedidosDoCliente('c1', [ped('a', 'c1', '2026-10-01'), ped('b', 'c2', '2026-10-09'), ped('c', 'c1', '2026-10-05'), ped('d', 'c1', '2026-10-03'), ped('e', 'c1', '2026-10-07')]);
    expect(r.map((o) => o.id)).toEqual(['e', 'c', 'd']);
  });

  it('mix: adicionar soma 1 unidade e preserva as outras linhas', () => {
    const r = somarAoRascunho(somarAoRascunho({ ...rascunhoVazio('c1'), lines: { p9: 4 } }, 'p1'), 'p1');
    expect(r.lines).toEqual({ p9: 4, p1: 2 });
  });

  it('novo pedido pela ficha: liga visita e parada sem sobrescrever ligação existente', () => {
    const base = rascunhoVazio('c1');
    expect(ligarRascunho(base, 'v1', 's1')).toMatchObject({ visit_id: 'v1', route_stop_id: 's1' });
    expect(ligarRascunho({ ...base, visit_id: 'v0', route_stop_id: 's0' }, null, 's9')).toMatchObject({ visit_id: 'v0', route_stop_id: 's0' });
    expect(ligarRascunho(base, null, null)).toBe(base);
  });

  it('pedido na fila leva total_cents para o core mostrar o total na visita', () => {
    const v = { totals: { total_cents: 12345, lines: [{ product_id: 'p1', quantity: 2 }] } } as never;
    const p = montarPedido({ id: '11111111-1111-4111-8111-111111111111', cliente: { id: 'c1' } as never, rascunho: rascunhoVazio('c1'), v, semSinal: false, agora: '2026-10-31T10:00:00Z' });
    expect(p.total_cents).toBe(12345);
    expect(CreateOrderRequest.parse(p).total_cents).toBe(12345);
  });
});
