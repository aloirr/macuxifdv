import { describe, expect, it } from 'vitest';
import { versaoVigente, vigenteEm } from './vigencia';

describe('RN-PRO-10: checklist, mix e metas valem por vigência', () => {
  it('vigente entre início e fim (inclusive); fim nulo = sem prazo', () => {
    const v = { vigencia_inicio: '2026-10-01', vigencia_fim: '2026-10-31' };
    expect(vigenteEm(v, '2026-10-01')).toBe(true);
    expect(vigenteEm(v, '2026-10-31')).toBe(true);
    expect(vigenteEm(v, '2026-09-30')).toBe(false);
    expect(vigenteEm(v, '2026-11-01')).toBe(false);
    expect(vigenteEm({ vigencia_inicio: '2026-10-01', vigencia_fim: null }, '2030-01-01')).toBe(true);
  });

  it('a coleta guarda a versão vigente no momento: escolhe a de início mais recente', () => {
    const versoes = [
      { id: 'v1', vigencia_inicio: '2026-01-01', vigencia_fim: '2026-06-30' },
      { id: 'v2', vigencia_inicio: '2026-07-01', vigencia_fim: null },
      { id: 'v3', vigencia_inicio: '2026-10-15', vigencia_fim: null },
    ];
    expect(versaoVigente(versoes, '2026-03-10')?.id).toBe('v1');
    expect(versaoVigente(versoes, '2026-10-01')?.id).toBe('v2');
    expect(versaoVigente(versoes, '2026-10-31')?.id).toBe('v3');
    expect(versaoVigente(versoes, '2025-12-31')).toBeNull();
  });
});
