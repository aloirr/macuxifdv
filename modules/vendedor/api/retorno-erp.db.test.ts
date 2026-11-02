/**
 * Retorno do ERP × Postgres real (fixture dois-tenants, papel macuxi_app, RLS) — T-0054: o repositório Postgres
 * (`repositorioRetornoErpPg`), o pull e o detalhe com as colunas do faturamento.
 *
 * A migração do faturamento é do banco-dados (pedido por recado, T-0054). Enquanto ela não está no `main`, o setup
 * `api/teste/ddl-proposta.ts` aplica a DDL PROPOSTA (a mesma de docs/modulos/vendedor/retorno-erp.md) SÓ no banco
 * efêmero do teste, antes de qualquer arquivo consultar o banco; quando a migração chegar, o teste passa a validar a
 * migração real (se divergir, falha aqui).
 * Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha. Relógio: o do banco (`select now()`), lido uma vez.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco, ContextoConsumo, DefinicaoEvento, EnvelopeEvento } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PedidoItemSyncSchema, PedidoSyncSchema } from '../contracts';
import { lerNotasDoPedido } from './pedidos';
import { paraFaturamento, type LinhaPedido } from './mapeamento';
import { aplicarNotaDevolucao, aplicarRetornoErp, repositorioRetornoErpPg, type ContextoRetorno } from './retorno-erp';
import { escopoDoPedido, sqlPedido, sqlPedidoItem } from './sync';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n: number) => `0f540000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PED = id(1);
const PED2 = id(2);
const P1 = id(11);
const P2 = id(12);

describe.skipIf(semBanco())('Vendedor × Postgres: retorno do ERP, faturamento e devolução (T-0054)', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  /** relógio único do arquivo: o do banco */
  let AGORA!: Date;
  const EM = (min: number) => new Date(AGORA.getTime() + min * 60_000).toISOString();

  interface Registro {
    publicados: Array<{ nome: string; payload: Record<string, unknown> }>;
  }
  const ctx = (eventoId: string, reg: Registro): ContextoRetorno => ({
    evento_id: eventoId,
    agora: () => AGORA,
    publicar: (async (def: DefinicaoEvento, payload: unknown) => {
      reg.publicados.push({ nome: def.nome, payload: def.schema.parse(payload) as Record<string, unknown> });
      return {} as EnvelopeEvento;
    }) as ContextoConsumo['publicar'],
    log: { info() {}, warn() {}, error() {} },
  });
  const noTenant = <T>(tenant: string, fn: (db: ClienteBanco) => Promise<T>) => comTenant(pool, tenant, (c) => fn(c as unknown as ClienteBanco));

  async function limpar() {
    await admin.query('delete from vendedor.pedido_devolucao where pedido_id = any($1::uuid[])', [[PED, PED2]]);
    await admin.query('delete from vendedor.pedido_faturamento where pedido_id = any($1::uuid[])', [[PED, PED2]]);
    await admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [[PED, PED2]]);
    await admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [[PED, PED2]]);
    await admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [[PED, PED2]]);
  }

  async function criarPedido(pedidoId: string, status: string) {
    await noTenant(A.tenantId, async (db) => {
      await db.query(
        `insert into vendedor.pedido (id, tenant_id, cliente_id, vendedor_id, autor_id, status, total_tabela_cents, total_cents, numero)
         values ($1, plataforma.tenant_atual(), $2, $3, $3, $4, 12000, 12000, $5)`,
        [pedidoId, A.clientes.c1, A.usuarios.vendedor1, status, pedidoId === PED ? 'T54-1' : 'T54-2'],
      );
      await db.query(
        `insert into vendedor.pedido_item (tenant_id, pedido_id, sequencia, produto_id, quantidade, preco_tabela_cents, preco_unitario_cents, total_cents)
         values (plataforma.tenant_atual(), $1, 1, $2, 10, 1000, 1000, 10000), (plataforma.tenant_atual(), $1, 2, $3, 4, 500, 500, 2000)`,
        [pedidoId, P1, P2],
      );
    });
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 2 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    AGORA = (await admin.query<{ agora: Date }>('select now() as agora')).rows[0]!.agora;
    await limpar();
  });
  afterAll(async () => {
    await limpar();
    await admin.end();
    await pool.end();
  });

  it('RN-INT-08 / RN-TRE-08: parcial com itens → status, número, linha do tempo, nota, resumo e faturado@1', async () => {
    await criarPedido(PED, 'approved');
    const reg: Registro = { publicados: [] };
    const retorno = {
      pedido_uuid: PED, status: 'faturado_parcial', numero_erp: 'ERP-54', motivo: null,
      nota: { numero: '9001', serie: '1', emitida_em: EM(-5), total_cents: 6_500 },
      itens_faturados: [{ sequencia: 1, quantidade: 6, valor_cents: 6_000 }, { sequencia: 9, quantidade: 1, valor_cents: 1 }],
      ocorrido_em: EM(-5),
    };
    const r = await noTenant(A.tenantId, (db) => aplicarRetornoErp(repositorioRetornoErpPg(db), retorno, ctx('0f540000-0000-4000-8000-0000000000e1', reg)));
    expect(r).toEqual({ aplicado: true, de: 'approved', para: 'invoiced_partial', faturado_publicado: true });
    const p = (await admin.query('select status, numero_erp, faturado_cents::int, notas_faturamento, ultima_nota_numero from vendedor.pedido where id = $1', [PED])).rows[0];
    expect(p).toEqual({ status: 'invoiced_partial', numero_erp: 'ERP-54', faturado_cents: 6_000, notas_faturamento: 1, ultima_nota_numero: '9001' });
    const itens = (await admin.query('select sequencia, quantidade_faturada from vendedor.pedido_item where pedido_id = $1 order by sequencia', [PED])).rows;
    expect(itens).toEqual([{ sequencia: 1, quantidade_faturada: 6 }, { sequencia: 2, quantidade_faturada: 0 }]);
    const ev = (await admin.query("select de, para, autor_nome, autor_id from vendedor.pedido_evento where pedido_id = $1", [PED])).rows;
    expect(ev).toEqual([{ de: 'approved', para: 'invoiced_partial', autor_nome: 'ERP', autor_id: null }]);
    expect(reg.publicados.map((x) => x.nome)).toEqual(['vendedor.pedido.status_alterado@1', 'vendedor.pedido.faturado@1']);
    expect(reg.publicados[1]!.payload).toMatchObject({ pedido_id: PED, vendedor_id: A.usuarios.vendedor1, parcial: true, itens: [{ produto_id: P1, quantidade: 6 }] });
  });

  it('RN-INT-08: a mesma entrega (evento_origem_id) não grava a nota de novo nem republica', async () => {
    const reg: Registro = { publicados: [] };
    const retorno = { pedido_uuid: PED, status: 'faturado_parcial', numero_erp: 'ERP-54', motivo: null, nota: { numero: '9001', emitida_em: EM(-5), total_cents: 6_500 }, itens_faturados: [{ sequencia: 1, quantidade: 6 }], ocorrido_em: EM(-5) };
    await noTenant(A.tenantId, (db) => aplicarRetornoErp(repositorioRetornoErpPg(db), retorno, ctx('0f540000-0000-4000-8000-0000000000e1', reg)));
    expect(reg.publicados).toEqual([]);
    expect((await admin.query('select count(*)::int as n from vendedor.pedido_faturamento where pedido_id = $1', [PED])).rows[0]!.n).toBe(1);
  });

  it('RN-TRE-08: faturado_total sem itens fatura o saldo e fecha o pedido; o detalhe lista as notas', async () => {
    const reg: Registro = { publicados: [] };
    const retorno = { pedido_uuid: PED, status: 'faturado_total', numero_erp: 'ERP-54', motivo: null, nota: { numero: '9002', serie: null, emitida_em: EM(-2), total_cents: 6_000 }, itens_faturados: null, ocorrido_em: EM(-2) };
    await noTenant(A.tenantId, (db) => aplicarRetornoErp(repositorioRetornoErpPg(db), retorno, ctx('0f540000-0000-4000-8000-0000000000e2', reg)));
    expect(reg.publicados[1]!.payload).toMatchObject({ parcial: false, itens: [{ produto_id: P1, quantidade: 4 }, { produto_id: P2, quantidade: 4 }] });
    const p = (await admin.query('select status, faturado_cents::int, notas_faturamento from vendedor.pedido where id = $1', [PED])).rows[0];
    expect(p).toEqual({ status: 'invoiced', faturado_cents: 12_000, notas_faturamento: 2 });
    const notas = await noTenant(A.tenantId, (db) => lerNotasDoPedido(db, PED));
    expect(notas.notas.map((n) => [n.nota_numero, n.parcial, n.unidades])).toEqual([['9001', true, 6], ['9002', false, 8]]);
    const f = paraFaturamento({ faturado_cents: 12_000, devolvido_cents: 0 } as LinhaPedido, notas.notas, notas.devolucoes);
    expect(f).toMatchObject({ faturado_cents: 12_000, devolucao: 'nenhuma', notas: [{ numero: '9001', total_cents: 6_500 }, { numero: '9002', serie: null }] });
  });

  it('RN-VEN-37: devolução grava, atualiza e sai da soma quando cancelada (macuxi_app, sem apagar)', async () => {
    const reg: Registro = { publicados: [] };
    const nota = (o: Record<string, unknown> = {}) => ({ acao: 'criado', external_id: 'NF-D-54', registro: { tipo: 'devolucao', pedido_uuid: PED, numero: 'D54', serie: '1', emitida_em: EM(-1), total_cents: 3_000, cancelada: false, ...o } });
    await noTenant(A.tenantId, (db) => aplicarNotaDevolucao(repositorioRetornoErpPg(db), nota(), ctx('x', reg)));
    expect((await admin.query('select devolvido_cents::int from vendedor.pedido where id = $1', [PED])).rows[0]!.devolvido_cents).toBe(3_000);
    await noTenant(A.tenantId, (db) => aplicarNotaDevolucao(repositorioRetornoErpPg(db), nota({ total_cents: 12_000 }), ctx('x', reg)));
    const notas = await noTenant(A.tenantId, (db) => lerNotasDoPedido(db, PED));
    expect(notas.devolucoes).toEqual([expect.objectContaining({ nota_numero: 'D54', total_cents: 12_000 })]);
    await noTenant(A.tenantId, (db) => aplicarNotaDevolucao(repositorioRetornoErpPg(db), nota({ cancelada: true }), ctx('x', reg)));
    expect((await admin.query('select devolvido_cents::int from vendedor.pedido where id = $1', [PED])).rows[0]!.devolvido_cents).toBe(0);
    expect((await admin.query('select count(*)::int as n from vendedor.pedido_devolucao where pedido_id = $1 and deleted_at is not null', [PED])).rows[0]!.n).toBe(1);
  });

  it('multi-tenant (RLS): no tenant B o pedido do tenant A não existe — retorno e devolução não alteram nada', async () => {
    await criarPedido(PED2, 'approved');
    const reg: Registro = { publicados: [] };
    const r = await noTenant(B.tenantId, (db) =>
      aplicarRetornoErp(repositorioRetornoErpPg(db), { pedido_uuid: PED2, status: 'integrado', numero_erp: 'X', motivo: null, nota: null, ocorrido_em: EM(-1) }, ctx('0f540000-0000-4000-8000-0000000000e3', reg)),
    );
    expect(r).toEqual({ aplicado: false, motivo: 'pedido_inexistente' });
    const d = await noTenant(B.tenantId, (db) =>
      aplicarNotaDevolucao(repositorioRetornoErpPg(db), { acao: 'criado', external_id: 'NF-B', registro: { tipo: 'devolucao', pedido_uuid: PED2, numero: 'B1', emitida_em: EM(-1), total_cents: 10 } }, ctx('x', reg)),
    );
    expect(d).toEqual({ pedidos: [] });
    expect((await admin.query('select status from vendedor.pedido where id = $1', [PED2])).rows[0]!.status).toBe('approved');
    expect((await admin.query('select count(*)::int as n from vendedor.pedido_devolucao where pedido_id = $1', [PED2])).rows[0]!.n).toBe(0);
  });

  it('RN-INT-08: cancelado no ERP (sem estorno) e o pull leva o resumo do faturamento ao aparelho', async () => {
    const reg: Registro = { publicados: [] };
    await noTenant(A.tenantId, (db) =>
      aplicarRetornoErp(repositorioRetornoErpPg(db), { pedido_uuid: PED2, status: 'cancelado', numero_erp: null, motivo: 'pedido duplicado', nota: null, ocorrido_em: EM(-1) }, ctx('0f540000-0000-4000-8000-0000000000e4', reg)),
    );
    expect((await admin.query('select status, motivo_cancelamento from vendedor.pedido where id = $1', [PED2])).rows[0]).toEqual({ status: 'cancelled', motivo_cancelamento: 'Cancelado no ERP: pedido duplicado' });
    // pull com as colunas do faturamento (o que liga com FATURAMENTO_LIGADO)
    const e = escopoDoPedido('vendedor', new Set([A.usuarios.vendedor1]), 'tenant');
    const ate = new Date(AGORA.getTime() + 3_600_000).toISOString();
    const pedidos = await noTenant(A.tenantId, async (db) => {
      const q = sqlPedido({ ate, desde: null, limite: 50 } as never, e, true);
      return (await db.query(q.sql, q.valores)).rows;
    });
    const linha = pedidos.find((x) => x.id === PED)!;
    expect(PedidoSyncSchema.parse(linha)).toMatchObject({ status: 'invoiced', faturado_cents: 12_000, notas_faturamento: 2, ultima_nota_numero: '9002' });
    const itens = await noTenant(A.tenantId, async (db) => {
      const q = sqlPedidoItem({ ate, desde: null, limite: 50 } as never, e, true);
      return (await db.query(q.sql, q.valores)).rows.filter((x) => x.pedido_id === PED);
    });
    expect(itens.map((i) => PedidoItemSyncSchema.parse(i)).sort((a, b) => a.sequencia - b.sequencia).map((i) => i.quantidade_faturada)).toEqual([10, 4]);
  });
});
