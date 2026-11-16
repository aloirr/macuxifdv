/**
 * T-0064 item 4 — R-20261102-111044: nenhuma tela do Campo e do Gestão desenha conteúdo sob a barra de status.
 * O shell reserva a faixa da barra de status (com o fundo do app) e as telas recebem `insets.top = 0`; a borda de
 * baixo continua com a tela/barra de abas. Renderização com `react-dom/server` e `react-native` simulado.
 */
import { readFileSync } from 'node:fs';

import { createContext, createElement, useContext, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { dividirAreaSegura, ROTAS_SEM_FAIXA, rotaComFaixa, type Insets } from '@/lib/area-segura';

const APARELHO: Insets = { top: 24, bottom: 48, left: 0, right: 0 };

type Props = { children?: ReactNode; testID?: string; style?: { paddingTop?: number; backgroundColor?: string } };
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  StatusBar: { currentHeight: 20 },
  View: ({ children, testID, style }: Props) =>
    createElement('div', { 'data-testid': testID, 'data-padding-top': style?.paddingTop ?? '', 'data-fundo': style?.backgroundColor ?? '' }, children),
}));
vi.mock('expo-status-bar', () => ({
  StatusBar: ({ style }: { style?: string }) => createElement('i', { 'data-testid': 'barra-de-status', 'data-style': style ?? '' }),
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
const FAIXA = '#1E3350';
const PEROLA = '#F8F6F1';
vi.mock('@macuxi/ui/mobile', () => ({
  colors: { faixa: '#1E3350', ground: '#F8F6F1' },
  estiloBarraDeStatus: (comCabecalho: boolean) => (comCabecalho ? 'light' : 'dark'),
}));
// o foco da aba: guarda o efeito de foco para o teste disparar o foco e o desfoco
const foco = vi.hoisted(() => ({ efeitos: [] as Array<() => void | (() => void)> }));
vi.mock('expo-router', () => ({ useFocusEffect: (efeito: () => void | (() => void)) => void foco.efeitos.push(efeito) }));

const { AreaSeguraSuperior, CorDaFaixaContext, useCorDaFaixaNoFoco, useFaixaSuperior } = await import('./area-segura');
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
  it('T-0076: inset de cima 0 no Android usa a altura da barra de status como piso (o "Olá" não encosta na barra)', () => {
    expect(dividirAreaSegura({ ...APARELHO, top: 0 }, 28).faixaSuperior).toBe(28);
    expect(dividirAreaSegura({ ...APARELHO, top: 0 }, 28).insetsDasTelas.top).toBe(0);
    expect(dividirAreaSegura(APARELHO, 20).faixaSuperior).toBe(24);
    expect(dividirAreaSegura(APARELHO, null).faixaSuperior).toBe(24);
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
    expect(src).toMatch(/const rota = usePathname\(\);/);
    const ini = src.indexOf('<AreaSeguraSuperior rota={rota}>');
    const fim = src.indexOf('</AreaSeguraSuperior>');
    expect(ini).toBeGreaterThan(0);
    const dentro = src.slice(ini, fim);
    expect(dentro).toMatch(/<Stack[\s>]/);
    expect(dentro).toContain('</Stack>');
  });

  it('o login e as telas de senha (KeyboardAvoidingView com padding) descontam a faixa ao medir o teclado', () => {
    // T-0178: o `AcimaDoTeclado` saiu do login para `components/acima-do-teclado.tsx` (login, trocar-senha e esqueci-senha)
    const src = readFileSync(new URL('./acima-do-teclado.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/behavior="padding"\s+keyboardVerticalOffset=\{faixaSuperior\}/);
  });
});

describe('useCorDaFaixaNoFoco (T-0172, Início do Campo)', () => {
  function AbaInicio() {
    useCorDaFaixaNoFoco(FAIXA);
    return null;
  }

  it('no foco pinta a faixa de Azul noite; no desfoco a faixa volta à cor da rota (null)', () => {
    const cores: Array<string | null> = [];
    foco.efeitos.length = 0;
    renderToStaticMarkup(createElement(CorDaFaixaContext.Provider, { value: (cor: string | null) => void cores.push(cor) }, createElement(AbaInicio)));
    expect(foco.efeitos).toHaveLength(1);
    expect(cores).toEqual([]); // montada sem foco não pinta

    const desfocar = foco.efeitos[0]?.();
    expect(cores).toEqual([FAIXA]);

    if (typeof desfocar === 'function') desfocar();
    expect(cores).toEqual([FAIXA, null]);
  });

  it('o Início do Campo usa a faixa no foco com o token da faixa (a barra de status acompanha a cor no shell)', () => {
    const src = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
    expect(src).toContain('useCorDaFaixaNoFoco(colors.faixa)');
  });
});

/** Renderiza o shell na rota e devolve o fundo da faixa e o estilo da barra de status. */
function faixaNa(rota: string | undefined) {
  const html = renderToStaticMarkup(createElement(AreaSeguraSuperior, { rota, children: createElement(TelaDeModulo) }));
  return {
    fundo: /data-testid="area-segura-superior"[^>]*data-fundo="([^"]*)"/.exec(html)?.[1],
    barra: /data-testid="barra-de-status" data-style="([^"]*)"/.exec(html)?.[1],
  };
}

describe('cor da faixa da barra de status (pedido de 14/11/2026, manual da marca §4)', () => {
  it('rota com cabeçalho (Catálogo): faixa Azul noite e ícones claros', () => {
    expect(faixaNa('/m/catalogo')).toEqual({ fundo: FAIXA, barra: 'light' });
  });
  it('Início ("/") sem tela pintando: Pérola e ícones escuros', () => {
    expect(faixaNa('/')).toEqual({ fundo: PEROLA, barra: 'dark' });
  });
  it('barra final não muda a rota: "/mais/" tem faixa', () => {
    expect(faixaNa('/mais/')).toEqual({ fundo: FAIXA, barra: 'light' });
  });
  it('sem rota: a faixa é o padrão', () => {
    expect(faixaNa(undefined)).toEqual({ fundo: FAIXA, barra: 'light' });
  });
});

describe('rotaComFaixa', () => {
  it('só Início, login, sincronização e foto ficam sem faixa', () => {
    expect(ROTAS_SEM_FAIXA).toEqual(['/', '/login', '/sync', '/foto']);
    for (const r of ROTAS_SEM_FAIXA) expect(rotaComFaixa(r)).toBe(false);
    expect(rotaComFaixa('/login/')).toBe(false);
  });
  it('as demais rotas têm faixa; sem rota também', () => {
    for (const r of ['/mais', '/mais/', '/profile', '/diagnostico-carga', '/m/catalogo', '/m/vendedor/clientes']) expect(rotaComFaixa(r)).toBe(true);
    expect(rotaComFaixa(undefined)).toBe(true);
    expect(rotaComFaixa(null)).toBe(true);
    expect(rotaComFaixa('')).toBe(true);
  });
});
