/** RF-GES-05 / RN-VEN-35 / RN-VEN-10 no aparelho do gestor: pedido em nome do vendedor. Funções puras. */
import { describe, expect, it } from 'vitest';
import { PedidoPush } from '../../contracts';
import { politicaApi } from './pull';
import { politicaParaAutor } from './novo-pedido';
import { montarPedido, prepararPedido, rascunhoVazio } from './pedidos';

const produto = (id: string, preco: number) => ({ id, erp_code: id.toUpperCase(), description: `Produto ${id}`, unit: 'UN', price_cents: preco, stock_total: 1_000_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false }) as never;
const VENDEDOR = '0e000000-0000-4000-8000-000000000010';
const base = {
  cliente: { id: 'c1', trade_name: 'Mercado Boto' } as never,
  catalogo: [produto('a', 10_000)],
  politica: politicaApi({}),
  eu: null,
  filaDoClienteCents: 0,
  unidades: [],
};
const comDesconto = (pct: number) => ({ ...rascunhoVazio('c1'), lines: { a: 1 }, discount_pct: pct, vendedor_em_nome_id: VENDEDOR });

describe('RN-VEN-35: o push do pedido em nome leva o dono e nunca o autor', () => {
  it('vendedor_id vai no payload e o payload passa no contrato; autor_id não existe no aparelho', () => {
    const rascunho = comDesconto(0);
    const { v } = prepararPedido({ ...base, rascunho, emNome: { vendedor_id: VENDEDOR, perfil_autor: 'supervisor' } });
    const p = montarPedido({ id: '9f0c6b9e-6c3f-4b5f-8b3a-1f4a0f7d1c99', cliente: base.cliente, rascunho, v, semSinal: false, agora: '2026-11-05T12:00:00.000Z' });
    expect(PedidoPush.parse(p)).toMatchObject({ vendedor_id: VENDEDOR });
    expect('autor_id' in p).toBe(false);
  });
  it('pedido comum (sem dono escolhido) não leva vendedor_id: o payload fica igual ao dos APKs anteriores', () => {
    const rascunho = { ...rascunhoVazio('c1'), lines: { a: 1 } };
    const { v } = prepararPedido({ ...base, eu: { id: 'v', name: 'V', short_name: 'V', team_id: '', team_name: '', branch_id: '', max_discount_pct: 5 }, rascunho });
    const p = montarPedido({ id: '9f0c6b9e-6c3f-4b5f-8b3a-1f4a0f7d1c99', cliente: base.cliente, rascunho, v, semSinal: false, agora: '2026-11-05T12:00:00.000Z' });
    expect('vendedor_id' in p).toBe(false);
  });
});

describe('RN-VEN-10: o aparelho do gestor valida pela alçada do gestor', () => {
  it('o gestor não precisa ser vendedor com carteira para fazer o pedido em nome', () => {
    expect(() => prepararPedido({ ...base, rascunho: comDesconto(0) })).toThrow(/não é vendedor/);
    expect(() => prepararPedido({ ...base, rascunho: comDesconto(0), emNome: { vendedor_id: VENDEDOR, perfil_autor: 'gerente' } })).not.toThrow();
  });
  it('supervisor: 8% segue direto (limite 10%); 12% vai à aprovação', () => {
    const emNome = { vendedor_id: VENDEDOR, perfil_autor: 'supervisor' };
    expect(prepararPedido({ ...base, rascunho: comDesconto(8), emNome }).v.outcome).toBe('ok');
    expect(prepararPedido({ ...base, rascunho: comDesconto(12), emNome }).v.outcome).toBe('pending_approval');
  });
  it('gerente: 14% segue direto (limite 15%)', () => {
    expect(prepararPedido({ ...base, rascunho: comDesconto(14), emNome: { vendedor_id: VENDEDOR, perfil_autor: 'gerente' } }).v.outcome).toBe('ok');
  });
  it('politicaParaAutor tira as exceções individuais do vendedor', () => {
    const p = { ...politicaApi({}), exceptions: [{ seller_id: VENDEDOR, max_discount_pct: 8, seller_name: 'Vera' }] };
    expect(politicaParaAutor(p, 'supervisor')).toMatchObject({ seller_pct: p.supervisor_pct, exceptions: [] });
    expect(politicaParaAutor(p, 'gerente')).toMatchObject({ seller_pct: p.manager_pct, exceptions: [] });
  });
});
