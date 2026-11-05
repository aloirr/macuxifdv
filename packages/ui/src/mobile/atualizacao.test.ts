/**
 * T-0065 (A) — RN-CORE-23 (R-20261102-121135, R-20261102-124413, R-20261102-124628): o app sincroniza ao abrir, ao voltar
 * ao primeiro plano depois de 30 min, a cada `sync_auto_min` (padrão 30, mínimo 15) e no aviso do servidor; puxar para
 * baixo = Sincronizar com proteção de 30 s. Relógio simulado.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  criarAgendadorSync,
  dentroDaProtecao,
  desenhoBotaoSincronizar,
  intervaloSyncAutoMs,
  PARAMETRO_SYNC_AUTO,
  PROTECAO_PUXAR_MS,
  rodapeAtualizacao,
  SYNC_AUTO_MIN_MIN,
  SYNC_AUTO_PADRAO_MIN,
  textoUltimaSincronizacao,
  VOLTA_PRIMEIRO_PLANO_MS,
  type MotivoSync,
} from './atualizacao';

const MIN = 60_000;
const INICIO = Date.parse('2026-11-02T15:00:00.000Z'); // 11:00 em Manaus

async function avancar(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

function montar(op: { intervaloMin?: unknown; ultima?: number | null; sinal?: boolean; ok?: boolean; abrir?: boolean; duracaoMs?: number } = {}) {
  const chamadas: { motivo: MotivoSync; entidades?: readonly string[]; em: number }[] = [];
  let ultima: number | null = op.ultima === undefined ? INICIO - 60 * MIN : op.ultima;
  const ctl = { sinal: op.sinal ?? true, ok: op.ok ?? true, intervaloMin: op.intervaloMin };
  const ag = criarAgendadorSync({
    intervaloMs: () => intervaloSyncAutoMs(ctl.intervaloMin),
    sincronizar: async (motivo, entidades) => {
      chamadas.push({ motivo, ...(entidades ? { entidades } : {}), em: Date.now() });
      if (op.duracaoMs) await new Promise((r) => setTimeout(r, op.duracaoMs));
      if (!ctl.ok) return false;
      ultima = Date.now();
      return true;
    },
    ultimaSincronizacao: () => ultima,
    podeSincronizar: () => ctl.sinal,
    ...(op.abrir === false ? { sincronizarAoAbrir: false } : {}),
  });
  return { ag, chamadas, ctl };
}

describe('parâmetro sync_auto_min', () => {
  it('RN-CORE-23: padrão 30 min, mínimo 15; aceita número ou texto; inválido volta ao padrão', () => {
    expect(PARAMETRO_SYNC_AUTO).toBe('sync_auto_min');
    expect(SYNC_AUTO_PADRAO_MIN).toBe(30);
    expect(SYNC_AUTO_MIN_MIN).toBe(15);
    expect(intervaloSyncAutoMs(undefined)).toBe(30 * MIN);
    expect(intervaloSyncAutoMs(null)).toBe(30 * MIN);
    expect(intervaloSyncAutoMs('abc')).toBe(30 * MIN);
    expect(intervaloSyncAutoMs(0)).toBe(30 * MIN);
    expect(intervaloSyncAutoMs(-5)).toBe(30 * MIN);
    expect(intervaloSyncAutoMs(45)).toBe(45 * MIN);
    expect(intervaloSyncAutoMs('20')).toBe(20 * MIN);
    // abaixo de 15 vale 15 (o 3–5 min foi cancelado)
    expect(intervaloSyncAutoMs(5)).toBe(15 * MIN);
    expect(intervaloSyncAutoMs(3)).toBe(15 * MIN);
    expect(intervaloSyncAutoMs(14.9)).toBe(15 * MIN);
    expect(intervaloSyncAutoMs(15)).toBe(15 * MIN);
    // teto de segurança de 1 dia (temporizador do JS)
    expect(intervaloSyncAutoMs(10_000_000)).toBe(24 * 60 * MIN);
  });

  it('proteção de 30 s e volta depois de 30 min', () => {
    expect(PROTECAO_PUXAR_MS).toBe(30_000);
    expect(VOLTA_PRIMEIRO_PLANO_MS).toBe(30 * MIN);
    expect(dentroDaProtecao(null, INICIO)).toBe(false);
    expect(dentroDaProtecao(INICIO, INICIO + 29_999)).toBe(true);
    expect(dentroDaProtecao(INICIO, INICIO + 30_000)).toBe(false);
  });
});

describe('textos', () => {
  it('"Última sincronização hh:mm · N na fila" no fuso do tenant', () => {
    expect(textoUltimaSincronizacao(INICIO, 0, 'America/Manaus')).toBe('Última sincronização 11:00 · 0 na fila');
    expect(textoUltimaSincronizacao('2026-11-02T15:00:00.000Z', 3, 'America/Manaus')).toBe('Última sincronização 11:00 · 3 na fila');
    expect(textoUltimaSincronizacao(null, 2)).toBe('Ainda não sincronizado · 2 na fila');
  });
  it('BotaoSincronizar (T-0076): rótulo curto, situação e motivo do sem sinal numa linha própria', () => {
    expect(desenhoBotaoSincronizar({ semSinal: false, recente: false, sincronizadoEm: INICIO, naFila: 0, tz: 'America/Manaus' })).toEqual({
      rotulo: 'Sincronizar',
      situacao: 'Última sincronização 11:00 · 0 na fila',
      aviso: null,
    });
    expect(desenhoBotaoSincronizar({ semSinal: false, recente: true, sincronizadoEm: INICIO, naFila: 2 }).situacao).toBe('Atualizado há instantes');
    const semSinal = desenhoBotaoSincronizar({ semSinal: true, recente: false, sincronizadoEm: null, naFila: 3 });
    expect(semSinal).toEqual({ rotulo: 'Sem sinal', situacao: 'Ainda não sincronizado · 3 na fila', aviso: 'Desligue o modo sem sinal para sincronizar' });
    // o rótulo cabe numa linha do botão (o Button corta em uma linha)
    expect(semSinal.rotulo.length).toBeLessThanOrEqual(12);
  });
  it('BotaoSincronizar (T-0076): botão de 52 dp e linha de situação centralizada, como na referência', () => {
    const src = readFileSync(new URL('./sincronizacao.tsx', import.meta.url), 'utf8');
    expect(src).toContain('height={ALTURA.principal}');
    expect(src).toMatch(/testID=\{`\$\{testID\}-situacao`\}/);
    expect(src.match(/textAlign: 'center'/g)?.length).toBe(2);
    expect(src).toContain('desenhoBotaoSincronizar(');
    expect(src).not.toContain('Sem sinal: desligue');
  });
  it('rodapé das listas', () => {
    expect(rodapeAtualizacao(null)).toBe('Puxe para sincronizar');
    expect(rodapeAtualizacao(INICIO, 'America/Manaus')).toBe('Atualizado às 11:00 · puxe para sincronizar');
    expect(rodapeAtualizacao(INICIO, 'America/Manaus', { recente: true })).toBe('Atualizado há instantes');
    // modo sem sinal: só a hora, sem convidar a puxar (o puxar não sincroniza)
    expect(rodapeAtualizacao(INICIO, 'America/Manaus', { semSinal: true })).toBe('Atualizado às 11:00');
    expect(rodapeAtualizacao(INICIO, 'America/Manaus', { semSinal: true, recente: true })).toBe('Atualizado às 11:00');
    expect(rodapeAtualizacao(null, 'America/Manaus', { semSinal: true })).toBe('Ainda não sincronizado');
  });
});

describe('criarAgendadorSync (relógio simulado)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(INICIO);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('abre o app: 1 sincronização leve; depois só 1 a cada 30 min (padrão), nunca antes', async () => {
    const { ag, chamadas } = montar();
    ag.primeiroPlano();
    await avancar(0);
    expect(chamadas.map((c) => c.motivo)).toEqual(['abertura']);
    await avancar(29 * MIN);
    expect(chamadas).toHaveLength(1);
    await avancar(1 * MIN);
    expect(chamadas.map((c) => c.motivo)).toEqual(['abertura', 'periodico']);
    await avancar(60 * MIN);
    expect(chamadas).toHaveLength(4);
    ag.parar();
  });

  it('parâmetro de 5 min vale 15: nenhuma automática antes de 15 min', async () => {
    const { ag, chamadas } = montar({ intervaloMin: 5 });
    ag.primeiroPlano();
    await avancar(0);
    await avancar(14 * MIN);
    expect(chamadas).toHaveLength(1);
    await avancar(1 * MIN);
    expect(chamadas).toHaveLength(2);
    ag.parar();
  });

  it('acabou de fazer a carga inicial: não sincroniza de novo ao abrir, só no intervalo', async () => {
    const { ag, chamadas } = montar({ abrir: false, ultima: INICIO });
    ag.primeiroPlano();
    await avancar(29 * MIN);
    expect(chamadas).toHaveLength(0);
    await avancar(1 * MIN);
    expect(chamadas.map((c) => c.motivo)).toEqual(['periodico']);
    ag.parar();
  });

  it('segundo plano: nada roda; volta antes de 30 min não sincroniza; volta depois de 30 min sincroniza 1 vez', async () => {
    const { ag, chamadas } = montar();
    ag.primeiroPlano();
    await avancar(0);
    ag.segundoPlano();
    await avancar(20 * MIN);
    expect(chamadas).toHaveLength(1);
    ag.primeiroPlano();
    await avancar(0);
    expect(chamadas).toHaveLength(1);
    ag.segundoPlano();
    await avancar(15 * MIN); // 35 min desde a última
    ag.primeiroPlano();
    await avancar(0);
    expect(chamadas.map((c) => c.motivo)).toEqual(['abertura', 'volta']);
    ag.parar();
  });

  it('sem sinal: nenhuma automática e nada de laço; com sinal de novo, segue no intervalo', async () => {
    const { ag, chamadas, ctl } = montar({ sinal: false });
    ag.primeiroPlano();
    await avancar(90 * MIN);
    expect(chamadas).toHaveLength(0);
    ctl.sinal = true;
    await avancar(30 * MIN);
    expect(chamadas.map((c) => c.motivo)).toEqual(['periodico']);
    ag.parar();
  });

  it('sincronização que falha não repete em laço: espera o intervalo inteiro', async () => {
    const { ag, chamadas } = montar({ ok: false });
    ag.primeiroPlano();
    await avancar(0);
    await avancar(29 * MIN);
    expect(chamadas).toHaveLength(1);
    await avancar(1 * MIN);
    expect(chamadas).toHaveLength(2);
    ag.parar();
  });

  it('puxar = Sincronizar (manual) na hora, mesmo logo depois da abertura; outro puxar em menos de 30 s é ignorado ("Atualizado há instantes")', async () => {
    const { ag, chamadas } = montar();
    ag.primeiroPlano();
    await avancar(0);
    vi.setSystemTime(INICIO + 2_000);
    expect(await ag.puxar()).toBe('sincronizou');
    expect(chamadas.map((c) => c.motivo)).toEqual(['abertura', 'manual']);
    vi.setSystemTime(INICIO + 20_000);
    expect(await ag.puxar()).toBe('recente');
    expect(ag.estado().recente).toBe(true);
    expect(chamadas).toHaveLength(2);
    // a mensagem some quando a proteção acaba
    await avancar(12_000);
    expect(ag.estado().recente).toBe(false);
    expect(await ag.puxar()).toBe('sincronizou');
    expect(chamadas).toHaveLength(3);
    ag.parar();
  });

  it('puxar liga o indicador só durante a sincronização manual; puxar recomeça a contagem da automática', async () => {
    const { ag, chamadas } = montar({ duracaoMs: 1_000 });
    ag.primeiroPlano();
    await avancar(1_000);
    await avancar(10 * MIN);
    const p = ag.puxar();
    expect(ag.estado().puxando).toBe(true);
    await avancar(1_000);
    expect(await p).toBe('sincronizou');
    expect(ag.estado().puxando).toBe(false);
    await avancar(29 * MIN);
    expect(chamadas).toHaveLength(2);
    await avancar(1 * MIN);
    expect(chamadas.map((c) => c.motivo)).toEqual(['abertura', 'manual', 'periodico']);
    ag.parar();
  });

  it('puxar durante uma automática em curso espera ela e faz a manual em seguida', async () => {
    const { ag, chamadas } = montar({ duracaoMs: 5_000 });
    ag.primeiroPlano();
    const p = ag.puxar();
    await avancar(10_000);
    expect(await p).toBe('sincronizou');
    expect(chamadas.map((c) => c.motivo)).toEqual(['abertura', 'manual']);
    ag.parar();
  });

  it('aviso do servidor (push silencioso) sincroniza na hora só as entidades indicadas', async () => {
    const { ag, chamadas } = montar();
    ag.primeiroPlano();
    await avancar(0);
    await avancar(2 * MIN);
    await ag.aviso(['pedido']);
    expect(chamadas[1]).toMatchObject({ motivo: 'aviso', entidades: ['pedido'] });
    ag.parar();
  });

  it('aviso sem sinal é ignorado; depois de parar, nada roda', async () => {
    const { ag, chamadas, ctl } = montar({ sinal: false });
    ag.primeiroPlano();
    await ag.aviso(['pedido']);
    expect(chamadas).toHaveLength(0);
    ctl.sinal = true;
    ag.parar();
    await ag.aviso(['pedido']);
    await avancar(120 * MIN);
    expect(chamadas).toHaveLength(0);
  });
});
