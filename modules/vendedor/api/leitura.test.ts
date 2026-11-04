import { describe, expect, it } from 'vitest';
import { criarPermissoes, verificarAcao, verificarAcesso } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import apiVendedor, { rotasTransportadoras, rotaAlcadas, rotaAprovarPedido, rotaCancelarPedido, rotaListarPedidos, rotaRejeitarPedido, rotaVerPedido } from './index';
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

  it('T-0061 / RN-VEN-16: transportadoras e padrão do frete — gerenciar só admin/analista/gerente, promotor e vendedor sem acesso, e sem licença do módulo nada passa', () => {
    const perm = criarPermissoes([manifest]);
    const como = (perfil: 'promotor' | 'vendedor' | 'supervisor' | 'gerente' | 'analista' | 'assistente' | 'admin', modulos: Array<'vendedor'> = ['vendedor']) => ({ id: 'u', tenant_id: 't', perfil, modulos });
    for (const r of rotasTransportadoras) expect(r.acao).toBeTruthy();
    for (const a of ['transportadora.ver', 'transportadora.gerenciar']) {
      expect(verificarAcao(como('promotor'), perm, a)).toMatchObject({ ok: false, status: 403 });
      expect(verificarAcao(como('vendedor'), perm, a)).toMatchObject({ ok: false, status: 403 });
    }
    for (const perfil of ['admin', 'analista', 'gerente'] as const) expect(verificarAcao(como(perfil), perm, 'transportadora.gerenciar')).toMatchObject({ ok: true });
    for (const perfil of ['supervisor', 'assistente'] as const) {
      expect(verificarAcao(como(perfil), perm, 'transportadora.ver')).toMatchObject({ ok: true });
      expect(verificarAcao(como(perfil), perm, 'transportadora.gerenciar')).toMatchObject({ ok: false, status: 403 });
    }
    // licença: sem o módulo vendedor contratado, nem o gerente passa
    expect(verificarAcao(como('gerente', []), perm, 'transportadora.gerenciar')).toMatchObject({ ok: false });
  });

  it('a API do módulo é válida para o SDK', () => {
    expect(apiVendedor.rotas).toHaveLength(14);
    expect(apiVendedor.sync?.map((s) => s.entidade.nome)).toEqual(['pedido', 'pedido_item', 'pedido_evento', 'condicao_pagamento', 'cliente_condicao', 'transportadora']);
  });
});
