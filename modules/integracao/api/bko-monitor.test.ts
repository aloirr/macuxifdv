import { describe, expect, it } from 'vitest';
import { MonitorResumo, ResumoPedidosErp } from '../contracts';
import { rotaMonitor } from './bko-monitor';

/** Banco falso: responde só às consultas da fila de pedidos; o resto volta vazio. */
function montarCtx() {
  const db = {
    query: async (sql: string) => {
      if (/group by estado/.test(sql)) return { rows: [{ estado: 'pendente', n: 4 }, { estado: 'enviado', n: 2 }, { estado: 'rejeitado_erp', n: 1 }, { estado: 'integrado', n: 50 }] };
      if (/as presos/.test(sql)) return { rows: [{ presos: 3, retidos: 5, parados_desde: new Date('2026-11-14T13:05:00Z') }] };
      if (/group by entidade/.test(sql)) return { rows: [{ entidade: 'cliente', recebido_em: new Date('2026-11-10T09:00:00Z') }] };
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
    expect(r.ultima_carga_por_entidade).toEqual([{ entidade: 'cliente', recebido_em: '2026-11-10T09:00:00.000Z' }]);
    expect(r.resumo_pedidos).toEqual({ na_fila: 4, entregue_ao_conector: 2, rejeitado_pelo_erp: 1, presos_sem_retorno: 3, retidos_sem_mapeamento: 5, parados_desde: '2026-11-14T13:05:00.000Z' });
    expect(ResumoPedidosErp.safeParse(r.resumo_pedidos).success).toBe(true);
    expect(MonitorResumo.safeParse(r).success).toBe(true);
  });

  it('RD-0963, RD-1567: o monitor devolve só o que alguma tela lê (lotes da tela e os 5 números dos cards)', async () => {
    const r = (await rotaMonitor.executar(montarCtx() as never)) as unknown as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(['gerado_em', 'lotes_recentes', 'resumo_pedidos', 'ultima_carga_por_entidade']);
    expect(Object.keys(MonitorResumo.shape).sort()).toEqual(['gerado_em', 'lotes_recentes', 'resumo_pedidos', 'ultima_carga_por_entidade']);
  });
});
