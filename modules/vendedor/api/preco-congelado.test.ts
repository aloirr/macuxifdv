/**
 * T-0134 (RN-VEN-18, preço congelado), sem banco: Transformar (push com `orcamento_origem_id`) e edição (PUT /orcamentos/:id)
 * mantêm o preço que o orçamento gravou; só o item novo entra pela tabela de hoje. O fluxo com Postgres fica no CI.
 */
import { describe, expect, it } from 'vitest';
import type { ContextoBase, ItemPush } from '@macuxi/platform-sdk';
import { precosCongeladosDoDocumento } from './preco-congelado';
import { rotaEditarOrcamento } from './orcamentos';
import { preVendaSql, usarPreVenda } from './pre-venda';
import { receberPedidos } from './receber';

const U = (n: number) => `0f340000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const VEND = U(10);
const CLIENTE = U(20);
const CAFE = U(30); // já estava no orçamento: R$ 100,00 salvo; hoje R$ 120,00
const GAS = U(31); // item novo da edição: hoje R$ 50,00
const ORC = U(40);
const PEDIDO = U(41);
const ATUALIZADO = '2026-11-08T12:00:00.000000Z';

const HOJE: Record<string, number> = { [CAFE]: 12_000, [GAS]: 5_000 };
type Sql = { sql: string; valores: unknown[] };

function montar(opcoes: { vencido?: boolean; enderecoOrcamento?: Record<string, unknown> } = {}) {
  usarPreVenda(preVendaSql);
  const sqls: Sql[] = [];
  const db = {
    query: async (sql: string, valores: unknown[] = []) => {
      sqls.push({ sql, valores });
      if (/select endereco_entrega from vendedor\.pedido where id = \$1/.test(sql)) return { rows: [{ endereco_entrega: opcoes.enderecoOrcamento ?? null }] };
      // itens salvos do orçamento: café a R$ 100,00 a unidade
      if (/from vendedor\.pedido_item where pedido_id = \$1 and deleted_at is null order by sequencia/.test(sql)) return { rows: [{ produto_id: CAFE, preco_tabela_cents: 10_000, fator: 1 }] };
      if (/from vendedor\.pedido where id = \$1 and tipo = 'orcamento'/.test(sql)) return { rows: [{ id: ORC, vendedor_id: VEND, cliente_id: CLIENTE, status: 'received', atualizado_em: ATUALIZADO, hash_envio: 'x', total_cents: '10000', itens: 1 }] };
      // preVendaSql.buscarOrcamento (Transformar)
      if (/p\.tipo = 'orcamento' and p\.deleted_at is null for update of p/.test(sql)) {
        return { rows: [{ id: ORC, tipo: 'orcamento', status: 'received', vendedor_id: VEND, cliente_id: CLIENTE, validade_data: '2026-11-15', validade_ate: opcoes.vencido ? '2026-11-01T04:00:00.000000Z' : '2026-11-16T04:00:00.000000Z', convertido_pedido_id: null }] };
      }
      // preVendaSql.lerDocumentos (edição)
      if (/orcamento_validade::text as validade_data/.test(sql)) return { rows: [{ id: ORC, tipo: 'orcamento', validade_data: '2026-11-15', validade_ate: opcoes.vencido ? '2026-11-01T04:00:00.000000Z' : '2026-11-16T04:00:00.000000Z', orcamento_origem_id: null, convertido_pedido_id: null }] };
      if (/from vendedor\.pedido p where p\.id = \$1/.test(sql)) return { rows: [{ cliente_id: CLIENTE, vendedor_id: VEND, observacao: null, desconto_pct: 0, acrescimo_pct: 0, frete_modalidade: 'CIF', transportadora_id: null, transportadora_digitada: false, transportadora_nome: null, transportadora_documento: null, transportadora_telefone: null, endereco_entrega: null, codigo: null, criado_em: '2026-11-09T12:00:00.000000Z' }] };
      if (/to_char\(updated_at/.test(sql)) return { rows: [{ atualizado_em: '2026-11-08T12:05:00.000000Z' }] };
      if (/from vendedor\.pedido where id/.test(sql)) return { rows: [] };
      if (/max\(sequencia\)/.test(sql)) return { rows: [{ n: 1 }] };
      if (/proximo_numero_pedido/.test(sql)) return { rows: [{ n: '000043' }] };
      if (/insert into vendedor\.pedido \(/.test(sql)) return { rows: [{ id: PEDIDO }] };
      if (/clock_timestamp/.test(sql)) return { rows: [{ em: ATUALIZADO }] };
      return { rows: [] };
    },
  };
  const tx = {
    consultar: async (def: { nome: string }, entrada: { produto_ids?: string[] }) => {
      if (def.nome === 'core.cadastro_resumo@1') {
        return {
          clientes: [{ id: CLIENTE, razao_social: 'Mercadinho São Jorge Ltda', nome_fantasia: 'São Jorge', documento: '12345678000190', logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', ativo: true, external_id: 'C5002' }],
          produtos: [CAFE, GAS].map((id) => ({ id, sku: `P${id.slice(-2)}`, nome: `Produto ${id.slice(-2)}`, unidade: 'UN', ativo: true, external_id: null, preco_venda_cents: null, desconto_maximo_pct: 100 })),
          usuarios: [{ id: VEND, nome: 'Vera Vendedora', perfil: 'vendedor', external_id: null }],
          enderecos: [],
        };
      }
      return { tabela_preco_id: null, itens: (entrada.produto_ids ?? []).map((p) => ({ produto_id: p, preco_cents: HOJE[p] ?? null, motivo_sem_preco: null })) };
    },
    publicar: async () => ({}),
    auditar: async () => undefined,
  };
  const ctx = {
    usuario: { id: VEND, tenant_id: U(900), perfil: 'vendedor', modulos: ['core', 'catalogo', 'vendedor'] },
    agora: () => new Date('2026-11-09T12:00:00Z'),
    fuso: () => 'America/Manaus',
    parametros: () => ({}),
    usuariosVisiveis: async () => new Set([VEND]),
    carteira: async () => new Set([CLIENTE]),
    comTenant: async (fn: (d: typeof db, t: typeof tx) => Promise<unknown>) => fn(db, tx),
    params: { id: ORC },
  } as unknown as ContextoBase & { params: unknown; corpo?: unknown };
  return { ctx, sqls, db };
}

const pedidoItem = (sqls: Sql[]) => sqls.filter((s) => /insert into vendedor\.pedido_item/.test(s.sql));
const push = (extra: Record<string, unknown>): ItemPush =>
  ({ entidade: 'pedido', id: PEDIDO, operacao: 'upsert', payload: { id: PEDIDO, customer_id: CLIENTE, discount_pct: 0, payment_terms: '28 dias', total_cents: 10_000, items: [{ product_id: CAFE, quantity: 1 }], ...extra } }) as unknown as ItemPush;

describe('RN-VEN-18 (T-0134): preço congelado, lado do servidor', () => {
  it('precosCongeladosDoDocumento lê os itens ativos do orçamento e devolve o preço por unidade', async () => {
    const { db } = montar();
    expect(await precosCongeladosDoDocumento(db as never, ORC)).toEqual({ [CAFE]: 10_000 });
  });

  it('RN-VEN-18: Transformar dentro da validade mantém o preço do orçamento (R$ 100,00), mesmo com a tabela de hoje em R$ 120,00', async () => {
    const { ctx, sqls } = montar();
    const r = await receberPedidos(ctx, [push({ orcamento_origem_id: ORC, tipo: 'pedido' })]);
    expect(r[0]).toMatchObject({ status: 'aceito' });
    const it = pedidoItem(sqls);
    expect(it).toHaveLength(1);
    expect(it[0]!.valores[4]).toBe(10_000); // preco_tabela_cents
  });

  it('RN-VEN-18: pedido comum (sem orçamento de origem) continua pela tabela de hoje', async () => {
    const { ctx, sqls } = montar();
    const r = await receberPedidos(ctx, [push({})]);
    expect(r[0]).toMatchObject({ status: 'aceito' });
    expect(pedidoItem(sqls)[0]!.valores[4]).toBe(12_000);
  });

  it('RN-VEN-18 (09/11): preço vencido (depois de D+7 23:59) não bloqueia: o pedido nasce pela tabela do dia (R$ 120,00), não pelo preço do orçamento (R$ 100,00)', async () => {
    const { ctx, sqls } = montar({ vencido: true });
    const r = await receberPedidos(ctx, [push({ orcamento_origem_id: ORC, tipo: 'pedido' })]);
    expect(r[0]).toMatchObject({ status: 'aceito' });
    expect(pedidoItem(sqls)[0]!.valores[4]).toBe(12_000);
  });

  it('RN-VEN-18: editar o orçamento depois dos 7 dias reprecifica o item salvo pela tabela do dia', async () => {
    const { ctx, sqls } = montar({ vencido: true });
    const corpo = { customer_id: CLIENTE, discount_pct: 0, payment_terms: '28 dias', total_cents: 0, atualizado_em: ATUALIZADO, items: [{ product_id: CAFE, quantity: 2 }] };
    (ctx as unknown as { corpo: unknown }).corpo = corpo;
    await rotaEditarOrcamento.executar(ctx as never);
    expect(pedidoItem(sqls)[0]!.valores[4]).toBe(12_000);
  });

  it('RN-VEN-18: editar o orçamento mantém o preço do item salvo (R$ 100,00) e põe o item NOVO pela tabela de hoje (R$ 50,00)', async () => {
    const { ctx, sqls } = montar();
    const corpo = { customer_id: CLIENTE, discount_pct: 0, payment_terms: '28 dias', total_cents: 0, atualizado_em: ATUALIZADO, items: [{ product_id: CAFE, quantity: 2 }, { product_id: GAS, quantity: 1 }] };
    (ctx as unknown as { corpo: unknown }).corpo = corpo;
    await rotaEditarOrcamento.executar(ctx as never);
    const itens = pedidoItem(sqls);
    expect(itens).toHaveLength(2);
    expect(itens[0]!.valores[2]).toBe(CAFE);
    expect(itens[0]!.valores[4]).toBe(10_000);
    expect(itens[1]!.valores[2]).toBe(GAS);
    expect(itens[1]!.valores[4]).toBe(5_000);
  });
});

describe('RN-VEN-17 (T-0141): Transformar herda o endereço do orçamento no servidor', () => {
  const editado = { id: null, external_id: null, descricao: null, logradouro: 'Rua Pará', numero: '140', complemento: null, bairro: 'São Geraldo', cidade: 'Manaus', uf: 'AM', cep: '69053000', principal: false, origem: 'editado' };
  const retratoGravado = (sqls: Sql[]) => {
    const ins = sqls.find((x) => /insert into vendedor\.pedido \(/.test(x.sql))!;
    return JSON.parse(String(ins.valores[33]));
  };

  it('RN-VEN-17: sem endereço no corpo, o pedido nasce com o endereço editado do orçamento, ainda como editado', async () => {
    const { ctx, sqls } = montar({ enderecoOrcamento: editado });
    const r = await receberPedidos(ctx, [push({ orcamento_origem_id: ORC, tipo: 'pedido' })]);
    expect(r[0]).toMatchObject({ status: 'aceito' });
    expect(retratoGravado(sqls)).toMatchObject({ origem: 'editado', logradouro: 'Rua Pará', numero: '140', cep: '69053000' });
  });
});

