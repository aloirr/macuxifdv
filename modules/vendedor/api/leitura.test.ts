import { describe, expect, it } from 'vitest';
import { ErroNaoEncontrado, verificarAcao, criarPermissoes, type ContextoRota } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import { rotaListarPedidos, rotaVerPedido } from './index';

const ID = '11111111-1111-4111-8111-111111111111';
function ctx(carteira: ReadonlySet<string> | 'tenant', params: unknown = { id: ID }, query: unknown = { limite: 50 }) {
  return {
    usuario: { id: 'u', tenant_id: 't', perfil: 'promotor', modulos: ['vendedor'] },
    requestId: 'r', corpo: {}, query, params,
    agora: () => new Date('2026-10-31T12:00:00Z'),
    carteira: async () => carteira,
    log: { info() {}, warn() {}, error() {} },
    comTenant: async (fn: (db: unknown) => Promise<unknown>) =>
      fn({ query: async () => ({ rows: [{ id: ID, status: 'received', cliente_id: 'c1' }, { id: 'x', status: 'received', cliente_id: 'c2' }], rowCount: 2 }) }),
  } as unknown as ContextoRota;
}

describe('leitura de pedidos pelo promotor (RN-PRO-01, O-3)', () => {
  it('RN-PRO-01: promotor pode pedido.ver e nenhuma ação de escrita de pedido', () => {
    const perm = criarPermissoes([manifest]);
    const p = { id: 'p', tenant_id: 't', perfil: 'promotor' as const, modulos: ['vendedor' as const] };
    expect(verificarAcao(p, perm, 'pedido.ver')).toMatchObject({ ok: true });
    for (const a of ['pedido.criar', 'pedido.editar', 'pedido.cancelar', 'pedido.excluir', 'pedido.criar_em_nome', 'pedido.aprovar']) {
      expect(verificarAcao(p, perm, a)).toMatchObject({ ok: false, status: 403 });
    }
  });

  it('RN-CORE-04: lista só devolve pedidos de clientes da carteira', async () => {
    const r = (await rotaListarPedidos.executar(ctx(new Set(['c1']), {}))) as { itens: { cliente_id: string }[] };
    expect(r.itens.map((i) => i.cliente_id)).toEqual(['c1']);
  });

  it('RN-CORE-04: lista filtra pela carteira na consulta, antes do limit', async () => {
    let args: unknown[] = [];
    const c = ctx(new Set(['c1']), {}, { limite: 1 }) as unknown as { comTenant: unknown };
    c.comTenant = async (fn: (db: unknown) => Promise<unknown>) =>
      fn({ query: async (_s: string, a: unknown[]) => { args = a; return { rows: [{ id: ID, status: 'received', cliente_id: 'c1' }], rowCount: 1 }; } });
    await rotaListarPedidos.executar(c as unknown as ContextoRota);
    expect(args[2]).toEqual(['c1']);
  });

  it('RN-CORE-04: detalhe da carteira responde 200', async () => {
    await expect(rotaVerPedido.executar(ctx(new Set(['c1'])))).resolves.toMatchObject({ id: ID });
  });

  it('RN-CORE-04: detalhe fora da carteira é 404 PEDIDO_NAO_ENCONTRADO', async () => {
    const erro = await rotaVerPedido.executar(ctx(new Set(['outro']))).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroNaoEncontrado);
    expect(erro).toMatchObject({ status: 404, codigo: 'PEDIDO_NAO_ENCONTRADO' });
  });
});
