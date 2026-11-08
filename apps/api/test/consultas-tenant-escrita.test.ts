/**
 * ADR 0025 §4.1 (T-0114, D-1 do R-20261108-085416): `{ licenca: 'tenant' }` em rota de ESCRITA só para consulta que o dono
 * declarou `configuracaoDoTenant` (ex.: `integracao.cancelamento_erp@1`), executada num savepoint somente leitura. Sem banco
 * (banco falso que registra o SQL); a prova do Postgres (escrita recusada, transação utilizável depois) fica em
 * `consultas-tenant-escrita.banco.test.ts`.
 */
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import {
  ConsultaIndisponivel,
  defineModule,
  definirConsulta,
  definirModuloApi,
  implementarConsulta,
  USUARIO_SISTEMA_ID,
  type ClienteBanco,
  type ModuloApi,
  type ModuloId,
} from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import type { BancoApp } from '../src/banco';
import { MODULOS_API } from '../src/modulos';
import { emSomenteLeitura, registroDeConsultas, SAVEPOINT_SOMENTE_LEITURA, transacaoTenant } from '../src/outbox';
import { cab, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, TENANT, usuarios } from './apoio';

/** Configuração do tenant (igual para qualquer usuário): o dono declara. */
const CONFIG = definirConsulta({
  nome: 'catalogo.config_tenant@1',
  entrada: z.object({ falhar: z.boolean().optional() }).strict(),
  saida: z.object({ aceita: z.boolean() }).strict(),
  configuracaoDoTenant: true,
});
/** Consulta comum (sem a declaração). */
const COMUM = definirConsulta({ nome: 'catalogo.comum@1', entrada: z.object({}).strict(), saida: z.object({ ok: z.boolean() }).strict() });
/** O consumidor passa uma cópia que DIZ ser de configuração, mas o dono registrou a comum: vale o registro do dono. */
const COMUM_DISFARCADA = { ...COMUM, configuracaoDoTenant: true as const };

type Visto = { id: string; perfil: string; modulos: readonly string[] };
const vistos: Visto[] = [];
const sql: string[] = [];

/** O Catálogo real (as consultas que o Vendedor usa) mais as duas de teste. */
const catalogoReal = MODULOS_API.find((m) => m.manifesto.id === 'catalogo')!;
const catalogoApi = definirModuloApi({
  ...catalogoReal,
  manifesto: defineModule({ ...catalogo, ofereceConsultas: [...(catalogo.ofereceConsultas ?? []), 'catalogo.config_tenant@1', 'catalogo.comum@1'] }),
  consultas: [
    ...(catalogoReal.consultas ?? []),
    implementarConsulta(CONFIG, async (e, ctx) => {
      vistos.push({ id: ctx.usuario.id, perfil: ctx.usuario.perfil, modulos: ctx.usuario.modulos });
      await ctx.db.query('select aceita -- consulta do dono');
      if (e.falhar) throw new Error('falha do dono');
      return { aceita: true };
    }),
    implementarConsulta(COMUM, async (_e, ctx) => {
      await ctx.db.query('select ok -- consulta comum');
      return { ok: true };
    }),
  ],
});

type Ctx = Parameters<NonNullable<ModuloApi['rotas']>[number]['executar']>[0];
const consultando = (def: typeof CONFIG | typeof COMUM | typeof COMUM_DISFARCADA, entrada: Record<string, unknown> = {}) => (ctx: Ctx) =>
  ctx.comTenant(async (db, tx) => {
    await db.query('update antes -- escrita da rota');
    const r = await tx.consultar(def as typeof CONFIG, entrada as never, { licenca: 'tenant' });
    await db.query('update depois -- escrita da rota');
    return r;
  });
// a escrita precisa de ação do manifesto (ADR 0004): `coleta.registrar` (perfil promotor)
const post = (caminho: string, executar: (ctx: Ctx) => Promise<unknown>) => ({ metodo: 'POST' as const, caminho, carteira: 'nao_se_aplica' as const, acao: 'coleta.registrar', executar });
const promotorApi = definirModuloApi({
  manifesto: defineModule({ ...promotor, usaConsultas: ['catalogo.config_tenant@1', 'catalogo.comum@1'] }),
  rotas: [
    post('config', consultando(CONFIG)),
    post('config-falha', consultando(CONFIG, { falhar: true })),
    post('comum', consultando(COMUM)),
    post('disfarcada', consultando(COMUM_DISFARCADA)),
    { metodo: 'GET' as const, caminho: 'config', carteira: 'nao_se_aplica' as const, perfis: ['promotor' as const], executar: (ctx: Ctx) => ctx.comTenant((_db, tx) => tx.consultar(CONFIG, {}, { licenca: 'tenant' })) },
  ],
});

const promotorId = usuarios.promotor!.id;
const cliente: ClienteBanco = {
  query: async <R>(q: string) => {
    sql.push(q.replace(/\s*--.*$/, '').trim());
    return { rows: [] as R[], rowCount: 0 };
  },
};
const banco: BancoApp = {
  verificar: async () => undefined,
  comTenant: async (_t, fn) => fn(cliente),
  semTenant: async (fn) => fn(cliente),
  horizonteSync: async () => new Date(Date.now() - 2_000),
  instanteSync: async () => new Date(),
};
function appLic(l: Partial<typeof LICENCAS_PADRAO> = {}) {
  const base = opcoesDeTeste({ ...LICENCAS_PADRAO, ...l }, { banco });
  return createApp({ ...base, modulos: modulosDeTeste({ catalogo: catalogoApi, promotor: promotorApi }) });
}
const pedir = (a: ReturnType<typeof appLic>, url: string, method: 'GET' | 'POST' = 'POST') =>
  a.inject({ method, url: `/v1/promotor/${url}`, headers: cab('promotor'), ...(method === 'POST' ? { payload: {} } : {}) });
const limpar = () => {
  sql.length = 0;
  vistos.length = 0;
};
const SP = SAVEPOINT_SOMENTE_LEITURA;

describe("ADR 0025 §4.1 — 'tenant' em escrita para consulta configuracaoDoTenant", () => {
  it('POST: dono ativo no tenant e fora do perfil responde, com o MESMO usuário, num savepoint somente leitura', async () => {
    limpar();
    const r = await pedir(appLic({ removidos: { [promotorId]: ['catalogo'] } }), 'config');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ aceita: true });
    expect(sql).toEqual([
      'update antes',
      `savepoint ${SP}`,
      'set transaction read only',
      'select aceita',
      `rollback to savepoint ${SP}`,
      `release savepoint ${SP}`,
      'update depois',
    ]);
    // sem elevação: o usuário da requisição (perfil e módulos DELE), nunca o de sistema
    expect(vistos).toEqual([{ id: promotorId, perfil: 'promotor', modulos: expect.not.arrayContaining(['catalogo']) }]);
    expect(vistos[0]!.id).not.toBe(USUARIO_SISTEMA_ID);
  });

  it('POST: dono desligado no TENANT continua 503 (a opção nunca liga módulo sem licença); nada de savepoint', async () => {
    limpar();
    const r = await pedir(appLic({ tenant: ['core', 'vendedor', 'promotor'] }), 'config');
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ codigo: 'CONSULTA_INDISPONIVEL', detalhes: { consulta: 'catalogo.config_tenant@1', modulo: 'catalogo' } });
    expect(sql.some((s) => s.includes('savepoint'))).toBe(false);
  });

  it('POST: consulta comum com tenant = erro de programação (500, sem detalhes), mesmo com o dono ativo', async () => {
    limpar();
    const r = await pedir(appLic(), 'comum');
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ codigo: 'ERRO_INTERNO', mensagem: expect.any(String) });
    expect(sql).toEqual(['update antes']);
  });

  it('POST: definição "disfarçada" pelo consumidor não vale; manda o registro do dono (500)', async () => {
    limpar();
    const r = await pedir(appLic(), 'disfarcada');
    expect(r.statusCode).toBe(500);
    expect(sql).toEqual(['update antes']);
  });

  it('POST: erro do dono desfaz o savepoint e sobe (a transação da rota desfaz junto)', async () => {
    limpar();
    const r = await pedir(appLic(), 'config-falha');
    expect(r.statusCode).toBe(500);
    expect(sql).toEqual(['update antes', `savepoint ${SP}`, 'set transaction read only', 'select aceita', `rollback to savepoint ${SP}`, `release savepoint ${SP}`]);
  });

  it('GET: igual à ADR 0025 original (sem savepoint)', async () => {
    limpar();
    const r = await pedir(appLic({ removidos: { [promotorId]: ['catalogo'] } }), 'config', 'GET');
    expect(r.statusCode, r.body).toBe(200);
    expect(sql).toEqual(['select aceita']);
  });
});

describe('ADR 0025 §4.1 — executor (transacaoTenant e emSomenteLeitura)', () => {
  const instalados = modulosDeTeste({ catalogo: catalogoApi, promotor: promotorApi });
  const consultas = registroDeConsultas(instalados);
  const manifestos = instalados.map((m) => m.manifesto);
  const efetivos: ModuloId[] = ['core', 'catalogo', 'promotor'];
  const usuario = { id: promotorId, tenant_id: TENANT, perfil: 'promotor' as const, modulos: efetivos };
  const conector = { manifestos, modulo: 'promotor' as const, tenantId: TENANT, usuarioId: null, requestId: 'r-1', agora: () => new Date(), consultas };
  const origem = { ...conector, usuarioId: promotorId, usuario };

  it("Conector (sem usuário): 'tenant' continua ConsultaIndisponivel, mesmo em escrita", async () => {
    const tx = transacaoTenant(cliente, { ...conector, modulosDoTenant: efetivos, escrita: true });
    await expect(tx.consultar(CONFIG, {}, { licenca: 'tenant' })).rejects.toBeInstanceOf(ConsultaIndisponivel);
  });

  it("sem modulosDoTenant: 'tenant' = erro de programação", async () => {
    await expect(transacaoTenant(cliente, origem).consultar(CONFIG, {}, { licenca: 'tenant' })).rejects.toThrow("licenca 'tenant' indisponível");
  });

  it("licença 'usuario' em escrita: consulta de configuração roda direto (sem savepoint)", async () => {
    limpar();
    expect(await transacaoTenant(cliente, { ...origem, modulosDoTenant: efetivos, escrita: true }).consultar(CONFIG, {})).toEqual({ aceita: true });
    expect(sql).toEqual(['select aceita']);
  });

  it('emSomenteLeitura: erro ao desfazer depois de sucesso sobe; erro da função preserva o erro original', async () => {
    const falhaNoRollback: ClienteBanco = {
      query: async <R>(q: string) => {
        if (q.startsWith('rollback')) throw new Error('rollback falhou');
        return { rows: [] as R[], rowCount: 0 };
      },
    };
    await expect(emSomenteLeitura(falhaNoRollback, async () => 1)).rejects.toThrow('rollback falhou');
    await expect(
      emSomenteLeitura(falhaNoRollback, async () => {
        throw new Error('original');
      }),
    ).rejects.toThrow('original');
  });
});
