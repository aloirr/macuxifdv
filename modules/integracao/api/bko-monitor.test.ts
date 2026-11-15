import { describe, expect, it } from 'vitest';
import { MonitorResumo, ResumoPedidosErp } from '../contracts';
import { rotaMonitor } from './bko-monitor';

/** Banco falso: responde só às consultas da fila de pedidos; o resto volta vazio. */
function montarCtx() {
  const db = {
    query: async (sql: string) => {
      if (/group by estado/.test(sql)) return { rows: [{ estado: 'pendente', n: 4 }, { estado: 'enviado', n: 2 }, { estado: 'rejeitado_erp', n: 1 }, { estado: 'integrado', n: 50 }] };
      if (/estado = 'enviado' and tentativas/.test(sql)) return { rows: [{ pedido_uuid: 'a' }, { pedido_uuid: 'b' }, { pedido_uuid: 'c' }] };
      if (/retencao_codigo is not null/.test(sql)) return { rows: Array.from({ length: 5 }, (_, i) => ({ pedido_uuid: `r${i}`, retencao_mensagem: null })) };
      return { rows: [] };
    },
  };
  return {
    usuario: { id: 'u1', tenant_id: 't1', perfil: 'analista' },
    parametros: () => ({}),
    agora: () => new Date('2026-11-15T18:00:00Z'),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    comTenant: async (fn: (d: unknown, t: unknown) => unknown) => fn(db, {}),
  };
}

describe('GET /integracao/monitor: resumo_pedidos (T-0173)', () => {
  it('RN-INT-08: resumo_pedidos traz os 5 números calculados pela API (fila, conector, rejeitado, presos, retidos)', async () => {
    const r = (await rotaMonitor.executar(montarCtx() as never)) as MonitorResumo;
    expect(r.resumo_pedidos).toEqual({ na_fila: 4, entregue_ao_conector: 2, rejeitado_pelo_erp: 1, presos_sem_retorno: 3, retidos_sem_mapeamento: 5 });
    expect(ResumoPedidosErp.safeParse(r.resumo_pedidos).success).toBe(true);
    expect(MonitorResumo.safeParse(r).success).toBe(true);
  });

  it('RD-0963: os 5 números só existem em resumo_pedidos (sem o bloco repetido `pedidos`)', async () => {
    const r = (await rotaMonitor.executar(montarCtx() as never)) as unknown as Record<string, unknown>;
    expect(r).not.toHaveProperty('pedidos');
    expect(Object.keys(MonitorResumo.shape)).not.toContain('pedidos');
  });
});
