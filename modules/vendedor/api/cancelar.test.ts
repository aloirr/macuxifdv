import { describe, expect, it } from 'vitest';
import { criarPermissoes, verificarAcao } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import { verificarCancelamento } from '../domain/order';
import { rotaCancelarPedido } from './index';

describe('POST /v1/vendedor/pedidos/:id/cancelar (o fluxo com banco está em pedido.db.test.ts)', () => {
  it.each(['enviado', 'sent_to_erp', 'integrated', 'faturado_parcial'])('RN-VEN-CANCELAR-APOS-ENVIO: %s -> 422 com código e mensagem', (st) => {
    expect(verificarCancelamento(st)).toEqual({ ok: false, codigo: 'RN-VEN-CANCELAR-APOS-ENVIO', status: 422, mensagem: 'Pedido já enviado ao ERP — cancele no ERP' });
  });

  it.each(['draft', 'queued', 'received', 'pending_approval', 'approved', 'rejected'])('RN-VEN-CANCELAR-APOS-ENVIO: %s ainda cancela (P-2: aprovado cancela, não edita)', (st) => {
    expect(verificarCancelamento(st)).toEqual({ ok: true });
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
});
