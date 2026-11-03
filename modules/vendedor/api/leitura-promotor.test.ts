/**
 * O-3 do doc 03 / RN-PRO-01: o promotor lê, SOMENTE LEITURA, os pedidos da própria carteira quando a opção do perfil
 * Promotor `promotor_ve_pedidos` está ligada (padrão); desligada, 403 na lista e no detalhe e o pull não entrega nada.
 * Sem banco: contexto falso com a opção injetada (`usarOpcaoPromotorVePedidos`) e um `db` que só registra as consultas.
 * O fluxo com Postgres real está em sync.db.test.ts e pedido.db.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { criarPermissoes, verificarAcao, type ContextoBase, type ContextoRota, type PedidoPull } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import { promotorVePedidos, usarOpcaoPromotorVePedidos } from './opcao-promotor';
import { rotaListarPedidos, rotaVerPedido } from './pedidos';
import { receberPedidos } from './receber';
import { provedoresSyncVendedor } from './sync';

const ID_PEDIDO = '0f610000-0000-4000-8000-000000000001';
const C1 = '0c100000-0000-4000-8000-000000000001';

interface Consulta {
  sql: string;
  valores: unknown[];
}

function contexto(perfil: string, extra: { query?: unknown; params?: unknown } = {}) {
  const consultas: Consulta[] = [];
  let aberturas = 0;
  const db = {
    query: async (sql: string, valores: unknown[] = []) => {
      consultas.push({ sql, valores });
      return { rows: [] };
    },
  };
  const ctx = {
    usuario: { id: 'u-1', tenant_id: 't-1', perfil, modulos: ['vendedor'] },
    query: extra.query ?? {},
    params: extra.params ?? {},
    corpo: {},
    agora: () => new Date('2026-11-03T12:00:00Z'),
    fuso: () => 'America/Manaus',
    parametros: () => ({}),
    usuariosVisiveis: async () => new Set(['u-1']),
    carteira: async () => new Set([C1]),
    comTenant: async (fn: (d: typeof db, tx: unknown) => Promise<unknown>) => {
      aberturas++;
      return fn(db, { consultar: async () => ({ ligado: true }) });
    },
  } as unknown as ContextoBase & ContextoRota;
  return { ctx, consultas, aberturas: () => aberturas };
}

const pullVazio = (): PedidoPull => ({ desde: null, ate: '2026-11-03T12:00:00.000Z', limite: 100 });
const provedor = (nome: string) => provedoresSyncVendedor.find((p) => p.entidade.nome === nome)!;
const CODIGO_403 = { status: 403, codigo: 'RN-PRO-01' };

let restaurar: (() => void) | null = null;
const opcao = (ligada: boolean) => {
  restaurar = usarOpcaoPromotorVePedidos(() => ligada);
};
afterEach(() => {
  restaurar?.();
  restaurar = null;
});

describe('O-3: ponto único da opção promotor_ve_pedidos', () => {
  it('O-3: sem usar leitor injetado, a consulta core.promotor_ve_pedidos@1 do Core decide (padrão LIGADA)', async () => {
    expect(await promotorVePedidos(contexto('promotor').ctx)).toBe(true);
  });

  it('O-3: comTenant sem tx.consultar é erro de montagem (não vira ligado silencioso)', async () => {
    const ctx = { usuario: { perfil: 'promotor' }, comTenant: async (fn: (db: unknown) => unknown) => fn({}) };
    await expect(promotorVePedidos(ctx as never)).rejects.toThrow(/Montagem/);
  });

  it('O-3: a opção só é consultada para o promotor (vendedor e supervisor não mudam)', async () => {
    let lida = 0;
    restaurar = usarOpcaoPromotorVePedidos(() => {
      lida++;
      return false;
    });
    for (const perfil of ['vendedor', 'supervisor']) {
      const { ctx, consultas } = contexto(perfil, { query: {} });
      expect(await rotaListarPedidos.executar(ctx as never)).toEqual({ itens: [], proximo_cursor: null });
      expect(consultas).toHaveLength(1);
    }
    expect(lida).toBe(0);
  });
});

describe('O-3: opção LIGADA — promotor lê com escopo de carteira', () => {
  it('lista: consulta filtrada pelos clientes da carteira, nunca por vendedor', async () => {
    opcao(true);
    const { ctx, consultas } = contexto('promotor');
    expect(await rotaListarPedidos.executar(ctx as never)).toEqual({ itens: [], proximo_cursor: null });
    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.valores[0]).toBeNull();
    expect(consultas[0]!.valores[1]).toEqual([C1]);
  });

  it('detalhe: consulta o pedido (fora da carteira = 404, não 403)', async () => {
    opcao(true);
    const { ctx, consultas } = contexto('promotor', { params: { id: ID_PEDIDO } });
    await expect(rotaVerPedido.executar(ctx as never)).rejects.toMatchObject({ status: 404, codigo: 'PEDIDO_NAO_ENCONTRADO' });
    expect(consultas.length).toBeGreaterThan(0);
    expect(consultas[0]!.valores.slice(1)).toEqual([null, [C1]]); // vendedores = null, clientes = carteira
  });

  it.each(['pedido', 'pedido_item', 'pedido_evento'])('pull de %s: consulta com escopo de carteira (vendedores = null, clientes = carteira)', async (nome) => {
    opcao(true);
    const { ctx, consultas } = contexto('promotor');
    await provedor(nome).puxar!(ctx, pullVazio());
    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.valores[4]).toBeNull();
    expect(consultas[0]!.valores[5]).toEqual([C1]);
  });

  it('RN-PRO-01: nenhuma escrita de pedido liberada ao promotor, mesmo com a opção ligada (403 PERFIL_SEM_ACESSO)', () => {
    opcao(true);
    const perm = criarPermissoes([manifest]);
    const p = { id: 'p', tenant_id: 't', perfil: 'promotor' as const, modulos: ['vendedor' as const] };
    expect(verificarAcao(p, perm, 'pedido.ver')).toMatchObject({ ok: true });
    // criar, editar, duplicar (= criar), cancelar, excluir, aprovar/rejeitar (= aprovar) e criar em nome
    for (const a of ['pedido.criar', 'pedido.editar', 'pedido.cancelar', 'pedido.excluir', 'pedido.aprovar', 'pedido.criar_em_nome']) {
      expect(verificarAcao(p, perm, a)).toMatchObject({ ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    }
  });

  it('RN-PRO-01: o push de pedido do promotor é recusado no servidor com a opção ligada (nada é gravado)', async () => {
    opcao(true);
    const { ctx, consultas } = contexto('promotor');
    const r = await receberPedidos(ctx, [{ entidade: 'pedido', id: ID_PEDIDO, operacao: 'upsert', payload: { id: ID_PEDIDO } }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: ID_PEDIDO, status: 'rejeitado' });
    expect(JSON.stringify(r[0])).toContain('RN-PRO-01');
    expect(consultas).toHaveLength(0);
  });
});

describe('O-3: opção DESLIGADA — promotor sem leitura de pedidos', () => {
  it('lista: 403 e nenhuma consulta ao banco', async () => {
    opcao(false);
    const { ctx, aberturas } = contexto('promotor');
    await expect(rotaListarPedidos.executar(ctx as never)).rejects.toMatchObject(CODIGO_403);
    expect(aberturas()).toBe(0);
  });

  it('detalhe: 403 (e não 404, para não sugerir que o pedido existe ou não) sem consultar o banco', async () => {
    opcao(false);
    const { ctx, aberturas } = contexto('promotor', { params: { id: ID_PEDIDO } });
    await expect(rotaVerPedido.executar(ctx as never)).rejects.toMatchObject(CODIGO_403);
    expect(aberturas()).toBe(0);
  });

  it('o 403 traz mensagem em português com a próxima ação', async () => {
    opcao(false);
    await expect(rotaListarPedidos.executar(contexto('promotor').ctx as never)).rejects.toThrow(/peça ao administrador/);
  });

  it.each(['pedido', 'pedido_item', 'pedido_evento'])('pull de %s: não entrega nada e não abre transação', async (nome) => {
    opcao(false);
    const { ctx, aberturas } = contexto('promotor');
    expect(await provedor(nome).puxar!(ctx, pullVazio())).toEqual([]);
    expect(aberturas()).toBe(0);
  });

  it('o desligado vale só para o promotor: vendedor e supervisor seguem lendo lista, detalhe e pull', async () => {
    opcao(false);
    for (const perfil of ['vendedor', 'supervisor']) {
      expect(await rotaListarPedidos.executar(contexto(perfil).ctx as never)).toEqual({ itens: [], proximo_cursor: null });
      await expect(rotaVerPedido.executar(contexto(perfil, { params: { id: ID_PEDIDO } }).ctx as never)).rejects.toMatchObject({ status: 404 });
      const { ctx, consultas } = contexto(perfil);
      await provedor('pedido').puxar!(ctx, pullVazio());
      expect(consultas).toHaveLength(1);
      expect(consultas[0]!.valores[4]).toEqual(['u-1']);
      expect(consultas[0]!.valores[5]).toBeNull();
    }
  });
});
