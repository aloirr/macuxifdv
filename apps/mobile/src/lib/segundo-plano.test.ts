/**
 * ADR 0017 §3 (T-0059): regras da tarefa `macuxi-sync-delta` em segundo plano.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CHAVE_LEASE,
  comOrcamento,
  DONO_APP,
  executarTarefaSegundoPlano,
  INTERVALO_MINIMO_MIN,
  leaseOcupado,
  novoLease,
  ORCAMENTO_SEGUNDO_PLANO_MS,
  TAREFA_SYNC_DELTA,
  textoDoResultado,
  VALIDADE_LEASE_MS,
  type DepsTarefaSegundoPlano,
  type LeaseSync,
  type MotorSegundoPlano,
} from './segundo-plano';

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

function cenario(o: { motor?: MotorSegundoPlano; motorDoApp?: MotorSegundoPlano | null; usuario?: string | null; semSinal?: boolean; lease?: LeaseSync | null; orcamentoMs?: number } = {}) {
  const guardado: { lease: LeaseSync | null; gravacoes: LeaseSync[] } = { lease: o.lease ?? null, gravacoes: [] };
  const abertos: string[] = [];
  const motor = o.motor ?? motorFalso();
  const deps: DepsTarefaSegundoPlano = {
    agora: () => AGORA,
    orcamentoMs: o.orcamentoMs,
    modoSemSinal: () => Promise.resolve(Boolean(o.semSinal)),
    motorDoApp: () => o.motorDoApp ?? null,
    usuarioDaSessao: () => Promise.resolve(o.usuario === undefined ? 'u1' : o.usuario),
    lease: () => ({
      ler: () => Promise.resolve(guardado.lease),
      gravar: (l) => {
        guardado.lease = l;
        guardado.gravacoes.push(l);
        return Promise.resolve();
      },
      remover: () => {
        guardado.lease = null;
        return Promise.resolve();
      },
    }),
    abrirMotor: (u) => {
      abertos.push(u);
      return Promise.resolve(motor);
    },
  };
  return { deps, guardado, abertos, motor };
}

describe('constantes da ADR 0017', () => {
  it('tarefa, intervalo, orçamento e lease', () => {
    expect(TAREFA_SYNC_DELTA).toBe('macuxi-sync-delta');
    expect(INTERVALO_MINIMO_MIN).toBe(15);
    expect(ORCAMENTO_SEGUNDO_PLANO_MS).toBe(60_000);
    expect(VALIDADE_LEASE_MS).toBe(120_000);
    expect(CHAVE_LEASE).toBe('sync:lease');
  });
});

describe('leaseOcupado', () => {
  it('outro dono e dentro da validade → ocupado; vencido, do mesmo dono ou ilegível → livre', () => {
    const l = novoLease('segundo-plano:1', AGORA);
    expect(leaseOcupado(l, DONO_APP, AGORA + 1_000)).toBe(true);
    expect(leaseOcupado(l, DONO_APP, AGORA + VALIDADE_LEASE_MS + 1)).toBe(false);
    expect(leaseOcupado(l, 'segundo-plano:1', AGORA)).toBe(false);
    expect(leaseOcupado(null, DONO_APP, AGORA)).toBe(false);
    expect(leaseOcupado({ dono: 'x', expira_em: 'lixo' }, DONO_APP, AGORA)).toBe(false);
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

  it('nunca sem sincronizado_em (carga inicial só com o app aberto): não grava lease nem sincroniza', async () => {
    const motor = motorFalso({ carga: null });
    const c = cenario({ motor });
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'pulado', motivo: 'sem-carga' });
    expect(motor.sincronizacoes).toBe(0);
    expect(c.guardado.gravacoes).toEqual([]);
    // também com o app aberto ainda na carga inicial
    const doApp = motorFalso({ carga: null });
    expect(await executarTarefaSegundoPlano(cenario({ motorDoApp: doApp }).deps)).toMatchObject({ resultado: 'pulado', motivo: 'sem-carga' });
    expect(doApp.sincronizacoes).toBe(0);
  });

  it('sessão inválida (renovação do token falhou) → não sincroniza e solta o lease', async () => {
    const motor = motorFalso({ prepararSessao: () => Promise.resolve('sessao-invalida') });
    const c = cenario({ motor });
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'pulado', motivo: 'sessao-invalida' });
    expect(motor.sincronizacoes).toBe(0);
    expect(c.guardado.lease).toBeNull();
  });

  it('aparelho bloqueado (RN-CORE-15) → não sincroniza e não regrava nada', async () => {
    const motor = motorFalso({ prepararSessao: () => Promise.resolve('aparelho-bloqueado') });
    const c = cenario({ motor });
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'pulado', motivo: 'aparelho-bloqueado' });
    expect(motor.sincronizacoes).toBe(0);
  });

  it('lease de outra execução ainda válido → pula; vencido → roda', async () => {
    const ocupado = cenario({ lease: { dono: 'segundo-plano:outro', expira_em: new Date(AGORA + 30_000).toISOString() } });
    expect(await executarTarefaSegundoPlano(ocupado.deps)).toMatchObject({ resultado: 'pulado', motivo: 'em-andamento' });
    expect(ocupado.abertos).toEqual([]);
    expect(ocupado.guardado.lease?.dono).toBe('segundo-plano:outro');
    const vencido = cenario({ lease: { dono: 'segundo-plano:outro', expira_em: new Date(AGORA - 1).toISOString() } });
    expect(await executarTarefaSegundoPlano(vencido.deps)).toMatchObject({ resultado: 'sincronizado' });
  });
});

describe('executarTarefaSegundoPlano — quando roda', () => {
  it('app fechado: abre o motor do usuário, segura o lease durante a passada e solta no fim', async () => {
    let leaseDurante: LeaseSync | null = null;
    const c = cenario();
    const motor = motorFalso({
      sincronizar: () => {
        leaseDurante = c.guardado.lease;
        return Promise.resolve(true);
      },
    });
    c.deps.abrirMotor = () => Promise.resolve(motor);
    const r = await executarTarefaSegundoPlano(c.deps);
    expect(r).toMatchObject({ resultado: 'sincronizado', quando: '2026-11-02T15:00:00.000Z' });
    expect(leaseDurante).toMatchObject({ dono: expect.stringMatching(/^segundo-plano:/), expira_em: new Date(AGORA + VALIDADE_LEASE_MS).toISOString() });
    expect(c.guardado.lease).toBeNull();
  });

  it('app aberto no mesmo processo: usa o motor do app (sem abrir outro nem gravar lease)', async () => {
    const doApp = motorFalso();
    const c = cenario({ motorDoApp: doApp });
    expect(await executarTarefaSegundoPlano(c.deps)).toMatchObject({ resultado: 'sincronizado' });
    expect(doApp.sincronizacoes).toBe(1);
    expect(c.abertos).toEqual([]);
    expect(c.guardado.gravacoes).toEqual([]);
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

  it('orçamento de 60 s esgotado → "parcial"; o lease fica até vencer (a passada pode seguir gravando)', async () => {
    vi.useFakeTimers();
    try {
      const motor = motorFalso({ sincronizar: () => new Promise<boolean>(() => undefined) });
      const c = cenario({ motor });
      const p = executarTarefaSegundoPlano(c.deps);
      await vi.advanceTimersByTimeAsync(ORCAMENTO_SEGUNDO_PLANO_MS + 1);
      const r = await p;
      expect(r.resultado).toBe('parcial');
      expect(textoDoResultado(r)).toContain('tempo esgotado');
      expect(c.guardado.lease?.dono).toMatch(/^segundo-plano:/);
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
