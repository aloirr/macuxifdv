/**
 * T-0065 (A) — RN-CORE-23 (R-20261102-121135, R-20261102-124413, R-20261102-124628): o app sincroniza ao abrir, ao voltar
 * ao primeiro plano depois de 30 min, a cada `sync_auto_min` (padrão 30, mínimo 15) e no aviso do servidor; puxar para
 * baixo = Sincronizar; disparo manual no máximo 1 vez a cada 30 s, em silêncio (R-20261115-125500). Relógio simulado.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  criarAgendadorSync,
  dentroDoIntervaloManual,
  desenhoBotaoSincronizar,
  desenhoSeloAtualizacao,
  intervaloSyncAutoMs,
  PARAMETRO_SYNC_AUTO,
  INTERVALO_MIN_SYNC_MANUAL_MS,
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

function montar(
  op: { intervaloMin?: unknown; ultima?: number | null; sinal?: boolean; ok?: boolean; abrir?: boolean; duracaoMs?: number; aoMudar?: (e: unknown) => void } = {},
) {
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
    ...(op.aoMudar ? { aoMudar: op.aoMudar } : {}),
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

  it('R-20261115-125500: intervalo mínimo de 30 s entre disparos manuais; volta depois de 30 min', () => {
    expect(INTERVALO_MIN_SYNC_MANUAL_MS).toBe(30_000);
    expect(VOLTA_PRIMEIRO_PLANO_MS).toBe(30 * MIN);
    expect(dentroDoIntervaloManual(null, INICIO)).toBe(false);
    expect(dentroDoIntervaloManual(INICIO, INICIO + 29_999)).toBe(true);
    expect(dentroDoIntervaloManual(INICIO, INICIO + 30_000)).toBe(false);
  });
});

describe('textos', () => {
  it('"Última sincronização hh:mm · N na fila" no fuso do tenant', () => {
    expect(textoUltimaSincronizacao(INICIO, 0, 'America/Manaus')).toBe('Última sincronização 11:00 · 0 na fila');
    expect(textoUltimaSincronizacao('2026-11-02T15:00:00.000Z', 3, 'America/Manaus')).toBe('Última sincronização 11:00 · 3 na fila');
    expect(textoUltimaSincronizacao(null, 2)).toBe('Ainda não sincronizado · 2 na fila');
  });
  it('BotaoSincronizar (T-0076): rótulo curto, situação e motivo do sem sinal numa linha própria', () => {
    expect(desenhoBotaoSincronizar({ semSinal: false, sincronizadoEm: INICIO, naFila: 0, tz: 'America/Manaus' })).toEqual({
      rotulo: 'Sincronizar',
      situacao: 'Última sincronização 11:00 · 0 na fila',
      tom: 'neutro',
      aviso: null,
    });
    const semSinal = desenhoBotaoSincronizar({ semSinal: true, sincronizadoEm: null, naFila: 3 });
    expect(semSinal).toEqual({ rotulo: 'Sem sinal', situacao: 'Ainda não sincronizado · 3 na fila', tom: 'neutro', aviso: 'Desligue o modo sem sinal para sincronizar' });
    // o rótulo cabe numa linha do botão (o Button corta em uma linha)
    expect(semSinal.rotulo.length).toBeLessThanOrEqual(12);
  });
  it('BotaoSincronizar (RD-0008): avisoDados é o aviso único de dado antigo, no lugar da última sincronização, com a fila', () => {
    const base = { semSinal: false, sincronizadoEm: INICIO, naFila: 0, tz: 'America/Manaus' };
    expect(desenhoBotaoSincronizar({ ...base, avisoDados: 'Dados de 06/11, 6h28' })).toEqual({
      rotulo: 'Sincronizar',
      situacao: 'Dados de 06/11, 6h28 · 0 na fila',
      tom: 'atencao',
      aviso: null,
    });
    expect(desenhoBotaoSincronizar({ ...base, naFila: 2, avisoDados: 'Sincronize para ver as vendas' }).situacao).toBe('Sincronize para ver as vendas · 2 na fila');
    // sem sinal: o motivo continua na linha própria e o aviso de dados na linha de situação
    const semSinal = desenhoBotaoSincronizar({ ...base, semSinal: true, avisoDados: 'Dados de 06/11, 6h28' });
    expect(semSinal).toMatchObject({ rotulo: 'Sem sinal', tom: 'atencao', aviso: 'Desligue o modo sem sinal para sincronizar' });
    // sem texto (null, undefined, vazio), nada muda; o aviso não repete "Sincronizar" (o botão logo acima já diz)
    for (const avisoDados of [null, undefined, '', '   ']) {
      expect(desenhoBotaoSincronizar({ ...base, avisoDados })).toEqual(desenhoBotaoSincronizar(base));
    }
    expect(desenhoBotaoSincronizar({ ...base, avisoDados: 'Dados de 06/11, 6h28' }).situacao).not.toMatch(/Sincronizar/);
  });
  it('BotaoSincronizar (T-0076): botão de 52 dp e linha de situação centralizada, como na referência', () => {
    const src = readFileSync(new URL('./sincronizacao.tsx', import.meta.url), 'utf8');
    expect(src).toContain('height={ALTURA.principal}');
    expect(src.match(/testID=\{`\$\{testID\}-situacao`\}/g)?.length).toBe(2);
    // aviso sem sinal, aviso do intervalo (R-20261115-130000), situação (normal e em atenção) e a dica do segurar
    expect(src.match(/textAlign: 'center'/g)?.length).toBe(5);
    expect(src).toContain('desenhoBotaoSincronizar(');
    expect(src).not.toContain('Sem sinal: desligue');
  });
  it('BotaoSincronizar (RD-0008): prop opcional avisoDados, ícone sync e warningInk na linha, testID {testID}-aviso-dados', () => {
    const src = readFileSync(new URL('./sincronizacao.tsx', import.meta.url), 'utf8');
    expect(src).toContain('avisoDados?: string | null;');
    expect(src).toMatch(/desenhoBotaoSincronizar\(\{[^}]*avisoDados \}\)/);
    expect(src).toContain("d.tom === 'atencao'");
    expect(src).toContain('<Icon name="sync" size={14} color={colors.warningInk} />');
    expect(src).toMatch(/testID=\{`\$\{testID\}-aviso-dados`\}/);
    // a linha inteira é lida de uma vez (ícone escondido do leitor), e avisa quando muda
    expect(src).toContain('accessible accessibilityLabel={d.situacao} accessibilityLiveRegion="polite"');
  });
  it('rodapé das listas', () => {
    expect(rodapeAtualizacao(null)).toBe('Puxe para sincronizar');
    expect(rodapeAtualizacao(INICIO, 'America/Manaus')).toBe('Atualizado às 11:00 · puxe para sincronizar');
    // modo sem sinal: só a hora, sem convidar a puxar (o puxar não sincroniza)
    expect(rodapeAtualizacao(INICIO, 'America/Manaus', { semSinal: true })).toBe('Atualizado às 11:00');
    expect(rodapeAtualizacao(null, 'America/Manaus', { semSinal: true })).toBe('Ainda não sincronizado');
    expect(rodapeAtualizacao(undefined, 'America/Manaus', { semSinal: true })).toBe('Ainda não sincronizado');
    expect(rodapeAtualizacao('', 'America/Manaus', { semSinal: true })).toBe('Ainda não sincronizado');
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

  it('R-20261115-125500: puxar = Sincronizar (manual) na hora; outro em menos de 30 s é ignorado em silêncio (nenhum aoMudar, nenhum timer)', async () => {
    const mudancas: unknown[] = [];
    const { ag, chamadas } = montar({ aoMudar: (e) => mudancas.push(e) });
    ag.primeiroPlano();
    await avancar(0);
    vi.setSystemTime(INICIO + 2_000);
    expect(await ag.puxar()).toBe('sincronizou');
    expect(chamadas.map((c) => c.motivo)).toEqual(['abertura', 'manual']);
    const antes = mudancas.length;
    const estadoAntes = ag.estado();
    vi.setSystemTime(INICIO + 20_000);
    const timers = vi.getTimerCount();
    expect(await ag.puxar()).toBe('ignorado');
    expect(await ag.puxar()).toBe('ignorado');
    expect(mudancas).toHaveLength(antes);
    expect(ag.estado()).toBe(estadoAntes);
    expect(ag.estado()).toEqual({ puxando: false });
    expect(vi.getTimerCount()).toBe(timers);
    expect(chamadas).toHaveLength(2);
    // passados os 30 s do último disparo, volta a disparar
    vi.setSystemTime(INICIO + 32_000);
    expect(await ag.puxar()).toBe('sincronizou');
    expect(chamadas).toHaveLength(3);
    ag.parar();
  });

  it('R-20261115-125500: liberarManual (completa) usa o mesmo intervalo do puxar e registra o disparo', async () => {
    const mudancas: unknown[] = [];
    const { ag, chamadas } = montar({ aoMudar: (e) => mudancas.push(e) });
    ag.primeiroPlano();
    await avancar(0);
    const antes = mudancas.length;
    // completa livre: registra; o puxar seguinte dentro de 30 s é ignorado
    expect(ag.liberarManual()).toBe(true);
    expect(mudancas).toHaveLength(antes);
    vi.setSystemTime(INICIO + 10_000);
    expect(await ag.puxar()).toBe('ignorado');
    expect(ag.liberarManual()).toBe(false);
    expect(chamadas.map((c) => c.motivo)).toEqual(['abertura']);
    // depois de 30 s do disparo: o puxar volta; a completa logo depois cai no intervalo
    vi.setSystemTime(INICIO + 30_000);
    expect(await ag.puxar()).toBe('sincronizou');
    vi.setSystemTime(INICIO + 40_000);
    expect(ag.liberarManual()).toBe(false);
    vi.setSystemTime(INICIO + 60_000);
    expect(ag.liberarManual()).toBe(true);
    ag.parar();
    expect(ag.liberarManual()).toBe(false);
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

describe('desenhoSeloAtualizacao — RD-0076: um só indicador de sincronização no cabeçalho da lista', () => {
  const base = { atualizadoEm: INICIO, tz: 'America/Manaus', modoSemSinal: false, semRede: false, atualizando: false, semResposta: false };

  it('normal: só a hora, toque = sincronizar', () => {
    const d = desenhoSeloAtualizacao(base);
    expect(d).toMatchObject({ estado: 'ok', texto: '11:00', tom: 'neutro', icone: 'sync', acao: 'sincronizar' });
    expect(d.rotuloAcessivel).toBe('Atualizado às 11:00');
    expect(desenhoSeloAtualizacao({ ...base, atualizadoEm: null })).toMatchObject({ texto: 'Sincronizar', rotuloAcessivel: 'Ainda não sincronizado' });
  });

  it('sem sinal vence tudo; com o modo ligado o toque abre o Perfil', () => {
    const modo = desenhoSeloAtualizacao({ ...base, modoSemSinal: true, atualizando: true, semResposta: true });
    expect(modo).toMatchObject({ estado: 'sem_sinal', texto: 'Sem sinal', tom: 'atencao', icone: 'alert', acao: 'perfil' });
    expect(modo.rotuloAcessivel).toBe('Sem sinal. A lista mostra o que está no aparelho, atualizado às 11:00.');
    expect(desenhoSeloAtualizacao({ ...base, semRede: true })).toMatchObject({ estado: 'sem_sinal', acao: 'sincronizar' });
  });

  it('atualizando vence a falha anterior e não aceita toque', () => {
    expect(desenhoSeloAtualizacao({ ...base, atualizando: true, semResposta: true })).toMatchObject({ estado: 'atualizando', texto: 'Atualizando…', acao: 'nenhuma', dica: null });
  });

  it('sem resposta do servidor: texto curto, leitura completa, toque = tentar de novo', () => {
    const d = desenhoSeloAtualizacao({ ...base, semResposta: true });
    expect(d).toMatchObject({ estado: 'sem_resposta', texto: 'Sem resposta', tom: 'atencao', acao: 'sincronizar', dica: 'Tenta de novo' });
    expect(d.rotuloAcessivel).toBe('Sem resposta do servidor. A lista mostra o que está no aparelho, atualizado às 11:00.');
  });

  it('texto visível cabe na pílula (até 13 caracteres)', () => {
    for (const e of [base, { ...base, atualizadoEm: null }, { ...base, semRede: true }, { ...base, atualizando: true }, { ...base, semResposta: true }]) {
      expect(desenhoSeloAtualizacao(e).texto.length).toBeLessThanOrEqual(13);
    }
  });
});
