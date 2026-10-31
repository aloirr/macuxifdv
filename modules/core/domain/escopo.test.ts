import { describe, expect, it } from 'vitest';
import { clienteNoEscopo, clientesVisiveis, escopoDeCarteira } from './escopo';

const c = { propria: new Set(['c1']), equipe: new Set(['c2']), equipesAbaixo: new Set(['c3']) };

describe('escopo de carteira (RN-CORE-04, S0-074)', () => {
  it('RN-CORE-04: vendedor e promotor → própria carteira', () => {
    expect(escopoDeCarteira('vendedor')).toBe('carteira');
    expect(escopoDeCarteira('promotor')).toBe('carteira');
  });

  it('RN-CORE-04: supervisor → equipe; gerente → equipes abaixo', () => {
    expect(escopoDeCarteira('supervisor')).toBe('equipe');
    expect(escopoDeCarteira('gerente')).toBe('equipes_abaixo');
  });

  it('RN-CORE-04: analista, assistente e admin → tenant inteiro', () => {
    for (const p of ['analista', 'assistente', 'admin'] as const) expect(escopoDeCarteira(p)).toBe('tenant');
  });

  it('RN-CORE-04: vendedor vê só os clientes da própria carteira', () => {
    const v = clientesVisiveis('vendedor', c);
    expect(clienteNoEscopo('c1', v)).toBe(true);
    expect(clienteNoEscopo('c2', v)).toBe(false);
    expect(clienteNoEscopo('c3', v)).toBe(false);
  });

  it('RN-CORE-04: supervisor vê a carteira da equipe, não as equipes abaixo', () => {
    const v = clientesVisiveis('supervisor', c);
    expect(clienteNoEscopo('c2', v)).toBe(true);
    expect(clienteNoEscopo('c3', v)).toBe(false);
  });

  it('RN-CORE-04: gerente vê as equipes abaixo', () => {
    const v = clientesVisiveis('gerente', c);
    for (const id of ['c1', 'c2', 'c3']) expect(clienteNoEscopo(id, v)).toBe(true);
    expect(clienteNoEscopo('c9', v)).toBe(false);
  });

  it('RN-CORE-04: admin vê o tenant (sem filtro de carteira)', () => {
    expect(clientesVisiveis('admin', c)).toBe('tenant');
    expect(clienteNoEscopo('qualquer', 'tenant')).toBe(true);
  });
});
