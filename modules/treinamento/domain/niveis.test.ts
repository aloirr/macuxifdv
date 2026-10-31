import { describe, expect, it } from 'vitest';
import { nivelDoXp, subiuDeNivel } from './niveis';

describe('RF-TRE-03: níveis por faixas de XP', () => {
  it('RF-TRE-03: 0 XP = nível 1, faltam 100 para o nível 2', () => {
    expect(nivelDoXp(0)).toEqual({ nivel: 1, xp_total: 0, xp_inicio_nivel: 0, xp_proximo_nivel: 100, xp_faltante: 100, progresso_pct: 0, nivel_maximo: false });
  });

  it('RF-TRE-03: 99 XP ainda é nível 1; 100 XP entra no nível 2 (limite inclusivo)', () => {
    expect(nivelDoXp(99).nivel).toBe(1);
    expect(nivelDoXp(99).xp_faltante).toBe(1);
    expect(nivelDoXp(100)).toMatchObject({ nivel: 2, xp_inicio_nivel: 100, xp_proximo_nivel: 250, xp_faltante: 150, progresso_pct: 0 });
  });

  it('RF-TRE-03: progresso dentro do nível (175 XP: 75 de 150 = 50%)', () => {
    expect(nivelDoXp(175)).toMatchObject({ nivel: 2, xp_faltante: 75, progresso_pct: 50 });
  });

  it('RF-TRE-03: no último nível não há próximo', () => {
    expect(nivelDoXp(3200)).toMatchObject({ nivel: 10, xp_proximo_nivel: null, xp_faltante: 0, progresso_pct: 100, nivel_maximo: true });
    expect(nivelDoXp(999999).nivel).toBe(10);
  });

  it('RF-TRE-03: faixas do tenant substituem as padrão', () => {
    expect(nivelDoXp(60, [0, 50, 200])).toMatchObject({ nivel: 2, xp_proximo_nivel: 200 });
  });

  it('RF-TRE-03: XP negativo ou fracionado é erro; faixas inválidas também', () => {
    expect(() => nivelDoXp(-1)).toThrow(/XP/);
    expect(() => nivelDoXp(1.5)).toThrow(/XP/);
    expect(() => nivelDoXp(10, [5, 10])).toThrow(/começar em 0/);
  });

  it('RF-TRE-03: subiu de nível (celebração) só quando a faixa muda', () => {
    expect(subiuDeNivel(95, 105)).toEqual({ subiu: true, de: 1, para: 2 });
    expect(subiuDeNivel(105, 120)).toEqual({ subiu: false, de: 2, para: 2 });
    expect(subiuDeNivel(90, 460)).toEqual({ subiu: true, de: 1, para: 4 });
  });
});
