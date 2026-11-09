/**
 * ADR 0017 §3 (T-0059): regras da tarefa `macuxi-sync-delta` em segundo plano. RD-0033 (T-0140): a trava única do
 * processo é a única porta entre a tarefa e o app (o `sync:lease` persistido saiu).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  comOrcamento,
  ESPERA_DO_CORTE_MS,
  executarTarefaSegundoPlano,
  INTERVALO_MINIMO_MIN,
  LIMITE_DA_PASSADA_CORTADA_MS,
  ORCAMENTO_SEGUNDO_PLANO_MS,
  TAREFA_SYNC_DELTA,
  textoDoResultado,
  type DepsTarefaSegundoPlano,
  type MotorSegundoPlano,
} from './segundo-plano';
import { criarCorteDaPassada, criarTravaSync } from './trava-sync';

const AGORA = Date.parse('2026-11-02T15:00:00.000Z');

function motorFalso(o: Partial<MotorSegundoPlano> & { carga?: string | null } = {}): MotorSegundoPlano & { sincronizacoes: number } {
  const m = {
    sincronizacoes: 0,
    sincronizadoEm: () => (o.carga === undefined ? '2026-11-02T14:00:00.000Z' : o.carga),
    prepararSessao: o.prepararSessao ?? (() => Promise.resolve('ok' as const)),
    sincronizar:
      o.sincronizar ??
      (() => {
        m.sincronizacoes++;
        return Promise.resolve(true);
      }),
    erro: o.erro ?? (() => null),
  };
  return m;
}

function cenario(o: { motor?: MotorSegundoPlano; motorDoApp?: MotorSegundoPlano | null; usuario?: string | null; semSinal?: boolean; orcamentoMs?: number } = {}) {
  const abertos: string[] = [];
  const motor = o.motor ?? motorFalso();
  const trava = criarTravaSync();
  const deps: DepsTarefaSegundoPlano = {
    agora: () => AGORA,
    orcamentoMs: o.orcamentoMs,
    modoSemSinal: () => Promise.resolve(Boolean(o.semSinal)),
    motorDoApp: () => o.motorDoApp ?? null,
    usuarioDaSessao: () => Promise.resolve(o.usuario === undefined ? 'u1' : o.usuario),
    abrirMotor: (u) => {
      abertos.push(u);
      return Promise.resolve(motor);
    },
    trava,
  };
  return { deps, abertos, motor, trava };
}

describe('constantes da ADR 0017', () => {
  it('tarefa, intervalo, orçamento e limite da passada cortada', () => {
    expect(TAREFA_SYNC_DELTA).toBe('macuxi-sync-delta');
    expect(INTERVALO_MINIMO_MIN).toBe(15);
    expect(ORCAMENTO_SEGUNDO_PLANO_MS).toBe(60_000);
    expect(LIMITE_DA_PASSADA_CORTADA_MS).toBe(120_000);
  });
});

describe('executarTarefaSegundoPlano — quando NÃO roda', () => {
  it('modo sem sinal ligado → pula sem abrir o motor', async () => {
    const c = cenario({ semSinal: true });
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'pulado', motivo: 'modo-sem-sinal' });
    expect(c.abertos).toEqual([]);
  });

  it('sem sessão guardada → pula', async () => {
    const c = cenario({ usuario: null });
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'pulado', motivo: 'sem-sessao' });
    expect(c.abertos).toEqual([]);
  });

  it('nunca sem sincronizado_em (carga inicial só com o app aberto): não sincroniza e solta a trava', async () => {
    const motor = motorFalso({ carga: null });
    const c = cenario({ motor });
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'pulado', motivo: 'sem-carga' });
    expect(motor.sincronizacoes).toBe(0);
    expect(c.trava.segundoPlanoAtivo()).toBe(false);
    // também com o app aberto ainda na carga inicial
    const doApp = motorFalso({ carga: null });
    expect(await executarTarefaSegundoPlano(cenario({ motorDoApp: doApp }).deps)).toMatchObject({ resultado: 'pulado', motivo: 'sem-carga' });
    expect(doApp.sincronizacoes).toBe(0);
  });

  it('sessão inválida (renovação do token falhou) → não sincroniza e solta a trava', async () => {
    const motor = motorFalso({ prepararSessao: () => Promise.resolve('sessao-invalida') });
    const c = cenario({ motor });
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'pulado', motivo: 'sessao-invalida' });
    expect(motor.sincronizacoes).toBe(0);
    expect(c.trava.segundoPlanoAtivo()).toBe(false);
  });

  it('aparelho bloqueado (RN-CORE-15) → não sincroniza e não regrava nada', async () => {
    const motor = motorFalso({ prepararSessao: () => Promise.resolve('aparelho-bloqueado') });
    const c = cenario({ motor });
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'pulado', motivo: 'aparelho-bloqueado' });
    expect(motor.sincronizacoes).toBe(0);
  });

  it('outra passada da tarefa com a trava neste processo → pula "em andamento"; solta a trava → roda', async () => {
    const c = cenario();
    expect(c.trava.tomarSegundoPlano()).toBe(true);
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'pulado', motivo: 'em-andamento' });
    expect(c.abertos).toEqual([]);
    expect(c.trava.segundoPlanoAtivo()).toBe(true); // a trava continua com a outra passada
    c.trava.liberarSegundoPlano();
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'sincronizado' });
  });

  it('RD-0033: nada persistido segura a próxima vez (processo morto no meio da tarefa = trava nova, livre)', async () => {
    // o lease gravado no arquivo sobrevivia ao processo e segurava o Sincronizar do app por até 2 min; a trava morre junto
    const c = cenario();
    expect(c.trava.segundoPlanoAtivo()).toBe(false);
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'sincronizado', sem_tela: true });
  });
});

describe('executarTarefaSegundoPlano — quando roda', () => {
  it('app fechado: abre o motor do usuário e sincroniza', async () => {
    const c = cenario();
    const r = await executarTarefaSegundoPlano(c.deps);
    expect(r).toMatchObject({ resultado: 'sincronizado', quando: '2026-11-02T15:00:00.000Z', sem_tela: true });
    expect(c.abertos).toEqual(['u1']);
  });

  it('app aberto no mesmo processo: usa o motor do app (sem abrir outro nem segurar a trava)', async () => {
    const doApp = motorFalso();
    const c = cenario({ motorDoApp: doApp });
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'sincronizado' });
    expect(doApp.sincronizacoes).toBe(1);
    expect(c.abertos).toEqual([]);
    expect(c.trava.segundoPlanoAtivo()).toBe(false);
  });

  it('falha do motor → "falhou" com a mensagem para o Diagnóstico', async () => {
    const motor = motorFalso({ sincronizar: () => Promise.resolve(false), erro: () => 'HTTP 502' });
    const r = await executarTarefaSegundoPlano(cenario({ motor }).deps);
    expect(r).toMatchObject({ resultado: 'falhou', mensagem: 'HTTP 502' });
    expect(textoDoResultado(r)).toContain('falhou');
  });

  it('exceção em qualquer passo não escapa (a tarefa nunca lança)', async () => {
    const c = cenario();
    c.deps.abrirMotor = () => Promise.reject(new Error('disco cheio'));
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'falhou', mensagem: 'disco cheio' });
  });

  it('orçamento de 60 s esgotado → "parcial"; a trava fica com a passada que segue gravando (no máximo 2 min)', async () => {
    vi.useFakeTimers();
    try {
      const motor = motorFalso({ sincronizar: () => new Promise<boolean>(() => undefined) });
      const c = cenario({ motor });
      const p = executarTarefaSegundoPlano(c.deps);
      await vi.advanceTimersByTimeAsync(ORCAMENTO_SEGUNDO_PLANO_MS + 1);
      const r = await p;
      expect(r.resultado).toBe('parcial');
      expect(textoDoResultado(r)).toContain('tempo esgotado');
      expect(c.trava.segundoPlanoAtivo()).toBe(true);
      await vi.advanceTimersByTimeAsync(LIMITE_DA_PASSADA_CORTADA_MS);
      expect(c.trava.segundoPlanoAtivo()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('comOrcamento', () => {
  it('termina antes do limite → valor; depois → terminou: false', async () => {
    expect(await comOrcamento(Promise.resolve(7), 1_000)).toEqual({ terminou: true, valor: 7 });
    vi.useFakeTimers();
    try {
      const p = comOrcamento(new Promise<number>(() => undefined), 500);
      await vi.advanceTimersByTimeAsync(501);
      expect(await p).toEqual({ terminou: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('textoDoResultado', () => {
  it('motivo legível para o suporte', () => {
    expect(textoDoResultado({ quando: '', resultado: 'pulado', motivo: 'sem-carga', duracao_ms: 1_234 })).toBe('não rodou: carga inicial ainda não concluída · 1.2 s');
    expect(textoDoResultado({ quando: '', resultado: 'sincronizado', duracao_ms: 8_000 })).toBe('concluída · 8 s');
  });
});

/**
 * T-0140 (relatos 1 e 6: o app abria e fechava depois de atualizado e na carga inicial): a tarefa sem tela não roda junto
 * com o app (primeiro plano, abertura, sincronização), não roda num build que ainda não abriu com tela, corta a passada no
 * fim do orçamento e nunca lança.
 */
describe('executarTarefaSegundoPlano — proteções da T-0140', () => {
  it('app em primeiro plano → pula sem abrir motor nem ler sessão (o agendador do app sincroniza)', async () => {
    const c = cenario();
    const sessao = vi.fn(c.deps.usuarioDaSessao);
    c.deps.usuarioDaSessao = sessao;
    c.deps.appEmPrimeiroPlano = () => true;
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'pulado', motivo: 'app-aberto' });
    expect(c.abertos).toEqual([]);
    expect(sessao).not.toHaveBeenCalled();
  });

  it('app abrindo ou sincronizando no processo (trava única) → pula na hora, sem abrir o motor', async () => {
    const c = cenario();
    const trava = c.trava;
    trava.entrar('abertura');
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'pulado', motivo: 'app-ocupado' });
    expect(c.abertos).toEqual([]);
    trava.sair('abertura');
    trava.entrar('sincronizacao');
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'pulado', motivo: 'app-ocupado' });
    expect(trava.segundoPlanoAtivo()).toBe(false);
  });

  it('segura a trava durante a passada sem tela e solta no fim (também na falha)', async () => {
    let durante: boolean | null = null;
    const motor = motorFalso({
      sincronizar: () => {
        durante = c.trava.segundoPlanoAtivo();
        return Promise.resolve(true);
      },
    });
    const c = cenario({ motor });
    const trava = c.trava;
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'sincronizado', sem_tela: true });
    expect(durante).toBe(true);
    expect(trava.segundoPlanoAtivo()).toBe(false);

    c.deps.abrirMotor = () => Promise.reject(new Error('banco local do usuário não abriu'));
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'falhou', mensagem: 'banco local do usuário não abriu' });
    expect(trava.segundoPlanoAtivo()).toBe(false);
  });

  it('com o motor do app vivo (app em segundo plano) solta a trava antes de sincronizar: sem espera cruzada', async () => {
    let durante: boolean | null = null;
    const doApp = motorFalso({
      sincronizar: () => {
        // a sincronização do app entra na trava como do app; com a tarefa segurando, o app esperaria a tarefa
        durante = c.trava.segundoPlanoAtivo();
        return Promise.resolve(true);
      },
    });
    const c = cenario({ motorDoApp: doApp });
    const r = await executarTarefaSegundoPlano(c.deps);
    expect(r).toMatchObject({ resultado: 'sincronizado' });
    expect(r.sem_tela).toBeUndefined();
    expect(durante).toBe(false);
  });

  it('build ainda não aberto com tela (logo depois da atualização do APK) → pula sem ler sessão nem abrir o SQLite', async () => {
    const c = cenario();
    const sessao = vi.fn(c.deps.usuarioDaSessao);
    c.deps.usuarioDaSessao = sessao;
    c.deps.buildAindaNaoAberto = () => Promise.resolve(true);
    const r = await executarTarefaSegundoPlano(c.deps);
    expect(r).toMatchObject({ resultado: 'pulado', motivo: 'app-atualizado' });
    expect(textoDoResultado(r)).toBe('não rodou: app atualizado, espera a 1ª abertura · 0 s');
    expect(sessao).not.toHaveBeenCalled();
    expect(c.abertos).toEqual([]);
    expect(c.trava.segundoPlanoAtivo()).toBe(false);
    // com o app vivo no processo o build já abriu: usa o motor do app
    const c2 = cenario({ motorDoApp: motorFalso() });
    c2.deps.buildAindaNaoAberto = () => Promise.resolve(true);
    expect(await executarTarefaSegundoPlano(c2.deps)).toMatchObject({ resultado: 'sincronizado' });
  });

  it('orçamento esgotado sem tela → corta a passada, espera ela parar e solta a trava', async () => {
    vi.useFakeTimers();
    try {
      const corte = criarCorteDaPassada();
      // a passada só para quando o corte recusa a próxima página
      const motor = motorFalso({
        sincronizar: () =>
          new Promise<boolean>((resolve) => {
            const t = setInterval(() => {
              if (corte.cortada()) {
                clearInterval(t);
                resolve(false);
              }
            }, 1_000);
          }),
      });
      const c = cenario({ motor });
      const trava = c.trava;
      c.deps.aoEsgotarOrcamento = () => corte.cortar();
      const p = executarTarefaSegundoPlano(c.deps);
      await vi.advanceTimersByTimeAsync(ORCAMENTO_SEGUNDO_PLANO_MS + 2_000);
      const r = await p;
      expect(corte.cortada()).toBe(true);
      expect(r).toMatchObject({ resultado: 'parcial', sem_tela: true });
      expect(textoDoResultado(r)).toContain('app fechado');
      expect(trava.segundoPlanoAtivo()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passada cortada que não para em 10 s → a tarefa devolve; a trava fica com a passada até ela parar', async () => {
    vi.useFakeTimers();
    try {
      let terminar: (ok: boolean) => void = () => undefined;
      const motor = motorFalso({ sincronizar: () => new Promise<boolean>((resolve) => (terminar = resolve)) });
      const c = cenario({ motor });
      const cortou = vi.fn();
      c.deps.aoEsgotarOrcamento = cortou;
      const p = executarTarefaSegundoPlano(c.deps);
      await vi.advanceTimersByTimeAsync(ORCAMENTO_SEGUNDO_PLANO_MS + ESPERA_DO_CORTE_MS + 1);
      const r = await p;
      expect(cortou).toHaveBeenCalledOnce();
      expect(r.resultado).toBe('parcial');
      // o app que tocar em Sincronizar agora espera a passada (sem segunda passada no mesmo arquivo)
      expect(c.trava.segundoPlanoAtivo()).toBe(true);
      const esperaDoApp = c.trava.esperarSegundoPlano();
      terminar(false);
      await vi.advanceTimersByTimeAsync(0);
      await esperaDoApp;
      expect(c.trava.segundoPlanoAtivo()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('motor do app no orçamento esgotado: não corta a sincronização do app', async () => {
    vi.useFakeTimers();
    try {
      const doApp = motorFalso({ sincronizar: () => new Promise<boolean>(() => undefined) });
      const c = cenario({ motorDoApp: doApp });
      const cortou = vi.fn();
      c.deps.aoEsgotarOrcamento = cortou;
      const p = executarTarefaSegundoPlano(c.deps);
      await vi.advanceTimersByTimeAsync(ORCAMENTO_SEGUNDO_PLANO_MS + 1);
      expect((await p).resultado).toBe('parcial');
      expect(cortou).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('textos novos do Diagnóstico', () => {
    expect(textoDoResultado({ quando: '', resultado: 'pulado', motivo: 'app-aberto', duracao_ms: 0 })).toBe('não rodou: o app estava aberto (ele mesmo sincroniza) · 0 s');
    expect(textoDoResultado({ quando: '', resultado: 'pulado', motivo: 'app-ocupado', duracao_ms: 0 })).toBe('não rodou: o app estava abrindo ou sincronizando · 0 s');
    expect(textoDoResultado({ quando: '', resultado: 'sincronizado', duracao_ms: 3_000, sem_tela: true })).toBe('concluída · 3 s · app fechado');
  });
});
