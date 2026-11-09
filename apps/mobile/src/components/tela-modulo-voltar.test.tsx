/**
 * T-0072 (R-20261105-132419 / R-20261105-135855) — rótulo do voltar na tela de módulo, renderizada com `react-dom/server`.
 * A rota `(tabs)/m/[...caminho]` envolve a tela no `ProvedorVoltar` do kit com o valor do shell (`useVoltarDoShell`):
 * - Início › Novo pedido: o `BackLink` mostra "‹ Início" e é lido "Voltar para Início", já no primeiro render (antes do
 *   registro na pilha, que roda no `useLayoutEffect`), e continua igual depois do registro (sem piscar);
 * - Pedidos › Novo pedido: vale o rótulo do módulo ("‹ Pedidos");
 * - tela indisponível também fica dentro do provedor, sem erro.
 * `ProvedorVoltar`/`useVoltarDaTela` e `rotuloDoVoltar` são os REAIS do kit; o `BackLink` simulado repete a linha do
 * `ui.tsx` (`rotuloDoVoltar(label, useVoltarDaTela())`), que o teste do kit (packages/ui/src/mobile/voltar.test.ts) fixa.
 * O histórico é o real (lib/historico-telas.ts); `react-native`, o roteador e a visão do shell são simulados.
 */
import { rotuloDoVoltar } from '@macuxi/ui/mobile/puro';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  abrirAba,
  limparHistoricoDoShell,
  marcarOrigemFora,
  marcarSaidaDoModulo,
  marcarVoltaAoModulo,
  registrarTelaAberta,
  type ParamsDaRota,
} from '@/lib/historico-telas';

// ---------- simulações ----------
type Props = { children?: ReactNode; testID?: string };
const host = (tag: string) =>
  function Host({ children, testID }: Props) {
    return createElement(tag, testID ? { 'data-testid': testID } : {}, children);
  };

vi.mock('react-native', () => {
  class Valor {
    setValue(): void {}
    stopAnimation(): void {}
  }
  return {
    View: host('div'),
    Text: host('span'),
    Animated: { Value: Valor, View: host('div'), timing: () => ({}), parallel: () => ({ start: () => undefined }) },
    useWindowDimensions: () => ({ width: 400, height: 800 }),
  };
});

const sim = vi.hoisted(() => ({ params: {} as Record<string, unknown> }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => sim.params,
  useRoute: () => ({ params: sim.params }),
}));

vi.mock('@macuxi/ui/mobile', async () => {
  // contexto REAL do kit (voltar.tsx só depende do React)
  const voltar = await import('../../../../packages/ui/src/mobile/voltar');
  const puro = await import('@macuxi/ui/mobile/puro');
  const BackLink = ({ label }: { label: string; fallback: string }) => {
    const rotulo = puro.rotuloDoVoltar(label, voltar.useVoltarDaTela());
    return createElement('a', { 'aria-label': rotulo.acessivel, 'data-testid': 'voltar' }, `‹ ${rotulo.visivel}`);
  };
  return {
    curvaPadrao: undefined,
    useReduzirMovimento: () => false,
    Screen: host('main'),
    Empty: ({ text }: { text: string }) => createElement('p', null, text),
    BackLink,
    ProvedorVoltar: voltar.ProvedorVoltar,
    useVoltarDaTela: voltar.useVoltarDaTela,
  };
});

const { BackLink } = (await import('@macuxi/ui/mobile')) as unknown as { BackLink: ComponentType<{ label: string; fallback: string }> };

/** Telas registradas pelos módulos (`moduloApp.paginas`): o Novo pedido do Vendedor tem "‹ Pedidos" fixo. */
const PAGINAS: Record<string, { modulo: string; id: string; componente: ComponentType }> = {
  'novo-pedido': { modulo: 'vendedor', id: 'novo-pedido', componente: () => createElement(BackLink, { label: 'Pedidos', fallback: '/m/pedidos' }) },
  pedidos: { modulo: 'vendedor', id: 'pedidos', componente: () => createElement('h1', null, 'Pedidos') },
};
// T-0140: a tela de erro do módulo (ErrorBoundary) não entra neste teste; ela tem o próprio (tela-de-erro.test.tsx)
vi.mock('@/components/tela-de-erro', () => ({ TelaDeErroDoModulo: () => null }));

vi.mock('@macuxi/platform-sdk/react', () => ({
  useVisaoShell: () => ({ pagina: (id: string) => PAGINAS[id] ?? null }),
}));

const { default: TelaDeModulo } = await import('../app/(tabs)/m/[...caminho]');

const p = (caminho: string): ParamsDaRota => ({ caminho: caminho.split('/') });
function renderizar(params: ParamsDaRota): string {
  sim.params = { ...params };
  return renderToStaticMarkup(createElement(TelaDeModulo));
}
const voltarDe = (html: string) => {
  const m = /<a aria-label="([^"]*)" data-testid="voltar">([^<]*)<\/a>/.exec(html);
  return m ? { lido: m[1], visivel: m[2] } : null;
};

describe('T-0072 — ProvedorVoltar na tela de módulo (rótulo do voltar dado pelo shell)', () => {
  beforeEach(() => limparHistoricoDoShell());

  it('Início › Novo pedido: "‹ Início", lido "Voltar para Início", já no primeiro render e igual depois do registro', () => {
    // o Início está em foco (a rota de módulo fora de foco)
    marcarSaidaDoModulo();
    marcarOrigemFora('inicio');
    // primeiro quadro: o useLayoutEffect (registro na pilha) ainda não rodou
    const primeiro = voltarDe(renderizar(p('novo-pedido')));
    expect(primeiro).toEqual({ lido: 'Voltar para Início', visivel: '‹ Início' });
    // registro na pilha (useLayoutEffect) e foco da rota: o render seguinte dá o mesmo rótulo
    registrarTelaAberta(p('novo-pedido'));
    marcarVoltaAoModulo();
    expect(voltarDe(renderizar(p('novo-pedido')))).toEqual(primeiro);
  });

  it('Pedidos › Novo pedido: vale o rótulo do módulo, "‹ Pedidos"', () => {
    abrirAba('/m/pedidos', false);
    expect(renderizar(p('pedidos'))).toContain('Pedidos');
    registrarTelaAberta(p('pedidos'));
    marcarVoltaAoModulo();
    const primeiro = voltarDe(renderizar(p('novo-pedido')));
    expect(primeiro).toEqual({ lido: 'Voltar para Pedidos', visivel: '‹ Pedidos' });
    registrarTelaAberta(p('novo-pedido'));
    expect(voltarDe(renderizar(p('novo-pedido')))).toEqual(primeiro);
  });

  it('sem o provedor do shell, o BackLink segue o rótulo do módulo (o kit não muda nada sozinho)', () => {
    expect(rotuloDoVoltar('Pedidos', null)).toEqual({ visivel: 'Pedidos', acessivel: 'Voltar para Pedidos' });
    const html = renderToStaticMarkup(createElement(BackLink, { label: 'Pedidos', fallback: '/m/pedidos' }));
    expect(voltarDe(html)).toEqual({ lido: 'Voltar para Pedidos', visivel: '‹ Pedidos' });
  });

  it('tela indisponível (módulo desligado ou perfil sem acesso) também abre dentro do provedor, sem erro', () => {
    marcarSaidaDoModulo();
    const html = renderizar(p('pedido-inexistente'));
    expect(html).toContain('data-testid="tela-indisponivel"');
    expect(html).toContain('Esta tela não está disponível');
  });
});
