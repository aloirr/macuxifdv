import { describe, expect, it, vi } from 'vitest';
import { PARAMETROS_PADRAO, calcularInativacao, novaSessao, registrarParte } from '../domain';
import { lerParametrosHub } from './parametros';

describe('RN-INT-12: parâmetros do tenant sobre os padrões do Hub', () => {
  it('RN-INT-12: sem linha em plataforma.parametro vale o padrão', () => {
    expect(lerParametrosHub({})).toEqual(PARAMETROS_PADRAO);
  });

  it('RN-INT-12: valor válido substitui o padrão; chave desconhecida é ignorada', () => {
    const p = lerParametrosHub({ limiteInativacaoPct: 10, timeoutEnvioMin: 20, naoExiste: 1 });
    expect(p.limiteInativacaoPct).toBe(10);
    expect(p.timeoutEnvioMin).toBe(20);
    expect(p).not.toHaveProperty('naoExiste');
  });

  it('RN-INT-12: número fora da faixa, texto no lugar de número ou fração em inteiro caem no padrão e avisam no log', () => {
    const warn = vi.fn();
    const p = lerParametrosHub({ limiteInativacaoPct: 150, pedidosPorConsulta: '50', limiteRegistrosLote: 10.5, ttlSessaoMin: -1 }, { info: vi.fn(), warn, error: vi.fn() });
    expect(p.limiteInativacaoPct).toBe(PARAMETROS_PADRAO.limiteInativacaoPct);
    expect(p.pedidosPorConsulta).toBe(PARAMETROS_PADRAO.pedidosPorConsulta);
    expect(p.limiteRegistrosLote).toBe(PARAMETROS_PADRAO.limiteRegistrosLote);
    expect(p.ttlSessaoMin).toBe(PARAMETROS_PADRAO.ttlSessaoMin);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain('limiteInativacaoPct');
  });

  it('RN-INT-12: balde de taxa só vale completo e positivo', () => {
    expect(lerParametrosHub({ taxaPorConector: { lote: { capacidade: 5, reposicaoPorMin: 5 }, geral: { capacidade: 10, reposicaoPorMin: 10 } } }).taxaPorConector.lote.capacidade).toBe(5);
    expect(lerParametrosHub({ taxaPorConector: { lote: { capacidade: 0, reposicaoPorMin: 5 }, geral: { capacidade: 10, reposicaoPorMin: 10 } } }).taxaPorConector).toEqual(PARAMETROS_PADRAO.taxaPorConector);
    expect(lerParametrosHub({ taxaPorConector: { lote: { capacidade: 5, reposicaoPorMin: 5 } } }).taxaPorConector).toEqual(PARAMETROS_PADRAO.taxaPorConector);
  });

  it('RN-INT-09: versões suportadas pedem lista de textos não vazia', () => {
    expect(lerParametrosHub({ versoesSuportadas: ['v1', 'v2'] }).versoesSuportadas).toEqual(['v1', 'v2']);
    expect(lerParametrosHub({ versoesSuportadas: [] }).versoesSuportadas).toEqual(PARAMETROS_PADRAO.versoesSuportadas);
    expect(lerParametrosHub({ versoesSuportadas: [1] }).versoesSuportadas).toEqual(PARAMETROS_PADRAO.versoesSuportadas);
  });

  it('RN-INT-06: prazo da sessão do tenant acima de 24 h é o valor efetivo (o mesmo para a rota e o aplicar-lote); sem parâmetro vale o padrão', () => {
    expect(lerParametrosHub({ ttlSessaoMin: 48 * 60 }).ttlSessaoMin).toBe(48 * 60);
    expect(lerParametrosHub({}).ttlSessaoMin).toBe(24 * 60);
  });
});

describe('RN-INT-06 / RN-INT-12: limite e prazo da inativação vêm do parâmetro do tenant (aplicar-lote)', () => {
  const ativos = Array.from({ length: 10 }, (_, i) => `A${i}`);
  const t0 = '2026-11-01T10:00:00.000Z';
  const decidir = (brutos: Record<string, unknown>) => {
    const p = lerParametrosHub(brutos);
    const sessao = registrarParte(novaSessao('s1', 'cliente', t0), { parte: 1, ultimo: true, status: 'concluido' });
    const r = calcularInativacao({ sessao, agora: t0, ativosNoMacuxi: ativos, recebidosNaSessao: ativos.slice(0, 6), limitePct: p.limiteInativacaoPct, ttlMin: p.ttlSessaoMin });
    return { p, r };
  };

  it('RN-INT-06: sem parâmetro vale o padrão (30%): 40% de ausentes exige confirmação e a pendência vale 7 dias', () => {
    const { p, r } = decidir({});
    expect(p.limiteInativacaoPct).toBe(30);
    expect(p.ttlConfirmacaoInativacaoDias).toBe(7);
    expect(p.ttlSessaoMin).toBe(24 * 60);
    expect(r).toMatchObject({ permitido: false, motivo: 'excede_limite_inativacao' });
  });

  it('RN-INT-06: limite do tenant maior que o padrão muda a decisão: 40% passa a inativar sem confirmação', () => {
    expect(decidir({ limiteInativacaoPct: 50 }).r).toMatchObject({ permitido: true, motivo: null });
  });

  it('RN-INT-06: limite do tenant menor que o padrão trava o que o padrão deixaria passar; prazo da pendência do tenant', () => {
    const { p, r } = decidir({ limiteInativacaoPct: 10, ttlConfirmacaoInativacaoDias: 3 });
    expect(r).toMatchObject({ permitido: false, motivo: 'excede_limite_inativacao' });
    expect(p.ttlConfirmacaoInativacaoDias).toBe(3);
  });
});
