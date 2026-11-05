/**
 * ADR 0022: agendador das tarefas periódicas (RN-CORE-23: nada abaixo de 15 min; RN-CORE-02/03: só módulo efetivo no
 * tenant; RLS: uma transação por tenant; log só com ids e contagens).
 */
import { defineModule, definirModuloApi, definirTarefa, type AcessoBanco, type ClienteBanco, type ContextoTarefa, type LogRota } from '@macuxi/platform-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { criarAgendador } from '../src/agendador';
import type { LicencasTenant } from '../src/licencas';

const T1 = '00000000-0000-4000-8000-000000000001';
const T2 = '00000000-0000-4000-8000-000000000002';

const core = defineModule({ id: 'core', versao: '1.0.0', perfis: ['admin'], acoes: {} });
const pesquisa = defineModule({ id: 'pesquisa', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], acoes: {} });

function montar(o: { trava?: boolean; ativos?: Record<string, string[]>; falhaEm?: string } = {}) {
  let agora = new Date('2026-11-05T12:00:00.000Z');
  const transacoes: string[] = [];
  const consultasSql: string[] = [];
  const app: AcessoBanco = {
    comTenant: async (tenantId, fn) => {
      transacoes.push(tenantId);
      const db = {
        query: vi.fn(async (sql: string) => {
          consultasSql.push(sql);
          if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ ok: o.trava ?? true }], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        }),
      } as unknown as ClienteBanco;
      return fn(db);
    },
    semTenant: async () => {
      throw new Error('sem tenant não é usado');
    },
  };
  const vistos: { tarefa: string; ctx: ContextoTarefa }[] = [];
  const tarefaCore = definirTarefa({
    nome: 'alerta',
    cadaMin: 60,
    executar: async (ctx) => {
      if (ctx.tenantId === o.falhaEm) throw new Error('falhou');
      vistos.push({ tarefa: 'core.alerta', ctx });
      return { alertadas: 2, rotulo: 'texto não vai ao log' };
    },
  });
  const tarefaPesquisa = definirTarefa({
    nome: 'varre',
    cadaMin: 15,
    executar: async (ctx) => {
      vistos.push({ tarefa: 'pesquisa.varre', ctx });
    },
  });
  const modulos = [definirModuloApi({ manifesto: core, tarefas: [tarefaCore] }), definirModuloApi({ manifesto: pesquisa, tarefas: [tarefaPesquisa] })];
  const ativos = o.ativos ?? { [T1]: ['core', 'pesquisa'], [T2]: ['core'] };
  const log: LogRota & { linhas: { nivel: string; o: Record<string, unknown>; msg: string }[] } = {
    linhas: [],
    info: (x, msg) => log.linhas.push({ nivel: 'info', o: x as Record<string, unknown>, msg: msg ?? '' }),
    warn: (x, msg) => log.linhas.push({ nivel: 'warn', o: x as Record<string, unknown>, msg: msg ?? '' }),
    error: (x, msg) => log.linhas.push({ nivel: 'error', o: x as Record<string, unknown>, msg: msg ?? '' }),
  };
  const agendador = criarAgendador({
    app,
    modulos,
    tenantsAtivos: async () => [T1, T2],
    licencasNoTenant: async (t): Promise<LicencasTenant> => ({ ativosNoTenant: (ativos[t] ?? []) as LicencasTenant['ativosNoTenant'], parametros: { core: { p: 1 } }, fuso: 'America/Sao_Paulo' }),
    agora: () => agora,
    log,
  });
  return { agendador, vistos, transacoes, consultasSql, log, avancar: (min: number) => (agora = new Date(agora.getTime() + min * 60_000)) };
}

afterEach(() => vi.useRealTimers());

describe('agendador de tarefas periódicas (ADR 0022)', () => {
  it('RN-CORE-02/03: na subida roda cada tarefa nos tenants com o módulo efetivo, uma transação por tenant', async () => {
    const t = montar();
    expect(t.agendador.tarefas()).toEqual(['core.alerta', 'pesquisa.varre']);
    const r = await t.agendador.ciclo();
    expect(r).toEqual({ devidas: 2, execucoes: 3, ocupadas: 0, falhas: 0 });
    expect(t.vistos.map((v) => `${v.tarefa}@${v.ctx.tenantId}`)).toEqual([`core.alerta@${T1}`, `pesquisa.varre@${T1}`, `core.alerta@${T2}`]);
    expect(t.transacoes).toEqual([T1, T1, T2]);
    const c = t.vistos[0]!.ctx;
    expect(c.fuso()).toBe('America/Sao_Paulo');
    expect(c.parametros()).toEqual({ p: 1 });
    expect(c.agora().toISOString()).toBe('2026-11-05T12:00:00.000Z');
  });

  it('RN-CORE-23: cada tarefa volta só depois do próprio período (15 min e 60 min)', async () => {
    const t = montar({ ativos: { [T1]: ['core', 'pesquisa'], [T2]: [] } });
    await t.agendador.ciclo();
    t.vistos.length = 0;
    t.avancar(15);
    expect((await t.agendador.ciclo()).devidas).toBe(1);
    expect(t.vistos.map((v) => v.tarefa)).toEqual(['pesquisa.varre']);
    t.avancar(14);
    expect((await t.agendador.ciclo()).devidas).toBe(0);
    t.avancar(31);
    t.vistos.length = 0;
    await t.agendador.ciclo();
    expect(t.vistos.map((v) => v.tarefa).sort()).toEqual(['core.alerta', 'core.alerta', 'pesquisa.varre']); // core é sempre efetivo (T2 também)
  });

  it('outro processo com a trava do (tarefa, tenant) faz este pular sem executar', async () => {
    const t = montar({ trava: false });
    const r = await t.agendador.ciclo();
    expect(r).toMatchObject({ execucoes: 0, ocupadas: 3 });
    expect(t.vistos).toHaveLength(0);
    expect(t.consultasSql.every((s) => s.includes('pg_try_advisory_xact_lock'))).toBe(true);
  });

  it('falha num tenant não para os outros e não volta antes do período; o log tem só ids, tarefa e contagens', async () => {
    const t = montar({ falhaEm: T1 });
    const r = await t.agendador.ciclo();
    expect(r).toMatchObject({ execucoes: 2, falhas: 1 });
    expect(t.vistos.map((v) => `${v.tarefa}@${v.ctx.tenantId}`)).toEqual([`pesquisa.varre@${T1}`, `core.alerta@${T2}`]);
    const falha = t.log.linhas.find((l) => l.nivel === 'warn')!;
    expect(falha.o).toMatchObject({ tenant_id: T1, modulo: 'core', tarefa: 'alerta' });
    const ok = t.log.linhas.find((l) => l.msg === 'tarefa periódica executada')!;
    expect(ok.o).toMatchObject({ tenant_id: T2, modulo: 'core', tarefa: 'alerta', alertadas: 2 });
    expect(ok.o).not.toHaveProperty('rotulo');
    expect(typeof ok.o.request_id).toBe('string');
    t.avancar(15);
    expect((await t.agendador.ciclo()).devidas).toBe(1); // só a de 15 min; a de 60 min que falhou espera o período
  });

  it('RN-CORE-23: o laço acorda a cada 15 min e não liga timer sem tarefa', async () => {
    vi.useFakeTimers();
    const t = montar();
    const execucao = t.agendador.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    const primeiras = t.transacoes.length;
    expect(primeiras).toBe(3);
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    expect(t.transacoes.length).toBe(primeiras);
    t.avancar(15);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.transacoes.length).toBe(primeiras + 1); // pesquisa.varre em T1
    await execucao.parar();

    const vazio = criarAgendador({ app: { comTenant: vi.fn(), semTenant: vi.fn() } as unknown as AcessoBanco, modulos: [], tenantsAtivos: vi.fn(async () => []) });
    const ev = vazio.iniciar();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await ev.parar();
    expect(vi.getTimerCount()).toBe(0);
  });
});
