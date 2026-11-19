/**
 * RF-GES-05 / RN-VEN-35 (sem banco): push do pedido em nome do vendedor. Contexto falso e `db` que despacha por SQL e
 * guarda o que seria gravado. O fluxo com Postgres está em `pedido-em-nome.db.test.ts` (CI).
 */
import { describe, expect, it } from 'vitest';
import type { ContextoBase, ItemPush } from '@macuxi/platform-sdk';
import { PedidoPush } from '../contracts';
import { receberPedidos } from './receber';

const U = (n: number) => `0e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TENANT = U(900);
const SUP = U(1);
const GER = U(2);
const VEND = U(10); // vendedor da equipe do supervisor
const VEND_FORA = U(11); // vendedor de outra equipe
const PROMOTOR = U(12);
const CLIENTE = U(20);
const PRODUTO = U(30);
const PEDIDO = U(40);

const nomes: Record<string, { nome: string; perfil: string }> = {
  [SUP]: { nome: 'Sueli Supervisora', perfil: 'supervisor' },
  [GER]: { nome: 'Geraldo Gerente', perfil: 'gerente' },
  [VEND]: { nome: 'Vera Vendedora', perfil: 'vendedor' },
  [VEND_FORA]: { nome: 'Vitor Vendedor', perfil: 'vendedor' },
  [PROMOTOR]: { nome: 'Paulo Promotor', perfil: 'promotor' },
};

type Sql = { sql: string; valores: unknown[] };

function montar(perfil: string, id: string, visiveis: ReadonlySet<string> | 'tenant', jaExiste?: { autor_id: string }) {
  const sqls: Sql[] = [];
  const eventos: Array<{ nome: string; payload: Record<string, unknown> }> = [];
  const auditoria: Array<Record<string, unknown>> = [];
  const db = {
    query: async (sql: string, valores: unknown[] = []) => {
      sqls.push({ sql, valores });
      if (/from vendedor\.pedido where id/.test(sql)) {
        return { rows: jaExiste ? [{ vendedor_id: VEND, autor_id: jaExiste.autor_id, hash_envio: null, status: 'received', numero: '000042' }] : [] };
      }
      // payloadAprovado (pedido que segue direto): linha do pedido já gravado e itens
      if (/from vendedor\.pedido p where p\.id/.test(sql)) return { rows: [{ cliente_id: CLIENTE, vendedor_id: valores[0] === PEDIDO ? VEND : VEND, observacao: null, desconto_pct: 0, acrescimo_pct: 0, frete_modalidade: 'CIF', transportadora_id: null, transportadora_digitada: false, transportadora_nome: null, transportadora_documento: null, transportadora_telefone: null, endereco_entrega: null, codigo: null, criado_em: '2026-11-05T12:00:00.000000Z' }] };
      if (/from vendedor\.pedido_item where pedido_id/.test(sql)) return { rows: [{ produto_id: PRODUTO, quantidade: 1, quantidade_base: 1, fator: 1, unidade: null, preco_tabela_cents: 10000, desconto_pct: 0, acrescimo_pct: 0, total_cents: 10000 }] };
      if (/proximo_numero_pedido/.test(sql)) return { rows: [{ n: '000042' }] };
      if (/insert into vendedor\.pedido \(/.test(sql)) return { rows: [{ id: PEDIDO }] };
      if (/clock_timestamp/.test(sql)) return { rows: [{ em: '2026-11-05T12:00:00.000000Z' }] };
      return { rows: [] };
    },
  };
  const tx = {
    consultar: async (def: { nome: string }, entrada: { usuario_ids?: string[] }) => {
      if (def.nome === 'core.cadastro_resumo@1') {
        return {
          clientes: [{ id: CLIENTE, razao_social: 'Mercado Boa Vista Ltda', nome_fantasia: 'Boa Vista', documento: '12345678000190', logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', ativo: true, external_id: 'C1' }],
          produtos: [{ id: PRODUTO, sku: 'P1', nome: 'Produto 1', unidade: 'UN', ativo: true, external_id: null, preco_venda_cents: null, desconto_maximo_pct: 100 }],
          usuarios: (entrada.usuario_ids ?? []).filter((i) => nomes[i]).map((i) => ({ id: i, nome: nomes[i]!.nome, perfil: nomes[i]!.perfil, external_id: null })),
          enderecos: [],
        };
      }
      if (def.nome === 'core.financeiro_cliente@1') return { financeiro: { limite_cents: 100_000_000, saldo_aberto_cents: 0, credito_disponivel_erp_cents: null, vencidos_qtd: 0, vencidos_cents: 0, maior_atraso_dias: 0 } };
      return { tabela_preco_id: null, itens: [{ produto_id: PRODUTO, preco_cents: 10_000, motivo_sem_preco: null }] };
    },
    publicar: async (def: { nome: string }, payload: Record<string, unknown>) => {
      eventos.push({ nome: def.nome, payload });
      return {};
    },
    auditar: async (a: Record<string, unknown>) => {
      auditoria.push(a);
    },
  };
  const ctx = {
    usuario: { id, tenant_id: TENANT, perfil, modulos: ['core', 'catalogo', 'vendedor'] },
    agora: () => new Date('2026-11-05T12:00:00Z'),
    fuso: () => 'America/Manaus',
    parametros: () => ({}),
    usuariosVisiveis: async () => visiveis,
    carteira: async () => new Set([CLIENTE]),
    comTenant: async (fn: (d: typeof db, t: typeof tx) => Promise<unknown>) => fn(db, tx),
  } as unknown as ContextoBase;
  return { ctx, sqls, eventos, auditoria };
}

const payload = (extra: Record<string, unknown> = {}) => ({
  id: PEDIDO,
  customer_id: CLIENTE,
  discount_pct: 0,
  payment_terms: '28 dias',
  total_cents: 10_000,
  items: [{ product_id: PRODUTO, quantity: 1 }],
  ...extra,
});
const item = (extra: Record<string, unknown> = {}): ItemPush => ({ entidade: 'pedido', id: PEDIDO, operacao: 'upsert', payload: payload(extra) }) as unknown as ItemPush;
const insertDoPedido = (sqls: Sql[]) => sqls.find((s) => /insert into vendedor\.pedido \(/.test(s.sql));

describe('RN-VEN-35: contrato do push', () => {
  it('PedidoPush aceita vendedor_id opcional e a fila antiga (sem o campo) segue válida', () => {
    expect(PedidoPush.safeParse(payload()).success).toBe(true);
    expect(PedidoPush.safeParse(payload({ vendedor_id: VEND })).success).toBe(true);
    expect(PedidoPush.safeParse(payload({ vendedor_id: 'nao-e-uuid' })).success).toBe(false);
  });
});

describe('RF-GES-05 / RN-VEN-35: supervisor faz pedido em nome do vendedor da equipe', () => {
  it('grava vendedor_id = vendedor e autor_id = supervisor, com o nome do vendedor no pedido e o do autor no histórico', async () => {
    const { ctx, sqls } = montar('supervisor', SUP, new Set([SUP, VEND]));
    const r = await receberPedidos(ctx, [item({ vendedor_id: VEND })]);
    expect(r[0]).toMatchObject({ id: PEDIDO, status: 'aceito' });
    const ins = insertDoPedido(sqls)!;
    expect(ins.sql).toMatch(/\$3, \$38/); // vendedor_id = $3 (dono), autor_id = $38 (token)
    expect(ins.valores[2]).toBe(VEND);
    expect(ins.valores[37]).toBe(SUP);
    expect(ins.valores).toContain('Vera Vendedora'); // vendedor_nome
    const hist = sqls.find((s) => /insert into vendedor\.pedido_evento/.test(s.sql))!;
    expect(hist.valores).toContain(SUP);
    expect(hist.valores).toContain('Sueli Supervisora');
    expect(hist.valores).toContain('supervisor');
  });

  it('os eventos levam o dono (para meta, ranking e notificação) e o autor; a auditoria guarda o autor', async () => {
    // 12% passa da alçada do supervisor (10%): vai ao gerente, sem depender do payload do ERP
    const { ctx, eventos, auditoria } = montar('supervisor', SUP, new Set([SUP, VEND]));
    const r = await receberPedidos(ctx, [item({ vendedor_id: VEND, discount_pct: 12 })]);
    expect(r[0]).toMatchObject({ status: 'aceito' });
    const criado = eventos.find((e) => e.nome === 'vendedor.pedido.criado@1')!.payload;
    expect(criado).toMatchObject({ pedido_id: PEDIDO, vendedor_id: VEND, autor_id: SUP, status: 'em_aprovacao' });
    for (const e of eventos) expect(e.payload.vendedor_id).toBe(VEND);
    expect(eventos.find((e) => e.nome === 'vendedor.pedido.status_alterado@1')!.payload).toMatchObject({ autor_id: SUP });
    expect(eventos.find((e) => e.nome === 'vendedor.pedido.aprovacao_solicitada@2')!.payload).toMatchObject({ vendedor_id: VEND, nivel: 'gerente' });
    expect(auditoria[0]).toMatchObject({ acao: 'pedido.criar', entidade: 'pedido', entidade_id: PEDIDO, depois: expect.objectContaining({ em_nome: true, vendedor_id: VEND, autor_id: SUP }) });
  });

  it('T-0138 (RN-CORE-21): vendedor.pedido.criado@1 leva emitido_em LIMITADO (aparelho no futuro = recebimento; muito antigo = 7 dias antes)', async () => {
    const emitidoDe = async (offline: string | null) => {
      const { ctx, eventos } = montar('supervisor', SUP, new Set([SUP, VEND]));
      await receberPedidos(ctx, [item({ vendedor_id: VEND, created_offline_at: offline })]);
      return eventos.find((e) => e.nome === 'vendedor.pedido.criado@1')!.payload as { emitido_em: string; criado_em: string };
    };
    expect((await emitidoDe('2026-11-05T09:00:00.000Z')).emitido_em).toBe('2026-11-05T09:00:00.000Z');
    const futuro = await emitidoDe('2027-01-01T00:00:00.000Z');
    expect(futuro.emitido_em).toBe(futuro.criado_em);
    expect((await emitidoDe('2026-09-01T00:00:00.000Z')).emitido_em).toBe('2026-10-29T12:00:00.000Z');
    const sem = await emitidoDe(null);
    expect(sem.emitido_em).toBe(sem.criado_em);
  });

  it('RN-VEN-10: usa a alçada do gestor, 8% segue direto para o supervisor (limite 10%), onde o vendedor (5%) iria à aprovação', async () => {
    const { ctx, sqls } = montar('supervisor', SUP, new Set([SUP, VEND]));
    await receberPedidos(ctx, [item({ vendedor_id: VEND, discount_pct: 8 })]);
    const ins = insertDoPedido(sqls)!;
    expect(ins.valores[3]).toBe('approved'); // status
  });

  it('RN-VEN-33: reenvio do mesmo id pelo mesmo autor é idempotente; outro autor recebe ID_EM_USO', async () => {
    const mesmo = montar('supervisor', SUP, new Set([SUP, VEND]), { autor_id: SUP });
    expect((await receberPedidos(mesmo.ctx, [item({ vendedor_id: VEND })]))[0]).toMatchObject({ status: 'aceito' });
    expect(insertDoPedido(mesmo.sqls)).toBeUndefined();
    const outro = montar('supervisor', SUP, new Set([SUP, VEND]), { autor_id: GER });
    expect((await receberPedidos(outro.ctx, [item({ vendedor_id: VEND })]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'ID_EM_USO' });
  });
});

describe('RN-VEN-35: o servidor revalida equipe e área', () => {
  it('supervisor para vendedor de outra equipe: rejeitado FORA_DA_EQUIPE, nada gravado', async () => {
    const { ctx, sqls, eventos } = montar('supervisor', SUP, new Set([SUP, VEND]));
    const r = await receberPedidos(ctx, [item({ vendedor_id: VEND_FORA })]);
    expect(r[0]).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DA_EQUIPE' });
    expect(insertDoPedido(sqls)).toBeUndefined();
    expect(eventos).toHaveLength(0);
  });
  it('gerente para vendedor da área: aceito, e a alçada é a do gerente (14% direto)', async () => {
    const { ctx, sqls } = montar('gerente', GER, new Set([GER, SUP, VEND]));
    const r = await receberPedidos(ctx, [item({ vendedor_id: VEND, discount_pct: 14 })]);
    expect(r[0]).toMatchObject({ status: 'aceito' });
    expect(insertDoPedido(sqls)!.valores[3]).toBe('approved');
  });
  it('gerente para vendedor de outra área: rejeitado, a mensagem fala em área', async () => {
    const { ctx } = montar('gerente', GER, new Set([GER, SUP, VEND]));
    const r = await receberPedidos(ctx, [item({ vendedor_id: VEND_FORA })]);
    expect(r[0]).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DA_EQUIPE' });
    expect(JSON.stringify(r[0])).toMatch(/área/);
  });
  it('dono que não é vendedor (gerente, promotor) é recusado', async () => {
    const { ctx } = montar('gerente', GER, new Set([GER, SUP, PROMOTOR]));
    expect((await receberPedidos(ctx, [item({ vendedor_id: PROMOTOR })]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-01' });
    expect((await receberPedidos(ctx, [item({ vendedor_id: SUP })]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'VENDEDOR_INVALIDO' });
  });
  it('RN-PRO-01: o promotor nunca cria pedido, nem em nome de vendedor', async () => {
    const { ctx, sqls } = montar('promotor', PROMOTOR, 'tenant');
    const r = await receberPedidos(ctx, [item({ vendedor_id: VEND })]);
    expect(r[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-01' });
    expect(sqls).toHaveLength(0);
  });
  it('analista não faz pedido em nome de vendedor', async () => {
    const { ctx, sqls } = montar('analista', U(50), 'tenant');
    const r = await receberPedidos(ctx, [item({ vendedor_id: VEND })]);
    expect(r[0]).toMatchObject({ status: 'rejeitado', codigo: 'PERFIL_SEM_ACESSO' });
    expect(insertDoPedido(sqls)).toBeUndefined();
  });
  it('orçamento e conversão não são em nome: EM_NOME_SO_PEDIDO', async () => {
    const { ctx } = montar('supervisor', SUP, new Set([SUP, VEND]));
    expect((await receberPedidos(ctx, [item({ vendedor_id: VEND, tipo: 'orcamento' })]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'EM_NOME_SO_PEDIDO' });
    expect((await receberPedidos(ctx, [item({ vendedor_id: VEND, orcamento_origem_id: U(60) })]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'EM_NOME_SO_PEDIDO' });
  });
  it('vendedor_id igual ao autor é pedido comum (o vendedor cria o próprio)', async () => {
    const { ctx, sqls } = montar('vendedor', VEND, new Set([VEND]));
    const r = await receberPedidos(ctx, [item({ vendedor_id: VEND })]);
    expect(r[0]).toMatchObject({ status: 'aceito' });
    const ins = insertDoPedido(sqls)!;
    expect(ins.valores[2]).toBe(VEND);
    expect(ins.valores[37]).toBe(VEND);
  });
});
