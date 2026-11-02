/**
 * T-0064 item 4 — R-20261102-111044: nenhuma tela do Campo e do Gestão desenha conteúdo sob a barra de status.
 * O shell reserva a faixa da barra de status (com o fundo do app) e as telas recebem `insets.top = 0`; a borda de
 * baixo continua com a tela/barra de abas. Renderização com `react-dom/server` e `react-native` simulado.
 */
import { readFileSync } from 'node:fs';

import { createContext, createElement, useContext, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { dividirAreaSegura, type Insets } from '@/lib/area-segura';

const APARELHO: Insets = { top: 24, bottom: 48, left: 0, right: 0 };

type Props = { children?: ReactNode; testID?: string; style?: { paddingTop?: number } };
vi.mock('react-native', () => ({
  View: ({ children, testID, style }: Props) =>
    createElement('div', { 'data-testid': testID, 'data-padding-top': style?.paddingTop ?? '' }, children),
}));
vi.mock('react-native-safe-area-context', () => {
  // contexto de verdade, como o da biblioteca: o provedor do aparelho fica na raiz (expo-router)
  const SafeAreaInsetsContext = createContext<Insets | null>({ top: 24, bottom: 48, left: 0, right: 0 });
  return {
    SafeAreaInsetsContext,
    useSafeAreaInsets: () => {
      const v = useContext(SafeAreaInsetsContext);
      if (!v) throw new Error('sem provedor');
      return v;
    },
  };
});
vi.mock('@macuxi/ui/mobile', () => ({ colors: new Proxy({}, { get: () => '#000' }) }));

const { AreaSeguraSuperior, useFaixaSuperior } = await import('./area-segura');
const { useSafeAreaInsets } = await import('react-native-safe-area-context');

/** Uma "tela" qualquer de módulo: soma `insets.top` como o detalhe do pedido e o `Screen` fazem. */
function TelaDeModulo() {
  const insets = useSafeAreaInsets();
  const faixa = useFaixaSuperior();
  return createElement('p', { 'data-top': insets.top, 'data-bottom': insets.bottom, 'data-faixa': faixa });
}

describe('dividirAreaSegura', () => {
  it('reserva a altura da barra de status e zera o topo das telas, sem mexer na borda de baixo', () => {
    expect(dividirAreaSegura(APARELHO)).toEqual({ faixaSuperior: 24, insetsDasTelas: { top: 0, bottom: 48, left: 0, right: 0 } });
    expect(dividirAreaSegura({ ...APARELHO, top: 0 }).faixaSuperior).toBe(0);
    expect(dividirAreaSegura({ ...APARELHO, top: 31.6 }).faixaSuperior).toBe(32);
  });
});

describe('AreaSeguraSuperior', () => {
  it('a faixa da barra de status fica no shell e as telas começam abaixo dela (insets.top = 0)', () => {
    const html = renderToStaticMarkup(createElement(AreaSeguraSuperior, null, createElement(TelaDeModulo)));
    expect(html).toContain('data-testid="area-segura-superior" data-padding-top="24"');
    expect(html).toContain('data-top="0"');
    expect(html).toContain('data-bottom="48"');
    expect(html).toContain('data-faixa="24"');
  });

  it('o layout raiz envolve o Stack inteiro (todas as telas empilhadas e as abas, nas duas variantes)', () => {
    const src = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
    const ini = src.indexOf('<AreaSeguraSuperior>');
    const fim = src.indexOf('</AreaSeguraSuperior>');
    expect(ini).toBeGreaterThan(0);
    const dentro = src.slice(ini, fim);
    expect(dentro).toContain('<Stack ');
    expect(dentro).toContain('</Stack>');
  });

  it('o login (KeyboardAvoidingView com padding) desconta a faixa ao medir o teclado', () => {
    const src = readFileSync(new URL('../app/login.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/behavior="padding" keyboardVerticalOffset=\{faixaSuperior\}/);
  });
});
