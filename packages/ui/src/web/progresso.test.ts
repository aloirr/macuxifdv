import { describe, expect, it } from 'vitest';
import { percentualDoProgresso, Progresso, valorDoProgresso, type PropsProgresso } from './progresso';

// T-0104: sem react-dom; o componente é chamado como função e a árvore de elementos é inspecionada.
type No = { type: unknown; props: Record<string, unknown> & { children?: unknown; className?: string; style?: { width?: string } } };

const LARANJA_PURO_EM_TEXTO = /\btext-accent\b(?!-)/;

function classes(no: unknown): string[] {
  if (Array.isArray(no)) return no.flatMap(classes);
  if (!no || typeof no !== 'object' || !('props' in no)) return [];
  const p = (no as No).props;
  return [...(typeof p.className === 'string' ? [p.className] : []), ...classes(p.children)];
}

function montar(props: PropsProgresso) {
  const raiz = Progresso(props) as unknown as No;
  const filhos = (raiz.props.children as unknown[]).filter(Boolean) as No[];
  const trilha = filhos[filhos.length - 1] as No;
  const preenchimento = trilha.props.children as No;
  const linha = filhos.length > 1 ? (filhos[0] as No) : null;
  return { raiz, trilha, preenchimento, linha };
}

describe('percentualDoProgresso', () => {
  it('percentual inteiro, arredondado', () => {
    expect(percentualDoProgresso(40)).toBe(40);
    expect(percentualDoProgresso(7, 10)).toBe(70);
    expect(percentualDoProgresso(1, 3)).toBe(33);
    expect(percentualDoProgresso(2, 3)).toBe(67);
  });

  it('limita a 0..100', () => {
    expect(percentualDoProgresso(-5)).toBe(0);
    expect(percentualDoProgresso(150)).toBe(100);
    expect(percentualDoProgresso(12, 10)).toBe(100);
    expect(percentualDoProgresso(Number.POSITIVE_INFINITY)).toBe(100);
  });

  it('NaN ou máximo ≤ 0 dá 0', () => {
    expect(percentualDoProgresso(Number.NaN)).toBe(0);
    expect(percentualDoProgresso(5, Number.NaN)).toBe(0);
    expect(percentualDoProgresso(5, 0)).toBe(0);
    expect(percentualDoProgresso(5, -10)).toBe(0);
    expect(percentualDoProgresso(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('valor para aria-valuenow fica na faixa [0, máximo]', () => {
    expect(valorDoProgresso(7, 10)).toBe(7);
    expect(valorDoProgresso(12, 10)).toBe(10);
    expect(valorDoProgresso(-1, 10)).toBe(0);
    expect(valorDoProgresso(Number.NaN)).toBe(0);
    expect(valorDoProgresso(3, 0)).toBe(0);
  });
});

describe('Progresso: árvore', () => {
  it('contêiner progressbar com nome e valores ARIA', () => {
    const { raiz } = montar({ valor: 7, maximo: 10, rotulo: 'Metas batidas', testid: 'metas.progresso' });
    expect(raiz.props.role).toBe('progressbar');
    expect(raiz.props['aria-label']).toBe('Metas batidas');
    expect(raiz.props['aria-valuemin']).toBe(0);
    expect(raiz.props['aria-valuemax']).toBe(10);
    expect(raiz.props['aria-valuenow']).toBe(7);
    expect(raiz.props['aria-valuetext']).toBe('70%');
    expect(raiz.props['data-testid']).toBe('metas.progresso');
  });

  it('valor fora da faixa: aria-valuenow limitado e largura 100%', () => {
    const { raiz, preenchimento } = montar({ valor: 130, rotulo: 'Positivação' });
    expect(raiz.props['aria-valuemax']).toBe(100);
    expect(raiz.props['aria-valuenow']).toBe(100);
    expect(preenchimento.props.style?.width).toBe('100%');
  });

  it('textoValor vai no aria-valuetext e na linha de cima', () => {
    const { raiz, linha } = montar({ valor: 7, maximo: 10, rotulo: 'Metas batidas', textoValor: '7 de 10' });
    expect(raiz.props['aria-valuetext']).toBe('7 de 10');
    const [rotulo, valor] = linha?.props.children as [No, No];
    expect(rotulo.props.children).toBe('Metas batidas');
    expect(rotulo.props.className).toContain('text-[13px] text-ink-2');
    expect(valor.props.children).toBe('7 de 10');
    expect(valor.props.className).toContain('text-[13px] font-semibold');
    expect(valor.props.className).toContain('tabular-nums');
    expect(valor.props.className).toContain('text-ink');
  });

  it('trilha h-2 arredondada bg-line-2; preenchimento na largura do percentual', () => {
    const { trilha, preenchimento } = montar({ valor: 1, maximo: 3, rotulo: 'Visitas' });
    expect(trilha.props.className).toContain('h-2');
    expect(trilha.props.className).toContain('rounded-full');
    expect(trilha.props.className).toContain('bg-line-2');
    expect(preenchimento.props.style?.width).toBe('33%');
    expect(preenchimento.props.className).toContain('motion-reduce:transition-none');
  });

  it('tom: destaque (padrão) bg-grafico, o laranja de gráfico da marca v1; sucesso bg-success', () => {
    expect(montar({ valor: 50, rotulo: 'A' }).preenchimento.props.className).toContain('bg-grafico');
    const s = montar({ valor: 50, rotulo: 'A', tom: 'sucesso' }).preenchimento.props.className ?? '';
    expect(s).toContain('bg-success');
    expect(s).not.toContain('bg-grafico');
  });

  it('mostrarRotulo=false esconde a linha, mas o nome e o valor continuam no ARIA', () => {
    const { raiz, linha } = montar({ valor: 50, rotulo: 'Positivação', mostrarRotulo: false });
    expect(linha).toBeNull();
    expect(raiz.props['aria-label']).toBe('Positivação');
    expect(raiz.props['aria-valuetext']).toBe('50%');
  });

  it("mostrarRotulo='valor' mostra só o número; o rótulo fica só no aria-label (RD-0615)", () => {
    const { raiz, linha } = montar({ valor: 120, maximo: 340, rotulo: 'Enviando', textoValor: '120 de 340 MB', mostrarRotulo: 'valor' });
    expect(linha).not.toBeNull();
    const textos = (Array.isArray(linha?.props.children) ? linha?.props.children : [linha?.props.children]) as unknown[];
    const visiveis = textos.filter(Boolean).map((t) => (t as No).props.children);
    expect(visiveis).toEqual(['120 de 340 MB']);
    expect(raiz.props['aria-label']).toBe('Enviando');
    expect(raiz.props['aria-valuetext']).toBe('120 de 340 MB');
  });

  it('className da tela entra no contêiner', () => {
    expect(montar({ valor: 1, rotulo: 'A', className: 'w-60' }).raiz.props.className).toContain('w-60');
  });

  it('nenhum texto em laranja puro (text-accent sem -ink)', () => {
    for (const tom of ['destaque', 'sucesso'] as const) {
      const todas = classes(Progresso({ valor: 40, rotulo: 'A', tom }));
      expect(todas.length).toBeGreaterThan(2);
      for (const c of todas) expect(c).not.toMatch(LARANJA_PURO_EM_TEXTO);
    }
  });
});
