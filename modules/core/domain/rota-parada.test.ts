import { describe, expect, it } from 'vitest';
import { subtituloParada } from './rota-parada';

describe('RN-CORE-52: 2ª linha da parada não iniciada na Rota (horário + complemento do módulo)', () => {
  it('RN-CORE-52: com texto, mostra "09:00 · Carla Lima"', () => {
    expect(subtituloParada('09:00', 'Carla Lima')).toBe('09:00 · Carla Lima');
  });
  it('RN-CORE-52: sem texto, vazio ou só espaços, mostra só o horário', () => {
    expect(subtituloParada('09:00', null)).toBe('09:00');
    expect(subtituloParada('09:00', undefined)).toBe('09:00');
    expect(subtituloParada('09:00', '')).toBe('09:00');
    expect(subtituloParada('09:00', '   ')).toBe('09:00');
  });
  it('RN-CORE-52: o texto é aparado e cortado em 60 caracteres', () => {
    expect(subtituloParada('09:00', '  Ana  ')).toBe('09:00 · Ana');
    expect(subtituloParada('09:00', 'x'.repeat(80))).toBe(`09:00 · ${'x'.repeat(60)}`);
  });
});
