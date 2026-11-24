import { describe, expect, it } from 'vitest';
import { MonitorDetalhes, MonitorResumo, ResumoPedidosErp } from '../contracts';
import { rotaMonitor, rotaMonitorDetalhes } from './bko-monitor';

/** Banco falso: responde só às consultas da fila de pedidos; o resto volta vazio. */
function montarCtx() {
  const db = {
    query: async (sql: string) => {
      if (/group by estado/.test(sql)) return { rows: [{ estado: 'pendente', n: 4 }, { estado: 'enviado', n: 2 }, { estado: 'rejeitado_erp', n: 1 }, { estado: 'integrado', n: 50 }] };
      if (/versao_conector from integracao.conector/.test(sql)) return { rows: [{ conector_id: 'erp-matriz', versao_conector: '1.4.2' }] };
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
  it('RN-INT-08: resumo_pedidos traz os números calculados pela API (fila, conector, rejeitado, presos, retidos, parados_desde) e a última carga por entidade', async () => {
    const r = (await rotaMonitor.executar(montarCtx() as never)) as MonitorResumo;
    expect(r.ultima_carga_por_entidade).toEqual([{ entidade: 'cliente', recebido_em: '2026-11-10T09:00:00.000Z' }]);
    expect(r.resumo_pedidos).toEqual({ na_fila: 4, entregue_ao_conector: 2, rejeitado_pelo_erp: 1, presos_sem_retorno: 3, retidos_sem_mapeamento: 5, parados_desde: '2026-11-14T13:05:00.000Z' });
    expect(ResumoPedidosErp.safeParse(r.resumo_pedidos).success).toBe(true);
    expect(MonitorResumo.safeParse(r).success).toBe(true);
  });

  it('RD-0963, RD-1567: o monitor devolve só o que alguma tela lê (lotes da tela, a versão de cada Conector, a última carga por entidade e o resumo dos cards)', async () => {
    const r = (await rotaMonitor.executar(montarCtx() as never)) as unknown as Record<string, unknown>;
    const chaves = ['conectores', 'gerado_em', 'lotes_recentes', 'resumo_pedidos', 'ultima_carga_por_entidade'];
    expect(Object.keys(r).sort()).toEqual(chaves);
    expect(Object.keys(MonitorResumo.shape).sort()).toEqual(chaves);
  });

  it('RF-INT-04: o monitor traz a versão instalada de cada Conector para o cabeçalho da tela', async () => {
    const r = (await rotaMonitor.executar(montarCtx() as never)) as MonitorResumo;
    expect(r.conectores).toEqual([{ conector_id: 'erp-matriz', versao_conector: '1.4.2' }]);
  });
});

describe('Monitor no portal (desenho empresa-zerar §6.4, ADR 0029)', () => {
  it('ADR 0029: o monitor aceita o super-admin e o detalhe é só dele', () => {
    expect(rotaMonitor.superAdmin).toBe('aceita');
    expect(rotaMonitorDetalhes.superAdmin).toBe('exige');
    expect(rotaMonitorDetalhes.caminho).toBe('monitor/detalhes');
    expect(rotaMonitorDetalhes.metodo).toBe('GET');
  });

  it('RF-INT-04: o detalhe junta cursor, registros, último lote, erros por código e lotes reprocessáveis, sempre filtrando pelo tenant', async () => {
    const L1 = '0b7e6c52-1c1c-4b43-9d1e-0a4f0f3a0001';
    const params: unknown[][] = [];
    const db = {
      query: async (sql: string, p: unknown[]) => {
        params.push(p);
        if (/sinal_resumo/.test(sql))
          return { rows: [{ conector_id: 'erp-1', tipo: 'conector', ativo: true, entidades: ['cliente'], versao_conector: '1.6.0', ultimo_sinal_em: new Date('2026-11-23T14:59:30Z'), parado_por_versao: false, sinal_resumo: { fila: [], entidades: [] } }] };
        if (/from integracao\.cursor_entidade/.test(sql)) return { rows: [{ conector_id: 'erp-1', entidade: 'cliente', alterado_em: new Date('2026-11-23T14:00:00Z'), external_id: 'C9', atualizado_em: new Date('2026-11-23T14:01:00Z') }] };
        if (/from integracao\.registro_atual/.test(sql)) return { rows: [{ entidade: 'cliente', ativos: 10, inativos: 1 }] };
        if (/from integracao\.lote_linha_erro/.test(sql)) return { rows: [{ entidade: 'cliente', codigo: 'referencia_ausente', reprocessavel: true, linhas: 3 }] };
        if (/tem_conteudo/.test(sql))
          return { rows: [{ lote_id: L1, conector_id: 'erp-1', entidade: 'cliente', modo: 'delta', status: 'falhou', recebido_em: new Date('2026-11-23T10:00:00Z'), concluido_em: null, tem_conteudo: true }] };
        return { rows: [] };
      },
    };
    const ctx = { ...montarCtx(), superAdmin: { id: 'sa', sessao_id: 's' }, agora: () => new Date('2026-11-23T15:00:00Z'), comTenant: async (fn: (d: unknown, t: unknown) => unknown) => fn(db, {}) };
    const r = (await rotaMonitorDetalhes.executar(ctx as never)) as MonitorDetalhes;
    expect(MonitorDetalhes.safeParse(r).success).toBe(true);
    expect(r.entidades).toEqual([
      {
        entidade: 'cliente',
        cursores: [{ conector_id: 'erp-1', alterado_em: '2026-11-23T14:00:00.000Z', external_id: 'C9', atualizado_em: '2026-11-23T14:01:00.000Z' }],
        registros: { ativos: 10, inativos: 1 },
        ultimo_lote: { lote_id: L1, conector_id: 'erp-1', modo: 'delta', status: 'falhou', recebido_em: '2026-11-23T10:00:00.000Z', concluido_em: null },
        erros: [{ codigo: 'referencia_ausente', classe: 'reprocessavel', linhas: 3 }],
        lotes_reprocessaveis: [L1],
      },
    ]);
    expect(r.conectores[0]).toMatchObject({ conector_id: 'erp-1', saude: 'ok', sinal: { fila: [], entidades: [], atualizacao: null } });
    expect(params.every((p) => p[0] === 't1')).toBe(true);
  });
});
