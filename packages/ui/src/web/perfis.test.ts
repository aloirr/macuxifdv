import { describe, expect, it } from 'vitest';
import { alternarMarcado, ALVO_TODOS_PERFIS, contagemNaoSalva, resumoDosAlvos } from './perfis';
import * as perfis from './perfis';

/** Código interno que nunca aparece para o cliente (R-20261124-094002). */
const CODIGO_INTERNO = /\b(RN|RF|RD)-|\bT-\d{4}\b|\bADR\b/;

describe('perfis de acesso: textos e arrumação (T-0111)', () => {
  it('contagem das mudanças não salvas no singular e no plural', () => {
    expect(contagemNaoSalva(0)).toBe('Nenhuma mudança');
    expect(contagemNaoSalva(1)).toBe('1 mudança não salva');
    expect(contagemNaoSalva(2)).toBe('2 mudanças não salvas');
  });

  it('resumo dos perfis-alvo da senha', () => {
    const r = { vendedor: 'Vendedor', supervisor: 'Supervisor', vendedor_jr: 'Vendedor júnior' };
    expect(resumoDosAlvos([], r)).toBe('Nenhum perfil');
    expect(resumoDosAlvos(null, r)).toBe('Nenhum perfil');
    expect(resumoDosAlvos([ALVO_TODOS_PERFIS], r)).toBe('Todos, menos admin');
    expect(resumoDosAlvos(['vendedor', 'vendedor_jr', 'sumiu'], r)).toBe('Vendedor, Vendedor júnior, sumiu');
  });

  it('alternarMarcado mantém a ordem da tela; "todos" substitui a lista', () => {
    const ordem = ['vendedor', 'promotor', 'supervisor'];
    expect(alternarMarcado(['supervisor'], 'vendedor', ordem)).toEqual(['vendedor', 'supervisor']);
    expect(alternarMarcado(['vendedor', 'supervisor'], 'vendedor', ordem)).toEqual(['supervisor']);
    expect(alternarMarcado(['vendedor'], ALVO_TODOS_PERFIS, ordem)).toEqual([ALVO_TODOS_PERFIS]);
    expect(alternarMarcado([ALVO_TODOS_PERFIS], ALVO_TODOS_PERFIS, ordem)).toEqual([]);
  });

  it('nenhum texto visível traz código interno (R-20261124-094002)', () => {
    const visiveis = [
      ...Object.values(perfis).filter((v: unknown): v is string => typeof v === 'string'),
      ...Object.values(perfis.TEXTO_INTERRUPTOR),
    ];
    for (const t of visiveis) expect(t).not.toMatch(CODIGO_INTERNO);
  });
});
