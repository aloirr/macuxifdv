import { describe, expect, it } from 'vitest';
import { hojeNoFuso } from './hoje';

describe('hojeNoFuso (RN-CORE-11)', () => {
  const t = new Date('2026-10-13T02:00:00Z');
  it('RN-CORE-11: usa o fuso do tenant para a virada do dia', () => {
    expect(hojeNoFuso(t, 'America/Manaus')).toBe('2026-10-12');
    expect(hojeNoFuso(t, 'America/Sao_Paulo')).toBe('2026-10-12');
    expect(hojeNoFuso(t, 'Asia/Tokyo')).toBe('2026-10-13');
  });
  it('RN-CORE-11: fuso inválido cai em UTC', () => {
    expect(hojeNoFuso(t, 'Nada/Valido')).toBe('2026-10-13');
  });
});
