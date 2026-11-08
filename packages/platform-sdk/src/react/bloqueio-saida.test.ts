/**
 * RN-VEN-38 (T-0128) — `useBloquearSaida` no `@macuxi/platform-sdk/react`.
 *
 * O SDK não tem renderizador com effects (sem react-dom/jsdom aqui), então o teste troca só `useContext`, `useRef` e
 * `useEffect` por um ciclo mínimo de render/commit com a mesma semântica de dependências do React; `createContext` é o real.
 * - com provedor: registra UMA vez (re-renders não re-registram), `alterado()` e `aoTentarSair` leem o último render;
 *   desmontar retira o registro;
 * - sem provedor: nada acontece (sem erro).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Efeito = { deps: unknown[] | undefined; fn: () => void | (() => void); limpar?: (() => void) | void };

const sim = vi.hoisted(() => ({
  contexto: null as unknown,
  refs: [] as { current: unknown }[],
  efeitos: [] as Efeito[],
  pendentes: [] as Efeito[],
  indice: 0,
}));

vi.mock('react', async (original) => {
  const real = await original<typeof import('react')>();
  return {
    ...real,
    useContext: () => sim.contexto,
    useRef: (inicial: unknown) => {
      const i = sim.indice++;
      sim.refs[i] ??= { current: inicial };
      return sim.refs[i];
    },
    useEffect: (fn: Efeito['fn'], deps?: unknown[]) => {
      sim.pendentes.push({ fn, deps });
    },
  };
});

const { useBloquearSaida } = await import('./bloqueio-saida');
type FormularioAlterado = import('./bloqueio-saida').FormularioAlterado;

const mudou = (antes: unknown[] | undefined, depois: unknown[] | undefined) =>
  !antes || !depois || antes.length !== depois.length || antes.some((v, i) => !Object.is(v, depois[i]));

/** Um render seguido do commit: roda os effects cujas dependências mudaram (limpando o anterior). */
function renderizar(alterado: boolean, aoTentarSair: (prosseguir: () => void) => void) {
  sim.indice = 0;
  sim.pendentes = [];
  useBloquearSaida(alterado, aoTentarSair);
  sim.pendentes.forEach((novo, i) => {
    const velho = sim.efeitos[i];
    if (velho && !mudou(velho.deps, novo.deps)) return;
    if (velho?.limpar) velho.limpar();
    sim.efeitos[i] = { ...novo, limpar: novo.fn() };
  });
}

function desmontar() {
  sim.efeitos.forEach((e) => e.limpar?.());
  sim.efeitos = [];
  sim.refs = [];
}

describe('useBloquearSaida (RN-VEN-38)', () => {
  beforeEach(() => {
    sim.contexto = null;
    sim.refs = [];
    sim.efeitos = [];
  });

  it('com provedor: registra uma vez, lê o último render e retira ao desmontar', () => {
    const registrados: FormularioAlterado[] = [];
    const retirar = vi.fn();
    sim.contexto = { registrar: vi.fn((f: FormularioAlterado) => (registrados.push(f), retirar)) };

    const primeira = vi.fn();
    renderizar(false, primeira);
    expect(registrados).toHaveLength(1);
    expect(registrados[0]!.alterado()).toBe(false);

    const segunda = vi.fn();
    renderizar(true, segunda);
    renderizar(true, segunda);
    expect(registrados).toHaveLength(1);
    expect(retirar).not.toHaveBeenCalled();
    expect(registrados[0]!.alterado()).toBe(true);

    const prosseguir = vi.fn();
    registrados[0]!.aoTentarSair(prosseguir);
    expect(primeira).not.toHaveBeenCalled();
    expect(segunda).toHaveBeenCalledWith(prosseguir);

    desmontar();
    expect(retirar).toHaveBeenCalledTimes(1);
  });

  it('sem provedor (web, testes de módulo): não faz nada', () => {
    expect(() => {
      renderizar(true, vi.fn());
      desmontar();
    }).not.toThrow();
  });
});
