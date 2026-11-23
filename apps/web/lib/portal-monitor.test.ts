/**
 * Seção "Monitor" da aba Integração no portal (desenho empresa-zerar.md §6.4): o cliente do painel no portal, o texto das células do
 * detalhe, quais entidades têm o "Zerar dados" e o monitor falso (contratos do módulo, só super-admin, zerar e reprocessar).
 */
import { ErrosLoteResposta, MonitorDetalhes, MonitorResumo, type EntidadeDetalhe } from '@macuxi/integracao/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { limparMonitorFalso, responderMonitorFalso } from './portal-falso-monitor';
import { limparZerarFalso, responderZerarFalso } from './portal-falso-zerar';
import { clienteDoPortal, INTERVALO_MONITOR_PORTAL_MS, SAUDE_DO_CONECTOR, temDadosNoHub, textoCorrigirNoErp, textoCursor, textoFila, textoRegistros } from './portal-monitor';

const T = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const detalhe = (x: Partial<EntidadeDetalhe> = {}): EntidadeDetalhe => ({
  entidade: 'estoque',
  cursores: [],
  registros: { ativos: 0, inativos: 0 },
  ultimo_lote: null,
  erros: [],
  lotes_reprocessaveis: [],
  ...x,
});

describe('cliente do painel no portal', () => {
  it('chamarPortal com o tenant, método, corpo e query; escopo por empresa e intervalo próprio', async () => {
    const chamar = vi.fn(async () => 'ok' as never);
    const c = clienteDoPortal(T, true, chamar);
    expect([c.escopo, c.ativo, c.intervaloMs]).toEqual([`portal:${T}`, true, INTERVALO_MONITOR_PORTAL_MS]);
    await c.chamar('/integracao/lotes/x/reprocessar', { method: 'POST', body: {}, query: { pagina: 1 } });
    expect(chamar).toHaveBeenCalledWith('/integracao/lotes/x/reprocessar', { metodo: 'POST', corpo: {}, query: { pagina: 1 }, tenant: T });
  });
});

describe('detalhe por entidade e Conector', () => {
  it('"Zerar dados" em toda entidade com dados no Hub (registro, cursor ou lote); sem dados, sem menu', () => {
    expect(temDadosNoHub(detalhe({ registros: { ativos: 3, inativos: 0 } }))).toBe(true);
    expect(temDadosNoHub(detalhe({ cursores: [{ conector_id: 'erp', alterado_em: null, external_id: null, atualizado_em: '2026-11-23T12:00:00.000Z' }] }))).toBe(true);
    expect(temDadosNoHub(detalhe())).toBe(false);
    const lote = { lote_id: '0b6f0c3e-0001-4a00-8000-000000000001', conector_id: 'erp', modo: 'delta' as const, status: 'concluido' as const, recebido_em: '2026-11-23T12:00:00.000Z', concluido_em: null };
    expect(temDadosNoHub(detalhe({ registros: { ativos: 3, inativos: 0 }, ultimo_lote: lote }))).toBe(true);
  });
  it('textos: registros, cursor no fuso, "Corrigir no ERP" (só a classe corrigir_no_erp), fila e saúde', () => {
    expect(textoRegistros({ ativos: 1180, inativos: 60 })).toBe('1.180 ativos · 60 inativos');
    expect(textoRegistros({ ativos: 5, inativos: 0 })).toBe('5 ativos');
    expect(textoRegistros({ ativos: 0, inativos: 0 })).toBe('—');
    const cursor = (alterado_em: string | null) => ({ conector_id: 'erp', alterado_em, external_id: null, atualizado_em: '2026-11-23T12:00:00.000Z' });
    expect(textoCursor([cursor('2026-11-23T12:00:00.000Z'), cursor('2026-11-23T15:30:00.000Z'), cursor(null)], 'America/Manaus')).toBe('23/11 às 11:30');
    expect(textoCursor([], 'America/Manaus')).toBe('—');
    expect(
      textoCorrigirNoErp([
        { codigo: 'referencia_ausente', classe: 'reprocessavel', linhas: 12 },
        { codigo: 'campo_obrigatorio', classe: 'corrigir_no_erp', linhas: 3 },
        { codigo: 'tipo_invalido', classe: 'corrigir_no_erp', linhas: 1 },
      ]),
    ).toBe('4 · campo_obrigatorio, tipo_invalido');
    expect(textoCorrigirNoErp([{ codigo: 'referencia_ausente', classe: 'reprocessavel', linhas: 12 }])).toBe('—');
    expect(textoCorrigirNoErp([])).toBe('—');
    expect(textoFila(null)).toBe('—');
    expect(textoFila({ fila: [], entidades: [] })).toBe('Vazia');
    expect(textoFila({ fila: [{ estado: 'pendente', lotes: 1, linhas: 1, maisAntigo: null }], entidades: [] })).toBe('1 lote · 1 linha');
    expect(SAUDE_DO_CONECTOR.sem_sinal).toEqual({ rotulo: 'Sem sinal', tom: 'danger' });
  });
});

describe('monitor falso', () => {
  const ler = async (r: Response) => ({ status: r.status, corpo: (await r.json()) as unknown });
  beforeEach(() => {
    limparZerarFalso();
    limparMonitorFalso();
    vi.useFakeTimers({ now: new Date('2026-11-23T12:00:00.000Z') });
  });
  afterEach(() => vi.useRealTimers());

  it('monitor e detalhes nos contratos; Estoque e Títulos com dados e sem lote; o admin do cliente recebe 403', async () => {
    const m = MonitorResumo.parse((await ler(responderMonitorFalso('GET', '/integracao/monitor', T, true))).corpo);
    expect(new Set(m.lotes_recentes.map((l) => l.entidade))).toEqual(new Set(['produto', 'cliente', 'cliente_endereco', 'preco', 'vendedor']));
    const d = MonitorDetalhes.parse((await ler(responderMonitorFalso('GET', '/integracao/monitor/detalhes', T, true))).corpo);
    expect(d.entidades.filter((x) => x.ultimo_lote === null && temDadosNoHub(x)).map((x) => x.entidade)).toEqual(['estoque', 'titulo']);
    expect(d.conectores.map((c) => [c.conector_id, c.saude])).toEqual([['erp', 'ok']]);
    expect((await ler(responderMonitorFalso('GET', '/integracao/monitor/detalhes', T, false))).status).toBe(403);
  });
  it('reprocessar: o lote com falha passa a concluído; erros do lote paginados no contrato', async () => {
    const id = '0b6f0c3e-0001-4a00-8000-000000000001';
    const e = ErrosLoteResposta.parse((await ler(responderMonitorFalso('GET', `/integracao/lotes/${id}/erros?pagina=1`, T, true))).corpo);
    expect(e.total).toBe(15);
    expect((await ler(responderMonitorFalso('POST', `/integracao/lotes/${id}/reprocessar`, T, true))).status).toBe(200);
    const m = MonitorResumo.parse((await ler(responderMonitorFalso('GET', '/integracao/monitor', T, true))).corpo);
    expect(m.lotes_recentes.find((l) => l.lote_id === id)?.status).toBe('concluido');
    expect((await ler(responderMonitorFalso('POST', `/integracao/lotes/${id}/reprocessar`, T, true))).status).toBe(409);
  });
  it('depois de zerar Clientes: sem os lotes nem os registros de Clientes e Endereços', async () => {
    const empresa = { id: T, codigo: 'AM2290', status: 'ativo', backupEmAndamento: false };
    responderZerarFalso('POST', empresa, false, { id: '7c0d5e1a-2b4f-4c6d-8e9f-000000000003', codigo_confirmacao: 'AM2290', senha: 'x', entidades: ['cliente'] });
    vi.advanceTimersByTime(6_000);
    const m = MonitorResumo.parse((await ler(responderMonitorFalso('GET', '/integracao/monitor', T, true))).corpo);
    expect(m.lotes_recentes.some((l) => l.entidade === 'cliente' || l.entidade === 'cliente_endereco')).toBe(false);
    const d = MonitorDetalhes.parse((await ler(responderMonitorFalso('GET', '/integracao/monitor/detalhes', T, true))).corpo);
    expect(d.entidades.find((x) => x.entidade === 'cliente')?.registros).toEqual({ ativos: 0, inativos: 0 });
    expect(d.entidades.find((x) => x.entidade === 'cliente')?.cursores).toEqual([]);
  });
});
