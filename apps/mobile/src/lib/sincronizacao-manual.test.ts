/**
 * Estoque diário, parte E (ADR 0057; docs/design/sincronizacao-completa.md §1 e §2): o botão "Sincronizar" do shell com o
 * gesto do kit (`criarControleSegurar`, timers falsos), o limite manual de 30 s silencioso e o que o popup mostra.
 */
import type { ProgressoEntrada } from '@macuxi/core/contracts';
import type { ModoSincronizacao } from '@macuxi/platform-sdk';
import { criarControleSegurar } from '@macuxi/ui/mobile/puro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  criarLimiteManual,
  criarSincronizacaoManual,
  INTERVALO_SYNC_MANUAL_MS,
  popupDaCompleta,
  type FasePopupCompleta,
} from './sincronizacao-manual';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-15T14:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

/** Botão montado como no shell: o gesto do kit chamando `tocar`/`segurar`. */
function montar(resultado: () => Promise<boolean> = () => Promise.resolve(true)) {
  const modos: ModoSincronizacao[] = [];
  const fases: FasePopupCompleta[] = [];
  const manual = criarSincronizacaoManual({
    limite: criarLimiteManual(),
    sincronizar: (modo) => {
      modos.push(modo);
      return resultado();
    },
    aoMudar: (f) => fases.push(f),
  });
  const botao = criarControleSegurar({ onToque: manual.tocar, onSegurar: manual.segurar });
  return { modos, fases, manual, botao };
}

describe('toque = parcial, segurar 10 s = completa', () => {
  it('soltar aos 9,9 s = parcial, sem popup', () => {
    const { modos, fases, botao } = montar();
    botao.pressionar();
    vi.advanceTimersByTime(9_900);
    botao.soltar();
    expect(modos).toEqual(['parcial']);
    expect(fases).toEqual([]);
  });

  it('chegar aos 10 s = completa e o popup abre; soltar depois não faz nada', async () => {
    const { modos, fases, botao } = montar();
    botao.pressionar();
    vi.advanceTimersByTime(10_000);
    botao.soltar();
    expect(modos).toEqual(['completa']);
    expect(fases).toEqual(['andando']);
    await vi.runAllTimersAsync();
    expect(fases).toEqual(['andando', 'pronto']);
  });

  it('a completa que falha leva o popup ao erro; "Tentar de novo" roda a completa de novo, mesmo dentro dos 30 s', async () => {
    const { modos, fases, botao, manual } = montar(() => Promise.resolve(false));
    botao.pressionar();
    vi.advanceTimersByTime(10_000);
    await vi.runAllTimersAsync();
    expect(fases).toEqual(['andando', 'erro']);
    manual.tentarDeNovo();
    await vi.runAllTimersAsync();
    expect(modos).toEqual(['completa', 'completa']);
    expect(fases).toEqual(['andando', 'erro', 'andando', 'erro']);
    manual.fechar();
    expect(fases.at(-1)).toBe('fechado');
  });

  it('fechar antes do fim: o resultado que chega depois não reabre o popup', async () => {
    let terminar: (ok: boolean) => void = () => undefined;
    const { fases, manual } = montar(() => new Promise<boolean>((r) => (terminar = r)));
    manual.segurar();
    manual.fechar();
    terminar(true);
    await vi.runAllTimersAsync();
    expect(fases).toEqual(['andando', 'fechado']);
  });
});

describe('limite manual: 1 a cada 30 s, silencioso', () => {
  it('segundo toque dentro dos 30 s não dispara nada; aos 30 s dispara', () => {
    const { modos, fases, manual } = montar();
    manual.tocar();
    vi.advanceTimersByTime(INTERVALO_SYNC_MANUAL_MS - 1);
    manual.tocar();
    expect(modos).toEqual(['parcial']);
    vi.advanceTimersByTime(1);
    manual.tocar();
    expect(modos).toEqual(['parcial', 'parcial']);
    expect(fases).toEqual([]);
  });

  it('a completa (10 s) também respeita a janela do toque: nada roda e o popup não abre', () => {
    const { modos, fases, manual, botao } = montar();
    manual.tocar();
    botao.pressionar();
    vi.advanceTimersByTime(10_000);
    expect(modos).toEqual(['parcial']);
    expect(fases).toEqual([]);
  });

  it('o toque logo depois da completa fica na janela', () => {
    const { modos, manual } = montar();
    manual.segurar();
    vi.advanceTimersByTime(5_000);
    manual.tocar();
    expect(modos).toEqual(['completa']);
  });

  it('o intervalo é uma constante só: 30 s', () => {
    expect(INTERVALO_SYNC_MANUAL_MS).toBe(30_000);
    const limite = criarLimiteManual({ agora: () => 0 });
    expect(limite.tentar()).toBe(true);
    expect(limite.tentar()).toBe(false);
  });
});

describe('popup da completa com a barra da tela de carga', () => {
  const etapa = (numero: number, nome: string) => ({ id: 'catalogo_precos' as const, numero, nome, situacao: 'atual' as const });
  const progresso: Pick<ProgressoEntrada, 'atual' | 'total' | 'percentual' | 'parou_em'> = {
    atual: etapa(3, 'Catálogo e preços'),
    total: 5,
    percentual: 47,
    parou_em: null,
  };

  it('fechado: invisível', () => {
    expect(popupDaCompleta('fechado', progresso, false).visivel).toBe(false);
  });

  it('andando: "Etapa n de N · nome" e o percentual da carga (no máximo 99)', () => {
    expect(popupDaCompleta('andando', progresso, false)).toEqual({
      visivel: true,
      rotulo: 'Etapa 3 de 5 · Catálogo e preços',
      pct: 47,
      erro: null,
    });
    expect(popupDaCompleta('andando', { ...progresso, percentual: 100 }, false).pct).toBe(99);
  });

  it('pronto: "Pronto" e 100%', () => {
    expect(popupDaCompleta('pronto', progresso, false)).toEqual({ visivel: true, rotulo: 'Pronto', pct: 100, erro: null });
  });

  it('erro: o texto da tela de carga sem a lista (sem sinal ou parou)', () => {
    const parou = { ...progresso, parou_em: { ...etapa(3, 'Catálogo e preços'), situacao: 'parou' as const } };
    expect(popupDaCompleta('erro', parou, true).erro).toBe('Sem internet na etapa 3 de 5');
    expect(popupDaCompleta('erro', parou, false).erro).toBe('Parou na etapa 3 de 5');
  });
});
