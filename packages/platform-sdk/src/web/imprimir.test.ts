/** E6 (T-0029 §9): `imprimirHtml` com DOM simulado — iframe oculto, título sugerido, impressão e limpeza. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imprimirHtml, type DocumentoImpressao, type IframeImpressao } from './imprimir';

function domSimulado(op: { semJanela?: boolean; printFalha?: boolean } = {}) {
  const anexados: IframeImpressao[] = [];
  const removidos: IframeImpressao[] = [];
  const eventos = new Map<string, () => void>();
  const print = vi.fn(() => {
    if (op.printFalha) throw new Error('bloqueado');
  });
  const doc: DocumentoImpressao & { tituloNaImpressao: string | null } = {
    title: 'Macuxi BKO',
    tituloNaImpressao: null,
    body: {
      appendChild: (n) => {
        const f = n as IframeImpressao;
        anexados.push(f);
        // o navegador carrega o srcdoc depois de anexar
        queueMicrotask(() => f.onload?.());
        return n;
      },
    },
    createElement: () => {
      const attrs: Record<string, string> = {};
      const iframe: IframeImpressao & { attrs: Record<string, string> } = {
        attrs,
        setAttribute: (k, v) => void (attrs[k] = v),
        style: {},
        srcdoc: '',
        onload: null,
        remove: () => void removidos.push(iframe),
        contentDocument: op.semJanela ? null : { title: '' },
        contentWindow: op.semJanela
          ? null
          : {
              focus: () => undefined,
              print: () => {
                doc.tituloNaImpressao = doc.title;
                print();
              },
              addEventListener: (tipo, fn) => void eventos.set(tipo, fn),
            },
      };
      return iframe;
    },
  };
  return { doc, anexados, removidos, eventos, print };
}

describe('imprimirHtml (E6, PDF no BKO pelo diálogo do navegador, P-5)', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('põe o HTML num iframe oculto, sugere o nome pelo título, imprime e remove no afterprint', async () => {
    const d = domSimulado();
    await imprimirHtml('<html><body><h1>Pedido 123</h1></body></html>', 'Pedido 123 - Mercado Sol', { documento: d.doc });
    const f = d.anexados[0] as IframeImpressao & { attrs: Record<string, string> };
    expect(f.srcdoc).toContain('Pedido 123');
    expect(f.attrs['aria-hidden']).toBe('true');
    expect(f.style).toMatchObject({ width: '0', height: '0', visibility: 'hidden' });
    expect(f.contentDocument?.title).toBe('Pedido 123 - Mercado Sol');
    expect(d.doc.tituloNaImpressao).toBe('Pedido 123 - Mercado Sol');
    expect(d.print).toHaveBeenCalledTimes(1);
    expect(d.removidos).toHaveLength(0);
    d.eventos.get('afterprint')!();
    expect(d.removidos).toEqual([f]);
    expect(d.doc.title).toBe('Macuxi BKO');
    // a remoção de segurança não remove de novo
    vi.advanceTimersByTime(60_000);
    expect(d.removidos).toHaveLength(1);
  });

  it('sem afterprint, remove depois do prazo de segurança', async () => {
    const d = domSimulado();
    await imprimirHtml('<p>x</p>', 'x', { documento: d.doc, limpezaMs: 1_000 });
    expect(d.removidos).toHaveLength(0);
    vi.advanceTimersByTime(1_000);
    expect(d.removidos).toHaveLength(1);
    expect(d.doc.title).toBe('Macuxi BKO');
  });

  it('navegador que recusa a impressão: rejeita e limpa', async () => {
    const d = domSimulado({ printFalha: true });
    await expect(imprimirHtml('<p>x</p>', 'x', { documento: d.doc })).rejects.toThrow('bloqueado');
    expect(d.removidos).toHaveLength(1);
    const s = domSimulado({ semJanela: true });
    await expect(imprimirHtml('<p>x</p>', 'x', { documento: s.doc })).rejects.toThrow('não abriu');
    expect(s.removidos).toHaveLength(1);
  });

  it('fora do navegador (sem document) rejeita sem lançar na chamada', async () => {
    await expect(imprimirHtml('<p>x</p>', 'x')).rejects.toThrow('Impressão só no navegador.');
  });
});
