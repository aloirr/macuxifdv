import type { KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Abas, classeDaAba, idDaAba, idDoPainel, indiceComFoco, indiceDaTecla, PainelAba, rotuloDaAba, type ItemAba } from './abas';

// T-0104: sem react-dom; o componente é chamado como função e a árvore de elementos é inspecionada.
type No = { type: unknown; props: Record<string, unknown> & { children?: unknown; className?: string } };

const LARANJA_PURO_EM_TEXTO = /\btext-accent\b(?!-)/;

function classes(no: unknown): string[] {
  if (Array.isArray(no)) return no.flatMap(classes);
  if (!no || typeof no !== 'object' || !('props' in no)) return [];
  const p = (no as No).props;
  return [...(typeof p.className === 'string' ? [p.className] : []), ...classes(p.children)];
}

type Id = 'pendentes' | 'enviados' | 'cancelados' | 'rascunhos';
const ABAS: ItemAba<Id>[] = [
  { id: 'pendentes', rotulo: 'Pendentes', contador: 3 },
  { id: 'enviados', rotulo: 'Enviados', contador: 1240 },
  { id: 'cancelados', rotulo: 'Cancelados', desligada: true },
  { id: 'rascunhos', rotulo: 'Rascunhos', testid: 'pedidos.rascunhos' },
];

function montar(valor: Id, onChange = vi.fn(), abas = ABAS) {
  const lista = Abas<Id>({ abas, valor, onChange, rotulo: 'Situação do pedido', idBase: 'pedidos' }) as unknown as No;
  const botoes = lista.props.children as No[];
  return { lista, botoes, onChange };
}

function tecla(key: string) {
  const focos = ABAS.map(() => ({ focus: vi.fn() }));
  const preventDefault = vi.fn();
  const evento = { key, preventDefault, currentTarget: { parentElement: { querySelectorAll: vi.fn(() => focos) } } };
  return { evento: evento as unknown as KeyboardEvent<HTMLButtonElement>, focos, preventDefault };
}

const apertar = (botao: No, e: KeyboardEvent<HTMLButtonElement>) => (botao.props.onKeyDown as (e: KeyboardEvent<HTMLButtonElement>) => void)(e);

describe('abas: funções puras', () => {
  it('rótulo com contador entre parênteses (milhar em pt-BR); sem contador, só o rótulo; zero aparece', () => {
    expect(rotuloDaAba('Pendentes', 3)).toBe('Pendentes (3)');
    expect(rotuloDaAba('Enviados', 1240)).toBe('Enviados (1.240)');
    expect(rotuloDaAba('Pendentes', 0)).toBe('Pendentes (0)');
    expect(rotuloDaAba('Todos')).toBe('Todos');
    expect(rotuloDaAba('Todos', null)).toBe('Todos');
    expect(rotuloDaAba('Todos', Number.NaN)).toBe('Todos');
  });

  it('ids de aba e painel', () => {
    expect(idDaAba('pedidos', 'pendentes')).toBe('pedidos-aba-pendentes');
    expect(idDoPainel('pedidos', 'pendentes')).toBe('pedidos-painel-pendentes');
  });

  it('foco: a ativa se ligada; senão a primeira ligada; -1 se nenhuma', () => {
    expect(indiceComFoco(ABAS, 'enviados')).toBe(1);
    expect(indiceComFoco(ABAS, 'cancelados')).toBe(0);
    expect(indiceComFoco([{ id: 'a', rotulo: 'A', desligada: true }, { id: 'b', rotulo: 'B' }], 'a')).toBe(1);
    expect(indiceComFoco(ABAS, 'inexistente' as Id)).toBe(0);
    expect(indiceComFoco([{ id: 'a', rotulo: 'A', desligada: true }], 'a')).toBe(-1);
    expect(indiceComFoco([], 'a')).toBe(-1);
  });

  it('setas andam com volta nas pontas e pulam as desligadas', () => {
    const d = [false, false, true, false];
    expect(indiceDaTecla('ArrowRight', 0, d)).toBe(1);
    expect(indiceDaTecla('ArrowRight', 1, d)).toBe(3);
    expect(indiceDaTecla('ArrowRight', 3, d)).toBe(0);
    expect(indiceDaTecla('ArrowLeft', 0, d)).toBe(3);
    expect(indiceDaTecla('ArrowLeft', 3, d)).toBe(1);
  });

  it('Home e End vão à primeira e à última ligadas', () => {
    const d = [true, false, false, true];
    expect(indiceDaTecla('Home', 2, d)).toBe(1);
    expect(indiceDaTecla('End', 1, d)).toBe(2);
  });

  it('outra tecla, lista vazia ou tudo desligado dão null; uma só ligada fica nela', () => {
    expect(indiceDaTecla('Enter', 0, [false, false])).toBeNull();
    expect(indiceDaTecla('ArrowDown', 0, [false, false])).toBeNull();
    expect(indiceDaTecla('ArrowRight', 0, [])).toBeNull();
    expect(indiceDaTecla('ArrowRight', 0, [true, true])).toBeNull();
    expect(indiceDaTecla('Home', 0, [true, true])).toBeNull();
    expect(indiceDaTecla('ArrowRight', 1, [true, false, true])).toBe(1);
  });
});

describe('Abas: árvore', () => {
  it('lista com papel, nome, orientação e testid; uma aba por item', () => {
    const { lista, botoes } = montar('pendentes');
    expect(lista.type).toBe('div');
    expect(lista.props.role).toBe('tablist');
    expect(lista.props['aria-label']).toBe('Situação do pedido');
    expect(lista.props['aria-orientation']).toBe('horizontal');
    expect(lista.props['data-testid']).toBe('abas');
    expect(lista.props.className).toContain('overflow-x-auto');
    expect(lista.props.className).toContain('border-b border-line');
    expect(botoes).toHaveLength(4);
  });

  it('cada aba: botão tab com id, aria-controls, rótulo com contador e testid', () => {
    const { botoes } = montar('pendentes');
    const [p, e, , r] = botoes as [No, No, No, No];
    expect(p.type).toBe('button');
    expect(p.props.type).toBe('button');
    expect(p.props.role).toBe('tab');
    expect(p.props.id).toBe('pedidos-aba-pendentes');
    expect(p.props['aria-controls']).toBe('pedidos-painel-pendentes');
    expect(p.props.children).toBe('Pendentes (3)');
    expect(e.props.children).toBe('Enviados (1.240)');
    expect(p.props['data-testid']).toBe('abas.pendentes');
    expect(r.props['data-testid']).toBe('pedidos.rascunhos');
  });

  it('aria-selected só na ativa; foco itinerante: tabIndex 0 só nela', () => {
    const { botoes } = montar('enviados');
    expect(botoes.map((b) => b.props['aria-selected'])).toEqual([false, true, false, false]);
    expect(botoes.map((b) => b.props.tabIndex)).toEqual([-1, 0, -1, -1]);
  });

  it('ativa desligada: o foco do Tab vai para a primeira ligada', () => {
    const { botoes } = montar('cancelados');
    expect(botoes.map((b) => b.props.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(botoes[2]?.props['aria-selected']).toBe(true);
  });

  it('desligada: disabled, com classes de desabilitado', () => {
    const { botoes } = montar('pendentes');
    expect(botoes.map((b) => Boolean(b.props.disabled))).toEqual([false, false, true, false]);
    expect(botoes[2]?.props.className).toContain('disabled:text-disabled');
    expect(botoes[2]?.props.className).toContain('disabled:cursor-not-allowed');
  });

  it('visual: 44 px, ativa com borda laranja e texto accent-ink, inativa ink-2, foco visível por dentro', () => {
    const { botoes } = montar('pendentes');
    const ativa = botoes[0]?.props.className ?? '';
    const inativa = botoes[1]?.props.className ?? '';
    for (const c of [ativa, inativa]) {
      expect(c).toContain('min-h-[44px]');
      expect(c).toContain('px-4 text-[14px] font-semibold');
      expect(c).toContain('-mb-px');
      expect(c).toContain('border-b-2');
      expect(c).toContain('focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent');
    }
    expect(ativa).toContain('border-accent text-accent-ink');
    expect(inativa).toContain('border-transparent text-ink-2');
    expect(inativa).not.toContain('text-accent-ink');
    expect(classeDaAba(true)).toBe(ativa);
  });

  it('nenhum texto em laranja puro (text-accent sem -ink) na lista nem nas abas', () => {
    const { lista } = montar('pendentes');
    const todas = classes(lista);
    expect(todas.length).toBeGreaterThan(1);
    for (const c of todas) expect(c).not.toMatch(LARANJA_PURO_EM_TEXTO);
    expect(LARANJA_PURO_EM_TEXTO.test('text-accent')).toBe(true);
    expect(LARANJA_PURO_EM_TEXTO.test('text-accent-ink')).toBe(false);
  });

  it('clique numa inativa chama onChange; na ativa, não', () => {
    const { botoes, onChange } = montar('pendentes');
    (botoes[0]?.props.onClick as () => void)();
    expect(onChange).not.toHaveBeenCalled();
    (botoes[3]?.props.onClick as () => void)();
    expect(onChange).toHaveBeenCalledWith('rascunhos');
  });

  it('seta à direita: pula a desligada, move o foco e ativa', () => {
    const { botoes, onChange } = montar('enviados');
    const { evento, focos, preventDefault } = tecla('ArrowRight');
    apertar(botoes[1] as No, evento);
    expect(preventDefault).toHaveBeenCalled();
    expect(focos[3]?.focus).toHaveBeenCalled();
    expect(focos[2]?.focus).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith('rascunhos');
  });

  it('seta à direita na última volta à primeira; à esquerda na primeira vai à última', () => {
    const a = montar('rascunhos');
    const t1 = tecla('ArrowRight');
    apertar(a.botoes[3] as No, t1.evento);
    expect(t1.focos[0]?.focus).toHaveBeenCalled();
    expect(a.onChange).toHaveBeenCalledWith('pendentes');

    const b = montar('pendentes');
    const t2 = tecla('ArrowLeft');
    apertar(b.botoes[0] as No, t2.evento);
    expect(t2.focos[3]?.focus).toHaveBeenCalled();
    expect(b.onChange).toHaveBeenCalledWith('rascunhos');
  });

  it('Home e End', () => {
    const a = montar('enviados');
    const home = tecla('Home');
    apertar(a.botoes[1] as No, home.evento);
    expect(home.focos[0]?.focus).toHaveBeenCalled();
    expect(a.onChange).toHaveBeenCalledWith('pendentes');

    const b = montar('enviados');
    const end = tecla('End');
    apertar(b.botoes[1] as No, end.evento);
    expect(end.focos[3]?.focus).toHaveBeenCalled();
    expect(b.onChange).toHaveBeenCalledWith('rascunhos');
  });

  it('outra tecla não faz nada (nem previne o padrão); tecla que cai na própria ativa não chama onChange', () => {
    const a = montar('pendentes');
    const enter = tecla('Enter');
    apertar(a.botoes[0] as No, enter.evento);
    expect(enter.preventDefault).not.toHaveBeenCalled();
    expect(a.onChange).not.toHaveBeenCalled();

    const b = montar('pendentes');
    const home = tecla('Home');
    apertar(b.botoes[0] as No, home.evento);
    expect(home.focos[0]?.focus).toHaveBeenCalled();
    expect(b.onChange).not.toHaveBeenCalled();
  });
});

describe('PainelAba: árvore', () => {
  it('tabpanel ligado à aba, focável, visível quando ativo', () => {
    const p = PainelAba({ idBase: 'pedidos', id: 'pendentes', ativo: true, children: 'conteúdo', testid: 'pedidos.painel' }) as unknown as No;
    expect(p.props.role).toBe('tabpanel');
    expect(p.props.id).toBe('pedidos-painel-pendentes');
    expect(p.props['aria-labelledby']).toBe('pedidos-aba-pendentes');
    expect(p.props.tabIndex).toBe(0);
    expect(p.props.hidden).toBe(false);
    expect(p.props.children).toBe('conteúdo');
    expect(p.props['data-testid']).toBe('pedidos.painel');
    expect(p.props.className).toContain('focus-visible:outline-accent');
  });

  it('inativo fica hidden; classe extra da tela entra', () => {
    const p = PainelAba({ idBase: 'pedidos', id: 'enviados', ativo: false, className: 'pt-3' }) as unknown as No;
    expect(p.props.hidden).toBe(true);
    expect(p.props.className).toContain('pt-3');
  });
});
