import { describe, expect, it } from 'vitest';
import { CabecalhoDoDialog, alvoDoTab, classesDoDialog, focoInicialDoDialog, type CaixaDoFoco } from './overlay';

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
  // T-0191 (docs/design/rotas-criar/spec.md §3 e §5): Criar rota em 540 px e Endereço base em 560 px.
  it("'media' = 540 px e 'media-larga' = 560 px, sem os 460 px", () => {
    const media = classesDoDialog('media').split(/\s+/);
    const mediaLarga = classesDoDialog('media-larga').split(/\s+/);
    expect(media).toContain('sm:max-w-[540px]');
    expect(mediaLarga).toContain('sm:max-w-[560px]');
    expect(media).not.toContain('sm:max-w-[460px]');
    expect(mediaLarga).not.toContain('sm:max-w-[460px]');
  });
  it("'larga' vai a 720 px e não leva os 460 px", () => {
    const c = classesDoDialog('larga').split(/\s+/);
    expect(c).toContain('sm:max-w-[720px]');
    expect(c).not.toContain('sm:max-w-[460px]');
  });
  // RD-2616: "Trocar de plano" do portal (cartões dos planos lado a lado) passa a usar o Dialog do kit.
  it("'extra-larga' vai a 880 px e não leva as outras larguras", () => {
    const c = classesDoDialog('extra-larga').split(/\s+/);
    expect(c).toContain('sm:max-w-[880px]');
    for (const outra of ['sm:max-w-[460px]', 'sm:max-w-[540px]', 'sm:max-w-[560px]', 'sm:max-w-[720px]']) expect(c).not.toContain(outra);
  });
  it('a caixa focada pelo script não mostra contorno (o foco visível fica nos campos)', () => {
    expect(classesDoDialog().split(/\s+/)).toContain('outline-none');
  });
  it('abaixo de 640 px segue folha na largura toda, em todas as larguras', () => {
    for (const l of ['padrao', 'media', 'media-larga', 'larga', 'extra-larga'] as const)
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

// RD-2616: ao abrir, o foco entra no popup e nunca fica atrás dele (a volta ao elemento que abriu fica no useEscape).
describe('Dialog: foco inicial', () => {
  type Falso = CaixaDoFoco & { nome: string };
  const caixa = (achados: Record<'campo' | 'focavel', Falso | null>): Falso => ({
    nome: 'caixa',
    querySelector: (sel: string) => (sel.startsWith('a[href]') ? achados.focavel : achados.campo),
  });
  const el = (nome: string): Falso => ({ nome, querySelector: () => null });
  it('vai ao primeiro campo ou botão habilitado', () => {
    expect(focoInicialDoDialog(caixa({ campo: el('input'), focavel: el('link') })).nome).toBe('input');
  });
  it('sem campo nem botão habilitado, vai ao primeiro focável (link, tabindex)', () => {
    expect(focoInicialDoDialog(caixa({ campo: null, focavel: el('link') })).nome).toBe('link');
  });
  it('sem nada focável, fica na própria caixa', () => {
    expect(focoInicialDoDialog(caixa({ campo: null, focavel: null })).nome).toBe('caixa');
  });
});
