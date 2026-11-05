import { describe, expect, it } from 'vitest';
import { aplicarParadoMinDoTenant, paradoMinDoTenant } from './parado-min';

const linha = (valor: unknown, extra: Record<string, unknown> = {}) => ({ modulo: 'core', chave: 'inicio.parado_min', valor, deleted_at: null, ...extra });

describe('parado_min do tenant (Core) no Gestão', () => {
  it('RN-CORE-26: inicio.parado_min = 30 publicado pelo Core vence o valor da visão', () => {
    expect(paradoMinDoTenant([linha(30)])).toBe(30);
    expect(aplicarParadoMinDoTenant({ parado_min: 60, x: 1 }, [linha(30)])).toEqual({ parado_min: 30, x: 1 });
  });
  it('RN-CORE-26: ausente, apagado, de outro módulo ou fora de 15..480 volta ao valor do Gestor', () => {
    expect(paradoMinDoTenant([])).toBeNull();
    expect(paradoMinDoTenant([linha(30, { deleted_at: '2026-01-01T00:00:00Z' })])).toBeNull();
    expect(paradoMinDoTenant([linha(30, { modulo: 'gestor' })])).toBeNull();
    expect(paradoMinDoTenant([linha(14)])).toBeNull();
    expect(paradoMinDoTenant([linha(481)])).toBeNull();
    expect(paradoMinDoTenant([linha('abc')])).toBeNull();
    expect(aplicarParadoMinDoTenant({ parado_min: 45 }, [])).toEqual({ parado_min: 45 });
  });
  it('sem visão (ainda não sincronizada) continua sem visão', () => {
    expect(aplicarParadoMinDoTenant(null, [linha(30)])).toBeNull();
  });
});
