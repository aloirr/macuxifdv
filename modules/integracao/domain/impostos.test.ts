import { describe, expect, it } from 'vitest';
import type { ImpostosRetorno } from '../contracts';
import { impostosDoRetorno } from './impostos';

const PEDIDO = [{ sequencia: 1 }, { sequencia: 2 }];
const bloco = (extra: Partial<ImpostosRetorno> = {}): ImpostosRetorno => ({ v_icms_st_cents: 300, v_ipi_cents: 0, itens: [{ sequencia: 1, v_icms_st_cents: 300, v_ipi_cents: 0 }], ...extra });

describe('RN-INT-08/RN-INT-09 (ADR 0077): ST e IPI do ERP só são repassados, nunca calculados', () => {
  it('RN-INT-08 (ADR 0077): 0 continua 0 (calculado e zero), no item e no total', () => {
    const r = impostosDoRetorno(PEDIDO, 'integrado', bloco({ v_icms_st_cents: 0, itens: [{ sequencia: 1, v_icms_st_cents: 0, v_ipi_cents: 0 }] }));
    expect(r.impostos).toEqual({ v_icms_st_cents: 0, v_ipi_cents: 0, itens: [{ sequencia: 1, v_icms_st_cents: 0, v_ipi_cents: 0 }] });
    expect(r.descartados).toEqual([]);
  });

  it('RN-INT-08 (ADR 0077): campo ausente continua ausente (nunca vira 0)', () => {
    const r = impostosDoRetorno(PEDIDO, 'faturado_total', { v_ipi_cents: 50, itens: [{ sequencia: 2, v_ipi_cents: 50 }] });
    expect(r.impostos).toEqual({ v_ipi_cents: 50, itens: [{ sequencia: 2, v_ipi_cents: 50 }] });
    expect(r.impostos && 'v_icms_st_cents' in r.impostos).toBe(false);
    expect(r.impostos?.itens[0] && 'v_icms_st_cents' in r.impostos.itens[0]).toBe(false);
  });

  it('RN-INT-08 (ADR 0077): total ausente com itens presentes continua ausente, sem somar os itens', () => {
    const r = impostosDoRetorno(PEDIDO, 'faturado_parcial', { itens: [{ sequencia: 1, v_icms_st_cents: 120, v_ipi_cents: 30 }, { sequencia: 2, v_icms_st_cents: 80, v_ipi_cents: 20 }] });
    expect(r.impostos?.v_icms_st_cents).toBeUndefined();
    expect(r.impostos?.v_ipi_cents).toBeUndefined();
    expect(r.impostos?.itens).toHaveLength(2);
  });

  it('RN-INT-08 (ADR 0077): null explícito é mantido como null ("não informado")', () => {
    const r = impostosDoRetorno(PEDIDO, 'integrado', { v_icms_st_cents: null, v_ipi_cents: null, itens: [{ sequencia: 1, v_icms_st_cents: null, v_ipi_cents: null }] });
    expect(r.impostos).toEqual({ v_icms_st_cents: null, v_ipi_cents: null, itens: [{ sequencia: 1, v_icms_st_cents: null, v_ipi_cents: null }] });
  });

  it('RN-INT-09 (ADR 0077): bloco ausente fica ausente (o consumidor não apaga o que já estava gravado)', () => {
    expect(impostosDoRetorno(PEDIDO, 'integrado', undefined)).toEqual({ impostos: undefined, descartados: [] });
    expect(impostosDoRetorno(PEDIDO, 'integrado', null)).toEqual({ impostos: undefined, descartados: [] });
  });

  it('RN-INT-08 (ADR 0077): itens vazios é um bloco válido (todos os itens "não informado")', () => {
    expect(impostosDoRetorno(PEDIDO, 'integrado', { itens: [] }).impostos).toEqual({ itens: [] });
  });

  it('RN-INT-08 (ADR 0077): fora de integrado/faturado_* o bloco é ignorado sem erro', () => {
    for (const s of ['rejeitado_erp', 'cancelado'] as const) expect(impostosDoRetorno(PEDIDO, s, bloco())).toEqual({ impostos: undefined, descartados: [] });
  });

  it('RN-INT-08 (ADR 0077): sequência inexistente é descartada; o resto do bloco vale', () => {
    const r = impostosDoRetorno(PEDIDO, 'integrado', bloco({ itens: [{ sequencia: 1, v_icms_st_cents: 1 }, { sequencia: 9, v_icms_st_cents: 2 }] }));
    expect(r.impostos?.itens).toEqual([{ sequencia: 1, v_icms_st_cents: 1 }]);
    expect(r.descartados).toEqual([expect.objectContaining({ indice: 1, sequencia: 9, codigo: 'sequencia_inexistente', campo: 'impostos.itens[1].sequencia' })]);
    expect(r.descartados[0]?.motivo).toMatch(/sequência 9/);
  });

  it('RN-INT-08 (ADR 0077): sequência repetida descarta todas as linhas dela', () => {
    const r = impostosDoRetorno(PEDIDO, 'integrado', bloco({ itens: [{ sequencia: 1, v_ipi_cents: 1 }, { sequencia: 2, v_ipi_cents: 5 }, { sequencia: 1, v_ipi_cents: 2 }] }));
    expect(r.impostos?.itens).toEqual([{ sequencia: 2, v_ipi_cents: 5 }]);
    expect(r.descartados.map((d) => [d.indice, d.codigo])).toEqual([
      [0, 'sequencia_repetida'],
      [2, 'sequencia_repetida'],
    ]);
  });
});
