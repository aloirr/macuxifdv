/**
 * RD-0088: visor de foto comum do shell, renderizado com `react-dom/server` e `react-native`/kit simulados:
 * - estados: carregando, foto (com o rótulo acessível) e sem sinal ("Sem sinal para abrir a foto.");
 * - fechar (X) com o rótulo "Fechar a foto" chama `aoFechar`;
 * - zoom pelos gestos reais do `PanResponder`: pinça (2 dedos), arraste limitado à área e toque duplo (aproxima / volta).
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Props = { children?: ReactNode; testID?: string; accessibilityLabel?: string; onPress?: () => void; onLayout?: (e: unknown) => void };
type Config = Record<string, (e: unknown) => unknown>;

const sim = vi.hoisted(() => ({
  config: null as Config | null,
  valores: [] as { atual: number }[],
  fechar: null as (() => void) | null,
  layout: null as ((e: unknown) => void) | null,
}));

vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const host = (tag: string) =>
    function Host({ children, testID, accessibilityLabel, onPress, onLayout }: Props) {
      if (testID === 'visor-foto-fechar' && onPress) sim.fechar = onPress;
      if (testID === 'visor-foto-area' && onLayout) sim.layout = onLayout;
      return createElement(tag, { ...(testID ? { 'data-testid': testID } : {}), ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}) }, children);
    };
  class Value {
    atual: number;
    constructor(v: number) {
      this.atual = v;
      sim.valores.push(this);
    }
    setValue(v: number) {
      this.atual = v;
    }
  }
  return {
    View: host('div'),
    Text: host('span'),
    Pressable: host('button'),
    Image: ({ testID, accessibilityLabel, source }: { testID: string; accessibilityLabel: string; source: { uri: string } }) =>
      createElement('img', { 'data-testid': testID, alt: accessibilityLabel, src: source.uri }),
    ActivityIndicator: ({ testID }: { testID: string }) => createElement('progress', { 'data-testid': testID }),
    Animated: { Value, View: host('div') },
    PanResponder: {
      create: (c: Config) => {
        sim.config = c;
        return { panHandlers: {} };
      },
    },
    StyleSheet: { create: <T,>(s: T) => s },
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@macuxi/ui/mobile', async () => {
  const { createElement } = await import('react');
  return {
    colors: new Proxy({}, { get: () => '#000' }),
    fonte: new Proxy({}, { get: () => ({}) }),
    Icon: ({ name }: { name: string }) => createElement('i', { 'data-icone': name }),
  };
});

import { TEXTO_SEM_SINAL_FOTO } from '@/lib/foto-pdv';
import type { EstadoVisor } from '@/lib/visor-foto';
import { VisorDeFoto } from './visor-foto';

function render(estado: EstadoVisor, aoFechar = () => undefined): string {
  return renderToStaticMarkup(createElement(VisorDeFoto, { titulo: 'Atacadinho Cachoeirinha', subtitulo: 'Fachada · 08/11/2026', estado, aoFechar }));
}

/** Evento de toque do RN com os dedos na tela (`touches`) e o ponto do dedo que saiu (`pageX/pageY`). */
function ev(dedos: [number, number][], solto?: [number, number]): unknown {
  return { nativeEvent: { touches: dedos.map(([x, y]) => ({ pageX: x, pageY: y })), pageX: solto?.[0] ?? 0, pageY: solto?.[1] ?? 0 } };
}

/** escala, x e y aplicados (ordem de criação no componente: escala, tx, ty). */
function zoom(): { escala: number; x: number; y: number } {
  const [escala, x, y] = sim.valores.slice(-3);
  return { escala: escala!.atual, x: x!.atual, y: y!.atual };
}

beforeEach(() => {
  sim.config = null;
  sim.valores.length = 0;
  sim.fechar = null;
  sim.layout = null;
});

describe('VisorDeFoto — estados', () => {
  it('topo com fechar, título e subtítulo; carregando', () => {
    const html = render({ tipo: 'carregando' });
    expect(html).toContain('aria-label="Fechar a foto"');
    expect(html).toContain('data-icone="close"');
    expect(html).toContain('Atacadinho Cachoeirinha');
    expect(html).toContain('Fachada · 08/11/2026');
    expect(html).toContain('data-testid="visor-foto-carregando"');
  });

  it('foto aberta com o rótulo acessível; fechar chama aoFechar', () => {
    const aoFechar = vi.fn();
    const html = render({ tipo: 'ok', uri: 'file:///fotos/a.jpg' }, aoFechar);
    expect(html).toContain('src="file:///fotos/a.jpg"');
    expect(html).toContain('alt="Foto"');
    expect(html).not.toContain('alt="Fachada');
    sim.fechar?.();
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it('sem sinal: a mensagem aprovada, sem imagem', () => {
    const html = render({ tipo: 'erro', mensagem: TEXTO_SEM_SINAL_FOTO });
    expect(html).toContain('Sem sinal para abrir a foto.');
    expect(html).not.toContain('<img');
  });
});

describe('VisorDeFoto — zoom', () => {
  function abrir(): Config {
    render({ tipo: 'ok', uri: 'file:///fotos/a.jpg' });
    sim.layout?.({ nativeEvent: { layout: { width: 400, height: 600 } } });
    return sim.config!;
  }

  it('pinça: dedos se afastando o dobro dobram a escala; soltar mantém', () => {
    const c = abrir();
    c.onPanResponderGrant!(ev([[100, 300], [200, 300]]));
    c.onPanResponderMove!(ev([[50, 300], [250, 300]]));
    expect(zoom()).toEqual({ escala: 2, x: 0, y: 0 });
    c.onPanResponderRelease!(ev([], [250, 300]));
    expect(zoom().escala).toBe(2);
  });

  it('arraste com a foto aproximada, limitado à borda; na foto inteira não arrasta', () => {
    const c = abrir();
    c.onPanResponderGrant!(ev([[200, 300]]));
    c.onPanResponderMove!(ev([[260, 340]]));
    expect(zoom()).toEqual({ escala: 1, x: 0, y: 0 });
    c.onPanResponderRelease!(ev([], [260, 340]));
    // pinça até 2x, depois arrasta muito para a direita: para em (2-1)*400/2 = 200
    c.onPanResponderGrant!(ev([[100, 300], [200, 300]]));
    c.onPanResponderMove!(ev([[50, 300], [250, 300]]));
    c.onPanResponderRelease!(ev([], [250, 300]));
    c.onPanResponderGrant!(ev([[200, 300]]));
    c.onPanResponderMove!(ev([[900, 330]]));
    expect(zoom()).toEqual({ escala: 2, x: 200, y: 30 });
  });

  it('toque duplo aproxima a foto inteira e o seguinte volta ao tamanho inteiro', () => {
    const c = abrir();
    const tocar = () => {
      c.onPanResponderGrant!(ev([[200, 300]]));
      c.onPanResponderRelease!(ev([], [200, 300]));
    };
    tocar();
    tocar();
    expect(zoom().escala).toBe(2.5);
    tocar();
    tocar();
    expect(zoom()).toEqual({ escala: 1, x: 0, y: 0 });
  });

  it('o visor não cede o gesto no meio da pinça', () => {
    expect(abrir().onPanResponderTerminationRequest!(ev([]))).toBe(false);
  });
});
