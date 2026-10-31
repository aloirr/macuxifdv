import { describe, expect, it } from 'vitest';
import { PARAMETROS_PADRAO, resolverParametros } from './parametros';

describe('parâmetros do tenant do Treinamento', () => {
  it('RN-TRE-01/02/04: padrões do doc 03 (70%, 3 tentativas/dia, 30 s, XP 10/5/50, streak 2 até 20)', () => {
    expect(PARAMETROS_PADRAO).toMatchObject({
      nota_minima_pct: 70,
      tentativas_max_dia: 3,
      tempo_min_licao_seg: 30,
      xp_licao: 10,
      xp_acerto_questao: 5,
      xp_trilha: 50,
      xp_streak_por_dia: 2,
      xp_streak_teto: 20,
      fuso: 'America/Manaus',
    });
  });

  it('mistura o parcial do tenant com o padrão', () => {
    const p = resolverParametros({ nota_minima_pct: 80 });
    expect(p.nota_minima_pct).toBe(80);
    expect(p.xp_licao).toBe(10);
  });

  it('recusa nota mínima fora de 0–100, tentativas < 1 e XP negativo', () => {
    expect(() => resolverParametros({ nota_minima_pct: 101 })).toThrow(/nota_minima_pct/);
    expect(() => resolverParametros({ tentativas_max_dia: 0 })).toThrow(/tentativas_max_dia/);
    expect(() => resolverParametros({ xp_licao: -1 })).toThrow(/xp_licao/);
  });

  it('recusa faixas de nível que não começam em 0 ou não crescem', () => {
    expect(() => resolverParametros({ niveis_xp_min: [10, 100] })).toThrow(/começar em 0/);
    expect(() => resolverParametros({ niveis_xp_min: [0, 100, 100] })).toThrow(/crescentes/);
  });

  it('recusa fuso inexistente', () => {
    expect(() => resolverParametros({ fuso: 'Marte/Olympus' })).toThrow(/Fuso/);
  });
});
