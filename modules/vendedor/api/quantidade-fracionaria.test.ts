/**
 * Quantidade fracionária no push (ADR 0076, RN-VEN-02 v3), sem banco: a trava das 24 h, a regra KG/M, o `criado@2` e o `criado@1`
 * em paralelo. O fluxo com Postgres está em `quantidade-fracionaria.db.test.ts`.
 */
import { criarPortaVersaoAppMemoria, type ContextoBase, type ItemPush, type PortaVersaoApp } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { receberPedidos } from './receber';

const U = (n: number) => `0e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TENANT = U(900);
const VEND = U(10);
const CLIENTE = U(20);
const PRODUTO = U(30);
const PEDIDO = U(40);
const nomes: Record<string, { nome: string; perfil: string }> = { [VEND]: { nome: 'Vera Vendedora', perfil: 'vendedor' } };
const AGORA = new Date('2026-11-05T12:00:00Z');
const publicadaHa = (horas: number) => ({ versao: '1.0.36', publicada_em: new Date(AGORA.getTime() - horas * 3_600_000).toISOString() });
const ABERTA = criarPortaVersaoAppMemoria({ campo: publicadaHa(25), gestao: publicadaHa(25) });
const FECHADA = criarPortaVersaoAppMemoria({ campo: publicadaHa(1), gestao: publicadaHa(25) });

type Sql = { sql: string; valores: unknown[] };

function montar(perfil: string, id: string, visiveis: ReadonlySet<string> | 'tenant', o: { unidade: string; versao?: PortaVersaoApp } = { unidade: 'UN' }) {
  const jaExiste = undefined as { autor_id: string } | undefined;
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
          produtos: [{ id: PRODUTO, sku: 'P1', nome: 'Produto 1', unidade: o.unidade, ativo: true, external_id: null, preco_venda_cents: null, desconto_maximo_pct: 100 }],
          usuarios: (entrada.usuario_ids ?? []).filter((i) => nomes[i]).map((i) => ({ id: i, nome: nomes[i]!.nome, perfil: nomes[i]!.perfil, external_id: null })),
          enderecos: [],
        };
      }
      if (def.nome === 'core.financeiro_cliente@1') return { financeiro: { limite_cents: 100_000_000, saldo_aberto_cents: 0, credito_disponivel_erp_cents: null, vencidos_qtd: 0, vencidos_cents: 0, maior_atraso_dias: 0 } };
      return { tabela_preco_id: null, itens: [{ produto_id: PRODUTO, preco_cents: 1999, motivo_sem_preco: null }] };
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
    ...(o.versao ? { versaoApp: o.versao } : {}),
    comTenant: async (fn: (d: typeof db, t: typeof tx) => Promise<unknown>) => fn(db, tx),
  } as unknown as ContextoBase;
  return { ctx, sqls, eventos, auditoria };
}


const item = (quantity: number): ItemPush =>
  ({ entidade: 'pedido', id: PEDIDO, operacao: 'upsert', payload: { id: PEDIDO, customer_id: CLIENTE, discount_pct: 0, payment_terms: '28 dias', total_cents: 1, items: [{ product_id: PRODUTO, quantity }] } }) as unknown as ItemPush;
const criados = (e: Array<{ nome: string }>) => e.map((x) => x.nome).filter((n) => n.startsWith('vendedor.pedido.criado'));

describe('RN-VEN-02 v3 (ADR 0076): quantidade fracionária no push', () => {
  it('trava fechada (sem porta de versão ou publicada há menos de 24 h): 422 quantidade_fracionaria_bloqueada, nada gravado', async () => {
    for (const versao of [undefined, FECHADA]) {
      const { ctx, sqls, eventos } = montar('vendedor', VEND, new Set([VEND]), { unidade: 'KG', ...(versao ? { versao } : {}) });
      const [r] = await receberPedidos(ctx, [item(1.25)]);
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'quantidade_fracionaria_bloqueada' });
      expect(sqls.some((s) => /insert into vendedor\.pedido /.test(s.sql))).toBe(false);
      expect(eventos).toEqual([]);
    }
  });

  it('trava fechada: quantidade inteira em KG segue aceita', async () => {
    const { ctx } = montar('vendedor', VEND, new Set([VEND]), { unidade: 'KG', versao: FECHADA });
    expect((await receberPedidos(ctx, [item(2)]))[0]).toMatchObject({ status: 'aceito' });
  });

  it('trava aberta: 1999 × 1,250 kg grava o item com 2499; criado@2 leva 1,25 e o criado@1 não sai', async () => {
    const { ctx, sqls, eventos } = montar('vendedor', VEND, new Set([VEND]), { unidade: 'KG', versao: ABERTA });
    expect((await receberPedidos(ctx, [item(1.25)]))[0]).toMatchObject({ status: 'aceito' });
    const it = sqls.find((s) => /insert into vendedor\.pedido_item/.test(s.sql))!;
    expect(it.valores).toContain(1.25);
    expect(it.valores).toContain(2499);
    expect(criados(eventos)).toEqual(['vendedor.pedido.criado@2']);
    expect(eventos.find((e) => e.nome === 'vendedor.pedido.criado@2')!.payload).toMatchObject({ itens: [{ produto_id: PRODUTO, quantidade: 1.25, total_cents: 2499 }] });
  });

  it('quantidade inteira publica o criado@2 e o criado@1 em paralelo', async () => {
    const { ctx, eventos } = montar('vendedor', VEND, new Set([VEND]), { unidade: 'KG', versao: ABERTA });
    await receberPedidos(ctx, [item(3)]);
    expect(criados(eventos)).toEqual(['vendedor.pedido.criado@2', 'vendedor.pedido.criado@1']);
  });

  it('fração fora de KG e M é quantidade_fracionaria_invalida, com a trava aberta ou fechada', async () => {
    for (const versao of [ABERTA, FECHADA]) {
      const { ctx, eventos } = montar('vendedor', VEND, new Set([VEND]), { unidade: 'UN', versao });
      expect((await receberPedidos(ctx, [item(1.5)]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'quantidade_fracionaria_invalida' });
      expect(eventos).toEqual([]);
    }
  });

  it('mais de 4 casas é quantidade_fracionaria_invalida (o contrato do push já recusa antes; a API revalida)', async () => {
    const { ctx } = montar('vendedor', VEND, new Set([VEND]), { unidade: 'KG', versao: ABERTA });
    expect((await receberPedidos(ctx, [item(1.23456)]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'quantidade_fracionaria_invalida' });
  });
});
