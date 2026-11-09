/**
 * T-0077 item 6 (RF-VEN-05): a listagem de pedidos aceita período (from/to no fuso do tenant) e, com `por_status=1`, traz também
 * o que mudou de status nele; o escopo (carteira/equipe) e o 403 do promotor com `promotor_ve_pedidos` desligado valem igual.
 * Sem banco: contexto falso que registra as consultas. A conferência do filtro de datas com Postgres real fica no CI (pedido.db.test.ts).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ContextoBase, ContextoRota } from '@macuxi/platform-sdk';
import { OrderListQuery } from '../contracts';
import { usarOpcaoPromotorVePedidos } from './opcao-promotor';
import { rotaListarPedidos } from './pedidos';

const C1 = '0c100000-0000-4000-8000-000000000001';

function contexto(perfil: string, query: unknown) {
  const consultas: Array<{ sql: string; valores: unknown[] }> = [];
  let aberturas = 0;
  const db = {
    query: async (sql: string, valores: unknown[] = []) => {
      consultas.push({ sql, valores });
      return { rows: [] };
    },
  };
  const ctx = {
    usuario: { id: 'u-1', tenant_id: 't-1', perfil, modulos: ['vendedor'] },
    query: OrderListQuery.parse(query),
    params: {},
    corpo: {},
    agora: () => new Date('2026-11-04T12:00:00Z'),
    fuso: () => 'America/Manaus',
    parametros: () => ({}),
    usuariosVisiveis: async () => new Set(['u-1', 'u-2']),
    carteira: async () => new Set([C1]),
    comTenant: async (fn: (d: typeof db, tx: unknown) => Promise<unknown>) => {
      aberturas++;
      return fn(db, { consultar: async () => ({ ligado: true }) });
    },
  } as unknown as ContextoBase & ContextoRota;
  return { ctx, consultas, aberturas: () => aberturas };
}

let restaurar: (() => void) | null = null;
afterEach(() => {
  restaurar?.();
  restaurar = null;
});

describe('RF-VEN-05: consulta ao servidor por período (fora da janela de 90 dias do aparelho)', () => {
  it('o contrato aceita from, to e por_status; valor fora de 0/1 é recusado', () => {
    expect(OrderListQuery.parse({ from: '2025-01-01', to: '2025-12-31', por_status: '1' })).toMatchObject({ from: '2025-01-01', to: '2025-12-31', por_status: '1' });
    expect(OrderListQuery.safeParse({ por_status: 'sim' }).success).toBe(false);
  });

  it('o período e o fuso do tenant vão para a consulta; por_status liga a regra "emitido OU mudou de status"', async () => {
    const { ctx, consultas } = contexto('vendedor', { from: '2025-01-01', to: '2025-12-31', por_status: '1', tipo: 'todos' });
    expect(await rotaListarPedidos.executar(ctx as never)).toEqual({ itens: [], proximo_cursor: null });
    const v = consultas[0]!.valores;
    expect(v[5]).toBe('2025-01-01');
    expect(v[6]).toBe('2025-12-31');
    expect(v[9]).toBe('America/Manaus');
    expect(v[14]).toBe(true);
    const sql = consultas[0]!.sql;
    expect(sql).toMatch(/exists \(select 1 from vendedor\.pedido_evento ev/);
    expect(sql).toMatch(/ev\.de is not null/);
    expect(sql).toMatch(/ev\.ocorrido_em >= \(\$6::date\)::timestamp at time zone \$10/);
    expect(sql).toMatch(/ev\.ocorrido_em < \(\(\$7::date\) \+ 1\)::timestamp at time zone \$10/);
    expect(sql).toMatch(/\$15::boolean/);
    expect(sql).not.toMatch(/p\.updated_at >= /);
  });

  it('sem por_status só vale a data de emissão', async () => {
    const { ctx, consultas } = contexto('vendedor', { from: '2025-01-01', to: '2025-12-31' });
    await rotaListarPedidos.executar(ctx as never);
    expect(consultas[0]!.valores[14]).toBe(false);
  });

  it('RN-CORE-04: vendedor/supervisor consultam por usuários visíveis; promotor pela carteira (nunca por vendedor)', async () => {
    const v = contexto('supervisor', { from: '2025-01-01' });
    await rotaListarPedidos.executar(v.ctx as never);
    expect(v.consultas[0]!.valores[0]).toEqual(['u-1', 'u-2']);
    expect(v.consultas[0]!.valores[1]).toBeNull();
    restaurar = usarOpcaoPromotorVePedidos(() => true);
    const p = contexto('promotor', { from: '2025-01-01' });
    await rotaListarPedidos.executar(p.ctx as never);
    expect(p.consultas[0]!.valores[0]).toBeNull();
    expect(p.consultas[0]!.valores[1]).toEqual([C1]);
  });

  it('RN-PRO-01 / O-3: promotor com promotor_ve_pedidos desligado recebe 403 também na consulta por período, sem abrir transação', async () => {
    restaurar = usarOpcaoPromotorVePedidos(() => false);
    const { ctx, aberturas } = contexto('promotor', { from: '2025-01-01', to: '2025-12-31', por_status: '1' });
    await expect(rotaListarPedidos.executar(ctx as never)).rejects.toMatchObject({ status: 403, codigo: 'RN-PRO-01' });
    expect(aberturas()).toBe(0);
  });

  it('a rota exige pedido.ver e continua sob a licença do módulo (rota do plugin /v1/vendedor)', () => {
    expect(rotaListarPedidos.acao).toBe('pedido.ver');
    expect(rotaListarPedidos.caminho).toBe('pedidos');
  });
});
