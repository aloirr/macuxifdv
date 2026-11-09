/**
 * T-0140 (relatos 1 e 6): trava única entre o app com tela e a tarefa sem tela, corte da passada no fim do orçamento,
 * identidade do build (a tarefa espera a 1ª abertura depois da atualização), execução que nunca derruba e a vez devolvida
 * ao sistema entre as páginas da carga.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  buildAindaNaoAberto,
  cederAVez,
  criarCorteDaPassada,
  criarTravaSync,
  idDoBuild,
  PassadaCortada,
  semDerrubar,
  semDerrubarAgora,
} from './trava-sync';

describe('criarTravaSync', () => {
  it('livre: a tarefa toma; uma segunda passada da tarefa não toma', () => {
    const t = criarTravaSync();
    expect(t.appOcupado()).toBe(false);
    expect(t.tomarSegundoPlano()).toBe(true);
    expect(t.segundoPlanoAtivo()).toBe(true);
    expect(t.tomarSegundoPlano()).toBe(false);
    t.liberarSegundoPlano();
    expect(t.segundoPlanoAtivo()).toBe(false);
  });

  it('app abrindo ou sincronizando: a tarefa não toma; contador por tipo (aninhadas valem)', () => {
    const t = criarTravaSync();
    t.entrar('abertura');
    t.entrar('sincronizacao');
    t.entrar('sincronizacao');
    expect(t.tomarSegundoPlano()).toBe(false);
    t.sair('abertura');
    t.sair('sincronizacao');
    expect(t.appOcupado()).toBe(true);
    expect(t.tomarSegundoPlano()).toBe(false);
    t.sair('sincronizacao');
    expect(t.appOcupado()).toBe(false);
    expect(t.tomarSegundoPlano()).toBe(true);
  });

  it('sair a mais não deixa contador negativo', () => {
    const t = criarTravaSync();
    t.sair('abertura');
    t.sair('abertura');
    t.entrar('abertura');
    expect(t.appOcupado()).toBe(true);
    t.sair('abertura');
    expect(t.appOcupado()).toBe(false);
  });

  it('o app nunca fica preso pela trava: entra mesmo com a tarefa rodando e espera ela terminar', async () => {
    const t = criarTravaSync();
    expect(t.tomarSegundoPlano()).toBe(true);
    t.entrar('abertura');
    expect(t.appOcupado()).toBe(true);
    let terminou = false;
    const espera = t.esperarSegundoPlano().then(() => {
      terminou = true;
    });
    await Promise.resolve();
    expect(terminou).toBe(false);
    t.liberarSegundoPlano();
    await espera;
    expect(terminou).toBe(true);
    // sem passada: resolve na hora
    await expect(t.esperarSegundoPlano()).resolves.toBeUndefined();
  });

  it('liberar sem ter tomado não chama quem espera de novo', () => {
    const t = criarTravaSync();
    expect(() => t.liberarSegundoPlano()).not.toThrow();
  });
});

describe('criarCorteDaPassada', () => {
  it('antes do corte deixa passar; depois recusa a próxima requisição com PassadaCortada', () => {
    const c = criarCorteDaPassada();
    expect(() => c.conferir()).not.toThrow();
    expect(c.cortada()).toBe(false);
    c.cortar();
    expect(c.cortada()).toBe(true);
    expect(() => c.conferir()).toThrow(PassadaCortada);
    expect(() => c.conferir()).toThrow('Tempo da sincronização em segundo plano esgotado; continua na próxima execução.');
  });
});

describe('idDoBuild e buildAindaNaoAberto', () => {
  it('versão + versionCode; sem dado vira "?"', () => {
    expect(idDoBuild('1.0.1', 3)).toBe('1.0.1+3');
    expect(idDoBuild('1.0.1', '3')).toBe('1.0.1+3');
    expect(idDoBuild(undefined, null)).toBe('?+?');
    expect(idDoBuild('', undefined)).toBe('?+?');
  });

  it('a instalação por cima (versão ou versionCode novo) fica "ainda não aberta" até a 1ª abertura com tela', () => {
    expect(buildAindaNaoAberto('1.0.1+3', null)).toBe(true);
    expect(buildAindaNaoAberto('1.0.1+3', undefined)).toBe(true);
    expect(buildAindaNaoAberto('1.0.1+3', '1.0.0+2')).toBe(true);
    expect(buildAindaNaoAberto('1.0.1+4', '1.0.1+3')).toBe(true);
    expect(buildAindaNaoAberto('1.0.1+3', '1.0.1+3')).toBe(false);
  });
});

describe('semDerrubar', () => {
  it('erro síncrono ou assíncrono vira a reserva e vai ao registro', async () => {
    const registrar = vi.fn();
    expect(
      await semDerrubar(
        () => {
          throw new Error('defineTask quebrou');
        },
        registrar,
        'reserva',
      ),
    ).toBe('reserva');
    expect(await semDerrubar(() => Promise.reject(new Error('sqlite')), registrar, 0)).toBe(0);
    expect(registrar).toHaveBeenCalledTimes(2);
    expect(await semDerrubar(() => Promise.resolve(7), registrar, 0)).toBe(7);
    expect(registrar).toHaveBeenCalledTimes(2);
  });

  it('nem o registro que lança derruba', async () => {
    const r = await semDerrubar(
      () => Promise.reject(new Error('x')),
      () => {
        throw new Error('storage cheio');
      },
      'ok',
    );
    expect(r).toBe('ok');
  });

  it('semDerrubarAgora (escopo global, na carga do bundle) não deixa o erro subir', () => {
    const registrar = vi.fn();
    expect(() =>
      semDerrubarAgora(() => {
        throw new Error('TaskManager sem módulo nativo');
      }, registrar),
    ).not.toThrow();
    expect(registrar).toHaveBeenCalledOnce();
    expect(() =>
      semDerrubarAgora(
        () => {
          throw new Error('a');
        },
        () => {
          throw new Error('b');
        },
      ),
    ).not.toThrow();
  });
});

describe('cederAVez', () => {
  it('só resolve depois que o sistema devolve a vez (macrotarefa), não no mesmo tique', async () => {
    let agendada: (() => void) | null = null;
    let resolveu = false;
    const p = cederAVez((f) => {
      agendada = f;
    }).then(() => {
      resolveu = true;
    });
    await Promise.resolve();
    expect(resolveu).toBe(false);
    expect(agendada).not.toBeNull();
    (agendada as unknown as () => void)();
    await p;
    expect(resolveu).toBe(true);
  });

  it('padrão: setTimeout 0', async () => {
    vi.useFakeTimers();
    try {
      let resolveu = false;
      const p = cederAVez().then(() => {
        resolveu = true;
      });
      await Promise.resolve();
      expect(resolveu).toBe(false);
      await vi.advanceTimersByTimeAsync(0);
      await p;
      expect(resolveu).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
