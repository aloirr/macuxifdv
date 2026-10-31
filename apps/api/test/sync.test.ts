/**
 * /v1/sync/pull e /v1/sync/push (desenho T-0004 §5) com provedores em memória: horizonte, cursor,
 * licença por entidade (RN-CORE-02) e RN-PRO-01 no push.
 */
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { codificarCursor, defineModule, definirEntidadeSync, definirModuloApi, ErroRegraNegocio, type LinhaSync, type Manifesto } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, type OpcoesApp } from '../src/app';
import { versaoDoConjunto } from '../src/sync';
import { bancoFalso, cab, CLIENTE_DA_CARTEIRA, LICENCAS_PADRAO, opcoesDeTeste, usuarios, vendedorApi } from './apoio';

const AGORA = new Date('2026-11-02T12:00:00.000Z');
const linha = (seg: number, id: string): LinhaSync => ({ id, updated_at: new Date(AGORA.getTime() - seg * 1000).toISOString(), deleted_at: null });

const pedido = definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: z.object({ total_centavos: z.number().int() }) });

function montar(linhas: LinhaSync[], horizonteSeg = 2, licencas = LICENCAS_PADRAO, manifesto: Manifesto = vendedor) {
  const recebidos: string[] = [];
  const pedidosPuxados: unknown[] = [];
  const api = definirModuloApi({
    ...vendedorApi,
    manifesto,
    sync: [
      {
        entidade: pedido,
        puxar: async (_ctx, p) => {
          pedidosPuxados.push(p);
          return linhas; // devolve tudo de propósito: a plataforma corta pelo horizonte e pelo cursor
        },
        receber: async (_ctx, itens) =>
          itens.map((i) => {
            if ((i.payload as { total_centavos: number }).total_centavos < 0) throw new ErroRegraNegocio('RN-VEN-02', 'Total negativo.');
            recebidos.push(i.id);
            return { id: i.id, status: 'aceito' as const };
          }),
      },
    ],
  });
  const { banco } = bancoFalso(() => new Date(AGORA.getTime() - horizonteSeg * 1000));
  const app = createApp({ ...opcoesDeTeste(licencas, { banco, relogio: () => AGORA }), modulos: opcoesDeTeste().modulos!.map((m) => (m.manifesto.id === 'vendedor' ? api : m)) });
  return { app, recebidos, pedidosPuxados };
}

const U = (n: number) => `0e000000-0000-4000-8000-00000000000${n}`;

describe('GET /v1/sync/pull', () => {
  it('nunca devolve linha no horizonte ou depois dele (transação longa ainda aberta)', async () => {
    const { app, pedidosPuxados } = montar([linha(10, U(1)), linha(5, U(2)), linha(1, U(3))], 2);
    const r = await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=pedido', headers: cab('vendedor') });
    expect(r.statusCode).toBe(200);
    expect(r.json().itens.map((l: LinhaSync) => l.id)).toEqual([U(1), U(2)]);
    expect(r.json().proximo_cursor).toBeNull();
    expect(pedidosPuxados[0]).toMatchObject({ desde: null, ate: new Date(AGORA.getTime() - 2000).toISOString(), limite: 1001 });
  });

  it('respeita o cursor (updated_at, id) e recusa cursor malformado', async () => {
    const { app } = montar([linha(10, U(1)), linha(5, U(2))]);
    const cursor = codificarCursor(linha(10, U(1)));
    const r = await app.inject({ method: 'GET', url: `/v1/sync/pull?entidade=pedido&cursor=${encodeURIComponent(cursor)}`, headers: cab('vendedor') });
    expect(r.json().itens.map((l: LinhaSync) => l.id)).toEqual([U(2)]);
    const ruim = await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=pedido&cursor=xpto', headers: cab('vendedor') });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().codigo).toBe('CURSOR_INVALIDO');
  });

  it('RN-CORE-02: entidade de módulo inativo → 403 MODULO_INATIVO; desconhecida → 404; sem provedor → 501', async () => {
    const { app } = montar([]);
    const inativo = await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=checklist_loja', headers: cab('vendedor') });
    expect(inativo.statusCode).toBe(403);
    expect(inativo.json()).toMatchObject({ codigo: 'MODULO_INATIVO', detalhes: { modulo: 'promotor' } });
    expect((await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=nao_existe', headers: cab('vendedor') })).statusCode).toBe(404);
    // `rota` é do Core e ainda sem provedor (o Core da T-0003 Fase 2 provê cliente, carteira e produto)
    const semProvedor = await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=rota', headers: cab('vendedor') });
    expect(semProvedor.statusCode).toBe(501);
  });

  it('O-3 / RN-PRO-01: o promotor puxa pedido só se o manifesto lhe der pedido.ver (sem a ação → 403 PERFIL_SEM_ACESSO)', async () => {
    const ver = (perfis: ('vendedor' | 'promotor')[]) => defineModule({ ...vendedor, acoes: { ...vendedor.acoes, 'pedido.ver': { perfis } } });
    const sem = montar([linha(10, U(1))], 2, LICENCAS_PADRAO, ver(['vendedor'])).app;
    const negado = await sem.inject({ method: 'GET', url: '/v1/sync/pull?entidade=pedido', headers: cab('promotor') });
    expect([negado.statusCode, negado.json().codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    const com = montar([linha(10, U(1))], 2, LICENCAS_PADRAO, ver(['vendedor', 'promotor'])).app;
    const ok = await com.inject({ method: 'GET', url: '/v1/sync/pull?entidade=pedido', headers: cab('promotor') });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().itens.map((l: LinhaSync) => l.id)).toEqual([U(1)]);
  });

  it('sem login → 401 antes de qualquer coisa', async () => {
    const { app } = montar([]);
    expect((await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=pedido' })).statusCode).toBe(401);
  });
});

describe('POST /v1/sync/push', () => {
  const item = (n: number, entidade = 'pedido', total_centavos = 100) => ({ id: U(n), entidade, payload: { total_centavos } });

  it('aceita itens da entidade ativa e responde um resultado por item, na ordem', async () => {
    const { app, recebidos } = montar([]);
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('vendedor'), payload: { itens: [item(1), item(2, 'checklist_loja'), item(3)] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().resultados).toEqual([
      { id: U(1), status: 'aceito' },
      // checklist_loja é do Promotor, inativo para o vendedor: MODULO_INATIVO pelo manifesto, mesmo sem provedor (D-1)
      { id: U(2), status: 'rejeitado', codigo: 'MODULO_INATIVO', mensagem: 'Módulo promotor inativo' },
      { id: U(3), status: 'aceito' },
    ]);
    expect(recebidos).toEqual([U(1), U(3)]);
  });

  it('RN-CORE-02: Vendedor desativado → cada item volta rejeitado com MODULO_INATIVO (fila do app mostra "não enviado")', async () => {
    const { app, recebidos } = montar([], 2, { ...LICENCAS_PADRAO, tenant: ['core', 'catalogo'] });
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('vendedor'), payload: { itens: [item(1), item(2)] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().resultados.map((x: { codigo?: string }) => x.codigo)).toEqual(['MODULO_INATIVO', 'MODULO_INATIVO']);
    expect(recebidos).toEqual([]);
  });

  it('D-1 / RN-CORE-02: Promotor desligado no tenant → push de checklist_loja (sem provedor) volta 403 MODULO_INATIVO, não ENTIDADE_DESCONHECIDA', async () => {
    const { app } = montar([], 2, { ...LICENCAS_PADRAO, tenant: ['core', 'catalogo', 'vendedor'] });
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('promotor'), payload: { itens: [item(1, 'checklist_loja'), item(2, 'nao_existe')] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().resultados).toEqual([
      { id: U(1), status: 'rejeitado', codigo: 'MODULO_INATIVO', mensagem: 'Módulo promotor inativo' },
      { id: U(2), status: 'rejeitado', codigo: 'ENTIDADE_DESCONHECIDA', mensagem: 'Entidade nao_existe não aceita push' },
    ]);
  });

  it('RN-PRO-01: promotor enviando entidade de pedido sem provedor (pedido_item) → RN-PRO-01, antes de ENTIDADE_DESCONHECIDA', async () => {
    const { app } = montar([]);
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('promotor'), payload: { itens: [item(1, 'pedido_item')] } });
    expect(r.json().resultados[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-01' });
  });

  it('RN-PRO-01: promotor enviando pedido (mesmo com o Vendedor ativo) → rejeitado RN-PRO-01, nada chega ao módulo', async () => {
    const { app, recebidos } = montar([]);
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('promotor'), payload: { itens: [item(1)] } });
    expect(r.json().resultados).toEqual([{ id: U(1), status: 'rejeitado', codigo: 'RN-PRO-01', mensagem: 'Promotor não cria nem altera pedido.' }]);
    expect(recebidos).toEqual([]);
  });

  it('regra de negócio no lote → itens rejeitados com o código da RN; payload fora do schema → PAYLOAD_INVALIDO', async () => {
    const { app } = montar([]);
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('vendedor'), payload: { itens: [item(1, 'pedido', -1)] } });
    expect(r.json().resultados[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-02' });
    const p = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('vendedor'), payload: { itens: [{ id: U(2), entidade: 'pedido', payload: { total_centavos: 'x' } }] } });
    expect(p.json().resultados[0]).toMatchObject({ status: 'rejeitado', codigo: 'PAYLOAD_INVALIDO' });
  });

  it('lote inválido (id que não é UUID do aparelho) → 400', async () => {
    const { app } = montar([]);
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('vendedor'), payload: { itens: [{ id: '1', entidade: 'pedido', payload: {} }] } });
    expect(r.statusCode).toBe(400);
  });
});

/** ADR 0009 (T-0016 E1/E2/E3): versão do escopo, usuários visíveis e entidade sem receptor. */
describe('ADR 0009: escopo do pull, usuários visíveis e envio ainda não disponível', () => {
  const pedidoSoPull = definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: z.unknown() });
  const itemDoPedido = definirEntidadeSync({ nome: 'pedido_item', modulo: 'vendedor', direcao: 'pull', conflito: 'servidor_vence', schema: z.unknown() });
  const condicao = definirEntidadeSync({ nome: 'condicao_pagamento', modulo: 'vendedor', direcao: 'pull', conflito: 'servidor_vence', schema: z.unknown() });
  const eventoDoPedido = definirEntidadeSync({ nome: 'pedido_evento', modulo: 'vendedor', direcao: 'pull', conflito: 'servidor_vence', schema: z.unknown() });

  function montarEscopo(extra: Partial<OpcoesApp> = {}) {
    const vistos: Array<ReadonlySet<string> | 'tenant'> = [];
    const api = definirModuloApi({
      ...vendedorApi,
      sync: [
        {
          entidade: pedidoSoPull,
          escopo: 'usuarios',
          puxar: async (ctx) => {
            vistos.push(await ctx.usuariosVisiveis());
            return [];
          },
        },
        { entidade: itemDoPedido, escopo: 'carteira', puxar: async () => [] },
        { entidade: condicao, escopo: 'tenant', puxar: async () => [] },
        { entidade: eventoDoPedido, escopo: ['usuarios', 'carteira'], puxar: async () => [] },
      ],
    });
    const { banco } = bancoFalso(() => new Date(AGORA.getTime() - 2000));
    const base = opcoesDeTeste(LICENCAS_PADRAO, { banco, relogio: () => AGORA, ...extra });
    const app = createApp({ ...base, modulos: base.modulos!.map((m) => (m.manifesto.id === 'vendedor' ? api : m)) });
    return { app, vistos };
  }
  const pull = (app: ReturnType<typeof createApp>, entidade: string, quem: keyof typeof usuarios = 'vendedor') =>
    app.inject({ method: 'GET', url: `/v1/sync/pull?entidade=${entidade}`, headers: cab(quem) });

  it('E1: escopo carteira leva versao_escopo (hash dos ids visíveis) que muda quando a carteira muda; tenant não leva', async () => {
    const carteira = new Set([CLIENTE_DA_CARTEIRA]);
    const { app } = montarEscopo({ carteira: async () => new Set(carteira) });
    const v1 = (await pull(app, 'pedido_item')).json();
    expect(v1.versao_escopo).toBe(versaoDoConjunto(new Set([CLIENTE_DA_CARTEIRA])));
    expect(v1.versao_escopo).toMatch(/^[0-9a-f]{16}$/);
    expect((await pull(app, 'pedido_item')).json().versao_escopo).toBe(v1.versao_escopo); // estável
    carteira.add('0c000000-0000-4000-8000-000000000009');
    expect((await pull(app, 'pedido_item')).json().versao_escopo).not.toBe(v1.versao_escopo);
    const t = await pull(app, 'condicao_pagamento');
    expect(t.statusCode).toBe(200);
    expect(t.json()).not.toHaveProperty('versao_escopo');
  });

  it('E1 / O-3: escopo combinado (usuarios + carteira, ex.: pedido lido pelo promotor) muda quando qualquer um dos conjuntos muda', async () => {
    const carteira = new Set([CLIENTE_DA_CARTEIRA]);
    const equipe = new Set<string>();
    const { app } = montarEscopo({ carteira: async () => new Set(carteira), usuariosVisiveis: async (u) => new Set([u.id, ...equipe]) });
    const v1 = (await pull(app, 'pedido_evento', 'promotor')).json().versao_escopo;
    expect(v1).toMatch(/^[0-9a-f]{16}$/);
    expect(v1).not.toBe(versaoDoConjunto(carteira)); // não é o hash de um conjunto só
    carteira.add('0c000000-0000-4000-8000-000000000009');
    const v2 = (await pull(app, 'pedido_evento', 'promotor')).json().versao_escopo;
    expect(v2).not.toBe(v1);
    equipe.add('0b000000-0000-4000-8000-000000000009');
    expect((await pull(app, 'pedido_evento', 'promotor')).json().versao_escopo).not.toBe(v2);
  });

  it('E1: versaoDoConjunto não depende da ordem e distingue "tenant"', () => {
    expect(versaoDoConjunto(new Set(['b', 'a']))).toBe(versaoDoConjunto(new Set(['a', 'b'])));
    expect(versaoDoConjunto('tenant')).not.toBe(versaoDoConjunto(new Set()));
  });

  it('E2 / RN-CORE-04: sem o serviço do Core, supervisor vê só os próprios dados (falha fechada); analista vê o tenant', async () => {
    const { app, vistos } = montarEscopo();
    const r = await pull(app, 'pedido', 'supervisor');
    expect(r.statusCode, r.body).toBe(200);
    expect([...(vistos[0] as Set<string>)]).toEqual([usuarios.supervisor!.id]);
    expect(r.json().versao_escopo).toBe(versaoDoConjunto(new Set([usuarios.supervisor!.id])));
    await pull(app, 'pedido', 'analista');
    expect(vistos[1]).toBe('tenant');
  });

  it('E2 / RN-CORE-04: com o serviço, supervisor vê a equipe — e sempre a si mesmo', async () => {
    const equipe = ['0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000009'];
    const { app, vistos } = montarEscopo({ usuariosVisiveis: async (u) => (u.perfil === 'supervisor' ? new Set(equipe) : new Set([u.id])) });
    await pull(app, 'pedido', 'supervisor');
    expect([...(vistos[0] as Set<string>)].sort()).toEqual([...equipe, usuarios.supervisor!.id].sort());
  });

  it('E3 / D-2: push de entidade com provedor só de pull, ou do manifesto sem provedor → rejeitado SYNC_NAO_IMPLEMENTADO (retentável)', async () => {
    const { app } = montarEscopo();
    const r = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: cab('vendedor'),
      payload: { itens: [{ id: U(1), entidade: 'pedido', payload: {} }, { id: U(2), entidade: 'cliente_condicao', payload: {} }, { id: U(3), entidade: 'pedido_item', payload: {} }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().resultados.map((x: { codigo?: string }) => x.codigo)).toEqual(['SYNC_NAO_IMPLEMENTADO', 'SYNC_NAO_IMPLEMENTADO', 'ENTIDADE_DESCONHECIDA']);
    expect(r.json().resultados[0].mensagem).toMatch(/ainda não disponível no servidor/);
  });
});
