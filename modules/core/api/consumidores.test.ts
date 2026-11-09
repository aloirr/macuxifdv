/** T-0121 N2: o push do Expo sai por `ctx.aposConfirmar` (depois do commit), não dentro da transação do consumo. */
import type { ContextoAposConfirmar, ContextoConsumo } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { criarConsumidorPushNotificacao } from './consumidores';

const P = { notificacao_id: 'n1', usuario_id: 'u1', tipo: 'recado', prioridade: 'alta' } as never;

function montar(fetcher: typeof fetch) {
  const efeitos: ((c: ContextoAposConfirmar) => Promise<void>)[] = [];
  const queries: string[] = [];
  const db = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('from core.notificacao')) return { rows: [{ titulo: 'T', corpo: 'C', link: null, prioridade: 'alta', push_enviado_em: null, lida_em: null }] };
      if (sql.includes('from core.dispositivo')) return { rows: [{ push_token: 'ExponentPushToken[x]' }] };
      return { rows: [] };
    }),
  };
  const ctx = { db, agora: () => new Date('2026-11-09T10:00:00Z'), aposConfirmar: (e: never) => void efeitos.push(e) } as unknown as ContextoConsumo;
  const c = { comTenant: async (fn: (d: typeof db) => Promise<unknown>) => fn(db), agora: () => new Date('2026-11-09T10:00:00Z') } as unknown as ContextoAposConfirmar;
  const consumidor = criarConsumidorPushNotificacao({ env: { MACUXI_PUSH_ATIVO: '1' }, fetcher });
  return { consumidor, ctx, efeitos, c, queries };
}

describe('T-0121 N2: push depois do commit', () => {
  it('o handler não chama a rede; agenda o envio e só ele marca push_enviado_em', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    const { consumidor, ctx, efeitos, c, queries } = montar(fetcher as never);
    await consumidor.executar(P, ctx);
    expect(fetcher).not.toHaveBeenCalled();
    expect(efeitos).toHaveLength(1);
    await efeitos[0]!(c);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(queries.some((q) => q.includes('update core.notificacao set push_enviado_em') && q.includes('push_enviado_em is null'))).toBe(true);
  });

  it('Expo recusando faz o efeito lançar (o despachante desfaz o consumo) e não marca', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 503 }) as Response);
    const { consumidor, ctx, efeitos, c, queries } = montar(fetcher as never);
    await consumidor.executar(P, ctx);
    await expect(efeitos[0]!(c)).rejects.toThrow(/HTTP 503/);
    expect(queries.some((q) => q.includes('update core.notificacao'))).toBe(false);
  });

  it('flag desligada: nada agendado', async () => {
    const { ctx, efeitos } = montar(vi.fn() as never);
    await criarConsumidorPushNotificacao({ env: {} }).executar(P, ctx);
    expect(efeitos).toHaveLength(0);
  });
});
