/**
 * T-0170: `INDICADORES_META` ganhou `itens_por_pedido`. O Gestor só usa a meta de venda; os demais indicadores
 * são aceitos pelo contrato e ignorados na projeção.
 */
import { INDICADORES_META } from '@macuxi/core/contracts';
import { describe, expect, it } from 'vitest';
import { EVENTOS_CONSUMIDOS } from '../contracts/eventos-consumidos';
import { ev, u, VENDEDOR } from './fixtures';
import { aplicarEvento, estadoInicial } from './projecao';

const EM = '2026-11-01T12:00:00Z';
const payload = (indicador: string, valor: number) => ({ usuario_id: VENDEDOR, periodo: '2026-11', indicador, valor, valor_anterior: null, definido_por: u(9) });
const CHAVE = `${VENDEDOR}|2026-11`;

describe('meta por indicador (T-0170)', () => {
  it('lista inclui itens_por_pedido e o schema aceita cada indicador', () => {
    expect(INDICADORES_META).toContain('itens_por_pedido');
    for (const i of INDICADORES_META) {
      expect(EVENTOS_CONSUMIDOS['core.meta.definida@1'].safeParse(payload(i, 10)).success, i).toBe(true);
    }
  });

  it.each([...INDICADORES_META])('%s: aplicado; só venda_cents entra em metas', (i) => {
    const r = aplicarEvento(estadoInicial(), ev('core.meta.definida@1', EM, payload(i, 10)));
    expect(r.situacao).toBe('aplicado');
    expect(Object.keys(r.estado.metas)).toEqual(i === 'venda_cents' ? [CHAVE] : []);
  });

  it('itens_por_pedido depois da venda não sobrescreve meta_cents', () => {
    const a = aplicarEvento(estadoInicial(), ev('core.meta.definida@1', EM, payload('venda_cents', 500000)));
    const b = aplicarEvento(a.estado, ev('core.meta.definida@1', '2026-11-02T12:00:00Z', payload('itens_por_pedido', 4)));
    expect(b.situacao).toBe('aplicado');
    expect(b.estado.metas[CHAVE]?.meta_cents).toBe(500000);
  });
});
