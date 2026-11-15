/**
 * Estoque diário, parte E: o botão do shell liga o `BotaoSincronizar` do kit (toque = parcial, segurar 10 s = completa) e o
 * `PopupSincronizacaoCompleta`, que começa fechado e mostra a barra da carga (`estado.carga`/`estado.progresso`) na completa.
 */
import { CARGA_VAZIA, type ModoSincronizacao } from '@macuxi/platform-sdk';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  modos: [] as string[],
  botao: null as null | { onPress: () => void; onSegurar: () => void; testID?: string },
  popup: null as null | { visivel: boolean; rotulo: string; pct: number | null; erro: string | null },
}));

vi.mock('@macuxi/ui/mobile', () => ({
  BotaoSincronizar: (p: { onPress: () => void; onSegurar: () => void; testID?: string }) => {
    sim.botao = p;
    return createElement('button', { 'data-testid': p.testID });
  },
  PopupSincronizacaoCompleta: (p: { visivel: boolean; rotulo: string; pct: number | null; erro: string | null }) => {
    sim.popup = p;
    return p.visivel ? createElement('dialog', null, p.rotulo) : null;
  },
}));
// RN-CORE-48 (domain do Core) simulado: o texto da barra é testado em `lib/sincronizacao-manual.test`
vi.mock('@macuxi/core/app', () => {
  const atual = { id: 'envio', numero: 1, nome: 'Envio do que ficou no aparelho', situacao: 'atual' };
  return { progressoDaEntrada: () => ({ etapas: [atual], atual, total: 5, percentual: 0, pronta: false, parou_em: null }) };
});
vi.mock('@macuxi/platform-sdk/react', () => ({
  useMotorSync: () => ({ estado: { carga: CARGA_VAZIA, progresso: 0, sincronizando: false, sincronizado_em: null, erro: null } }),
}));
vi.mock('@/state/plataforma', () => ({
  usePlataforma: () => ({
    sincronizarManual: (modo: ModoSincronizacao) => {
      sim.modos.push(modo);
      return new Promise<boolean>(() => undefined);
    },
    limiteManual: { tentar: () => true },
    sessao: { user: { id: 'u1' }, tenant: { id: 't1' } },
    perfil: 'vendedor',
    modulosAtivos: ['core', 'catalogo', 'vendedor'],
    offline: false,
  }),
}));

const { SincronizarDoShell } = await import('./sincronizar-do-shell');

const montar = (): ReactNode => createElement(SincronizarDoShell, { testID: 'inicio-sincronizar' });

describe('SincronizarDoShell', () => {
  it('monta o botão do kit com toque e segurar e o popup fechado', () => {
    const html = renderToStaticMarkup(montar());
    expect(html).toContain('data-testid="inicio-sincronizar"');
    expect(html).not.toContain('<dialog');
    expect(sim.popup?.visivel).toBe(false);
    sim.botao?.onPress();
    expect(sim.modos).toEqual(['parcial']);
    sim.botao?.onSegurar();
    expect(sim.modos).toEqual(['parcial', 'completa']);
  });
});
