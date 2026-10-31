import { describe, expect, it } from 'vitest';
import { ErroNaoEncontrado, ErroRegraNegocio, verificarAcao, criarPermissoes, type ContextoRota } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import apiVendedor, { rotaCancelarPedido } from './index';

const ID = '11111111-1111-4111-8111-111111111111';
function ctx(status: string, carteira: ReadonlySet<string> | 'tenant' = 'tenant') {
  const consultas: string[] = [];
  const c = {
    usuario: { id: 'u', tenant_id: 't', perfil: 'vendedor', modulos: ['vendedor'] },
    requestId: 'r', corpo: {}, query: {}, params: { id: ID },
    agora: () => new Date('2026-10-31T12:00:00Z'),
    carteira: async () => carteira,
    log: { info() {}, warn() {}, error() {} },
    comTenant: async (fn: (db: unknown) => Promise<unknown>) =>
      fn({ query: async (sql: string) => { consultas.push(sql); return { rows: sql.startsWith('select') ? [{ status, cliente_id: 'c1' }] : [], rowCount: 1 }; } }),
  } as unknown as ContextoRota;
  return { c, consultas };
}

describe('POST /v1/vendedor/pedidos/:id/cancelar', () => {
  it.each(['enviado', 'sent_to_erp', 'integrated', 'faturado_parcial'])('RN-VEN-CANCELAR-APOS-ENVIO: %s -> 422 com código e mensagem', async (st) => {
    const { c, consultas } = ctx(st);
    const erro = await rotaCancelarPedido.executar(c).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroRegraNegocio);
    expect(erro).toMatchObject({ status: 422, codigo: 'RN-VEN-CANCELAR-APOS-ENVIO', message: 'Pedido já enviado ao ERP — cancele no ERP' });
    expect(consultas.some((s) => s.startsWith('update'))).toBe(false);
  });

  it('RN-VEN-CANCELAR-APOS-ENVIO: antes do envio cancela (200)', async () => {
    const { c, consultas } = ctx('pending_approval');
    await expect(rotaCancelarPedido.executar(c)).resolves.toEqual({ id: ID, status: 'cancelled' });
    expect(consultas.some((s) => s.startsWith('update'))).toBe(true);
    expect(rotaCancelarPedido.status ?? 200).toBe(200);
  });

  it('RN-CORE-04: pedido de cliente fora da carteira é tratado como não encontrado', async () => {
    const { c } = ctx('draft', new Set(['outro']));
    const erro = await rotaCancelarPedido.executar(c).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroNaoEncontrado);
    expect(erro).toMatchObject({ status: 404, codigo: 'PEDIDO_NAO_ENCONTRADO' });
  });

  it('RN-PRO-01: promotor recebe 403 PERFIL_SEM_ACESSO na ação pedido.cancelar', () => {
    expect(rotaCancelarPedido.acao).toBe('pedido.cancelar');
    const r = verificarAcao({ id: 'p', tenant_id: 't', perfil: 'promotor', modulos: ['vendedor'] }, criarPermissoes([manifest]), 'pedido.cancelar');
    expect(r).toMatchObject({ ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO' });
  });

  it('RN-CORE-02: sem licença do módulo, 403 MODULO_INATIVO', () => {
    const r = verificarAcao({ id: 'v', tenant_id: 't', perfil: 'vendedor', modulos: ['core'] }, criarPermissoes([manifest]), 'pedido.cancelar');
    expect(r).toMatchObject({ ok: false, status: 403, codigo: 'MODULO_INATIVO' });
  });

  it('a API do módulo é válida para o SDK', () => {
    expect(apiVendedor.rotas).toHaveLength(3);
  });
});
