/**
 * T-0029 §11 E1 e E3 no createApp, sem banco (banco falso): `tx.consultar` entre módulos instalados (ADR 0012) e
 * `ctx.parametros()` do módulo da rota. A prova com Postgres (RLS, mesma transação, auditoria) fica em
 * `consultas.banco.test.ts`.
 */
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { consultasSemImplementacao, defineModule, definirConsulta, definirEntidadeSync, definirModuloApi, implementarConsulta, type ClienteBanco, type ContextoBase, type LinhaSync, type ModuloApi } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { MODULOS_API } from '../src/modulos';
import { bancoFalso, cab, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, usuarios } from './apoio';

const PRECOS = definirConsulta({
  nome: 'catalogo.precos_cliente@1',
  entrada: z.object({ cliente_id: z.string().uuid(), produto_ids: z.array(z.string()).max(500) }),
  saida: z.object({ itens: z.array(z.object({ produto_id: z.string(), preco_cents: z.number().int().nullable() })), quem: z.string(), fator: z.number() }),
});
const NAO_DECLARADA = definirConsulta({ nome: 'catalogo.outra@1', entrada: z.object({}), saida: z.object({}) });

const CLIENTE = '0c000000-0000-4000-8000-000000000001';
let dbDaConsulta: ClienteBanco | null = null;

/** Catálogo de teste: oferece e implementa a consulta (lê os parâmetros do PRÓPRIO módulo e o usuário da requisição). */
const catalogoApi = definirModuloApi({
  manifesto: defineModule({ ...catalogo, ofereceConsultas: ['catalogo.precos_cliente@1', 'catalogo.outra@1'] }),
  consultas: [
    implementarConsulta(PRECOS, async (e, ctx) => {
      dbDaConsulta = ctx.db;
      const fator = Number(ctx.parametros().fator_teste ?? 1);
      return { itens: e.produto_ids.map((p) => ({ produto_id: p, preco_cents: p === 'sem' ? null : 1000 * fator })), quem: ctx.usuario.perfil, fator };
    }),
    implementarConsulta(NAO_DECLARADA, async () => ({})),
  ],
});

const rotaPrecos = (cons = PRECOS as typeof PRECOS | typeof NAO_DECLARADA) => ({
  metodo: 'GET' as const,
  caminho: cons === PRECOS ? 'teste-precos' : 'teste-outra',
  carteira: 'nao_se_aplica' as const,
  executar: async (ctx: Parameters<NonNullable<ModuloApi['rotas']>[number]['executar']>[0]) =>
    ctx.comTenant(async (db, tx) => {
      const r = await tx.consultar(cons as typeof PRECOS, { cliente_id: CLIENTE, produto_ids: ['p1', 'sem'] });
      return { ...r, mesma_transacao: dbDaConsulta === db, parametros_da_rota: ctx.parametros() };
    }),
});

/** Vendedor (depende do Catálogo) e Promotor (Catálogo opcional) consumindo a consulta. */
const vendedorApi = definirModuloApi({
  manifesto: defineModule({ ...vendedor, usaConsultas: ['catalogo.precos_cliente@1'] }),
  rotas: [rotaPrecos(), rotaPrecos(NAO_DECLARADA)],
});
const promotorApi = definirModuloApi({
  manifesto: defineModule({ ...promotor, usaConsultas: ['catalogo.precos_cliente@1'] }),
  rotas: [{ ...rotaPrecos(), perfis: ['promotor'] }],
});

function app(removidos: Record<string, ('catalogo' | 'vendedor')[]> = {}) {
  const base = opcoesDeTeste({ ...LICENCAS_PADRAO, removidos }, { banco: bancoFalso().banco });
  return createApp({
    ...base,
    modulos: modulosDeTeste({ catalogo: catalogoApi, vendedor: vendedorApi, promotor: promotorApi }),
    licencas: async (u, b) => ({ ...(await base.licencas!(u, b)), parametros: { vendedor: { 'alcada.vendedor_pct': 5 }, catalogo: { fator_teste: 2 } } }),
  });
}

describe('E1 — tx.consultar no createApp (ADR 0012)', () => {
  it('o consumidor recebe a saída validada; o dono roda na MESMA transação, com o usuário e os parâmetros dele', async () => {
    const r = await app().inject({ method: 'GET', url: '/v1/vendedor/teste-precos', headers: cab('vendedor') });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      itens: [
        { produto_id: 'p1', preco_cents: 2000 },
        { produto_id: 'sem', preco_cents: null },
      ],
      quem: 'vendedor',
      fator: 2,
      mesma_transacao: true,
      // E3: a rota vê os parâmetros do PRÓPRIO módulo; a consulta, os do dono
      parametros_da_rota: { 'alcada.vendedor_pct': 5 },
    });
  });

  it('dono opcional inativo para o usuário → ConsultaIndisponivel, 503 CONSULTA_INDISPONIVEL se a rota não tratar', async () => {
    const ok = await app().inject({ method: 'GET', url: '/v1/promotor/teste-precos', headers: cab('promotor') });
    expect(ok.statusCode).toBe(200);
    const r = await app({ [usuarios.promotor!.id]: ['catalogo'] }).inject({ method: 'GET', url: '/v1/promotor/teste-precos', headers: cab('promotor') });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ codigo: 'CONSULTA_INDISPONIVEL', detalhes: { consulta: 'catalogo.precos_cliente@1', modulo: 'catalogo' } });
  });

  it('consulta fora de usaConsultas do módulo da rota = erro de programação (500, sem detalhes)', async () => {
    const r = await app().inject({ method: 'GET', url: '/v1/vendedor/teste-outra', headers: cab('vendedor') });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ codigo: 'ERRO_INTERNO', mensagem: expect.any(String) });
  });

  it('API real (módulos do produto): toda consulta oferecida tem implementação', () => {
    expect(consultasSemImplementacao(MODULOS_API)).toEqual([]);
    expect(() => createApp()).not.toThrow();
  });

  it('montagem: consulta usada que o dono instalado não oferece = a API não sobe', () => {
    // o manifesto real do Catálogo passou a oferecer a consulta (T-0029): aqui ele é tirado de propósito
    const semOferta = definirModuloApi({ manifesto: defineModule({ ...catalogo, ofereceConsultas: [] }) });
    expect(() => createApp({ ...opcoesDeTeste(), modulos: modulosDeTeste({ catalogo: semOferta, vendedor: vendedorApi }) })).toThrow(
      'vendedor usa a consulta catalogo.precos_cliente@1, que catalogo não oferece',
    );
  });
});

/**
 * R-20261103-020048 (T-0061): o provedor de sync recebe o MESMO `ctx.comTenant` das rotas, com `tx.consultar` no tenant e
 * no usuário do pull/push/novidades (ex.: o Vendedor lê `core.promotor_ve_pedidos@1` no pull do promotor).
 */
describe('E1 — tx.consultar no provedor de sync (pull, novidades e push)', () => {
  const ENTIDADE = definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: z.object({}) });
  const AGORA = new Date('2026-11-03T05:00:00.000Z');
  const ID = '0e000000-0000-4000-8000-000000000001';
  type Visto = { quem: string; fator: number; mesma_transacao: boolean; tenant: string; usuario: string };

  function appSync() {
    const vistos: Visto[] = [];
    const consultar = (ctx: ContextoBase) =>
      ctx.comTenant(async (db, tx) => {
        const r = await tx.consultar(PRECOS, { cliente_id: CLIENTE, produto_ids: ['p1'] });
        vistos.push({ quem: r.quem, fator: r.fator, mesma_transacao: dbDaConsulta === db, tenant: ctx.usuario.tenant_id, usuario: ctx.usuario.id });
      });
    const vendedorSync = definirModuloApi({
      manifesto: defineModule({ ...vendedor, usaConsultas: ['catalogo.precos_cliente@1'] }),
      sync: [
        {
          entidade: ENTIDADE,
          escopo: 'usuarios',
          puxar: async (ctx) => {
            await consultar(ctx);
            return [{ id: ID, updated_at: new Date(AGORA.getTime() - 10_000).toISOString(), deleted_at: null } satisfies LinhaSync];
          },
          receber: async (ctx, itens) => {
            await consultar(ctx);
            return itens.map((i) => ({ id: i.id, status: 'aceito' as const }));
          },
        },
      ],
    });
    const base = opcoesDeTeste(LICENCAS_PADRAO, { banco: bancoFalso(() => new Date(AGORA.getTime() - 2_000)).banco, relogio: () => AGORA });
    const app = createApp({
      ...base,
      modulos: modulosDeTeste({ catalogo: catalogoApi, vendedor: vendedorSync, promotor: promotorApi }),
      licencas: async (u, b) => ({ ...(await base.licencas!(u, b)), parametros: { catalogo: { fator_teste: 3 } } }),
    });
    return { app, vistos };
  }

  it('pull: o provedor consulta na transação do tenant, com o usuário do pull (promotor)', async () => {
    const { app, vistos } = appSync();
    const r = await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=pedido', headers: cab('promotor') });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().itens.map((l: LinhaSync) => l.id)).toEqual([ID]);
    const p = usuarios.promotor!;
    expect(vistos).toEqual([{ quem: 'promotor', fator: 3, mesma_transacao: true, tenant: p.tenant_id, usuario: p.id }]);
  });

  it('novidades e push: o provedor também recebe tx.consultar', async () => {
    const { app, vistos } = appSync();
    const primeira = await app.inject({ method: 'GET', url: '/v1/sync/novidades', headers: cab('vendedor') });
    expect(primeira.statusCode, primeira.body).toBe(200);
    // com o cursor da primeira, a segunda chamada pergunta ao provedor (puxar com limite 1)
    const desde = encodeURIComponent(primeira.json().cursor);
    const segunda = await app.inject({ method: 'GET', url: `/v1/sync/novidades?desde=${desde}`, headers: cab('vendedor') });
    expect(segunda.statusCode, segunda.body).toBe(200);
    const push = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: cab('vendedor'),
      payload: { itens: [{ id: '0e000000-0000-4000-8000-000000000002', entidade: 'pedido', operacao: 'upsert', payload: {} }] },
    });
    expect(push.statusCode, push.body).toBe(200);
    expect(push.json().resultados[0]).toMatchObject({ status: 'aceito' });
    expect(vistos.length).toBe(2);
    expect(vistos.every((v) => v.quem === 'vendedor' && v.mesma_transacao && v.usuario === usuarios.vendedor!.id)).toBe(true);
  });
});
