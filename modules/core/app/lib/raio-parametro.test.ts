import { describe, expect, it } from 'vitest';
import { raioDosParametros } from './estado';

const linha = (valor: unknown, extra: Record<string, unknown> = {}) => ({ modulo: 'core', chave: 'checkin.raio_m', valor, ...extra });

describe('RN-CORE-10: raio do check-in vem do parâmetro do tenant sincronizado', () => {
  it('lê o valor do parâmetro checkin.raio_m', () => {
    expect(raioDosParametros([linha(350)])).toBe(350);
  });
  it('sem parâmetro, removido ou inválido: null (vale o padrão do domínio, nunca um número fixo na tela)', () => {
    expect(raioDosParametros([])).toBeNull();
    expect(raioDosParametros([linha(350, { deleted_at: '2030-01-01T00:00:00Z' })])).toBeNull();
    expect(raioDosParametros([linha('abc')])).toBeNull();
    expect(raioDosParametros([linha(0)])).toBeNull();
    expect(raioDosParametros([{ modulo: 'vendedor', chave: 'checkin.raio_m', valor: 99 }])).toBeNull();
  });
});
