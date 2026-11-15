/**
 * R-20261115-100000: popup da sincronização completa no shell. O `Dialogo` do kit fica bloqueado (Voltar sem efeito) e sem
 * botões enquanto roda, com a `BarraProgresso` no tema Pérola; com erro, "Fechar" e "Tentar de novo". A tela fica acesa
 * (`useKeepAwake`) só enquanto roda.
 */
import { CARGA_VAZIA, type EstadoMotorSync } from '@macuxi/platform-sdk';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FaseCompleta } from '@/lib/sync-completa';

const sim = vi.hoisted(() => ({
  dialogo: null as null | Record<string, unknown>,
  barra: null as null | Record<string, unknown>,
  acesa: 0,
  estado: null as unknown as EstadoMotorSync,
}));

// o índice de `@macuxi/core/app` puxa telas: os módulos nativos viram vazios e a regra das etapas é a real
vi.mock('react-native', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('react-native-safe-area-context', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('react-native-svg', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('expo-router', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('expo-keep-awake', () => ({
  useKeepAwake: () => {
    sim.acesa++;
  },
}));
/** Kit simulado; o resto do kit (usado pelas telas do Core, carregadas junto com o `@macuxi/core/app`) vira um vazio. */
vi.mock('@macuxi/ui/mobile', () => {
  const vazio: unknown = new Proxy(() => null, {
    get: (_alvo, chave) => (chave === 'then' ? undefined : vazio),
  });
  const simulado: Record<string | symbol, unknown> = {
    TEMAS_ENTRADA: {
      perola: {
        texto: '#perola-texto',
        trilho: '#perola-trilho',
        preenchimento: '#perola-barra',
        erro: '#erro',
      },
    },
    TEXTOS_SYNC_COMPLETA: {
      titulo: 'Realizando a sincronização completa',
      texto: 'Aguarde e não saia desta tela.',
      acao: 'x',
    },
    useReduzirMovimento: () => false,
    Dialogo: (p: Record<string, unknown> & { children?: ReactNode }) => {
      sim.dialogo = p;
      return createElement('div', null, p.children);
    },
    BarraProgresso: (p: Record<string, unknown>) => {
      sim.barra = p;
      return createElement('span', null, String(p.rotulo));
    },
  };
  return new Proxy(simulado, {
    get: (alvo, chave) => (chave in alvo ? alvo[chave] : chave === 'then' ? undefined : vazio),
    has: () => true,
  });
});
vi.mock('@/components/tela-entrada', () => ({
  ErroEntrada: ({ texto }: { texto: string }) =>
    createElement('em', { 'data-testid': 'entrada-erro' }, texto),
}));
// do `@macuxi/core/app` só a regra das etapas (RN-CORE-48); o resto do pacote (telas do Core) fica de fora
vi.mock('@macuxi/core/app', async (importOriginal) => ({
  progressoDaEntrada: (await importOriginal<typeof import('@macuxi/core/app')>()).progressoDaEntrada,
}));
vi.mock('@macuxi/platform-sdk/react', () => ({ useMotorSync: () => ({ motor: null, estado: sim.estado }) }));
vi.mock('@/state/plataforma', () => ({
  usePlataforma: () => ({
    sessao: { user: { id: 'u1' } },
    perfil: 'vendedor',
    modulosAtivos: ['core', 'catalogo', 'vendedor'],
    variante: 'campo',
    offline: false,
  }),
}));

const { PopupSyncCompleta } = await import('./popup-sync-completa');

function render(fase: FaseCompleta, estado: Partial<EstadoMotorSync> = {}) {
  sim.dialogo = null;
  sim.barra = null;
  sim.acesa = 0;
  sim.estado = {
    fila: [],
    aceitos: [],
    enviando: false,
    sincronizando: fase === 'rodando',
    etapa: '',
    progresso: 0.4,
    erro: null,
    sincronizado_em: '2026-11-15T12:00:00.000Z',
    modulosAtivos: [],
    limpezaPendente: [],
    avisos: [],
    arquivos: [],
    carga: CARGA_VAZIA,
    ...estado,
  };
  const fechar = vi.fn();
  const tentar = vi.fn();
  const html = renderToStaticMarkup(
    createElement(PopupSyncCompleta, { fase, rodada: 1, aoFechar: fechar, aoTentarDeNovo: tentar }),
  );
  return { html, fechar, tentar };
}

describe('PopupSyncCompleta', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rodando: visível, Voltar bloqueado, sem botões, barra Pérola com a etapa e o percentual, tela acesa', () => {
    const { html } = render('rodando');
    expect(sim.dialogo).toMatchObject({
      visivel: true,
      bloqueado: true,
      titulo: 'Realizando a sincronização completa',
      mensagem: 'Aguarde e não saia desta tela.',
      cancelar: undefined,
      confirmar: undefined,
    });
    expect(sim.barra).toMatchObject({
      pct: 40,
      cores: { texto: '#perola-texto', trilho: '#perola-trilho', preenchimento: '#perola-barra' },
    });
    expect(String(sim.barra?.rotulo)).toMatch(/^Etapa \d+ de \d+ · /);
    expect(html).not.toContain('entrada-erro');
    expect(sim.acesa).toBe(1);
  });

  it('pronto: "Pronto" e 100%, tela já pode apagar', () => {
    render('pronto', { sincronizando: false, progresso: 1 });
    expect(sim.barra).toMatchObject({ rotulo: 'Pronto', pct: 100 });
    expect(sim.dialogo?.bloqueado).toBe(true);
    expect(sim.acesa).toBe(0);
  });

  it('erro: linha da carga, "Fechar" e "Tentar de novo", e o Voltar fecha', () => {
    const { html, fechar, tentar } = render('erro', { sincronizando: false, erro: 'Falhou' });
    expect(html).toMatch(/Parou na etapa \d+ de \d+/);
    expect(sim.barra).toBeNull();
    expect(sim.dialogo?.bloqueado).toBe(false);
    const d = sim.dialogo as {
      cancelar: { rotulo: string; onPress: () => void };
      confirmar: { rotulo: string; onPress: () => void };
      onFechar: () => void;
    };
    expect(d.cancelar.rotulo).toBe('Fechar');
    expect(d.confirmar.rotulo).toBe('Tentar de novo');
    d.confirmar.onPress();
    expect(tentar).toHaveBeenCalledTimes(1);
    d.cancelar.onPress();
    d.onFechar();
    expect(fechar).toHaveBeenCalledTimes(2);
    expect(sim.acesa).toBe(0);
  });

  it('fechado: invisível e tela livre', () => {
    render('fechado', { sincronizando: false });
    expect(sim.dialogo?.visivel).toBe(false);
    expect(sim.acesa).toBe(0);
  });
});
