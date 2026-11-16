/**
 * T-0181 (spec docs/design/carga-aviso-frases/spec.md §2) — `useFraseDaCarga`, a frase da tela de carga no aparelho:
 * - lê a lista guardada no último sync e o id da última frase; sem lista, usa as 30 do bundle (`FRASES_CARGA_INICIAIS`);
 * - sorteia uma vez por montagem (não troca em novo render) e grava só o id da sorteada;
 * - lista vazia: nenhuma frase e nada gravado.
 * O hook roda num simulador mínimo de `useState`/`useEffect` (montagem, novo render, desmontagem): o shell testa em Node,
 * sem renderizador com efeitos. O armazenamento do aparelho é um Map.
 */
import { FRASES_CARGA_INICIAIS } from '@macuxi/platform-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAVE_FRASES_CARGA, CHAVE_ULTIMA_FRASE_CARGA, type FraseSorteavel } from '@/lib/frase-sorteio';

// ---------- simulador de hooks ----------
const h = vi.hoisted(() => {
  type Efeito = { deps: readonly unknown[] | undefined; limpar?: (() => void) | void };
  const estado = { slots: [] as unknown[], efeitos: [] as Efeito[], i: 0, j: 0, pendentes: [] as (() => void)[] };
  return {
    estado,
    useState<T>(inicial: T | (() => T)) {
      const k = estado.i++;
      if (!(k in estado.slots)) estado.slots[k] = typeof inicial === 'function' ? (inicial as () => T)() : inicial;
      const set = (v: T) => {
        estado.slots[k] = v;
      };
      return [estado.slots[k] as T, set] as const;
    },
    useEffect(fn: () => (() => void) | void, deps?: readonly unknown[]) {
      const k = estado.j++;
      const antes = estado.efeitos[k];
      const mudou = !antes || !deps || !antes.deps || deps.some((d, n) => !Object.is(d, antes.deps![n]));
      if (!mudou) return;
      estado.pendentes.push(() => {
        if (antes?.limpar) antes.limpar();
        estado.efeitos[k] = { deps, limpar: fn() };
      });
    },
  };
});
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), useState: h.useState, useEffect: h.useEffect }));

/** Monta o hook; `render()` é um novo render da mesma montagem; `desmontar()` roda as limpezas. */
function montar<T>(hook: () => T) {
  h.estado.slots = [];
  h.estado.efeitos = [];
  const render = () => {
    h.estado.i = 0;
    h.estado.j = 0;
    const valor = hook();
    for (const efeito of h.estado.pendentes.splice(0)) efeito();
    return valor;
  };
  render();
  return { render, desmontar: () => h.estado.efeitos.forEach((e) => e.limpar?.()) };
}
const esperarArmazenamento = () => new Promise((r) => setTimeout(r, 0));

// ---------- armazenamento do aparelho ----------
const aparelho = vi.hoisted(() => ({ dados: new Map<string, unknown>(), leituras: [] as string[], gravacoes: [] as [string, unknown][] }));
vi.mock('@/services/storage', () => ({
  readJson: (chave: string) => {
    aparelho.leituras.push(chave);
    return Promise.resolve(aparelho.dados.get(chave) ?? null);
  },
  writeJson: (chave: string, valor: unknown) => {
    aparelho.gravacoes.push([chave, valor]);
    aparelho.dados.set(chave, valor);
    return Promise.resolve();
  },
}));
// o componente do mesmo arquivo usa o kit e o react-native (não rodam aqui)
vi.mock('react-native', () => ({ StyleSheet: { create: <T,>(s: T) => s }, Text: () => null, View: () => null }));
vi.mock('@macuxi/ui/mobile', () => ({ fonts: {}, Icon: () => null, temaDaEntrada: () => ({}) }));

const { useFraseDaCarga } = await import('./frase-carga');

const GUARDADAS: FraseSorteavel[] = [
  { id: 'f1', texto: 'Frase um.' },
  { id: 'f2', texto: 'Frase dois.' },
  { id: 'f3', texto: 'Frase três.' },
];

beforeEach(() => {
  aparelho.dados = new Map();
  aparelho.leituras = [];
  aparelho.gravacoes = [];
});

describe('useFraseDaCarga (T-0181, spec carga-aviso-frases §2)', () => {
  it('lê a lista guardada e a última; sorteia entre as outras e grava só o id da sorteada', async () => {
    aparelho.dados.set(CHAVE_FRASES_CARGA, GUARDADAS);
    aparelho.dados.set(CHAVE_ULTIMA_FRASE_CARGA, 'f1');
    const tela = montar(() => useFraseDaCarga(() => 0));
    // enquanto lê, sem frase (o bloco não aparece)
    expect(tela.render()).toBeNull();
    await esperarArmazenamento();
    expect(tela.render()).toEqual(GUARDADAS[1]);
    expect(aparelho.leituras.sort()).toEqual([CHAVE_FRASES_CARGA, CHAVE_ULTIMA_FRASE_CARGA].sort());
    expect(aparelho.gravacoes).toEqual([[CHAVE_ULTIMA_FRASE_CARGA, 'f2']]);
  });

  it('sem lista guardada (antes do 1º sync): sorteia entre as 30 do bundle', async () => {
    const tela = montar(() => useFraseDaCarga(() => 0.5));
    await esperarArmazenamento();
    const frase = tela.render();
    expect(FRASES_CARGA_INICIAIS).toHaveLength(30);
    expect(FRASES_CARGA_INICIAIS.map((f) => f.id)).toContain(frase?.id);
    expect(aparelho.gravacoes).toEqual([[CHAVE_ULTIMA_FRASE_CARGA, frase?.id]]);
  });

  it('sorteia uma vez por montagem: novo render não troca a frase nem sorteia de novo; a montagem seguinte não repete', async () => {
    aparelho.dados.set(CHAVE_FRASES_CARGA, GUARDADAS);
    const rnd = vi.fn(() => 0);
    const primeira = montar(() => useFraseDaCarga(rnd));
    await esperarArmazenamento();
    const frase = primeira.render();
    for (let n = 0; n < 5; n++) expect(primeira.render()).toBe(frase);
    await esperarArmazenamento();
    expect(rnd).toHaveBeenCalledTimes(1);
    expect(aparelho.gravacoes).toHaveLength(1);
    primeira.desmontar();
    // carga nova: outra frase, diferente da última gravada
    const segunda = montar(() => useFraseDaCarga(rnd));
    await esperarArmazenamento();
    expect(segunda.render()?.id).not.toBe(frase?.id);
    expect(rnd).toHaveBeenCalledTimes(2);
  });

  it('nenhuma ativa na lista guardada: sem frase e nada gravado', async () => {
    aparelho.dados.set(CHAVE_FRASES_CARGA, []);
    const tela = montar(() => useFraseDaCarga(() => 0));
    await esperarArmazenamento();
    expect(tela.render()).toBeNull();
    expect(aparelho.gravacoes).toEqual([]);
  });

  it('tela desmontada antes da leitura terminar: não guarda frase nem grava a última', async () => {
    aparelho.dados.set(CHAVE_FRASES_CARGA, GUARDADAS);
    const tela = montar(() => useFraseDaCarga(() => 0));
    tela.desmontar();
    await esperarArmazenamento();
    expect(aparelho.gravacoes).toEqual([]);
  });
});
