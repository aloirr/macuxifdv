import { describe, expect, it } from 'vitest';
import { CabecalhoDoDialog, alvoDoTab, classesDoDialog } from './overlay';

// R-20261114-141500: o Tab não sai do popup (Dialog e Drawer do BKO).
describe('alvoDoTab', () => {
  it('do último campo volta ao primeiro', () => expect(alvoDoTab(3, 2, false)).toBe(0));
  it('com Shift, do primeiro vai ao último', () => expect(alvoDoTab(3, 0, true)).toBe(2));
  it('no meio deixa o navegador seguir', () => {
    expect(alvoDoTab(3, 1, false)).toBeNull();
    expect(alvoDoTab(3, 1, true)).toBeNull();
  });
  it('foco fora do popup entra pelo primeiro (ou pelo último com Shift)', () => {
    expect(alvoDoTab(3, -1, false)).toBe(0);
    expect(alvoDoTab(3, -1, true)).toBe(2);
  });
  it('sem campo focável não faz nada', () => expect(alvoDoTab(0, -1, false)).toBeNull());
});

// Monitor de Integração v1.0.19: o "Histórico — ‹Entidade›" precisa de tabela de 5 colunas e de uma linha de identificação
// (conector · n lotes) sob o título. Sem react-dom: o cabeçalho (sem hooks) é chamado como função.
type No = { type: unknown; props: Record<string, unknown> & { className?: string; children?: unknown } };
const filhos = (no: No) =>
  Array.isArray(no.props.children) ? (no.props.children as unknown[]) : [no.props.children];

describe('Dialog: largura', () => {
  it('padrão continua com 460 px a partir de 640 px', () => {
    expect(classesDoDialog()).toContain('sm:max-w-[460px]');
    expect(classesDoDialog('padrao')).toBe(classesDoDialog());
  });
  it("'larga' vai a 720 px e não leva os 460 px", () => {
    const c = classesDoDialog('larga').split(/\s+/);
    expect(c).toContain('sm:max-w-[720px]');
    expect(c).not.toContain('sm:max-w-[460px]');
  });
  it('abaixo de 640 px segue folha na largura toda, nas duas larguras', () => {
    for (const l of ['padrao', 'larga'] as const)
      expect(classesDoDialog(l).split(/\s+/)).toEqual(
        expect.arrayContaining(['w-full', 'rounded-t-2xl', 'max-h-full']),
      );
  });
});

describe('Dialog: subtítulo', () => {
  it('sem subtítulo: só o h2, como antes', () => {
    const no = CabecalhoDoDialog({ id: 't', title: 'Cancelar este lote?', rola: false }) as unknown as No;
    expect(no.type).toBe('h2');
    expect(no.props.id).toBe('t');
    expect(no.props.children).toBe('Cancelar este lote?');
  });
  it('com subtítulo: h2 e, embaixo, a linha em 13 px ink-2 (como no Drawer)', () => {
    const no = CabecalhoDoDialog({
      id: 't',
      title: 'Histórico — Produtos',
      subtitle: 'erp-matriz · 4 lotes',
      rola: false,
    }) as unknown as No;
    const [h2, sub] = filhos(no) as No[];
    expect(h2?.type).toBe('h2');
    expect(h2?.props.id).toBe('t');
    expect(sub?.props.children).toBe('erp-matriz · 4 lotes');
    expect(String(sub?.props.className).split(/\s+/)).toEqual(
      expect.arrayContaining(['text-[13px]', 'text-ink-2']),
    );
  });
  it('a divisa de rolagem fica no cabeçalho inteiro, com ou sem subtítulo', () => {
    const com = CabecalhoDoDialog({ id: 't', title: 'T', subtitle: 'S', rola: true }) as unknown as No;
    const sem = CabecalhoDoDialog({ id: 't', title: 'T', rola: true }) as unknown as No;
    expect(String(com.props.className)).toContain('border-b');
    expect(String(sem.props.className)).toContain('border-b');
  });
});
