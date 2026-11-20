/**
 * Item 16 do teste de campo do Campo v1.0.16 — "Perfil da conta" no Mais, renderizado com `react-dom/server` (`react-native`, o
 * kit, o roteador e o estado da plataforma simulados): a linha está na seção "Conta", também sem abas no Mais, e abre `/profile`.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Props = { children?: ReactNode; testID?: string; onPress?: () => void; title?: string; text?: string };
const host = (tag: string) =>
  function Host({ children, testID, onPress }: Props) {
    if (onPress && testID) sim.toques[testID] = onPress;
    return createElement(tag, { 'data-testid': testID }, children);
  };

const sim = vi.hoisted(() => ({
  toques: {} as Record<string, () => void>,
  rotas: [] as string[],
  mais: [] as Array<{ href: string; testID: string; icon: string; label: string }>,
}));

vi.mock('react-native', () => ({ Pressable: host('button'), Text: host('span'), View: host('div') }));
vi.mock('expo-router', () => ({
  router: { push: (r: string) => sim.rotas.push(r), navigate: (r: string) => sim.rotas.push(r) },
}));
vi.mock('@macuxi/platform-sdk/react', () => ({ useVisaoShell: () => ({ navegacao: [] }) }));
vi.mock('@/lib/abas', () => ({ abasDaVariante: () => ({ mais: sim.mais }) }));
vi.mock('@/lib/variante', () => ({ varianteAtual: () => 'campo' }));
vi.mock('@/lib/historico-telas', () => ({ abrirAba: (href: string) => href }));
vi.mock('@/state/plataforma', () => ({ usePlataforma: () => ({ empresa: { nome: null, logo: null, soLogoDoCliente: false } }) }));
vi.mock('@macuxi/ui/mobile', () => ({
  colors: {},
  type: {},
  Card: host('div'),
  Icon: () => createElement('i'),
  Screen: host('main'),
  PlacaLogoCliente: () => createElement('img'),
  SectionHeader: ({ title }: Props) => createElement('h2', null, title),
  Empty: ({ text }: Props) => createElement('p', null, text),
}));

const { default: Mais } = await import('@/app/(tabs)/mais');

beforeEach(() => {
  sim.toques = {};
  sim.rotas = [];
  sim.mais = [];
});

describe('Mais — "Perfil da conta" (item 16)', () => {
  it('a seção "Conta" com "Perfil da conta", mesmo com todas as telas na barra', () => {
    const html = renderToStaticMarkup(createElement(Mais));
    expect(html).toContain('<h2>Conta</h2>');
    expect(html).toMatch(/data-testid="mais-perfil"[^>]*>.*Perfil da conta/);
  });

  it('o toque abre o Perfil do shell (/profile)', () => {
    renderToStaticMarkup(createElement(Mais));
    sim.toques['mais-perfil']!();
    expect(sim.rotas).toEqual(['/profile']);
  });

  it('as abas que não couberam continuam antes da Conta', () => {
    sim.mais = [{ href: '/m/catalogo', testID: 'tab-catalogo', icon: 'search', label: 'Catálogo' }];
    const html = renderToStaticMarkup(createElement(Mais));
    expect(html.indexOf('mais-catalogo')).toBeLessThan(html.indexOf('mais-perfil'));
  });
});
