import { describe, expect, it } from 'vitest';
import { formatarParametro, ListaParametros, valorComPadrao } from './lista-parametros';

// Sem react-dom: o componente é chamado como função e a árvore de elementos é inspecionada (como em progresso.test.ts).
type No = { type: unknown; props: Record<string, unknown> & { children?: unknown; className?: string } };

const LARANJA_PURO_EM_TEXTO = /\btext-accent\b(?!-)/;

describe('valorComPadrao (RD-1584)', () => {
  it('igual ao padrão: só o valor, sem "Padrão"', () => {
    expect(valorComPadrao(30, 30, formatarParametro.dias)).toEqual({ valor: '30 dias', padrao: null });
    expect(valorComPadrao('melhor', 'melhor')).toEqual({ valor: 'melhor', padrao: null });
  });

  it('diferente: valor e "Padrão: X", os dois com o mesmo formato', () => {
    expect(valorComPadrao(7, 30, formatarParametro.dias)).toEqual({ valor: '7 dias', padrao: 'Padrão: 30 dias' });
    expect(valorComPadrao(1600, 1280, formatarParametro.unidade('px'))).toEqual({ valor: '1.600 px', padrao: 'Padrão: 1.280 px' });
  });

  it('listas comparadas por valor', () => {
    const f = (v: readonly number[]) => v.join(' · ');
    expect(valorComPadrao([0, 100, 300], [0, 100, 300], f).padrao).toBeNull();
    expect(valorComPadrao([0, 150], [0, 100], f)).toEqual({ valor: '0 · 150', padrao: 'Padrão: 0 · 100' });
  });

  it('sem formatador, String(v)', () => {
    expect(valorComPadrao(3, 5)).toEqual({ valor: '3', padrao: 'Padrão: 5' });
  });
});

describe('formatarParametro', () => {
  it('min, pct, dias (singular em 1) e unidade livre, em pt-BR', () => {
    expect(formatarParametro.min(15)).toBe('15 min');
    expect(formatarParametro.pct(50)).toBe('50%');
    expect(formatarParametro.dias(1)).toBe('1 dia');
    expect(formatarParametro.dias(30)).toBe('30 dias');
    expect(formatarParametro.unidade('caracteres')(2000)).toBe('2.000 caracteres');
  });
});

describe('ListaParametros: árvore (RD-1583)', () => {
  const montar = (linhas: Parameters<typeof ListaParametros>[0]['linhas'], testId?: string) => ListaParametros({ linhas, testId }) as unknown as No;
  const pares = (raiz: No) => raiz.props.children as No[];

  it('<dl> com o testId e uma linha (dt/dd) por parâmetro, na ordem', () => {
    const raiz = montar([{ rotulo: 'Crítica até', valor: '7 dias' }, { rotulo: 'Em atenção até', valor: '30 dias' }], 'promotor.parametros.validade');
    expect(raiz.type).toBe('dl');
    expect(raiz.props['data-testid']).toBe('promotor.parametros.validade');
    const [a, b] = pares(raiz);
    const [dtA] = a?.props.children as No[];
    const [dtB] = b?.props.children as No[];
    expect(dtA?.props.children).toBe('Crítica até');
    expect(dtB?.props.children).toBe('Em atenção até');
  });

  it('"Padrão: X" só na linha que o tem, em 13 na cor de apoio (ink-2, MC-1515)', () => {
    const raiz = montar([
      { rotulo: 'Tolerância', valor: '12 h', padrao: 'Padrão: 24 h', testId: 'p.tolerancia' },
      { rotulo: 'Fotos por pergunta', valor: '3', padrao: null },
    ]);
    const [comPadrao, semPadrao] = pares(raiz);
    const ddCom = (comPadrao?.props.children as No[])[1] as No;
    const ddSem = (semPadrao?.props.children as No[])[1] as No;
    expect(ddCom.props['data-testid']).toBe('p.tolerancia');
    const [valor, padrao] = ddCom.props.children as [string, No];
    expect(valor).toBe('12 h');
    expect(padrao.props.children).toBe('Padrão: 24 h');
    expect(padrao.props.className).toContain('text-[13px] text-ink-2');
    expect((ddSem.props.children as unknown[])[1]).toBeNull();
  });

  it('rótulo 15/600 em ink e valor tabular; nenhum texto em laranja puro', () => {
    const raiz = montar([{ rotulo: 'A', valor: '1', padrao: 'Padrão: 2' }]);
    expect(raiz.props.className).toContain('text-[15px]');
    const [dt, dd] = (pares(raiz)[0]?.props.children ?? []) as No[];
    expect(dt?.props.className).toContain('font-semibold text-ink');
    expect(dd?.props.className).toContain('tabular-nums');
    for (const c of [raiz.props.className, dt?.props.className, dd?.props.className]) expect(c).not.toMatch(LARANJA_PURO_EM_TEXTO);
  });
});
