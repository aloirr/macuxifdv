/**
 * Item 19 — `BotaoVerificarAtualizacao`, renderizado com `react-dom/server` (`react-native`, o kit e o Expo simulados):
 * ao abrir, só o botão "Verificar atualização", sem mensagem; o toque consulta a rota com a variante e a versão do app.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

type Props = { children?: ReactNode; testID?: string };
const host = (tag: string) =>
  function Host({ children, testID }: Props) {
    return createElement(tag, { 'data-testid': testID }, children);
  };

const sim = vi.hoisted(() => ({
  toques: [] as Array<() => void>,
  pedidos: [] as Array<[string, unknown]>,
}));

vi.mock('react-native', () => ({ Text: host('span'), View: host('div'), Linking: { openURL: async () => undefined } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.0.16' } } }));
vi.mock('@/lib/variante', () => ({ varianteAtual: () => 'campo' }));
vi.mock('@macuxi/platform-sdk/react', () => ({
  useHttp: () => ({
    get: async (caminho: string, query: unknown) => {
      sim.pedidos.push([caminho, query]);
      return { variante: 'campo', versao: '1.0.17', apk_url: 'https://downloads.exemplo.com/a.apk', publicada_em: null };
    },
  }),
}));
vi.mock('@macuxi/ui/mobile', () => ({
  type: { sub: {} },
  Button: ({ label, testID, onPress, disabled }: { label: string; testID?: string; onPress?: () => void; disabled?: boolean }) => {
    if (onPress) sim.toques.push(onPress);
    return createElement('button', { 'data-testid': testID, disabled }, label);
  },
}));

const { BotaoVerificarAtualizacao } = await import('./verificar-atualizacao');

describe('BotaoVerificarAtualizacao (item 19)', () => {
  it('ao abrir: só "Verificar atualização", sem mensagem', () => {
    const html = renderToStaticMarkup(createElement(BotaoVerificarAtualizacao));
    expect(html).toContain('data-testid="verificar-atualizacao-botao"');
    expect(html).toContain('>Verificar atualização</button>');
    expect(html).not.toContain('verificar-atualizacao-mensagem');
    expect(html).not.toContain('verificar-atualizacao-baixar');
  });

  it('o toque pergunta a versão publicada da variante do app', async () => {
    sim.toques = [];
    renderToStaticMarkup(createElement(BotaoVerificarAtualizacao));
    sim.toques.at(-1)!();
    await new Promise((r) => setTimeout(r, 0));
    expect(sim.pedidos).toEqual([['/app/versao', { variante: 'campo' }]]);
  });
});
