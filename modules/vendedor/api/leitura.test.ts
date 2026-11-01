import { describe, expect, it } from 'vitest';
import { criarPermissoes, verificarAcao, verificarAcesso } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import apiVendedor, { rotaAlcadas, rotaAprovarPedido, rotaCancelarPedido, rotaListarPedidos, rotaRejeitarPedido, rotaVerPedido } from './index';
import { escopoDoPedido } from './sync';

describe('leitura de pedidos pelo promotor (RN-PRO-01, O-3)', () => {
  it('RN-PRO-01: promotor pode pedido.ver e nenhuma ação de escrita de pedido', () => {
    const perm = criarPermissoes([manifest]);
    const p = { id: 'p', tenant_id: 't', perfil: 'promotor' as const, modulos: ['vendedor' as const] };
    expect(verificarAcao(p, perm, 'pedido.ver')).toMatchObject({ ok: true });
    for (const a of ['pedido.criar', 'pedido.editar', 'pedido.cancelar', 'pedido.excluir', 'pedido.criar_em_nome', 'pedido.aprovar']) {
      expect(verificarAcao(p, perm, a)).toMatchObject({ ok: false, status: 403 });
    }
  });

  it('RN-PRO-01 / T-0035: GET /alcadas não é aberto ao promotor (403 pelo perfil); vendedor, supervisor, gerente, analista, assistente e admin seguem', () => {
    const regra = { modulo: 'vendedor' as const, perfis: rotaAlcadas.perfis! };
    const como = (perfil: 'promotor' | 'vendedor' | 'supervisor' | 'gerente' | 'analista' | 'assistente' | 'admin') =>
      verificarAcesso({ id: 'u', tenant_id: 't', perfil, modulos: ['vendedor'] }, regra);
    expect(rotaAlcadas.acao).toBeUndefined();
    expect(como('promotor')).toMatchObject({ ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    for (const perfil of ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const) expect(como(perfil)).toEqual({ ok: true });
  });

  it('RN-PRO-01: promotor recebe 403 nas rotas de aprovar, rejeitar e cancelar; as de leitura ficam com pedido.ver', () => {
    const perm = criarPermissoes([manifest]);
    const p = { id: 'p', tenant_id: 't', perfil: 'promotor' as const, modulos: ['vendedor' as const] };
    for (const r of [rotaAprovarPedido, rotaRejeitarPedido, rotaCancelarPedido]) expect(verificarAcao(p, perm, r.acao!)).toMatchObject({ ok: false, status: 403 });
    for (const r of [rotaListarPedidos, rotaVerPedido]) expect(r.acao).toBe('pedido.ver');
  });

  it('RN-GES-08 / P-3: aprovar e rejeitar exigem pedido.aprovar; vendedor e assistente recebem 403 PERFIL_SEM_ACESSO', () => {
    const perm = criarPermissoes([manifest]);
    for (const perfil of ['vendedor', 'assistente'] as const) {
      expect(verificarAcao({ id: 'u', tenant_id: 't', perfil, modulos: ['vendedor'] }, perm, rotaAprovarPedido.acao!)).toMatchObject({ ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    }
    for (const perfil of ['supervisor', 'gerente', 'analista'] as const) {
      expect(verificarAcao({ id: 'u', tenant_id: 't', perfil, modulos: ['vendedor'] }, perm, rotaRejeitarPedido.acao!)).toMatchObject({ ok: true });
    }
    expect(rotaAprovarPedido.caminho).toBe('pedidos/:id/aprovar');
    expect(rotaRejeitarPedido.caminho).toBe('pedidos/:id/rejeitar');
  });

  it('matriz §2: admin vê pedidos do tenant (pedido.ver) e não decide nem cancela', () => {
    const perm = criarPermissoes([manifest]);
    const admin = { id: 'a', tenant_id: 't', perfil: 'admin' as const, modulos: ['vendedor' as const] };
    expect(verificarAcao(admin, perm, 'pedido.ver')).toMatchObject({ ok: true });
    expect(verificarAcao(admin, perm, 'pedido.aprovar')).toMatchObject({ ok: false, status: 403 });
    expect(verificarAcao(admin, perm, 'pedido.cancelar')).toMatchObject({ ok: false, status: 403 });
  });

  it('RN-CORE-04: o escopo é o do pull: promotor = carteira; os demais = usuários visíveis', () => {
    expect(escopoDoPedido('promotor', new Set(['u']), new Set(['c1']))).toEqual({ vendedores: null, clientes: ['c1'] });
    expect(escopoDoPedido('supervisor', new Set(['s', 'v']), new Set(['c1']))).toEqual({ vendedores: ['s', 'v'], clientes: null });
    expect(escopoDoPedido('analista', 'tenant', 'tenant')).toEqual({ vendedores: null, clientes: null });
  });

  it('a API do módulo é válida para o SDK', () => {
    expect(apiVendedor.rotas).toHaveLength(6);
    expect(apiVendedor.sync?.map((s) => s.entidade.nome)).toEqual(['pedido', 'pedido_item', 'pedido_evento', 'condicao_pagamento', 'cliente_condicao']);
  });
});
