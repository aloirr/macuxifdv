import { describe, expect, it } from 'vitest';
import type { CustomerSummary } from '@macuxi/core/contracts';
import { nomesDosVendedores, rotuloAcessivelDaOpcao, seletorEmNome, subtituloDoSeletor, textoOutraCarteira, vazioDoSeletor, vinculoVigente } from './seletor-em-nome';

const cli = (id: string, nome: string, extra: Partial<CustomerSummary> = {}): CustomerSummary => ({ id, erp_code: id, trade_name: nome, legal_name: nome, cnpj: '', segment: '', abc_curve: 'C', address: '', city: '', district: '', lat: null, lng: null, phone: '', email: '', seller_id: '', seller_name: '', customer_since: '', credit_limit_cents: 0, open_receivables_cents: 0, available_credit_cents: 0, overdue_count: 0, overdue_cents: 0, last_purchase_at: null, days_since_purchase: null, avg_monthly_cents: 0, positivated_this_month: false, price_table_id: null, ...extra });
const v = (cliente_id: string, usuario_id: string, extra: Record<string, unknown> = {}) => ({ cliente_id, usuario_id, papel: 'vendedor' as const, inicio: '2026-01-01', fim: null, ...extra });
const agora = new Date('2026-11-08T15:00:00Z');
const tz = 'America/Manaus';
const clientes = [cli('c1', 'Padaria Sol'), cli('c2', 'Mercado Lua'), cli('c3', 'Padaria Lua')];
const carteiras = [v('c1', 'u1'), v('c2', 'u2'), v('c3', 'u1')];
const nomes = new Map([['u1', 'Ana Souza'], ['u2', 'Bruno Lima']]);
const base = { clientes, carteiras, vendedorId: 'u1', nomes, agora, tz };

describe('RN-VEN-35: vigência do vínculo da carteira', () => {
  it('RN-VEN-35: início futuro, fim passado, promotor e excluído não contam', () => {
    expect(vinculoVigente(v('c', 'u', { inicio: '2026-11-09' }), '2026-11-08')).toBe(false);
    expect(vinculoVigente(v('c', 'u', { fim: '2026-11-07' }), '2026-11-08')).toBe(false);
    expect(vinculoVigente(v('c', 'u', { papel: 'promotor' }), '2026-11-08')).toBe(false);
    expect(vinculoVigente(v('c', 'u', { deleted_at: '2026-11-01T00:00:00Z' }), '2026-11-08')).toBe(false);
    expect(vinculoVigente(v('c', 'u', { fim: '2026-11-08' }), '2026-11-08')).toBe(true);
    expect(vinculoVigente(v('c', 'u', { inicio: '2026-11-08' }), '2026-11-08')).toBe(true);
  });
  it('RN-VEN-35: a vigência usa o dia no fuso do tenant (02:00Z em Manaus ainda é dia 07)', () => {
    const cs = [v('c1', 'u1', { inicio: '2026-11-08' })];
    const r = seletorEmNome({ ...base, clientes: [cli('c1', 'Padaria Sol')], carteiras: [...cs, v('c9', 'u9')], agora: new Date('2026-11-08T02:00:00Z'), busca: '' });
    expect(r.opcoes).toEqual([]);
    const r2 = seletorEmNome({ ...base, clientes: [cli('c1', 'Padaria Sol')], carteiras: [...cs, v('c9', 'u9')], agora: new Date('2026-11-08T05:00:00Z'), busca: '' });
    expect(r2.opcoes.map((o) => o.cliente.id)).toEqual(['c1']);
  });
});

describe('RN-VEN-35: seletor do pedido em nome', () => {
  it('RN-VEN-35: sem busca mostra só a carteira do vendedor dono', () => {
    const r = seletorEmNome({ ...base, busca: '' });
    expect(r.opcoes.map((o) => o.cliente.id)).toEqual(['c1', 'c3']);
    expect(r.opcoes.every((o) => o.selecionavel && o.nota === null)).toBe(true);
    expect(r.carteiraConhecida).toBe(true);
    expect(r.totalDaCarteira).toBe(2);
    expect(r.nomeDoDono).toBe('Ana Souza');
  });
  it('RN-VEN-35: com busca, o cliente de outra carteira aparece depois, com a nota e não selecionável', () => {
    const r = seletorEmNome({ ...base, busca: 'lua' });
    expect(r.opcoes.map((o) => o.cliente.id)).toEqual(['c3', 'c2']);
    expect(r.opcoes[1]).toMatchObject({ selecionavel: false, nota: 'Cliente da carteira de Bruno Lima' });
    expect(rotuloAcessivelDaOpcao(r.opcoes[1]!)).toContain('Não pode ser escolhido');
    expect(rotuloAcessivelDaOpcao(r.opcoes[0]!)).toBe('Padaria Lua');
  });
  it('RN-VEN-35: carteira desconhecida no aparelho mostra todos, como antes', () => {
    const r = seletorEmNome({ ...base, carteiras: [], busca: '' });
    expect(r.carteiraConhecida).toBe(false);
    expect(r.opcoes).toHaveLength(3);
    expect(r.opcoes.every((o) => o.selecionavel)).toBe(true);
  });
  it('RN-VEN-35: o limite corta a lista', () => {
    const r = seletorEmNome({ ...base, busca: '', limite: 1 });
    expect(r.opcoes).toHaveLength(1);
  });
});

describe('RN-VEN-35: textos e nomes do seletor', () => {
  it('RN-VEN-35: texto com 0, 1, 2 e 3 vendedores e nome desconhecido', () => {
    expect(textoOutraCarteira([], 0)).toBe('Cliente sem vendedor na carteira');
    expect(textoOutraCarteira([], 1)).toBe('Cliente da carteira de outro vendedor');
    expect(textoOutraCarteira(['Ana'], 1)).toBe('Cliente da carteira de Ana');
    expect(textoOutraCarteira(['Ana', 'Bia'], 2)).toBe('Cliente da carteira de Ana e Bia');
    expect(textoOutraCarteira(['Ana', 'Bia'], 3)).toBe('Cliente da carteira de Ana e mais 2');
    expect(textoOutraCarteira(['Ana'], 2)).toBe('Cliente da carteira de Ana e mais 1');
  });
  it('RN-VEN-35: os nomes da rota vencem os dos pedidos', () => {
    const m = nomesDosVendedores([{ seller_id: 'u1', seller_name: 'Ana (pedido)' }, { seller_id: 'u2', seller_name: 'Bruno' }, { seller_id: 'u3', seller_name: '' }], { id: 'u1', nome: 'Ana Souza' });
    expect(m.get('u1')).toBe('Ana Souza');
    expect(m.get('u2')).toBe('Bruno');
    expect(m.has('u3')).toBe(false);
    expect(nomesDosVendedores([{ seller_id: 'u1', seller_name: 'Ana (pedido)' }], { id: 'u1', nome: null }).get('u1')).toBe('Ana (pedido)');
  });
  it('RN-VEN-35: subtítulo e mensagens de vazio', () => {
    expect(subtituloDoSeletor('Ana Souza')).toBe('Clientes da carteira de Ana Souza');
    expect(subtituloDoSeletor(null)).toBe('Clientes da carteira do vendedor');
    expect(vazioDoSeletor('Ana', false)).toContain('carteira de Ana');
    expect(vazioDoSeletor(null, false)).toContain('do vendedor');
    expect(vazioDoSeletor(undefined, false)).toBe('Nenhum cliente na carteira neste aparelho. Sincronize com sinal e tente de novo.');
    expect(vazioDoSeletor('Ana', false)).not.toContain('encontrado');
    expect(vazioDoSeletor(null, true)).toBe('Confira o código, o CNPJ ou o nome.');
  });
});
