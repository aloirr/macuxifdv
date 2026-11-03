import { describe, expect, it } from 'vitest';
import type { ClienteSync, HistoricoCompraSync } from '../../contracts';
import { filtrarExtensoesDePedido, pedidosVisiveisNoAparelho } from '../../domain';
import { montarCliente360Local } from './cliente360-local';

const HOJE = '2026-10-31';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { updated_at: '2026-10-31T10:00:00.000000Z', deleted_at: null, external_id: null };
const cliente = { ...base, id: id(1), documento: '1', razao_social: 'A Ltda', nome_fantasia: 'A', segmento: null, telefone: null, email: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null, cep: null, latitude: null, longitude: null, ativo: true } as unknown as ClienteSync;
const compra: HistoricoCompraSync = { ...base, id: id(2), cliente_id: id(1), ano_mes: '2026-10', valor_cents: 800_000, pedidos: 2, itens: 6, ultima_compra_em: '2026-10-20', origem: 'erp' };
const linhas = { cliente, contatos: [], financeiro: null, titulos: [], historico: [compra] };
const param = (valor: unknown, extra: Record<string, unknown> = {}) => ({ modulo: 'core', chave: 'promotor_ve_pedidos', valor, ...extra });

describe('RN-CORE-01 / RN-PRO-01: pedidosVisiveisNoAparelho (perfil + opção, offline)', () => {
  it('promotor com a opção desligada não vê; ligada, ou sem registro, vê', () => {
    expect(pedidosVisiveisNoAparelho('promotor', [param(false)])).toBe(false);
    expect(pedidosVisiveisNoAparelho('promotor', [param(true)])).toBe(true);
    expect(pedidosVisiveisNoAparelho('promotor', [])).toBe(true);
    expect(pedidosVisiveisNoAparelho('promotor', [param(false, { deleted_at: '2030-01-01T00:00:00Z' })])).toBe(true);
  });
  it('vendedor, gestor e demais perfis não mudam com a opção desligada', () => {
    for (const p of ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin']) expect(pedidosVisiveisNoAparelho(p, [param(false)])).toBe(true);
  });
  it('perfil desconhecido (null) não é promotor: nada muda', () => {
    expect(pedidosVisiveisNoAparelho(null, [param(false)])).toBe(true);
  });
});

describe('RN-PRO-01: Cliente 360 do promotor sem pedidos quando a opção está desligada', () => {
  it('opção desligada: sem histórico, sem contagem de pedidos e sem valores de compra', () => {
    const r = montarCliente360Local(linhas, HOJE, { verPedidos: false });
    expect(r.pedidos_visiveis).toBe(false);
    expect(r.historico).toEqual([]);
    expect(r.resumo_compras).toMatchObject({ ultima_compra_em: null, total_12m_cents: 0, ticket_medio_cents: 0 });
  });
  it('opção ligada (ou padrão, para vendedor e gestor): mostra o histórico de compras', () => {
    for (const r of [montarCliente360Local(linhas, HOJE, { verPedidos: true }), montarCliente360Local(linhas, HOJE)]) {
      expect(r.pedidos_visiveis).toBe(true);
      expect(r.historico).toHaveLength(1);
      expect(r.resumo_compras).toMatchObject({ ultima_compra_em: '2026-10-20', total_12m_cents: 800_000 });
    }
  });
  it('o resto do Cliente 360 (financeiro, contatos) não depende da opção', () => {
    const r = montarCliente360Local({ ...linhas, contatos: [] }, HOJE, { verPedidos: false });
    expect(r.cliente.id).toBe(id(1));
  });
});

describe('RN-PRO-01: seções e abas de extensão de pedido montadas pelo Core', () => {
  const itens = [
    { id: 'ultimos-pedidos', acao: 'pedido.ver', payload: {} },
    { id: 'mix', acao: 'pedido.criar', payload: {} },
    { id: 'detalhe', acao: 'pedido_item.ver', payload: {} },
    { id: 'declarada', payload: { mostraPedidos: true } },
    { id: 'pesquisas', acao: 'pesquisa.responder', payload: {} },
    { id: 'loja', payload: {} },
  ];
  it('opção desligada: some o que é de pedido (ação pedido.*, pedido_item.* ou declarado) e fica o resto', () => {
    expect(filtrarExtensoesDePedido(itens, false).map((i) => i.id)).toEqual(['pesquisas', 'loja']);
  });
  it('opção ligada: nada é filtrado', () => {
    expect(filtrarExtensoesDePedido(itens, true)).toHaveLength(itens.length);
  });
});
