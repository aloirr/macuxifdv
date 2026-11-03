/**
 * O-3 / RN-PRO-01 (T-0061): o Vendedor lê a opção `promotor_ve_pedidos` pela consulta pública `core.promotor_ve_pedidos@1`
 * (sem `usarOpcaoPromotorVePedidos`). Sem banco: `tx.consultar` simulado, avaliado a cada requisição.
 */
import { CONSULTA_PROMOTOR_VE_PEDIDOS } from '@macuxi/core/contracts';
import { criarPermissoes, verificarAcao, type ContextoBase, type ContextoRota, type PedidoPull } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import manifest from '../manifest';
import { promotorVePedidos } from './opcao-promotor';
import { rotaListarPedidos, rotaVerPedido } from './pedidos';
import { provedoresSyncVendedor } from './sync';

const ID_PEDIDO = '0f610000-0000-4000-8000-000000000001';
const C1 = '0c100000-0000-4000-8000-000000000001';
type Resposta = { ligado: boolean } | 'falha';

function contexto(perfil: string, resposta: { atual: Resposta }, extra: { params?: unknown } = {}) {
  const sql: string[] = [];
  const nomes: string[] = [];
  const db = {
    query: async (s: string) => {
      sql.push(s);
      return { rows: [] };
    },
  };
  const tx = {
    consultar: async (def: { nome: string }, entrada: unknown) => {
      nomes.push(def.nome);
      CONSULTA_PROMOTOR_VE_PEDIDOS.entrada.parse(entrada);
      if (resposta.atual === 'falha') throw new Error('Core fora do ar');
      return resposta.atual;
    },
  };
  const ctx = {
    usuario: { id: 'u-1', tenant_id: 't-1', perfil, modulos: ['vendedor'] },
    query: {},
    params: extra.params ?? {},
    corpo: {},
    agora: () => new Date('2026-11-03T12:00:00Z'),
    fuso: () => 'America/Manaus',
    parametros: () => ({}),
    usuariosVisiveis: async () => new Set(['u-1']),
    carteira: async () => new Set([C1]),
    comTenant: async (fn: (d: typeof db, t: typeof tx) => Promise<unknown>) => fn(db, tx),
  } as unknown as ContextoBase & ContextoRota;
  return { ctx, sql, nomes };
}

const pull = (): PedidoPull => ({ desde: null, ate: '2026-11-03T12:00:00.000Z', limite: 100 });
const provedor = (nome: string) => provedoresSyncVendedor.find((p) => p.entidade.nome === nome)!;
const NEGADO = { status: 403, codigo: 'RN-PRO-01' };
const ENTIDADES = ['pedido', 'pedido_item', 'pedido_evento'];

describe('O-3: opção lida da consulta core.promotor_ve_pedidos@1 — LIGADA', () => {
  const r = { atual: { ligado: true } as Resposta };
  it('o manifesto declara a consulta consumida', () => {
    expect(manifest.usaConsultas).toContain(CONSULTA_PROMOTOR_VE_PEDIDOS.nome);
  });
  it('lista: 200 com escopo de carteira', async () => {
    const { ctx, sql, nomes } = contexto('promotor', r);
    expect(await rotaListarPedidos.executar(ctx as never)).toEqual({ itens: [], proximo_cursor: null });
    expect(nomes).toEqual(['core.promotor_ve_pedidos@1']);
    expect(sql).toHaveLength(1);
  });
  it('detalhe: segue o escopo de carteira (404 fora dela, nunca 403)', async () => {
    const { ctx } = contexto('promotor', r, { params: { id: ID_PEDIDO } });
    await expect(rotaVerPedido.executar(ctx as never)).rejects.toMatchObject({ status: 404 });
  });
  it.each(ENTIDADES)('pull de %s: entrega (consulta no banco)', async (nome) => {
    const { ctx, sql } = contexto('promotor', r);
    await provedor(nome).puxar!(ctx, pull());
    expect(sql).toHaveLength(1);
  });
});

describe('O-3: opção lida da consulta core.promotor_ve_pedidos@1 — DESLIGADA', () => {
  const r = { atual: { ligado: false } as Resposta };
  it('lista e detalhe: 403 RN-PRO-01 sem consultar pedidos', async () => {
    const a = contexto('promotor', r);
    await expect(rotaListarPedidos.executar(a.ctx as never)).rejects.toMatchObject(NEGADO);
    const b = contexto('promotor', r, { params: { id: ID_PEDIDO } });
    await expect(rotaVerPedido.executar(b.ctx as never)).rejects.toMatchObject(NEGADO);
    expect(a.sql.length + b.sql.length).toBe(0);
  });
  it.each(ENTIDADES)('pull de %s: vazio', async (nome) => {
    const { ctx, sql } = contexto('promotor', r);
    expect(await provedor(nome).puxar!(ctx, pull())).toEqual([]);
    expect(sql).toHaveLength(0);
  });
  it('escrita segue 403 (com a opção ligada ou desligada)', () => {
    const perm = criarPermissoes([manifest]);
    const p = { id: 'p', tenant_id: 't', perfil: 'promotor' as const, modulos: ['vendedor' as const] };
    for (const a of ['pedido.criar', 'pedido.editar', 'pedido.cancelar', 'pedido.excluir', 'pedido.aprovar', 'pedido.criar_em_nome']) {
      expect(verificarAcao(p, perm, a)).toMatchObject({ ok: false, status: 403 });
    }
  });
  it('vendedor e supervisor inalterados: leem e nem consultam a opção', async () => {
    for (const perfil of ['vendedor', 'supervisor']) {
      const { ctx, nomes } = contexto(perfil, r);
      expect(await rotaListarPedidos.executar(ctx as never)).toEqual({ itens: [], proximo_cursor: null });
      await provedor('pedido').puxar!(ctx, pull());
      expect(nomes).toEqual([]);
    }
  });
});

describe('O-3: a opção é reavaliada a cada requisição e falha abre no padrão', () => {
  it('mudou no Core, a requisição seguinte já vale', async () => {
    const r = { atual: { ligado: true } as Resposta };
    const { ctx } = contexto('promotor', r);
    expect(await promotorVePedidos(ctx)).toBe(true);
    r.atual = { ligado: false };
    expect(await promotorVePedidos(ctx)).toBe(false);
    await expect(rotaListarPedidos.executar(ctx as never)).rejects.toMatchObject(NEGADO);
  });
  it('consulta com falha: padrão do contrato (ligada)', async () => {
    const { ctx } = contexto('promotor', { atual: 'falha' });
    expect(await promotorVePedidos(ctx)).toBe(true);
    expect(await rotaListarPedidos.executar(ctx as never)).toEqual({ itens: [], proximo_cursor: null });
  });
});
