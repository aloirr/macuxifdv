/**
 * R-20261115-100000 (docs/design/sync-completa/spec.md): toque no Sincronizar = parcial; segurar 10 s = completa. Relógio simulado.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  criarControleSegurar,
  desenhoSegurar,
  dicaDoSegurar,
  DICAS_SEGURAR,
  ESPERA_ANEL_MS,
  modoDoSegurar,
  ROTULO_ACESSIVEL_SYNC,
  SEGURAR_COMPLETA_MS,
  TEXTOS_SYNC_COMPLETA,
  vibracaoDoSegurar,
  type ForcaVibracao,
  type ModoSegurar,
} from './sincronizacao-completa';

describe('tempos e textos', () => {
  it('10 s para a completa, anel depois de 500 ms', () => {
    expect(SEGURAR_COMPLETA_MS).toBe(10_000);
    expect(ESPERA_ANEL_MS).toBe(500);
  });
  it('textos do R-20261115-100000', () => {
    expect(TEXTOS_SYNC_COMPLETA).toEqual({ titulo: 'Realizando a sincronização completa', texto: 'Aguarde e não saia desta tela.', acao: 'Sincronização completa' });
    expect(DICAS_SEGURAR.repouso).toBe('Segure 10 s para a sincronização completa');
    expect(DICAS_SEGURAR.segurando).toBe('Solte antes para atualizar só pedidos e clientes');
    expect(ROTULO_ACESSIVEL_SYNC).toBe('Sincronizar. Toque para pedidos e clientes; ação: sincronização completa');
  });
});

describe('desenhoSegurar', () => {
  it('solto ou antes de 500 ms: nada muda no botão', () => {
    for (const ms of [null, 0, 200, 499]) {
      const d = desenhoSegurar(ms);
      expect(d.anel).toBe(false);
      expect(d.rotulo).toBeNull();
      expect(d.completa).toBe(false);
    }
  });
  it('anel a partir de 500 ms, contagem de 10 até 1', () => {
    expect(desenhoSegurar(500)).toMatchObject({ anel: true, segundosRestantes: 10, rotulo: 'Continue segurando · 10 s' });
    expect(desenhoSegurar(4000).rotulo).toBe('Continue segurando · 6 s');
    expect(desenhoSegurar(9001).rotulo).toBe('Continue segurando · 1 s');
    const vistos = new Set<number>();
    for (let ms = 500; ms < 10_000; ms += 50) vistos.add(desenhoSegurar(ms).segundosRestantes);
    expect([...vistos]).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });
  it('o anel se completa em 10 s', () => {
    expect(desenhoSegurar(5000).progresso).toBeCloseTo(0.5);
    expect(desenhoSegurar(10_000)).toMatchObject({ completa: true, progresso: 1, rotulo: null, segundosRestantes: 0 });
  });
  it('reduzir movimento: anel cheio e parado, só a contagem muda', () => {
    expect(desenhoSegurar(1000, { reduzirMovimento: true }).progresso).toBe(1);
    expect(desenhoSegurar(7000, { reduzirMovimento: true })).toMatchObject({ progresso: 1, rotulo: 'Continue segurando · 3 s' });
  });
});

describe('modo, dica e vibração', () => {
  it('sem sincronizarCompleta = só toque; sem sinal ou ocupado = nada', () => {
    expect(modoDoSegurar({ temCompleta: true, semSinal: false, ocupado: false })).toBe('segurar');
    expect(modoDoSegurar({ temCompleta: false, semSinal: false, ocupado: false })).toBe('toque');
    expect(modoDoSegurar({ temCompleta: true, semSinal: true, ocupado: false })).toBe('nenhum');
    expect(modoDoSegurar({ temCompleta: true, semSinal: false, ocupado: true })).toBe('nenhum');
  });
  it('dica só no modo segurar (a completa é oferecida e há sinal)', () => {
    const modo = (temCompleta: boolean, semSinal: boolean) => modoDoSegurar({ temCompleta, semSinal, ocupado: false });
    expect(dicaDoSegurar({ modo: modo(true, false), segurando: false })).toBe(DICAS_SEGURAR.repouso);
    expect(dicaDoSegurar({ modo: modo(true, false), segurando: true })).toBe(DICAS_SEGURAR.segurando);
    expect(dicaDoSegurar({ modo: modo(false, false), segurando: false })).toBeNull();
    expect(dicaDoSegurar({ modo: modo(true, true), segurando: false })).toBeNull();
  });
  it('ocupado (sincronizando ou popup aberto) → sem dica', () => {
    const modo = modoDoSegurar({ temCompleta: true, semSinal: false, ocupado: true });
    expect(dicaDoSegurar({ modo, segurando: false })).toBeNull();
  });
  it('leve ao surgir o anel, média aos 10 s, nada no resto', () => {
    expect(vibracaoDoSegurar(450, 500)).toBe('leve');
    expect(vibracaoDoSegurar(500, 550)).toBeNull();
    expect(vibracaoDoSegurar(9950, 10_000)).toBe('media');
    expect(vibracaoDoSegurar(0, 10_000)).toBe('media');
  });
});

describe('criarControleSegurar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-11-15T14:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  function montar(modoInicial: ModoSegurar = 'segurar', liberar?: () => boolean) {
    const ctl = { modo: modoInicial };
    const chamadas = { parcial: 0, completa: 0, vibrou: [] as ForcaVibracao[], ms: [] as (number | null)[] };
    const c = criarControleSegurar({
      modo: () => ctl.modo,
      parcial: () => void chamadas.parcial++,
      completa: () => void chamadas.completa++,
      vibrar: (f) => void chamadas.vibrou.push(f),
      aoMudar: (ms) => void chamadas.ms.push(ms),
      ...(liberar ? { liberar } : {}),
    });
    return { c, ctl, chamadas };
  }

  it('toque curto = parcial', () => {
    const { c, chamadas } = montar();
    c.pressionar();
    vi.advanceTimersByTime(200);
    c.soltar();
    c.tocar();
    expect(chamadas).toMatchObject({ parcial: 1, completa: 0, vibrou: [] });
  });

  it('soltar antes dos 10 s = parcial (com a vibração leve do anel)', () => {
    const { c, chamadas } = montar();
    c.pressionar();
    vi.advanceTimersByTime(6000);
    c.soltar();
    c.tocar();
    expect(chamadas).toMatchObject({ parcial: 1, completa: 0, vibrou: ['leve'] });
    expect(chamadas.ms.at(-1)).toBeNull();
  });

  it('aos 10 s chama a completa com o dedo ainda no botão; soltar depois não faz a parcial', () => {
    const { c, chamadas } = montar();
    c.pressionar();
    vi.advanceTimersByTime(10_000);
    expect(chamadas).toMatchObject({ parcial: 0, completa: 1, vibrou: ['leve', 'media'] });
    vi.advanceTimersByTime(3000);
    expect(chamadas.completa).toBe(1);
    c.soltar();
    c.tocar();
    expect(chamadas.parcial).toBe(0);
    // o gesto seguinte volta ao normal
    c.pressionar();
    c.soltar();
    c.tocar();
    expect(chamadas.parcial).toBe(1);
  });

  it('sem sincronizarCompleta: segurar não conta, o toque faz a parcial', () => {
    const { c, chamadas } = montar('toque');
    c.pressionar();
    vi.advanceTimersByTime(12_000);
    c.soltar();
    c.tocar();
    expect(chamadas).toMatchObject({ parcial: 1, completa: 0, vibrou: [], ms: [] });
  });

  it('sem sinal: segurar e tocar nada fazem', () => {
    const { c, chamadas } = montar('nenhum');
    c.pressionar();
    vi.advanceTimersByTime(12_000);
    c.soltar();
    c.tocar();
    c.acaoDoLeitor();
    expect(chamadas).toMatchObject({ parcial: 0, completa: 0, vibrou: [], ms: [] });
  });

  it('perdeu o sinal no meio do segurar: para sem disparar', () => {
    const { c, ctl, chamadas } = montar();
    c.pressionar();
    vi.advanceTimersByTime(3000);
    ctl.modo = 'nenhum';
    vi.advanceTimersByTime(8000);
    expect(chamadas.completa).toBe(0);
    expect(chamadas.ms.at(-1)).toBeNull();
  });

  it('cancelado (o dedo saiu sem onPress) não faz nada', () => {
    const { c, chamadas } = montar();
    c.pressionar();
    vi.advanceTimersByTime(3000);
    c.soltar();
    vi.advanceTimersByTime(10_000);
    expect(chamadas).toMatchObject({ parcial: 0, completa: 0 });
  });

  it('ação do leitor de tela = completa direto (só com a completa oferecida)', () => {
    const a = montar();
    a.c.acaoDoLeitor();
    expect(a.chamadas.completa).toBe(1);
    const b = montar('toque');
    b.c.acaoDoLeitor();
    expect(b.chamadas.completa).toBe(0);
  });

  it('R-20261115-125500: segurar dentro do intervalo mínimo = sem completa e sem a vibração final, em silêncio', () => {
    let livre = false;
    let pedidos = 0;
    const { c, chamadas } = montar('segurar', () => (pedidos++, livre));
    c.pressionar();
    vi.advanceTimersByTime(10_000);
    expect(chamadas).toMatchObject({ completa: 0, vibrou: ['leve'] });
    expect(pedidos).toBe(1);
    expect(chamadas.ms.at(-1)).toBeNull();
    // soltar depois não vira parcial
    c.soltar();
    c.tocar();
    expect(chamadas.parcial).toBe(0);
    // leitor de tela também respeita o intervalo
    c.acaoDoLeitor();
    expect(chamadas.completa).toBe(0);
    // livre: vibra média e chama a completa
    livre = true;
    c.pressionar();
    vi.advanceTimersByTime(10_000);
    expect(chamadas).toMatchObject({ completa: 1, vibrou: ['leve', 'leve', 'media'] });
    c.acaoDoLeitor();
    expect(chamadas.completa).toBe(2);
  });
});

describe('BotaoSincronizar, Dialogo e BarraProgresso (fonte)', () => {
  const botao = readFileSync(new URL('./sincronizacao.tsx', import.meta.url), 'utf8');
  const folha = readFileSync(new URL('./folha.tsx', import.meta.url), 'utf8');
  const barra = readFileSync(new URL('./barra-progresso-rn.tsx', import.meta.url), 'utf8');
  it('mantém os testIDs e ganha a dica', () => {
    for (const id of ['`${testID}-bloco`', '`${testID}-situacao`', '`${testID}-sem-sinal`', '`${testID}-aviso-dados`', '`${testID}-dica`']) expect(botao).toContain(id);
  });
  it('contrato do provider (aditivo)', () => {
    expect(botao).toMatch(/sincronizarCompleta\?: \(\) => void;/);
    expect(botao).toMatch(/vibrar\?: \(forca: ForcaVibracao\) => void;/);
    expect(botao).toMatch(/completaEmCurso\?: boolean;/);
  });
  it('Dialogo: botões opcionais, conteúdo e bloqueado (Voltar sem efeito), sem quebrar os testIDs', () => {
    expect(folha).toMatch(/cancelar\?: AcaoTexto;/);
    expect(folha).toMatch(/confirmar\?: AcaoTexto & \{ ocupado\?: boolean \};/);
    expect(folha).toMatch(/bloqueado\?: boolean;/);
    expect(folha).toMatch(/children\?: ReactNode;/);
    expect(folha).toContain('const fechar = bloqueado ? semAcao : (onFechar ?? cancelar?.onPress ?? semAcao);');
    expect(folha).toContain('{cancelar || confirmar ? (');
    for (const id of ['`${testID}-cancelar`', '`${testID}-confirmar`']) expect(folha).toContain(id);
  });
  it('BarraProgresso: igual à da entrada (testIDs, trecho sem medida, 240 ms, progressbar 0..100, sem cor fixa)', () => {
    expect(barra).toContain("testID = 'entrada'");
    for (const id of ['`${testID}-etapa`', '`${testID}-pct`']) expect(barra).toContain(id);
    expect(barra).toContain('export const TRECHO_SEM_MEDIDA = 30;');
    expect(barra).toContain("duracaoMovimento('barra', false)");
    expect(barra).toContain('accessibilityRole="progressbar"');
    expect(barra).toContain("rotuloAcessivel = 'Sincronização'");
    expect(barra).toContain('{ min: 0, max: 100, now: pct }');
    expect(barra).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });
});
