/**
 * Monitor da empresa no portal (desenho empresa-zerar.md §6.4; R-20261124-090510): o cliente no portal, o texto das células do
 * Conector e da aba Dados, a Situação, quais entidades têm o "Zerar dados", o "Reprocessar" da entidade e o monitor falso (contratos
 * do módulo, só super-admin, zerar e reprocessar).
 */
import { ErrosLoteResposta, MonitorDetalhes, MonitorResumo, type ConectorResumo, type EntidadeDetalhe } from '@macuxi/integracao/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { limparMonitorFalso, responderMonitorFalso } from './portal-falso-monitor';
import { limparZerarFalso, responderZerarFalso } from './portal-falso-zerar';
import {
  celulasDaEntidade,
  clienteDoPortal,
  INTERVALO_MONITOR_PORTAL_MS,
  reprocessarEntidade,
  SAUDE_DO_CONECTOR,
  situacaoDaEntidade,
  temDadosNoHub,
  textoCorrigirNoErp,
  textoCursor,
  textoDoReprocesso,
  textoFila,
  textoRegistros,
} from './portal-monitor';

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
  it('linha da aba Dados (RD-2678): sem dados, todas vazias (o "Sem dados" fica no selo); com dados, o "—" de cada célula e a carga no fuso', () => {
    expect(celulasDaEntidade(detalhe(), 'America/Manaus')).toEqual({ carga: '', registros: '', cursor: '', corrigir: '' });
    const cursor = { conector_id: 'erp', alterado_em: null, external_id: null, atualizado_em: '2026-11-23T12:00:00.000Z' };
    expect(celulasDaEntidade(detalhe({ cursores: [cursor] }), 'America/Manaus')).toEqual({ carga: '—', registros: '—', cursor: '—', corrigir: '—' });
    expect(celulasDaEntidade(detalhe({ registros: { ativos: 5, inativos: 0 } }), 'America/Manaus')).toEqual({ carga: '—', registros: '5 ativos', cursor: '—', corrigir: '—' });
    const lote = { lote_id: '0b6f0c3e-0001-4a00-8000-000000000001', conector_id: 'erp', modo: 'delta' as const, status: 'concluido' as const, recebido_em: '2026-11-23T15:30:00.000Z', concluido_em: null };
    expect(celulasDaEntidade(detalhe({ ultimo_lote: lote }), 'America/Manaus').carga).toBe('23/11 às 11:30');
  });
  it('Situação: "Com falha" com lote a reprocessar (lista da API) ou erro a corrigir no ERP, "Em dia" com lote, "Sem dados" sem nada no Hub, sem selo com dados e sem lote', () => {
    const lote = { lote_id: '0b6f0c3e-0001-4a00-8000-000000000001', conector_id: 'erp', modo: 'delta' as const, status: 'falhou' as const, recebido_em: '2026-11-23T15:30:00.000Z', concluido_em: null };
    expect(situacaoDaEntidade(detalhe({ ultimo_lote: lote, lotes_reprocessaveis: [lote.lote_id] }))).toEqual({ rotulo: 'Com falha', tom: 'danger' });
    expect(situacaoDaEntidade(detalhe({ ultimo_lote: { ...lote, status: 'concluido' } }))).toEqual({ rotulo: 'Em dia', tom: 'success' });
    const corrigir = { codigo: 'campo_obrigatorio' as const, classe: 'corrigir_no_erp' as const, linhas: 3 };
    expect(situacaoDaEntidade(detalhe({ ultimo_lote: { ...lote, status: 'concluido' }, erros: [corrigir] }))).toEqual({ rotulo: 'Com falha', tom: 'danger' });
    expect(situacaoDaEntidade(detalhe())).toEqual({ rotulo: 'Sem dados', tom: 'neutral' });
    expect(situacaoDaEntidade(detalhe({ registros: { ativos: 5, inativos: 0 } }))).toBeNull();
  });
  it('Reprocessar a entidade (RN-INT-15): um lote de cada vez, na ordem da API; o recusado não para os outros; o aviso diz quantos', async () => {
    const chamadas: string[] = [];
    const chamar = vi.fn(async (caminho: string) => {
      chamadas.push(caminho);
      if (caminho.includes('/b/')) throw new Error('expirado');
      return { lote_id: caminho.includes('/a/') ? '0b6f0c3e-0001-4a00-8000-00000000000a' : '0b6f0c3e-0001-4a00-8000-00000000000c', reenfileiradas: 1, status: 'recebido' } as never;
    });
    const r = await reprocessarEntidade({ chamar }, ['a', 'b', 'c']);
    expect(chamadas).toEqual(['/integracao/lotes/a/reprocessar', '/integracao/lotes/b/reprocessar', '/integracao/lotes/c/reprocessar']);
    expect(chamar).toHaveBeenCalledWith('/integracao/lotes/a/reprocessar', { method: 'POST', body: {} });
    expect(r.feitos).toBe(2);
    const msg = (e: unknown) => (e as Error).message;
    expect(textoDoReprocesso(r, msg)).toBe('2 de 3 lotes reprocessados. expirado');
    expect(textoDoReprocesso({ feitos: 0, erros: [new Error('fora')] }, msg)).toBe('Nenhum lote reprocessado. fora');
    expect(textoDoReprocesso({ feitos: 1, erros: [] }, msg)).toBe('Reprocessamento iniciado.');
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
    expect(new Set(m.lotes_recentes.map((l) => l.entidade))).toEqual(new Set(['produto', 'cliente', 'cliente_endereco', 'preco', 'vendedor', 'forma_pagamento']));
    const d = MonitorDetalhes.parse((await ler(responderMonitorFalso('GET', '/integracao/monitor/detalhes', T, true))).corpo);
    expect(d.entidades.filter((x) => x.ultimo_lote === null && temDadosNoHub(x)).map((x) => x.entidade)).toEqual(['estoque', 'titulo']);
    expect(d.conectores).toEqual([]);
    // os Conectores do detalhe são os da lista do falso (a mesma da aba Integração)
    const erp: ConectorResumo = {
      id: '7c1d2e3f-4a5b-4c6d-8e9f-000000000001',
      conector_id: 'erp',
      nome: 'Conector do ERP',
      tipo: 'conector',
      ativo: false,
      recebe_pedidos: true,
      aceita_cancelamento: false,
      entidades: [],
      ips_permitidos: [],
      versao_conector: null,
      situacao_versao: 'sem_politica',
      ultimo_sinal_em: null,
      saude: 'desativado',
      chave: null,
      criado_em: '2026-11-14T12:00:00.000Z',
    };
    const lista = [erp];
    const comLista = MonitorDetalhes.parse((await ler(responderMonitorFalso('GET', '/integracao/monitor/detalhes', T, true, lista))).corpo);
    expect(comLista.conectores.map((c) => [c.conector_id, c.saude, c.sinal])).toEqual([['erp', 'desativado', null]]);
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
