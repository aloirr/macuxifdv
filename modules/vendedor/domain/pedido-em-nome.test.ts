/** RN-VEN-35 / RN-VEN-10 / RN-PRO-01: pedido em nome do vendedor. Funções puras. */
import { describe, expect, it } from 'vitest';
import { revalidarPedido } from './aprovacao';
import { alcadaDoAutorPct, decisorEhAutor, ehPedidoEmNome, politicaDoAutor, verificarPedidoEmNome } from './pedido-em-nome';

const SUP = { id: 'sup', perfil: 'supervisor' };
const GER = { id: 'ger', perfil: 'gerente' };
const vendedor = { id: 'v1', perfil: 'vendedor' };

describe('RN-VEN-35: pedido em nome só quando o dono não é o autor', () => {
  it('sem vendedor_id, ou igual ao autor, é pedido comum', () => {
    expect(ehPedidoEmNome('sup', undefined)).toBe(false);
    expect(ehPedidoEmNome('sup', null)).toBe(false);
    expect(ehPedidoEmNome('sup', 'sup')).toBe(false);
    expect(ehPedidoEmNome('sup', 'v1')).toBe(true);
  });
});

describe('RN-VEN-35: supervisor cria só para vendedor da própria equipe', () => {
  it('vendedor da equipe passa', () => {
    expect(verificarPedidoEmNome({ autor: SUP, vendedor_id: 'v1', vendedor, visiveis: new Set(['sup', 'v1']) })).toBeNull();
  });
  it('vendedor fora da equipe é 403 FORA_DA_EQUIPE, com a ação seguinte', () => {
    const r = verificarPedidoEmNome({ autor: SUP, vendedor_id: 'v9', vendedor, visiveis: new Set(['sup', 'v1']) });
    expect(r).toMatchObject({ codigo: 'FORA_DA_EQUIPE', http: 403 });
    expect(r?.mensagem).toBe('Vendedor fora da sua equipe');
  });
});

describe('RN-VEN-35: gerente cria para vendedores da área dele', () => {
  it('vendedor das equipes abaixo passa', () => {
    expect(verificarPedidoEmNome({ autor: GER, vendedor_id: 'v1', vendedor, visiveis: new Set(['ger', 'sup', 'v1']) })).toBeNull();
  });
  it('vendedor de outra área é 403 e a mensagem fala em área', () => {
    const r = verificarPedidoEmNome({ autor: GER, vendedor_id: 'v7', vendedor, visiveis: new Set(['ger', 'v1']) });
    expect(r).toMatchObject({ codigo: 'FORA_DA_EQUIPE', http: 403 });
    expect(r?.mensagem).toMatch(/área/);
  });
});

describe('RN-PRO-01: o promotor nunca cria pedido, nem em nome nem como dono', () => {
  it('autor promotor é 403 RN-PRO-01', () => {
    expect(verificarPedidoEmNome({ autor: { id: 'p', perfil: 'promotor' }, vendedor_id: 'v1', vendedor, visiveis: 'tenant' })).toMatchObject({ codigo: 'RN-PRO-01', http: 403 });
  });
  it('dono promotor é recusado: o pedido não conta para quem não vende', () => {
    expect(verificarPedidoEmNome({ autor: SUP, vendedor_id: 'p1', vendedor: { id: 'p1', perfil: 'promotor' }, visiveis: new Set(['p1']) })).toMatchObject({ codigo: 'RN-PRO-01', http: 403 });
  });
});

describe('RN-VEN-35: quem pode ser autor e quem pode ser dono', () => {
  it('vendedor, analista e assistente não criam em nome', () => {
    for (const perfil of ['vendedor', 'analista', 'assistente', 'admin']) {
      expect(verificarPedidoEmNome({ autor: { id: 'a', perfil }, vendedor_id: 'v1', vendedor, visiveis: 'tenant' })).toMatchObject({ codigo: 'PERFIL_SEM_ACESSO', http: 403 });
    }
  });
  it('dono inexistente ou que não é vendedor é 422 VENDEDOR_INVALIDO', () => {
    expect(verificarPedidoEmNome({ autor: SUP, vendedor_id: 'v1', vendedor: null, visiveis: new Set(['v1']) })).toMatchObject({ codigo: 'VENDEDOR_INVALIDO', http: 422 });
    expect(verificarPedidoEmNome({ autor: SUP, vendedor_id: 'g', vendedor: { id: 'g', perfil: 'gerente' }, visiveis: new Set(['g']) })).toMatchObject({ codigo: 'VENDEDOR_INVALIDO', http: 422 });
  });
});

describe('RN-VEN-10: pedido feito pelo gestor usa a alçada do gestor', () => {
  const pol = { seller_pct: 5, supervisor_pct: 10, manager_pct: 15 };
  it('supervisor usa a dele, gerente a dele', () => {
    expect(alcadaDoAutorPct('supervisor', pol)).toBe(10);
    expect(alcadaDoAutorPct('gerente', pol)).toBe(15);
  });
  it('vendedor (e qualquer outro perfil) fica na alçada do vendedor', () => {
    expect(alcadaDoAutorPct('vendedor', pol)).toBe(5);
  });
});

describe('RN-VEN-35 + RN-VEN-10: revalidação do pedido em nome', () => {
  const policy = { seller_pct: 5, supervisor_pct: 10, manager_pct: 15, above_manager: 'director' as const, exceptions: { v1: 8 } };
  const base = (perfil: string, desconto: number, emNome = true) => ({
    perfil,
    em_nome: emNome,
    vendedor_id: 'v1',
    cliente_id: 'c1',
    carteira: ['c1'],
    desconto_pct: desconto,
    itens: [{ product_id: 'p1', sku: 'P1', quantity: 1 }],
    precos: { p1: 10_000 },
    policy: politicaDoAutor(policy, perfil),
  });
  it('supervisor em nome: 8% (alçada do vendedor com exceção) ainda segue direto pela alçada DELE (10%)', () => {
    const r = revalidarPedido(base('supervisor', 8));
    expect(r).toMatchObject({ ok: true, status: 'approved' });
  });
  it('supervisor em nome: 12% passa da alçada dele e vai ao gerente', () => {
    expect(revalidarPedido(base('supervisor', 12))).toMatchObject({ ok: true, status: 'pending_approval', nivel: 'gerente' });
  });
  it('gerente em nome: 15% segue direto; 20% vai à diretoria/analista', () => {
    expect(revalidarPedido(base('gerente', 15))).toMatchObject({ ok: true, status: 'approved' });
    expect(revalidarPedido(base('gerente', 20))).toMatchObject({ ok: true, status: 'pending_approval', nivel: 'analista' });
  });
  it('sem a marca em_nome, supervisor continua sem criar pedido pelo aparelho', () => {
    expect(revalidarPedido(base('supervisor', 1, false))).toMatchObject({ ok: false, codigo: 'PERFIL_SEM_ACESSO' });
  });
  it('RN-PRO-01: promotor é recusado mesmo com em_nome', () => {
    expect(revalidarPedido(base('promotor', 1))).toMatchObject({ ok: false, codigo: 'RN-PRO-01' });
  });
  it('analista não ganha o direito por em_nome', () => {
    expect(revalidarPedido(base('analista', 1))).toMatchObject({ ok: false, codigo: 'PERFIL_SEM_ACESSO' });
  });
});

describe('RN-VEN-10 e T-0187 P4 A: ninguém decide a aprovação do próprio pedido', () => {
  it('decisorEhAutor: o autor_id decide por ele; sem autor_id o autor é o vendedor dono', () => {
    expect(decisorEhAutor({ autor_id: 'sup', vendedor_id: 'v1' }, 'sup')).toBe(true);
    expect(decisorEhAutor({ autor_id: 'sup', vendedor_id: 'v1' }, 'ger')).toBe(false);
    expect(decisorEhAutor({ autor_id: 'sup', vendedor_id: 'v1' }, 'v1')).toBe(false);
    expect(decisorEhAutor({ autor_id: null, vendedor_id: 'v1' }, 'v1')).toBe(true);
    expect(decisorEhAutor({ vendedor_id: 'v1' }, 'sup')).toBe(false);
  });
});

describe('D-187-01: vendedor inexistente vem antes de fora da equipe', () => {
  it('dono que não existe e fora da equipe é VENDEDOR_INVALIDO (422), não FORA_DA_EQUIPE', () => {
    expect(verificarPedidoEmNome({ autor: SUP, vendedor_id: 'x', vendedor: null, visiveis: new Set(['sup']) })).toMatchObject({ codigo: 'VENDEDOR_INVALIDO', http: 422 });
  });
  it('dono que existe e está fora da equipe segue FORA_DA_EQUIPE (403)', () => {
    expect(verificarPedidoEmNome({ autor: SUP, vendedor_id: 'v9', vendedor: { id: 'v9', perfil: 'vendedor' }, visiveis: new Set(['sup']) })).toMatchObject({ codigo: 'FORA_DA_EQUIPE', http: 403 });
  });
});
