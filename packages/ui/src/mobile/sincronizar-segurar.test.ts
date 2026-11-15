/** Estoque diário, parte F: botão Sincronizar com segurar 10 s e popup da completa (docs/design/sincronizacao-completa.md). */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACAO_SINCRONIZACAO_COMPLETA,
  criarControleSegurar,
  ESPERA_PRONTO_POPUP_MS,
  ESTADO_REPOUSO,
  LIMIAR_CONTAGEM_MS,
  popupPronto,
  rotuloDoSegurar,
  SEGURAR_COMPLETA_MS,
  segundosParaCompleta,
  TEXTO_SINCRONIZACAO_COMPLETA,
  type EstadoSegurar,
  type OpcoesSegurar,
} from './sincronizar-segurar';
import { contraste } from '../comum/contraste';
import { colors } from './tokens';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

function montar(extra: Partial<OpcoesSegurar> = {}) {
  const onToque = vi.fn();
  const onSegurar = vi.fn();
  const vibrar = vi.fn();
  const onAnunciar = vi.fn();
  const estados: EstadoSegurar[] = [];
  const c = criarControleSegurar({ onToque, onSegurar, vibrar, onAnunciar, onMudar: (e) => estados.push(e), ...extra });
  const ultimo = (): EstadoSegurar => estados.at(-1) ?? { fase: 'repouso', segundos: -1, pct: -1 };
  return { c, onToque, onSegurar, vibrar, onAnunciar, estados, ultimo };
}

describe('segurar 10 s (§1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('constantes: 10 s, limiar 600 ms, Pronto 600 ms', () => {
    expect(SEGURAR_COMPLETA_MS).toBe(10_000);
    expect(LIMIAR_CONTAGEM_MS).toBe(600);
    expect(ESPERA_PRONTO_POPUP_MS).toBe(600);
  });

  it('toque rápido = toque, sem contagem nem vibração', () => {
    const m = montar();
    m.c.pressionar();
    vi.advanceTimersByTime(200);
    m.c.soltar();
    expect(m.onToque).toHaveBeenCalledTimes(1);
    expect(m.onSegurar).not.toHaveBeenCalled();
    expect(m.vibrar).not.toHaveBeenCalled();
    expect(m.estados.some((e) => e.fase === 'contando')).toBe(false);
    expect(m.ultimo()).toEqual(ESTADO_REPOUSO);
  });

  it('9,9 s segurando e solta = toque', () => {
    const m = montar();
    m.c.pressionar();
    vi.advanceTimersByTime(9_900);
    m.c.soltar();
    vi.advanceTimersByTime(5_000);
    expect(m.onToque).toHaveBeenCalledTimes(1);
    expect(m.onSegurar).not.toHaveBeenCalled();
    expect(m.ultimo()).toEqual(ESTADO_REPOUSO);
  });

  it('10 s = segurar: vibra, volta ao repouso e soltar depois não faz nada', () => {
    const m = montar();
    m.c.pressionar();
    vi.advanceTimersByTime(10_000);
    expect(m.onSegurar).toHaveBeenCalledTimes(1);
    expect(m.vibrar).toHaveBeenCalledTimes(2); // aos 600 ms e aos 10 s
    expect(m.ultimo()).toEqual(ESTADO_REPOUSO);
    m.c.soltar();
    expect(m.onToque).not.toHaveBeenCalled();
    expect(m.onSegurar).toHaveBeenCalledTimes(1);
  });

  it('contagem e faixa só a partir de 600 ms: "em 9 s" e 6%; aos 4 s "em 6 s" e 40%', () => {
    const m = montar();
    m.c.pressionar();
    vi.advanceTimersByTime(599);
    expect(m.ultimo().fase).toBe('pressionado');
    vi.advanceTimersByTime(1);
    expect(m.ultimo()).toEqual({ fase: 'contando', segundos: 9, pct: 6 });
    expect(m.vibrar).toHaveBeenCalledTimes(1);
    expect(m.onAnunciar).toHaveBeenCalledWith('Sincronização completa em 9 segundos');
    vi.advanceTimersByTime(3_400);
    expect(m.ultimo()).toEqual({ fase: 'contando', segundos: 6, pct: 40 });
    expect(rotuloDoSegurar(m.ultimo().segundos)).toBe('Sincronização completa em 6 s');
    vi.advanceTimersByTime(5_000);
    expect(m.ultimo()).toEqual({ fase: 'contando', segundos: 1, pct: 90 });
    expect(m.onAnunciar).toHaveBeenCalledTimes(1);
  });

  it('segundos de 9 a 1', () => {
    expect(segundosParaCompleta(600)).toBe(9);
    expect(segundosParaCompleta(1_000)).toBe(9);
    expect(segundosParaCompleta(4_000)).toBe(6);
    expect(segundosParaCompleta(9_999)).toBe(1);
  });

  it('ocupado: o toque não faz nada, o segurar funciona', () => {
    const m = montar({ ocupado: () => true });
    m.c.pressionar();
    m.c.soltar();
    expect(m.onToque).not.toHaveBeenCalled();
    m.c.pressionar();
    vi.advanceTimersByTime(10_000);
    expect(m.onSegurar).toHaveBeenCalledTimes(1);
  });

  it('cancelar limpa sem disparar nada', () => {
    const m = montar();
    m.c.pressionar();
    vi.advanceTimersByTime(3_000);
    m.c.cancelar();
    vi.advanceTimersByTime(10_000);
    m.c.soltar();
    expect(m.onToque).not.toHaveBeenCalled();
    expect(m.onSegurar).not.toHaveBeenCalled();
    expect(m.ultimo()).toEqual(ESTADO_REPOUSO);
  });
});

describe('popup da sincronização completa (§2)', () => {
  it('texto literal do Alexandre e ação de acessibilidade', () => {
    expect(TEXTO_SINCRONIZACAO_COMPLETA).toBe('Realizando a sincronização completa, aguarde e não saia dessa tela');
    expect(ACAO_SINCRONIZACAO_COMPLETA).toBe('Sincronização completa');
  });

  it('Pronto = 100% sem erro (RD-0323: a frase sai)', () => {
    expect(popupPronto(100, null)).toBe(true);
    expect(popupPronto(99, null)).toBe(false);
    expect(popupPronto(null, null)).toBe(false);
    expect(popupPronto(100, 'Parou na etapa 3 de 5')).toBe(false);
    const src = ler('./sincronizar-segurar-rn.tsx');
    expect(src).toContain('{pronto ? null : (');
    expect(src).toContain('setTimeout(() => fecharRef.current(), ESPERA_PRONTO_POPUP_MS)');
  });

  it('não fecha por toque fora nem Voltar; no erro, o Voltar = Fechar', () => {
    const src = ler('./sincronizar-segurar-rn.tsx');
    expect(src).toContain('onRequestClose={() => (erro ? onFechar() : undefined)}');
    expect(src).toContain('<Botao rotulo="Tentar de novo" nivel="principal"');
    expect(src).toContain('<Botao rotulo="Fechar" nivel="neutro"');
    expect(src).not.toMatch(/fundo[^\n]*onPress/);
  });

  it('cores: faixa graficoEscuro no grafite e erro danger no branco', () => {
    expect(contraste(colors.graficoEscuro, colors.ink)).toBeGreaterThanOrEqual(3);
    expect(contraste(colors.danger, colors.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('BotaoSincronizar: onPress e onSegurar; sem onSegurar, o botão de antes', () => {
    const src = ler('./sincronizacao.tsx');
    expect(src).toContain('onSegurar?: () => void;');
    expect(src).toContain('onPress?: () => void;');
    expect(src).toContain('{onSegurar ? (');
    expect(src).toContain('const tocar = onPress ?? (() => void s.agendador.puxar());');
  });

  it('BarraProgresso do kit mantém os testIDs da tela de entrada', () => {
    const src = ler('./barra-progresso-rn.tsx');
    expect(src).toContain("testID = 'entrada'");
    expect(src).toContain('testID={`${testID}-etapa`}');
    expect(src).toContain('testID={`${testID}-pct`}');
    expect(src).toContain("rotuloAcessivel = 'Sincronização'");
  });
});
