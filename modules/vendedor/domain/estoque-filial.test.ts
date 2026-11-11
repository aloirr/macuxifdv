import { describe, expect, it } from 'vitest';
import { disponivelNaFilial } from './estoque-filial';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

describe('RN-VEN-20: disponível = saldo da filial do pedido − reservas da mesma filial (T-0149)', () => {
  const saldos = [
    { filial_id: A, quantidade: 10 },
    { filial_id: B, quantidade: 50 },
  ];
  it('só conta o saldo e as reservas da filial do pedido', () => {
    const reservas = [
      { filial_id: A, quantidade: 4 },
      { filial_id: B, quantidade: 30 },
    ];
    expect(disponivelNaFilial(saldos, reservas, A)).toBe(6);
    expect(disponivelNaFilial(saldos, reservas, B)).toBe(20);
  });
  it('reservas de outra filial não consomem a filial do pedido', () => {
    expect(disponivelNaFilial(saldos, [{ filial_id: B, quantidade: 50 }], A)).toBe(10);
  });
  it('filial sem saldo = 0, e o disponível nunca fica negativo', () => {
    expect(disponivelNaFilial(saldos, [], 'cccccccc-0000-4000-8000-000000000003')).toBe(0);
    expect(disponivelNaFilial(saldos, [{ filial_id: A, quantidade: 15 }], A)).toBe(0);
  });
  it('compara o id da filial sem diferenciar maiúsculas', () => {
    expect(disponivelNaFilial(saldos, [], A.toUpperCase())).toBe(10);
  });
});
