import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { estiloDaTabela, tabelaPronta } from './tabela';
import { TableScroll } from './ui';

describe('TableScroll: tabela pronta ou miolo', () => {
  it('um <table> pronto como único filho é reaproveitado (sem tabela dentro de tabela)', () => {
    const t = createElement('table', { className: 'w-full', 'data-testid': 'x.tabela' }, createElement('tbody'));
    const achada = tabelaPronta(t);
    expect(achada?.type).toBe('table');
    expect(achada?.props.className).toBe('w-full');
  });

  it('o miolo (<thead>/<tbody>) não é tabela pronta: o TableScroll embrulha no próprio <table>', () => {
    expect(tabelaPronta([createElement('thead', { key: 'h' }), createElement('tbody', { key: 'b' })])).toBeNull();
    expect(tabelaPronta(createElement('tbody'))).toBeNull();
  });

  it('vazio, texto e nulos não são tabela pronta; nulos ao lado do <table> não atrapalham', () => {
    expect(tabelaPronta(null)).toBeNull();
    expect(tabelaPronta('texto')).toBeNull();
    expect(tabelaPronta([null, false, createElement('table', { key: 't' })])?.type).toBe('table');
  });

  it('a largura mínima do TableScroll vence; o resto do estilo da tela fica', () => {
    expect(estiloDaTabela(760, { minWidth: 100, tableLayout: 'fixed' })).toEqual({ minWidth: 760, tableLayout: 'fixed' });
    expect(estiloDaTabela(500)).toEqual({ minWidth: 500 });
  });
});

describe('TableScroll: árvore final (sem react-dom; o componente chamado como função)', () => {
  type No = { type: unknown; props: { className?: string; style?: { minWidth?: number }; children?: unknown; 'data-testid'?: string } };
  const filhoDaCaixa = (children: ReactNode, minWidth: number): No => (TableScroll({ children, minWidth }) as unknown as No).props.children as No;

  it('com <table> pronto: um <table> só, com as classes, o testID e a largura mínima da tela', () => {
    const t = filhoDaCaixa(createElement('table', { className: 'x', 'data-testid': 'x.tabela' }, createElement('tbody')), 500);
    expect(t.type).toBe('table');
    expect(t.props.className).toBe('x');
    expect(t.props['data-testid']).toBe('x.tabela');
    expect(t.props.style).toEqual({ minWidth: 500 });
    expect((t.props.children as No).type).toBe('tbody');
  });

  it('com o miolo: o <table> do kit embrulha o <thead>/<tbody>, com as classes do kit', () => {
    const t = filhoDaCaixa([createElement('thead', { key: 'h' }), createElement('tbody', { key: 'b' })], 640);
    expect(t.type).toBe('table');
    expect(t.props.className).toBe('w-full border-collapse text-[15px]');
    expect(t.props.style).toEqual({ minWidth: 640 });
    const miolo = t.props.children as No[];
    expect(miolo.map((m) => m.type)).toEqual(['thead', 'tbody']);
  });
});
