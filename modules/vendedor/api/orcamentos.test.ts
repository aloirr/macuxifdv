/**
 * T-0071 fatia 5 (API) sem banco: rotas do orçamento, repositório SQL da pré-venda (mapeamento banco ↔ contrato), colunas e janela
 * do pull. O fluxo com Postgres está em `pre-venda.db.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { criarPermissoes, verificarAcao, type ClienteBanco } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import { OrderListQuery } from '../contracts';
import { apiVendedor, preVenda, preVendaSql, rotaCancelarOrcamento, rotaEditarOrcamento } from './index';
import { escopoDoPedido, sqlPedido, sqlPedidoEvento, sqlPedidoItem } from './sync';

const permissoes = criarPermissoes([manifest]);
const usuario = (perfil: string, modulos = ['core', 'vendedor']) => ({ id: 'u', tenant_id: 't', perfil, modulos }) as never;

describe('T-0071: rotas do orçamento recebido', () => {
  it('PUT /orcamentos/:id e POST /orcamentos/:id/cancelar estão montadas no plugin do Vendedor', () => {
    expect(rotaEditarOrcamento).toMatchObject({ metodo: 'PUT', caminho: 'orcamentos/:id', acao: 'pedido.criar' });
    expect(rotaCancelarOrcamento).toMatchObject({ metodo: 'POST', caminho: 'orcamentos/:id/cancelar', acao: 'pedido.cancelar' });
    expect(apiVendedor.rotas).toEqual(expect.arrayContaining([rotaEditarOrcamento, rotaCancelarOrcamento]));
  });
  it.each(['pedido.criar', 'pedido.cancelar'])('RN-PRO-01: promotor recebe 403 PERFIL_SEM_ACESSO em %s (criar, editar, cancelar e transformar orçamento)', (acao) => {
    expect(verificarAcao(usuario('promotor'), permissoes, acao)).toMatchObject({ ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    expect(verificarAcao(usuario('vendedor'), permissoes, acao)).toMatchObject({ ok: true });
  });
  it.each(['pedido.criar', 'pedido.cancelar'])('RN-CORE-02: sem licença do módulo Vendedor, 403 MODULO_INATIVO em %s', (acao) => {
    expect(verificarAcao(usuario('vendedor', ['core']), permissoes, acao)).toMatchObject({ ok: false, status: 403, codigo: 'MODULO_INATIVO' });
  });
  it('§2.1: o corpo do PUT exige atualizado_em (concorrência otimista) e recusa campo desconhecido', () => {
    const base = { customer_id: '0f530000-0000-4000-8000-000000000001', discount_pct: 0, items: [{ product_id: '0f530000-0000-4000-8000-000000000002', quantity: 1 }] };
    expect(rotaEditarOrcamento.corpo!.safeParse(base).success).toBe(false);
    expect(rotaEditarOrcamento.corpo!.safeParse({ ...base, atualizado_em: '2026-11-03T12:00:00.000000Z' }).success).toBe(true);
    expect(rotaEditarOrcamento.corpo!.safeParse({ ...base, atualizado_em: 'x', tipo: 'pedido' }).success).toBe(false);
  });
  it('§1.4 g: OrderListQuery aceita tipo e situacao', () => {
    expect(OrderListQuery.parse({ tipo: 'orcamento', situacao: 'aberto' })).toMatchObject({ tipo: 'orcamento', situacao: 'aberto' });
    expect(OrderListQuery.safeParse({ tipo: 'outro' }).success).toBe(false);
  });
});

describe('T-0071 §1.4 a: repositório SQL da pré-venda', () => {
  it('o plugin liga o repositório SQL por padrão (orçamento não é mais recusado com PRE_VENDA_INDISPONIVEL)', () => {
    expect(preVenda()).toBe(preVendaSql);
    expect(preVendaSql.disponivel).toBe(true);
  });

  function bancoFalso(linhas: unknown[]) {
    const chamadas: Array<{ sql: string; valores: unknown[] }> = [];
    const db = {
      async query(sql: string, valores: unknown[] = []) {
        chamadas.push({ sql, valores });
        return { rows: linhas };
      },
    } as unknown as ClienteBanco;
    return { db, chamadas };
  }

  it('RN-VEN-18: lerDocumentos mapeia orcamento_validade/orcamento_id/filho para o contrato, com o fuso do tenant', async () => {
    const { db, chamadas } = bancoFalso([
      { id: 'o1', tipo: 'orcamento', validade_data: '2026-11-10', validade_ate: '2026-11-11T04:00:00.000000Z', orcamento_origem_id: null, convertido_pedido_id: 'p9' },
    ]);
    const m = await preVendaSql.lerDocumentos(db, ['o1'], 'America/Manaus');
    expect(m.get('o1')).toEqual({ tipo: 'orcamento', validade_data: '2026-11-10', validade_ate: '2026-11-11T04:00:00.000000Z', orcamento_origem_id: null, convertido_pedido_id: 'p9' });
    expect(chamadas[0]!.valores).toEqual([['o1'], 'America/Manaus']);
    expect(chamadas[0]!.sql).toMatch(/p\.orcamento_validade::text as validade_data/);
    expect(chamadas[0]!.sql).toMatch(/p\.orcamento_id as orcamento_origem_id/);
    expect(chamadas[0]!.sql).toMatch(/c\.orcamento_id = p\.id/); // convertido_pedido_id = pedido filho (pedido_orcamento_uk)
  });
  it('lerDocumentos sem ids não consulta o banco', async () => {
    const { db, chamadas } = bancoFalso([]);
    expect((await preVendaSql.lerDocumentos(db, [], 'UTC')).size).toBe(0);
    expect(chamadas).toHaveLength(0);
  });
  it('RN-VEN-32: buscarOrcamento trava a linha, só traz tipo orcamento e devolve o formato da conversão', async () => {
    const { db, chamadas } = bancoFalso([{ id: 'o1', tipo: 'orcamento', status: 'received', vendedor_id: 'v', cliente_id: 'c', validade_data: '2026-11-10', validade_ate: '2026-11-11T04:00:00.000000Z', convertido_pedido_id: null }]);
    expect(await preVendaSql.buscarOrcamento(db, 'o1', 'America/Manaus')).toEqual({ id: 'o1', tipo: 'orcamento', status: 'received', vendedor_id: 'v', cliente_id: 'c', validade_ate: '2026-11-11T04:00:00.000000Z', convertido_pedido_id: null });
    expect(chamadas[0]!.sql).toMatch(/p\.tipo = 'orcamento'/);
    expect(chamadas[0]!.sql).toMatch(/for update of p/);
    expect(await preVendaSql.buscarOrcamento(bancoFalso([]).db, 'x', 'UTC')).toBeNull();
  });
  it('marcarDocumento grava tipo, orcamento_validade (a data civil) e orcamento_id; marcarConvertido só preenche convertido_em', async () => {
    const { db, chamadas } = bancoFalso([]);
    await preVendaSql.marcarDocumento(db, 'o1', { tipo: 'orcamento', validade_data: '2026-11-10', orcamento_origem_id: null });
    expect(chamadas[0]!.valores).toEqual(['o1', 'orcamento', '2026-11-10', null]);
    expect(chamadas[0]!.sql).toMatch(/orcamento_validade = \$3::date, orcamento_id = \$4/);
    await preVendaSql.marcarConvertido(db, 'o1', 'p1');
    expect(chamadas[1]!.valores).toEqual(['o1']);
    expect(chamadas[1]!.sql).toMatch(/convertido_em = clock_timestamp\(\)/);
  });
});

describe('T-0071 §1.4 b: pull com tipo, validade e janela do orçamento', () => {
  const pull = { ate: '2026-11-03T20:00:00.000000Z', desde: null, limite: 50 } as never;
  const e = escopoDoPedido('vendedor', new Set(['u']), 'tenant');

  it('COLUNAS_PEDIDO leva tipo, validade_data, validade_ate, orcamento_origem_id, convertido_pedido_id e as colunas da 0020', () => {
    const { sql, valores } = sqlPedido(pull, e, false, 'America/Manaus');
    for (const c of ['p.tipo', 'validade_data', 'validade_ate', 'orcamento_origem_id', 'convertido_pedido_id', 'desconto_valor_cents', 'acrescimo_valor_cents', 'p.ajuste_em']) expect(sql).toContain(c);
    expect(valores).toHaveLength(8);
    expect(valores[7]).toBe('America/Manaus');
  });
  it('janela: criado há ≤ 90 dias OU aberto (não convertido e orcamento_validade ≥ hoje no fuso); o pedido não final continua entrando', () => {
    const { sql } = sqlPedido(pull, e, false);
    expect(sql).toMatch(/p\.created_at >= \$1::timestamptz - make_interval\(days => 90\)/);
    expect(sql).toMatch(/p\.tipo = 'pedido' or \(p\.convertido_em is null and p\.orcamento_validade >= \(\$1::timestamptz at time zone \$8\)::date\)/);
  });
  it('item e evento usam a mesma janela e o item leva R$ por unidade e o modo digitado', () => {
    const item = sqlPedidoItem(pull, e, false, 'UTC');
    expect(item.sql).toContain('desconto_unitario_cents');
    expect(item.sql).toContain('acrescimo_unitario_cents');
    expect(item.sql).toContain('i.ajuste_em');
    expect(item.valores).toHaveLength(8);
    expect(sqlPedidoEvento(pull, e).valores).toHaveLength(8);
    expect(sqlPedidoEvento(pull, e).sql).toContain('p.orcamento_validade');
  });
});
