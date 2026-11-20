/**
 * RN-VEN-38 (T-0128): a saída de formulário alterado no shell, com a `TabBar` e o registro REAIS
 * (components/tab-bar.tsx, state/bloqueio-do-shell.ts, lib/historico-telas.ts). Simulados: `react-native` (`BackHandler`,
 * que chama o ouvinte mais novo primeiro), o roteador e a `BarraAbas` do kit (guarda os itens para tocar).
 * - Barra inferior: com o Novo pedido alterado, tocar em Início, Pedidos (inclusive a aba em uso) ou Mais não navega e chama
 *   `aoTentarSair`; o `prosseguir` abre a aba; sem alteração, abre direto.
 * - Voltar do Android (gesto e botão): com alteração, o shell trata antes do roteador; o `prosseguir` volta
 *   (`router.back()`, ou sai do app na raiz); sem alteração, o roteador volta direto.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AbasDoShell } from '@/lib/abas';
import { limparHistoricoDoShell, marcarSaidaDoModulo, registrarTelaAberta } from '@/lib/historico-telas';

// ---------- simulações ----------
const sim = vi.hoisted(() => ({
  pathname: '/m/novo-pedido',
  itens: [] as { testID?: string; onPress: () => void }[],
  ouvintes: [] as (() => boolean)[],
  podeVoltar: true,
  router: { navigate: (_: unknown): void => undefined, back: (): void => undefined, canGoBack: (): boolean => true },
  sair: () => undefined,
}));

vi.mock('react-native', () => ({
  BackHandler: {
    addEventListener: (_evento: string, ouvinte: () => boolean) => {
      sim.ouvintes.push(ouvinte);
      return {
        remove: () => {
          const i = sim.ouvintes.indexOf(ouvinte);
          if (i >= 0) sim.ouvintes.splice(i, 1);
        },
      };
    },
    exitApp: () => sim.sair(),
  },
}));

vi.mock('expo-router', () => ({
  router: {
    navigate: (href: unknown) => sim.router.navigate(href),
    back: () => sim.router.back(),
    canGoBack: () => sim.router.canGoBack(),
  },
  usePathname: () => sim.pathname,
}));

vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

vi.mock('@macuxi/ui/mobile', () => ({
  BarraAbas: ({ itens }: { itens: { testID?: string; onPress: () => void }[] }) => {
    sim.itens = itens;
    return createElement('nav', { 'data-testid': 'tab-bar' });
  },
}));

const { TabBar } = await import('./tab-bar');
const { bloqueioDoShell } = await import('@/state/bloqueio-do-shell');

// ---------- apoio ----------
const ABAS: AbasDoShell = {
  barra: [
    { href: '/', label: 'Início', icon: 'home', testID: 'tab-inicio', modulo: null },
    { href: '/m/pedidos', label: 'Pedidos', icon: 'cart', testID: 'tab-vendedor-pedidos', modulo: 'vendedor' },
    { href: '/mais', label: 'Mais', icon: 'more', testID: 'tab-mais', modulo: null },
  ] as AbasDoShell['barra'],
  mais: [],
  perfil: [],
};

function tocar(testID: string): void {
  renderToStaticMarkup(createElement(TabBar, { abas: ABAS }));
  const item = sim.itens.find((i) => i.testID === testID);
  if (!item) throw new Error(`aba ${testID} não encontrada`);
  item.onPress();
}

/** Aperta o Voltar do Android: o ouvinte mais novo primeiro; devolve se alguém tratou. */
function voltarDoAndroid(): boolean {
  for (let i = sim.ouvintes.length - 1; i >= 0; i--) if (sim.ouvintes[i]()) return true;
  return false;
}

/** O Novo pedido aberto pela aba Pedidos, registrado no shell como o `useBloquearSaida` faz. */
function abrirFormulario(alterado: boolean) {
  const estado = { alterado, prosseguir: null as (() => void) | null };
  const aoTentarSair = vi.fn((p: () => void) => {
    estado.prosseguir = p;
  });
  const retirar = bloqueioDoShell.registrar({ alterado: () => estado.alterado, aoTentarSair });
  return { estado, aoTentarSair, retirar };
}

let navegar: ReturnType<typeof vi.fn>;
let voltar: ReturnType<typeof vi.fn>;
let sair: ReturnType<typeof vi.fn>;
let voltarDoRoteador: ReturnType<typeof vi.fn>;
let retirarDoTeste: (() => void) | null = null;

beforeEach(() => {
  retirarDoTeste?.();
  retirarDoTeste = null;
  sim.ouvintes.length = 0;
  // o roteador (raiz) assina o Voltar antes de qualquer formulário
  voltarDoRoteador = vi.fn(() => true);
  sim.ouvintes.push(voltarDoRoteador as unknown as () => boolean);
  navegar = vi.fn();
  voltar = vi.fn();
  sair = vi.fn();
  sim.router = { navigate: navegar, back: voltar, canGoBack: () => sim.podeVoltar };
  sim.sair = sair as unknown as () => undefined;
  sim.podeVoltar = true;
  sim.pathname = '/m/novo-pedido';
  limparHistoricoDoShell();
  // Pedidos → Novo pedido: as telas de módulo em foco, pilha [pedidos, novo-pedido]
  registrarTelaAberta({ caminho: ['pedidos'] });
  registrarTelaAberta({ caminho: ['novo-pedido'] });
});

function registrar(alterado: boolean) {
  const f = abrirFormulario(alterado);
  retirarDoTeste = f.retirar;
  return f;
}

// ---------- barra inferior ----------
describe('barra inferior com o formulário alterado (RN-VEN-38)', () => {
  it.each([
    ['Início', 'tab-inicio', '/'],
    ['Mais', 'tab-mais', '/mais'],
  ])('tocar em %s não navega: pergunta à tela, e o prosseguir abre a aba', (_nome, testID, destino) => {
    const { aoTentarSair, estado } = registrar(true);
    tocar(testID);
    expect(aoTentarSair).toHaveBeenCalledTimes(1);
    expect(navegar).not.toHaveBeenCalled();
    estado.prosseguir?.();
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith(destino);
  });

  it('tocar de novo na aba em uso (Pedidos) também pergunta; o prosseguir volta à raiz da aba', () => {
    const { aoTentarSair, estado } = registrar(true);
    tocar('tab-vendedor-pedidos');
    expect(aoTentarSair).toHaveBeenCalledTimes(1);
    expect(navegar).not.toHaveBeenCalled();
    estado.prosseguir?.();
    expect(navegar).toHaveBeenCalledWith('/m/pedidos');
  });

  it('"Continuar editando" (sem prosseguir) fica no formulário', () => {
    const { aoTentarSair } = registrar(true);
    tocar('tab-inicio');
    tocar('tab-mais');
    expect(aoTentarSair).toHaveBeenCalledTimes(2);
    expect(navegar).not.toHaveBeenCalled();
  });

  it('sem alteração, a aba abre direto, sem chamar a tela', () => {
    const { aoTentarSair } = registrar(false);
    tocar('tab-inicio');
    expect(navegar).toHaveBeenCalledWith('/');
    expect(aoTentarSair).not.toHaveBeenCalled();
  });

  it('desmontado o formulário, a barra volta a navegar direto', () => {
    const { aoTentarSair, retirar } = registrar(true);
    retirar();
    tocar('tab-inicio');
    expect(navegar).toHaveBeenCalledWith('/');
    expect(aoTentarSair).not.toHaveBeenCalled();
  });

  it('no Início (telas de módulo fora de foco), o formulário montado por baixo não segura a barra', () => {
    const { aoTentarSair } = registrar(true);
    marcarSaidaDoModulo();
    sim.pathname = '/';
    tocar('tab-mais');
    expect(navegar).toHaveBeenCalledWith('/mais');
    expect(aoTentarSair).not.toHaveBeenCalled();
  });
});

// ---------- Voltar do Android ----------
describe('Voltar do Android (gesto e botão) com o formulário alterado (RN-VEN-38)', () => {
  it('o shell trata antes do roteador; o prosseguir volta pelo roteador (uma vez só)', () => {
    const { aoTentarSair, estado } = registrar(true);
    expect(voltarDoAndroid()).toBe(true);
    expect(aoTentarSair).toHaveBeenCalledTimes(1);
    expect(voltarDoRoteador).not.toHaveBeenCalled();
    expect(voltar).not.toHaveBeenCalled();
    estado.prosseguir?.();
    estado.prosseguir?.();
    expect(voltar).toHaveBeenCalledTimes(1);
    expect(sair).not.toHaveBeenCalled();
  });

  it('na raiz (o roteador não tem para onde voltar), o prosseguir sai do app como o Android faria', () => {
    const { estado } = registrar(true);
    sim.podeVoltar = false;
    voltarDoAndroid();
    estado.prosseguir?.();
    expect(sair).toHaveBeenCalledTimes(1);
    expect(voltar).not.toHaveBeenCalled();
  });

  it('sem alteração, o roteador volta direto, sem chamar a tela', () => {
    const { aoTentarSair } = registrar(false);
    expect(voltarDoAndroid()).toBe(true);
    expect(voltarDoRoteador).toHaveBeenCalledTimes(1);
    expect(aoTentarSair).not.toHaveBeenCalled();
  });

  it('desmontado o formulário, o ouvinte sai e o roteador volta direto', () => {
    const { retirar, aoTentarSair } = registrar(true);
    retirar();
    voltarDoAndroid();
    expect(voltarDoRoteador).toHaveBeenCalledTimes(1);
    expect(aoTentarSair).not.toHaveBeenCalled();
  });
});

// ---------- BackLink do kit (T-0128, ProvedorSaidaDaTela) ----------
describe('Voltar do cabeçalho (BackLink do kit) com o formulário alterado (RN-VEN-38)', () => {
  // `tocarNoVoltar` é a parte pura REAL do BackLink (packages/ui, voltar.test.ts); o valor do provedor é o do shell
  const seguirDoBackLink = () => (sim.router.canGoBack() ? sim.router.back() : sim.router.navigate('/'));

  it('o _layout envolve todas as telas no ProvedorSaidaDaTela com o mesmo bloqueio do shell', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
    expect(src).toContain('<ProvedorSaidaDaTela value={bloqueioDoShell}>');
    expect(src.indexOf('<ProvedorSaidaDaTela')).toBeLessThan(src.indexOf('<Stack'));
  });

  it('com alteração, o toque no ‹ pergunta à tela; o prosseguir volta uma vez', async () => {
    const { tocarNoVoltar } = await import('@macuxi/ui/mobile/puro');
    const { aoTentarSair, estado } = registrar(true);
    tocarNoVoltar({ saida: bloqueioDoShell, seguir: seguirDoBackLink });
    expect(aoTentarSair).toHaveBeenCalledTimes(1);
    expect(voltar).not.toHaveBeenCalled();
    estado.prosseguir?.();
    expect(voltar).toHaveBeenCalledTimes(1);
  });

  it('sem alteração, volta direto; com `aoVoltar` da tela, a tela decide e o shell não é chamado', async () => {
    const { tocarNoVoltar } = await import('@macuxi/ui/mobile/puro');
    const { aoTentarSair } = registrar(false);
    tocarNoVoltar({ saida: bloqueioDoShell, seguir: seguirDoBackLink });
    expect(voltar).toHaveBeenCalledTimes(1);
    const aoVoltar = vi.fn();
    tocarNoVoltar({ aoVoltar, saida: bloqueioDoShell, seguir: seguirDoBackLink });
    expect(aoVoltar).toHaveBeenCalledTimes(1);
    expect(aoTentarSair).not.toHaveBeenCalled();
  });
});
