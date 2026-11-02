/**
 * T-0053 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): retorno do ERP aplicado ao pedido (consumidor de
 * `integracao.pedido.retorno_erp@1`) e orçamento/conversão no push com o repositório de pré-venda em memória (a 0013 ainda
 * não está no main). As consultas entre módulos são simuladas como em `pedido.db.test.ts`. Pula sem Postgres.
 * Relógio único do arquivo: lido do banco no beforeAll (sem hora fixa contra o relógio real).
 */
import { randomUUID } from 'node:crypto';
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import { comTenant, dadosDoisTenants, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco, ContextoBase, ContextoConsumo, DefinicaoEvento, ItemPush, ResultadoItemPush, UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import manifest from '../manifest';
import { RetornoErpConsumido } from '../contracts';
import { entidadePedido } from '../contracts/entidades';
import { apiVendedor } from './index';
import { rotaCancelarPedido, rotaVerPedido } from './pedidos';
import { criarPreVendaEmMemoria, usarPreVenda } from './pre-venda';
import { aplicarRetornoErp, repositorioRetornoErpPg } from './retorno-erp';
import { provedoresSyncVendedor } from './sync';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
let AGORA!: Date;
const id = (n: number) => `0f530000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IDS = Array.from({ length: 40 }, (_, i) => id(i + 1));
const CADASTRO = (() => {
  const d = dadosDoisTenants('hash-de-teste');
  return { cliente: d['core.cliente']!, produto: d['core.produto']!, usuario: d['core.usuario']! };
})();
const DIA = 86_400_000;

const vendedor1: UsuarioAutenticado = { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' };
const vendedor2: UsuarioAutenticado = { id: A.usuarios.vendedor2, tenant_id: A.tenantId, perfil: 'vendedor' };
const promotor: UsuarioAutenticado = { id: A.usuarios.promotor, tenant_id: A.tenantId, perfil: 'promotor' };
const vendedorB: UsuarioAutenticado = { id: B.usuarios.vendedor, tenant_id: B.tenantId, perfil: 'vendedor' };

interface Evento {
  nome: string;
  payload: Record<string, unknown>;
}

describe('T-0053: manifesto e ligação do consumidor', () => {
  it('RN-INT-08: o Vendedor consome integracao.pedido.retorno_erp@1 e publica faturado@1 (o despachante só entrega o que está em consome)', () => {
    expect(manifest.consome).toContain('integracao.pedido.retorno_erp@1');
    expect(manifest.publica).toContain('vendedor.pedido.faturado@1');
    expect(apiVendedor.consumidores?.map((c) => c.evento.nome)).toEqual(['integracao.pedido.retorno_erp@1']);
  });
});

describe.skipIf(semBanco())('Vendedor T-0053 × Postgres: retorno do ERP e pré-venda', () => {
  let pool: pg.Pool;
  let prod1 = '';
  let prod2 = '';
  const INATIVOS = new Set<string>();

  function contexto(u: UsuarioAutenticado, o: { parametros?: Record<string, unknown>; agora?: Date; eventos?: Evento[] } = {}) {
    const eventos = o.eventos ?? [];
    const base = {
      usuario: { ...u, modulos: ['core', 'catalogo', 'vendedor'] },
      requestId: 'r-teste',
      agora: () => o.agora ?? AGORA,
      fuso: () => 'America/Manaus',
      carteira: async () => 'tenant' as const,
      usuariosVisiveis: async () => new Set([u.id]),
      parametros: () => o.parametros ?? {},
      log: { info() {}, warn() {}, error() {} },
      comTenant: <T>(fn: (db: ClienteBanco, tx: unknown) => Promise<T>) =>
        comTenant(pool, u.tenant_id, (c) => {
          const tx = {
            async consultar(def: { nome: string }, entrada: Record<string, unknown>) {
              if (def.nome === CONSULTA_CADASTRO_RESUMO.nome) {
                const ent = CONSULTA_CADASTRO_RESUMO.entrada.parse(entrada);
                const pegar = (tabela: 'cliente' | 'produto' | 'usuario', ids: string[], campos: string[]) =>
                  CADASTRO[tabela]
                    .filter((l) => ids.includes(l.id as string) && l.tenant_id === u.tenant_id)
                    .map((l) => ({ ...Object.fromEntries(campos.map((k) => [k, l[k] ?? null])), ...(tabela === 'cliente' && INATIVOS.has(l.id as string) ? { ativo: false } : {}) }));
                return CONSULTA_CADASTRO_RESUMO.saida.parse({
                  clientes: pegar('cliente', ent.cliente_ids, ['id', 'razao_social', 'nome_fantasia', 'documento', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'ativo', 'external_id']),
                  produtos: pegar('produto', ent.produto_ids, ['id', 'sku', 'nome', 'unidade', 'ativo', 'external_id']),
                  usuarios: pegar('usuario', ent.usuario_ids, ['id', 'nome', 'perfil', 'external_id']),
                });
              }
              if (def.nome === CONSULTA_PRECOS_CLIENTE.nome) {
                const ent = CONSULTA_PRECOS_CLIENTE.entrada.parse(entrada);
                const tabela: Record<string, number> = { [prod1]: 100_000, [prod2]: 50_000 };
                return { tabela_preco_id: id(40), itens: ent.produto_ids.map((p) => ({ produto_id: p, preco_cents: tabela[p] ?? null, motivo_sem_preco: tabela[p] ? null : 'Sem preço.' })) };
              }
              throw new Error(`consulta não simulada: ${def.nome}`);
            },
            async publicar(def: DefinicaoEvento, payload: unknown) {
              eventos.push({ nome: def.nome, payload: def.schema.parse(payload) as Record<string, unknown> });
              return {};
            },
            async auditar() {},
            async registrarArquivo() {
              throw new Error('não usado');
            },
          };
          return fn(c as unknown as ClienteBanco, tx);
        }),
    };
    return { ctx: base as unknown as ContextoBase, eventos };
  }

  const push = (idPedido: string, payload: Record<string, unknown>): ItemPush =>
    ({ entidade: 'pedido', id: idPedido, operacao: 'upsert', payload: entidadePedido.schema.parse({ id: idPedido, ...payload }) }) as unknown as ItemPush;
  const receber = (c: ContextoBase, ...itens: ItemPush[]): Promise<ResultadoItemPush[]> => provedoresSyncVendedor[0]!.receber!(c, itens);
  const itens = () => [
    { product_id: prod1, quantity: 2 },
    { product_id: prod2, quantity: 1 },
  ];
  const lerPedido = (pedidoId: string, tenant = A.tenantId) =>
    comTenant(pool, tenant, async (c) => ({
      p: (await c.query('select * from vendedor.pedido where id = $1', [pedidoId])).rows[0],
      ev: (await c.query('select * from vendedor.pedido_evento where pedido_id = $1 order by ocorrido_em, created_at, (de is not null)', [pedidoId])).rows,
    }));

  /** Roda o consumidor como o despachante: transação do tenant do evento, payload validado pelo schema do evento. */
  async function retorno(pedidoId: string, status: string, extra: Record<string, unknown> = {}, tenant = A.tenantId, quando = AGORA) {
    const eventos: Evento[] = [];
    const avisos: string[] = [];
    const payload = RetornoErpConsumido.parse({ pedido_uuid: pedidoId, status, numero_erp: 'ERP-55', motivo: null, nota: null, itens_faturados: null, ocorrido_em: quando.toISOString(), ...extra });
    await comTenant(pool, tenant, (db) =>
      aplicarRetornoErp(repositorioRetornoErpPg(db), payload, {
        evento_id: randomUUID(),
        agora: () => quando,
        publicar: (async (def: DefinicaoEvento, p: unknown) => {
          eventos.push({ nome: def.nome, payload: def.schema.parse(p) as Record<string, unknown> });
          return {};
        }) as unknown as ContextoConsumo['publicar'],
        log: { info: (_o: unknown, m?: string) => avisos.push(m ?? ''), warn: (_o: unknown, m?: string) => avisos.push(m ?? ''), error() {} },
      }),
    );
    return { eventos, avisos };
  }

  async function limpar() {
    const admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    try {
      await admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [IDS]);
      await admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [IDS]);
      await admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [IDS]);
    } finally {
      await admin.end();
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    AGORA = new Date((await pool.query<{ agora: Date }>('select now() as agora')).rows[0]!.agora); // hora-fixa-ok: linha do tempo única do arquivo
    await limpar();
    prod1 = CADASTRO.produto.find((x) => x.sku === 'ALFA-001' && x.tenant_id === A.tenantId)!.id as string;
    prod2 = CADASTRO.produto.find((x) => x.sku === 'ALFA-002' && x.tenant_id === A.tenantId)!.id as string;
  });
  afterAll(async () => {
    await limpar();
    await pool?.end();
  });

  // ---------- retorno do ERP ----------
  describe('retorno do ERP (RN-VEN-30, RN-INT-08)', () => {
    it('RN-VEN-30: aprovado → integrado → faturado parcial (2 notas) → faturado; histórico do ERP e eventos', async () => {
      const { ctx } = contexto(vendedor1);
      expect((await receber(ctx, push(id(1), { customer_id: A.clientes.c1, discount_pct: 3, items: itens() })))[0]).toMatchObject({ status: 'aceito' });
      expect((await lerPedido(id(1))).p.status).toBe('approved');

      const r1 = await retorno(id(1), 'integrado');
      let { p, ev } = await lerPedido(id(1));
      expect(p).toMatchObject({ status: 'integrated', numero_erp: 'ERP-55' });
      expect(ev.at(-1)).toMatchObject({ de: 'approved', para: 'integrated', autor_id: null, autor_nome: 'ERP', autor_perfil: 'erp' });
      expect(r1.eventos).toEqual([{ nome: 'vendedor.pedido.status_alterado@1', payload: expect.objectContaining({ pedido_id: id(1), de: 'aprovado', para: 'integrado_erp', autor_id: null }) }]);

      const nota = { numero: '100', serie: '1', emitida_em: AGORA.toISOString(), total_cents: 100_000 };
      const r2 = await retorno(id(1), 'faturado_parcial', { nota, itens_faturados: [{ sequencia: 1, produto_external_id: 'X', quantidade: 1, valor_cents: 97_000 }] });
      ({ p } = await lerPedido(id(1)));
      expect(p.status).toBe('invoiced_partial');
      expect(r2.eventos.map((e) => e.nome)).toEqual(['vendedor.pedido.status_alterado@1', 'vendedor.pedido.faturado@1']);
      expect(r2.eventos[1]!.payload).toEqual({ pedido_id: id(1), vendedor_id: A.usuarios.vendedor1, faturado_em: nota.emitida_em, parcial: true, itens: [{ produto_id: prod1, quantidade: 1 }] });

      // 2ª nota parcial: fatura sem transição (o banco não aceita de = para no histórico)
      const antes = (await lerPedido(id(1))).ev.length;
      const r3 = await retorno(id(1), 'faturado_parcial', { nota: { ...nota, numero: '101' }, itens_faturados: [{ sequencia: 2, produto_external_id: 'Y', quantidade: 1, valor_cents: 48_500 }] });
      expect(r3.eventos.map((e) => e.nome)).toEqual(['vendedor.pedido.faturado@1']);
      expect((await lerPedido(id(1))).ev.length).toBe(antes);

      const r4 = await retorno(id(1), 'faturado_total', { nota: { ...nota, numero: '102' }, itens_faturados: [{ sequencia: 1, produto_external_id: 'X', quantidade: 1, valor_cents: 97_000 }] });
      ({ p, ev } = await lerPedido(id(1)));
      expect(p.status).toBe('invoiced');
      expect(ev.map((e) => e.para)).toEqual(['received', 'approved', 'integrated', 'invoiced_partial', 'invoiced']);
      expect(r4.eventos.find((e) => e.nome === 'vendedor.pedido.faturado@1')!.payload).toMatchObject({ parcial: false, itens: [{ produto_id: prod1, quantidade: 1 }] });

      // atrasado/repetido: não volta
      const r5 = await retorno(id(1), 'integrado');
      expect(r5.eventos).toEqual([]);
      expect((await lerPedido(id(1))).p.status).toBe('invoiced');
    });

    it('faturado total sem itens e sem parcial antes: o pedido inteiro vai no faturado@1', async () => {
      const { ctx } = contexto(vendedor1);
      await receber(ctx, push(id(2), { customer_id: A.clientes.c1, discount_pct: 0, items: itens() }));
      const r = await retorno(id(2), 'faturado_total', { nota: { numero: '200', serie: null, emitida_em: AGORA.toISOString(), total_cents: 250_000 } });
      expect((await lerPedido(id(2))).p.status).toBe('invoiced');
      expect(r.eventos.find((e) => e.nome === 'vendedor.pedido.faturado@1')!.payload).toMatchObject({ itens: [{ produto_id: prod1, quantidade: 2 }, { produto_id: prod2, quantidade: 1 }] });
    });

    it('RN-INT-08: rejeitado pelo ERP grava o motivo; cancelado no ERP grava o motivo do cancelamento', async () => {
      const { ctx } = contexto(vendedor1);
      await receber(ctx, push(id(3), { customer_id: A.clientes.c1, discount_pct: 0, items: itens() }), push(id(4), { customer_id: A.clientes.c1, discount_pct: 0, items: itens() }));
      await retorno(id(3), 'rejeitado_erp', { numero_erp: null, motivo: 'Cliente sem limite no ERP' });
      expect((await lerPedido(id(3))).p).toMatchObject({ status: 'rejected', motivo_rejeicao: 'Recusado pelo ERP: Cliente sem limite no ERP' });
      await retorno(id(4), 'integrado');
      const r = await retorno(id(4), 'cancelado', { motivo: 'desistência' });
      expect((await lerPedido(id(4))).p).toMatchObject({ status: 'cancelled', motivo_cancelamento: 'Cancelado no ERP: desistência', numero_erp: 'ERP-55' });
      expect(r.eventos[0]!.payload).toMatchObject({ de: 'integrado_erp', para: 'cancelado' });
    });

    it('RN-INT-08: pedido pendente de aprovação não é mexido pelo retorno; pedido desconhecido só gera aviso', async () => {
      const { ctx } = contexto(vendedor1);
      await receber(ctx, push(id(5), { customer_id: A.clientes.c1, discount_pct: 8, items: itens() }));
      expect((await lerPedido(id(5))).p.status).toBe('pending_approval');
      expect((await retorno(id(5), 'integrado')).eventos).toEqual([]);
      expect((await lerPedido(id(5))).p.status).toBe('pending_approval');
      const r = await retorno(id(39), 'integrado');
      expect(r.eventos).toEqual([]);
      expect(r.avisos.join(' ')).toMatch(/desconhecido/);
    });

    it('multi-tenant: retorno entregue no tenant B não enxerga nem altera o pedido do tenant A (RLS)', async () => {
      const { ctx } = contexto(vendedor1);
      await receber(ctx, push(id(6), { customer_id: A.clientes.c1, discount_pct: 0, items: itens() }));
      const r = await retorno(id(6), 'integrado', {}, B.tenantId);
      expect(r.eventos).toEqual([]);
      expect((await lerPedido(id(6))).p).toMatchObject({ status: 'approved', numero_erp: null });
    });
  });

  // ---------- pré-venda ----------
  describe('orçamento e conversão (RF-VEN-03, RN-VEN-32, RN-VEN-13)', () => {
    let restaurar: (() => void) | null = null;
    afterEach(() => {
      restaurar?.();
      restaurar = null;
      INATIVOS.clear();
    });

    it('sem a 0013 (repositório indisponível, padrão): orçamento e conversão são recusados sem gravar nada', async () => {
      const { ctx } = contexto(vendedor1);
      const [r1, r2] = await receber(ctx, push(id(10), { customer_id: A.clientes.c1, discount_pct: 0, items: itens(), tipo: 'orcamento' }), push(id(11), { customer_id: A.clientes.c1, discount_pct: 0, items: itens(), orcamento_origem_id: id(12) }));
      expect(r1).toMatchObject({ status: 'rejeitado', codigo: 'PRE_VENDA_INDISPONIVEL' });
      expect(r2).toMatchObject({ status: 'rejeitado', codigo: 'PRE_VENDA_INDISPONIVEL' });
      expect((await lerPedido(id(10))).p).toBeUndefined();
    });

    it('RN-VEN-32: orçamento fica recebido, sem alçada, sem evento e sem fila do ERP, com validade do parâmetro', async () => {
      const repo = criarPreVendaEmMemoria();
      restaurar = usarPreVenda(repo);
      const { ctx, eventos } = contexto(vendedor1, { parametros: { 'orcamento.validade_dias': 10 } });
      // 8% passaria pela alçada do supervisor num pedido; no orçamento não
      expect((await receber(ctx, push(id(13), { customer_id: A.clientes.c1, discount_pct: 8, items: itens(), tipo: 'orcamento' })))[0]).toMatchObject({ status: 'aceito' });
      const { p, ev } = await lerPedido(id(13));
      expect(p).toMatchObject({ status: 'received', nivel_aprovacao: null, aprovacao_automatica: false });
      expect(Number(p.total_cents)).toBe(230_000);
      expect(ev).toHaveLength(1);
      expect(ev[0].motivo).toMatch(/não reserva estoque nem consome crédito/);
      expect(eventos).toEqual([]);
      const doc = repo.estado.get(id(13))!;
      expect(doc.tipo).toBe('orcamento');
      expect(Date.parse(doc.validade_ate!) - AGORA.getTime()).toBe(10 * DIA);

      const detalhe = (await rotaVerPedido.executar({ ...(ctx as object), params: { id: id(13) } } as never)) as Record<string, unknown>;
      expect(detalhe).toMatchObject({ tipo: 'orcamento', situacao_orcamento: 'aberto', status: 'received' });
    });

    it('RN-VEN-13: cliente inativo só aceita orçamento', async () => {
      restaurar = usarPreVenda(criarPreVendaEmMemoria());
      INATIVOS.add(A.clientes.c2);
      const { ctx } = contexto(vendedor1);
      const [r1, r2] = await receber(ctx, push(id(14), { customer_id: A.clientes.c2, discount_pct: 0, items: itens() }), push(id(15), { customer_id: A.clientes.c2, discount_pct: 0, items: itens(), tipo: 'orcamento' }));
      expect(r1).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-13' });
      expect(r2).toMatchObject({ status: 'aceito' });
    });

    it('RF-VEN-03: converter gera pedido novo (alçada e eventos de pedido), marca o orçamento e só converte uma vez; reenvio é idempotente', async () => {
      const repo = criarPreVendaEmMemoria();
      restaurar = usarPreVenda(repo);
      const { ctx } = contexto(vendedor1);
      await receber(ctx, push(id(16), { customer_id: A.clientes.c1, discount_pct: 3, items: itens(), tipo: 'orcamento' }));
      const conv = contexto(vendedor1);
      const pedido = push(id(17), { customer_id: A.clientes.c1, discount_pct: 3, items: itens(), orcamento_origem_id: id(16), created_offline_at: AGORA.toISOString() });
      expect((await receber(conv.ctx, pedido))[0]).toMatchObject({ status: 'aceito' });
      expect((await lerPedido(id(17))).p.status).toBe('approved');
      expect(conv.eventos.map((e) => e.nome)).toContain('vendedor.pedido.aprovado@1');
      expect(repo.estado.get(id(16))!.convertido_pedido_id).toBe(id(17));
      expect(repo.estado.get(id(17))).toMatchObject({ tipo: 'pedido', orcamento_origem_id: id(16) });

      expect((await receber(conv.ctx, pedido))[0]).toMatchObject({ status: 'aceito' }); // RN-VEN-33
      const outro = await receber(ctx, push(id(18), { customer_id: A.clientes.c1, discount_pct: 3, items: itens(), orcamento_origem_id: id(16) }));
      expect(outro[0]).toMatchObject({ status: 'rejeitado', codigo: 'ORCAMENTO_JA_CONVERTIDO' });

      const det = (await rotaVerPedido.executar({ ...(ctx as object), params: { id: id(16) } } as never)) as Record<string, unknown>;
      expect(det).toMatchObject({ situacao_orcamento: 'convertido', convertido_pedido_id: id(17) });
    });

    it('RN-VEN-32: orçamento expirado não converte; de outro vendedor ou de outro tenant é "não encontrado"; promotor nunca', async () => {
      restaurar = usarPreVenda(criarPreVendaEmMemoria());
      await receber(contexto(vendedor1, { parametros: { 'orcamento.validade_dias': 1 } }).ctx, push(id(19), { customer_id: A.clientes.c1, discount_pct: 0, items: itens(), tipo: 'orcamento' }));
      const depois = contexto(vendedor1, { agora: new Date(AGORA.getTime() + 2 * DIA) });
      expect((await receber(depois.ctx, push(id(20), { customer_id: A.clientes.c1, discount_pct: 0, items: itens(), orcamento_origem_id: id(19) })))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-32' });

      await receber(contexto(vendedor1).ctx, push(id(21), { customer_id: A.clientes.c1, discount_pct: 0, items: itens(), tipo: 'orcamento' }));
      expect((await receber(contexto(vendedor2).ctx, push(id(22), { customer_id: A.clientes.c1, discount_pct: 0, items: itens(), orcamento_origem_id: id(21) })))[0]).toMatchObject({ codigo: 'ORCAMENTO_NAO_ENCONTRADO' });
      const clienteB = CADASTRO.cliente.find((c) => c.tenant_id === B.tenantId)!.id as string;
      expect((await receber(contexto(vendedorB).ctx, push(id(23), { customer_id: clienteB, discount_pct: 0, items: itens(), orcamento_origem_id: id(21) })))[0]).toMatchObject({ status: 'rejeitado' });
      expect((await lerPedido(id(23), B.tenantId)).p).toBeUndefined();
      expect((await receber(contexto(promotor).ctx, push(id(24), { customer_id: A.clientes.c1, discount_pct: 0, items: itens(), tipo: 'orcamento' })))[0]).toMatchObject({ codigo: 'RN-PRO-01' });
    });

    it('RN-VEN-32: cancelar orçamento não publica evento de pedido', async () => {
      restaurar = usarPreVenda(criarPreVendaEmMemoria());
      await receber(contexto(vendedor1).ctx, push(id(25), { customer_id: A.clientes.c1, discount_pct: 0, items: itens(), tipo: 'orcamento' }));
      const c = contexto(vendedor1);
      expect(await rotaCancelarPedido.executar({ ...(c.ctx as object), params: { id: id(25) }, corpo: {} } as never)).toEqual({ id: id(25), status: 'cancelled' });
      expect(c.eventos).toEqual([]);
      const det = (await rotaVerPedido.executar({ ...(c.ctx as object), params: { id: id(25) } } as never)) as Record<string, unknown>;
      expect(det).toMatchObject({ situacao_orcamento: 'cancelado' });
    });
  });
});
