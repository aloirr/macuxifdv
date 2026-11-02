import { describe, expect, it } from 'vitest';
import type { ClienteSync, ProdutoSync } from '@macuxi/core/contracts';
import type { CondicaoPagamentoSync, ClienteCondicaoSync, PedidoEventoSync, PedidoItemSync, PedidoSync } from '../../contracts/sync';
import { prepararPedido, montarPedido, aceitosComoPedidos, pedidosNaFila, rascunhoVazio, type ItemFilaPedido } from './pedidos';
import { rotuloDaAba } from './lista-pedidos';
import {
  condicoesDoCliente,
  detalheDoPedido,
  ESTOQUE_NAO_CONTROLADO,
  LINHAS_VAZIAS,
  lerLinhas,
  listaDeClientes,
  listaDePedidos,
  meDoAparelho,
  paraAprovar,
  politicaApi,
  produtosComPrecos,
  type LinhasVendedor,
} from './pull';

const base = { updated_at: '2026-11-01T12:00:00.000000Z', deleted_at: null, external_id: null };
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function pedido(over: Partial<PedidoSync> & Pick<PedidoSync, 'id'>): PedidoSync {
  return {
    ...base,
    cliente_id: U(100),
    vendedor_id: U(1),
    autor_id: U(1),
    status: 'approved',
    condicao_pagamento: null,
    desconto_pct: 3,
    total_tabela_cents: 250_000,
    total_cents: 242_500,
    observacao: null,
    visita_id: null,
    rota_parada_id: null,
    criado_no_aparelho_em: null,
    recebido_em: '2026-11-01T12:00:00.000000Z',
    numero_erp: null,
    motivo_cancelamento: null,
    created_at: '2026-11-01T12:00:00.000000Z',
    numero: '000007',
    cliente_nome: 'Auto Peças Um',
    vendedor_nome: 'Lucas',
    condicao_pagamento_descricao: 'À vista',
    nivel_aprovacao: null,
    motivos_aprovacao: [],
    ...over,
  } as PedidoSync;
}
const item = (n: number, pedido_id: string, seq: number, qtd: number, tabela: number): PedidoItemSync => ({
  ...base,
  id: U(200 + n),
  pedido_id,
  sequencia: seq,
  produto_id: U(300 + seq),
  quantidade: qtd,
  preco_tabela_cents: tabela,
  preco_unitario_cents: tabela,
  desconto_pct: 3,
  total_cents: qtd * tabela,
  produto_sku: `SKU-${seq}`,
  produto_nome: `Produto ${seq}`,
  unidade: 'PC',
});
const evento = (n: number, pedido_id: string, de: PedidoEventoSync['de'], para: PedidoEventoSync['para'], em: string, motivo: string | null, extra: Partial<PedidoEventoSync> = {}): PedidoEventoSync => ({
  ...base,
  id: U(400 + n),
  pedido_id,
  de,
  para,
  autor_id: U(1),
  autor_nome: 'Lucas',
  autor_perfil: 'vendedor',
  motivo,
  nivel: null,
  acima_do_nivel: false,
  ocorrido_em: em,
  created_at: em,
  ...extra,
});
const cliente = (over: Partial<ClienteSync> = {}): ClienteSync =>
  ({ ...base, id: U(100), documento: '33333333000191', razao_social: 'Auto Peças Um Ltda', nome_fantasia: 'Auto Peças Um', segmento: null, telefone: null, email: null, logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: null, latitude: '-3.1', longitude: '-60.0', ativo: true, ...over }) as ClienteSync;
const produto = (n: number, ativo = true): ProdutoSync => ({ ...base, id: U(300 + n), sku: `SKU-${n}`, ean: null, nome: `Produto ${n}`, marca: null, categoria: null, unidade: 'PC', ativo });

const linhas = (over: Partial<LinhasVendedor> = {}): LinhasVendedor => ({ ...LINHAS_VAZIAS, ...over });

describe('telas sobre o pull (T-0029 §8)', () => {
  it('RN-VEN-02: a lista usa o total do servidor, o número e a contagem de itens e unidades das linhas', () => {
    const l = linhas({ pedidos: [pedido({ id: U(10) })], itens: [item(1, U(10), 1, 2, 100_000), item(2, U(10), 2, 1, 50_000)] });
    const [o] = listaDePedidos(l, {});
    expect(o).toMatchObject({ id: U(10), number: '000007', total_cents: 242_500, subtotal_cents: 250_000, discount_cents: 7_500, items_count: 2, units: 3, payment_terms: 'À vista', customer_name: 'Auto Peças Um' });
  });

  it('RN-VEN-10: pedido pendente mostra o texto de pendência com a alçada dos parâmetros do tenant', () => {
    const l = linhas({ pedidos: [pedido({ id: U(11), status: 'pending_approval', desconto_pct: 8, nivel_aprovacao: 'supervisor' })] });
    expect(listaDePedidos(l, {})[0]!.pending_reason).toBe('Desconto de 8,0% acima da alçada de 5,0%: aguardando supervisor');
    expect(listaDePedidos(l, { 'alcada.vendedor_pct': 6 })[0]!.pending_reason).toMatch(/alçada de 6,0%/);
  });

  it('RN-GES-08: pedido rejeitado leva o motivo; os outros não', () => {
    const l = linhas({ pedidos: [pedido({ id: U(12), status: 'rejected', motivo_rejeicao: 'Desconto alto' }), pedido({ id: U(13) })] });
    const por = new Map(listaDePedidos(l, {}).map((o) => [o.id, o]));
    expect(por.get(U(12))!.rejection_reason).toBe('Desconto alto');
    expect(por.get(U(13))!.rejection_reason).toBe('');
  });

  it('RF-VEN-05: o detalhe junta itens, histórico em ordem, retrato do cliente e a aprovação por perfil (offline)', () => {
    const p = pedido({ id: U(20), status: 'pending_approval', desconto_pct: 8, nivel_aprovacao: 'supervisor', motivos_aprovacao: ['desconto'] });
    const l = linhas({
      pedidos: [p],
      itens: [item(2, U(20), 2, 1, 50_000), item(1, U(20), 1, 2, 100_000)],
      eventos: [evento(2, U(20), 'received', 'pending_approval', '2026-11-01T12:00:00.100000Z', 'Desconto de 8,0%'), evento(1, U(20), null, 'received', '2026-11-01T12:00:00.000000Z', 'Recebido pelo servidor')],
      clientes: [cliente()],
    });
    const sup = detalheDoPedido(l, U(20), 'supervisor', {})!;
    expect(sup.items.map((i) => i.erp_code)).toEqual(['SKU-1', 'SKU-2']);
    expect(sup.history.map((h) => h.status)).toEqual(['received', 'pending_approval']);
    expect(sup.cliente).toMatchObject({ razao_social: 'Auto Peças Um Ltda', endereco: 'Rua A, 10', cidade: 'Manaus' });
    expect(sup.aprovacao).toMatchObject({ nivel: 'supervisor', pode_decidir: true, limite_vendedor_pct: 5, acima_do_nivel: false });
    expect(detalheDoPedido(l, U(20), 'gerente', {})!.aprovacao).toMatchObject({ pode_decidir: true, acima_do_nivel: true });
    expect(detalheDoPedido(l, U(20), 'analista', {})!.aprovacao!.pode_decidir).toBe(false);
    expect(detalheDoPedido(l, U(20), 'vendedor', {})!.aprovacao!.pode_decidir).toBe(false);
    expect(detalheDoPedido(l, U(999), 'vendedor', {})).toBeNull();
  });

  it('P-3 / RN-GES-04: "para aprovar" segue o nível que o perfil decide', () => {
    const l = linhas({
      pedidos: [
        pedido({ id: U(30), status: 'pending_approval', nivel_aprovacao: 'supervisor' }),
        pedido({ id: U(31), status: 'pending_approval', nivel_aprovacao: 'gerente' }),
        pedido({ id: U(32), status: 'pending_approval', nivel_aprovacao: 'analista' }),
        pedido({ id: U(33), status: 'approved' }),
      ],
    });
    expect(paraAprovar(l, 'supervisor').map((p) => p.id)).toEqual([U(30)]);
    expect(paraAprovar(l, 'gerente').map((p) => p.id)).toEqual([U(30), U(31)]);
    expect(paraAprovar(l, 'analista').map((p) => p.id)).toEqual([U(32)]);
    expect(paraAprovar(l, 'vendedor')).toEqual([]);
  });

  it('RN-CAT-06: produto sem preço para o cliente aparece como "sem preço" (nunca cai na tabela padrão) e o estoque não limita', () => {
    const l = linhas({ produtos: [produto(1), produto(2), produto(3, false)] });
    const lista = produtosComPrecos(l, new Map([[U(301), 100_000]]));
    expect(lista.map((p) => [p.erp_code, p.price_cents])).toEqual([['SKU-1', 100_000], ['SKU-2', null]]);
    expect(lista[0]!.stock_total).toBe(ESTOQUE_NAO_CONTROLADO);
  });

  it('RN-CORE-04: a carteira é a do pull; cliente inativo não aparece; a tabela de preço do cliente vira price_table_id', () => {
    const l = linhas({
      clientes: [cliente(), cliente({ id: U(101), nome_fantasia: 'Beta', ativo: false })],
      tabelasDoCliente: [{ ...base, id: U(500), cliente_id: U(100), tabela_preco_id: U(600) }],
    });
    const c = listaDeClientes(l, { id: U(1), name: 'Lucas' });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ trade_name: 'Auto Peças Um', price_table_id: U(600), address: 'Rua A, 10', lat: -3.1 });
  });

  it('RN-VEN-14: condições do cliente; sem lista própria vale só a padrão', () => {
    const cond = (n: number, d: string, padrao = false, ativo = true): CondicaoPagamentoSync => ({ ...base, id: U(700 + n), codigo: `C${n}`, descricao: d, ativo, padrao });
    const cc = (cli: number, n: number): ClienteCondicaoSync => ({ ...base, id: U(800 + cli * 10 + n), cliente_id: U(cli), condicao_pagamento_id: U(700 + n) });
    const l = linhas({ condicoes: [cond(1, 'À vista', true), cond(2, '28 dias'), cond(3, '30/60', false, false)], condicoesDoCliente: [cc(100, 1), cc(100, 2), cc(100, 3)] });
    expect(condicoesDoCliente(l, U(100)).map((c) => c.descricao)).toEqual(['À vista', '28 dias']);
    expect(condicoesDoCliente(l, U(101)).map((c) => c.descricao)).toEqual(['À vista']);
  });

  it('E3: a política vem dos parâmetros guardados (offline); o Me do aparelho leva o fuso e a alçada do vendedor', () => {
    expect(politicaApi({})).toEqual({ seller_pct: 5, supervisor_pct: 10, manager_pct: 15, above_manager: 'director', exceptions: [] });
    expect(politicaApi({ 'alcada.vendedor_pct': 3, 'alcada.acima_gerente': 'bloquear' })).toMatchObject({ seller_pct: 3, above_manager: 'block' });
    const me = meDoAparelho({ id: U(1), nome: 'Lucas Silva', perfil: 'vendedor', fuso: 'America/Manaus' }, { 'alcada.vendedor_pct': 4 }, new Date('2026-11-01T12:00:00Z'));
    expect(me.tenant.timezone).toBe('America/Manaus');
    expect(me.seller).toMatchObject({ id: U(1), max_discount_pct: 4, short_name: 'Lucas' });
    expect(meDoAparelho({ id: U(2), nome: 'Renata', perfil: 'supervisor', fuso: 'America/Manaus' }, {}, new Date('2026-11-01T12:00:00Z')).seller).toBeNull();
  });

  it('lerLinhas ignora o que o pull marcou como removido', async () => {
    const motor = { linhas: async (e: string) => (e === 'pedido' ? [pedido({ id: U(40) }), pedido({ id: U(41), deleted_at: '2026-11-01T13:00:00.000000Z' })] : []) };
    const l = await lerLinhas(motor as never);
    expect(l.pedidos.map((p) => p.id)).toEqual([U(40)]);
  });
});

describe('pedido no aparelho (P-6, RN-VEN-14, ADR 0009 §3)', () => {
  it('P-6: o aparelho não valida crédito (igual ao servidor): cliente sem limite cadastrado não bloqueia', () => {
    const r = prepararPedido({
      rascunho: { ...rascunhoVazio('c1'), lines: { p1: 2 }, discount_pct: 8 },
      cliente: listaDeClientes(linhas({ clientes: [cliente({ id: 'c1' })] }), { id: 'v', name: 'V' })[0]!,
      catalogo: [{ ...produtosComPrecos(linhas({ produtos: [{ ...produto(1), id: 'p1' }] }), new Map([['p1', 100_000]]))[0]! }],
      politica: politicaApi({}),
      eu: { id: 'v', name: 'V', short_name: 'V', team_id: '', team_name: '', branch_id: '', max_discount_pct: 5 },
      filaDoClienteCents: 0,
    });
    expect(r.v.outcome).toBe('pending_approval');
    expect(r.display.expected).toBe('pending_approval');
    expect(r.display.total_cents).toBe(184_000);
  });

  it('RN-VEN-14: o payload leva a condição, a observação e a visita; vazio vira null', () => {
    const cl = listaDeClientes(linhas({ clientes: [cliente({ id: 'c1' })] }), { id: 'v', name: 'V' })[0]!;
    const v = prepararPedido({
      rascunho: { ...rascunhoVazio('c1'), lines: { p1: 1 } },
      cliente: cl,
      catalogo: produtosComPrecos(linhas({ produtos: [{ ...produto(1), id: 'p1' }] }), new Map([['p1', 1000]])),
      politica: politicaApi({}),
      eu: { id: 'v', name: 'V', short_name: 'V', team_id: '', team_name: '', branch_id: '', max_discount_pct: 5 },
      filaDoClienteCents: 0,
    }).v;
    const p = montarPedido({ id: U(1), cliente: cl, rascunho: { ...rascunhoVazio('c1'), condicao_pagamento_id: U(701), observacao: ' ', visit_id: U(9) }, v, semSinal: false, agora: '2026-11-01T12:00:00Z' });
    expect(p).toMatchObject({ condicao_pagamento_id: U(701), observacao: null, visita_id: U(9), created_offline_at: null });
  });

  it('ADR 0009 §3: item aceito que o pull ainda não trouxe aparece como "Recebido", sem duplicar quando o pull chega', () => {
    const fila = (id: string): ItemFilaPedido => ({
      id,
      entidade: 'pedido',
      criado_em: '2026-11-01T12:00:00.000Z',
      ultima_tentativa_em: null,
      ultimo_erro: '',
      situacao: 'aceito',
      payload: { id, customer_id: 'c1', discount_pct: 0, payment_terms: '', items: [{ product_id: 'p1', quantity: 1 }] },
    });
    const aceitos = pedidosNaFila([fila('a'), fila('b')], {});
    const eu = { id: 'v', name: 'V', branch_id: '' };
    expect(aceitosComoPedidos(aceitos, new Set(['b']), eu).map((o) => [o.id, o.status, o.local])).toEqual([['a', 'received', false]]);
  });

  it('T-0029 §8: Gestão não mostra as abas "Na fila" e "Integrados"', () => {
    expect(rotuloDaAba('queued', true)).toBe(false);
    expect(rotuloDaAba('integrated', true)).toBe(false);
    expect(rotuloDaAba('pending', true)).toBe(true);
    expect(rotuloDaAba('queued', false)).toBe(true);
  });
});
