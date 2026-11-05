import { ConsultaIndisponivel, type ClienteBanco } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { manifest } from '../manifest';
import { apurarPositivacaoDoStatus, regravarPositivacaoDoMes, STATUS_QUE_MUDAM_POSITIVACAO } from './consumidores-positivacao';
import { consumidorPedidoStatus } from './consumidores-pedido';
import { moduloApi } from './index';

const V = '0b000000-0000-4000-8000-000000000001';
const C1 = '0d000000-0000-4000-8000-000000000001';
const MANAUS = 'America/Manaus';

function ctxDe(consultar: unknown, gravados: string[] = []) {
  const sqls: string[] = [];
  const db: ClienteBanco = {
    query: async (sql: string) => {
      sqls.push(sql);
      if (sql.includes('to_char(data')) return { rows: gravados.map((dia) => ({ dia })) as never[], rowCount: gravados.length };
      if (sql.includes('insert into core.indicador_diario')) return { rows: [{ clientes_positivados: 1 }] as never[], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  return { ctx: { db, consultar } as never, sqls };
}
const pedido = { vendedor_id: V, criado_por: V, cliente_id: C1, emitido_em: '2026-11-10T14:00:00Z', aprovado_em: null, status: 'aprovado', total_cents: 100, frete_cents: null, cancelado_cents: null };

describe('RN-CORE-20/26: consumidor da positivação (T-0073)', () => {
  it('RN-CORE-20: o manifesto declara o consumo e o moduloApi registra o consumidor', () => {
    expect(manifest.consome).toContain('vendedor.pedido.status_alterado@1');
    expect(moduloApi.consumidores).toContain(consumidorPedidoStatus);
  });
  it('RN-CORE-20: só as transições que mudam a positivação disparam a apuração', async () => {
    const consultar = vi.fn();
    const { ctx } = ctxDe(consultar);
    const base = { pedido_id: C1, vendedor_id: V, de: null, alterado_em: '2026-11-10T14:00:00Z', autor_id: null, motivo: null };
    await apurarPositivacaoDoStatus({ ...base, para: 'na_fila' }, { ...(ctx as object), fuso: () => MANAUS } as never);
    expect(consultar).not.toHaveBeenCalled();
    expect(STATUS_QUE_MUDAM_POSITIVACAO).toEqual(expect.arrayContaining(['aprovado', 'faturado_total', 'cancelado']));
  });
  it('RN-CORE-26: grava o dia do pedido com o cliente (uma vez, mesmo com dois pedidos do cliente no dia)', async () => {
    const consultar = vi.fn().mockResolvedValue({ pedidos: [pedido, { ...pedido, emitido_em: '2026-11-10T15:00:00Z' }], faturamentos: [] });
    const { ctx, sqls } = ctxDe(consultar);
    expect(await regravarPositivacaoDoMes(ctx, { usuarioId: V, periodo: '2026-11', fuso: MANAUS })).toBe(1);
    expect(sqls.filter((s) => s.includes('insert into core.indicador_diario'))).toHaveLength(1);
  });
  it('RN-CORE-26: cancelamento do único pedido regrava o dia já gravado com lista vazia', async () => {
    const consultar = vi.fn().mockResolvedValue({ pedidos: [], faturamentos: [] });
    const { ctx, sqls } = ctxDe(consultar, ['2026-11-10']);
    expect(await regravarPositivacaoDoMes(ctx, { usuarioId: V, periodo: '2026-11', fuso: MANAUS })).toBe(1);
    expect(sqls.some((s) => s.includes('insert into core.indicador_diario'))).toBe(true);
  });
  it('RN-CORE-26: Vendedor desligado (ConsultaIndisponivel) não grava nem falha', async () => {
    const { ctx, sqls } = ctxDe(vi.fn().mockRejectedValue(new ConsultaIndisponivel('vendedor.pedidos_da_meta@1', 'vendedor')));
    expect(await regravarPositivacaoDoMes(ctx, { usuarioId: V, periodo: '2026-11', fuso: MANAUS })).toBe(0);
    expect(sqls).toHaveLength(0);
  });
});
