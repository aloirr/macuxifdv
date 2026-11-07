import { describe, expect, it } from 'vitest';
import { prazoMedioDoCampo } from './pagamento-cliente';

describe('prazoMedioDoCampo (RN-VEN-25)', () => {
  it('RN-VEN-25: vazio significa sem teto', () => expect(prazoMedioDoCampo('  ')).toEqual({ ok: true, valor: null }));
  it('RN-VEN-25: aceita de 0 a 365', () => {
    expect(prazoMedioDoCampo('0')).toEqual({ ok: true, valor: 0 });
    expect(prazoMedioDoCampo('365')).toEqual({ ok: true, valor: 365 });
  });
  it('RN-VEN-25: recusa negativo, decimal, texto e acima de 365 com a ação seguinte', () => {
    for (const t of ['-1', '4,5', 'abc', '366']) expect(prazoMedioDoCampo(t)).toMatchObject({ ok: false, mensagem: expect.stringContaining('0 a 365') });
  });
});
