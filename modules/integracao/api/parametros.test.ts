import { describe, expect, it, vi } from 'vitest';
import { PARAMETROS_PADRAO } from '../domain';
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
});
