/** Tabela de preços do cliente no aparelho: vence a cada sync, mas só é trocada quando a nova está pronta. */
import { describe, expect, it } from 'vitest';
import { tabelaVencida } from './tabela-vencida';

describe('RN-VEN-02: preço de hoje chega depois do sync sem apagar a tabela antiga', () => {
  it('sem tabela, está vencida (precisa calcular)', () => {
    expect(tabelaVencida(null, '2026-11-24T14:00:00.000Z')).toBe(true);
    expect(tabelaVencida(undefined, null)).toBe(true);
  });
  it('tabela calculada sobre o último sync não vence, mesmo se o relógio voltar (só vale o carimbo do sync)', () => {
    expect(tabelaVencida({ base_sync: '2026-11-24T14:00:00.000Z' }, '2026-11-24T14:00:00.000Z')).toBe(false);
  });
  it('tabela calculada sobre um sync anterior vence', () => {
    expect(tabelaVencida({ base_sync: '2026-11-24T14:00:00.000Z' }, '2026-11-24T14:15:00.000Z')).toBe(true);
  });
  it('tabela sem carimbo de base vence uma vez; sem carimbo de sync nada venceu', () => {
    expect(tabelaVencida({}, '2026-11-24T14:00:00.000Z')).toBe(true);
    expect(tabelaVencida({ base_sync: '2026-11-24T14:00:00.000Z' }, null)).toBe(false);
  });
});
