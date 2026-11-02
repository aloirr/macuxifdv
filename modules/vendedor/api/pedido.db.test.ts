/**
 * Pedido do Vendedor × Postgres real (fixture dois-tenants, papel macuxi_app, RLS) — T-0029: `receber` do push,
 * aprovar/rejeitar, cancelar, lista, detalhe, alçadas e pull de evento/condições. As consultas entre módulos são
 * simuladas AQUI (cadastro vem da fixture em memória, sem SQL em outro schema; preço vem de um mapa por cliente): o ponta a
 * ponta com `createApp` e as consultas reais é do agente `testes` (onda 3). Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import { comTenant, dadosDoisTenants, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import {
  criarRegistroSync,
  rejeitarItensInvalidos,
  type ClienteBanco,
  type ContextoBase,
  type DefinicaoEvento,
  type ItemPush,
  type ResultadoItemPush,
  type UsuarioAutenticado,
} from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import manifest from '../manifest';
import { ClienteCondicaoSyncSchema, CondicaoPagamentoSyncSchema, OrderDetail, PedidoEventoSyncSchema, PedidoItemSyncSchema, PedidoSyncSchema } from '../contracts';
import { entidadePedido } from '../contracts/entidades';
import { rotaAlcadas, rotaAprovarPedido, rotaCancelarPedido, rotaListarPedidos, rotaRejeitarPedido, rotaVerPedido } from './pedidos';
import { provedoresSyncVendedor } from './sync';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
/** Relógio único do arquivo (T-0042): lido do banco no beforeAll, o mesmo que grava created_at/updated_at. */
let AGORA!: Date;
const id = (n: number) => `0f290000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Cadastro do Core da fixture, em memória (a consulta real é do Core): o teste não faz SQL em schema de outro módulo. */
const CADASTRO = (() => {
  const d = dadosDoisTenants('hash-de-teste');
  return { cliente: d['core.cliente']!, produto: d['core.produto']!, usuario: d['core.usuario']! };
})();
const IDS = Array.from({ length: 60 }, (_, i) => id(i + 1));

const vendedor1: UsuarioAutenticado = { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' };
const vendedor2: UsuarioAutenticado = { id: A.usuarios.vendedor2, tenant_id: A.tenantId, perfil: 'vendedor' };
const supervisor: UsuarioAutenticado = { id: A.usuarios.supervisor, tenant_id: A.tenantId, perfil: 'supervisor' };
const gerente: UsuarioAutenticado = { id: A.usuarios.gerente, tenant_id: A.tenantId, perfil: 'gerente' };
const analista: UsuarioAutenticado = { id: A.usuarios.analista, tenant_id: A.tenantId, perfil: 'analista' };
const promotor: UsuarioAutenticado = { id: A.usuarios.promotor, tenant_id: A.tenantId, perfil: 'promotor' };
const vendedorB: UsuarioAutenticado = { id: B.usuarios.vendedor, tenant_id: B.tenantId, perfil: 'vendedor' };

interface Registro {
  eventos: Array<{ nome: string; payload: Record<string, unknown> }>;
  auditoria: Array<{ acao: string; entidade_id: string | null; antes: unknown; depois: unknown }>;
}

describe.skipIf(semBanco())('Vendedor × Postgres: receber, aprovação, leitura (T-0029)', () => {
  let pool: pg.Pool;
  let prod1 = '';
  let prod2 = '';
  /** preço por cliente (a consulta do Catálogo é simulada); c3 sem tabela */
  const PRECOS = (): Record<string, Record<string, number>> => ({
    [A.clientes.c1]: { [prod1]: 100_000, [prod2]: 50_000 },
    [A.clientes.c2]: { [prod1]: 90_000, [prod2]: 45_000 },
    [A.clientes.c3]: {},
  });

  function contexto(u: UsuarioAutenticado, o: { visiveis?: ReadonlySet<string> | 'tenant'; carteira?: ReadonlySet<string> | 'tenant'; parametros?: Record<string, unknown>; registro?: Registro; fuso?: string } = {}) {
    const registro: Registro = o.registro ?? { eventos: [], auditoria: [] };
    const visiveis = o.visiveis ?? new Set([u.id]);
    const base = {
      usuario: { ...u, modulos: ['core', 'catalogo', 'vendedor'] },
      requestId: 'r-teste',
      agora: () => AGORA,
      fuso: () => o.fuso ?? 'America/Manaus',
      carteira: async () => o.carteira ?? 'tenant',
      usuariosVisiveis: async () => visiveis,
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
                    .filter((l) => ids.includes(l.id as string))
                    .map((l) => Object.fromEntries(campos.map((k) => [k, l[k] ?? null])));
                return CONSULTA_CADASTRO_RESUMO.saida.parse({
                  clientes: pegar('cliente', ent.cliente_ids, ['id', 'razao_social', 'nome_fantasia', 'documento', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'ativo', 'external_id']),
                  produtos: pegar('produto', ent.produto_ids, ['id', 'sku', 'nome', 'unidade', 'ativo', 'external_id']),
                  usuarios: pegar('usuario', ent.usuario_ids, ['id', 'nome', 'perfil', 'external_id']),
                });
              }
              if (def.nome === CONSULTA_PRECOS_CLIENTE.nome) {
                const ent = CONSULTA_PRECOS_CLIENTE.entrada.parse(entrada);
                const tabela = PRECOS()[ent.cliente_id];
                return {
                  tabela_preco_id: tabela && Object.keys(tabela).length > 0 ? id(59) : null,
                  itens: ent.produto_ids.map((p) => ({ produto_id: p, preco_cents: tabela?.[p] ?? null, motivo_sem_preco: tabela?.[p] ? null : 'Sem preço para este cliente.' })),
                };
              }
              throw new Error(`consulta não simulada: ${def.nome}`);
            },
            async publicar(def: DefinicaoEvento, payload: unknown) {
              const v = def.schema.parse(payload) as Record<string, unknown>; // o contrato do evento vale aqui
              registro.eventos.push({ nome: def.nome, payload: v });
              return {};
            },
            async auditar(r: { acao: string; entidade_id: string | null; antes?: unknown; depois?: unknown }) {
              registro.auditoria.push({ acao: r.acao, entidade_id: r.entidade_id, antes: r.antes, depois: r.depois });
            },
            async registrarArquivo() {
              throw new Error('não usado');
            },
          };
          return fn(c as unknown as ClienteBanco, tx);
        }),
    };
    return { ctx: base as unknown as ContextoBase, registro };
  }

  const push = (idPedido: string, payload: Record<string, unknown>): ItemPush =>
    ({ entidade: 'pedido', id: idPedido, operacao: 'upsert', payload: entidadePedido.schema.parse({ id: idPedido, ...payload }) }) as unknown as ItemPush;
  const receber = (c: ContextoBase, ...itens: ItemPush[]): Promise<ResultadoItemPush[]> => provedoresSyncVendedor[0]!.receber!(c, itens);
  const corpo = (c: ContextoBase, extra: object) => ({ ...(c as object), ...extra }) as never;
  const chamar = (rota: { executar: (c: never) => Promise<unknown> }, c: ContextoBase, extra: { params?: object; corpo?: object; query?: object } = {}) =>
    rota.executar(corpo(c, { params: extra.params ?? {}, corpo: extra.corpo ?? {}, query: extra.query ?? { limite: 50 } }));

  const itens = (p1 = 2, p2 = 1) => [
    { product_id: prod1, quantity: p1 },
    { product_id: prod2, quantity: p2 },
  ];
  async function lerPedido(pedidoId: string, tenant = A.tenantId) {
    return comTenant(pool, tenant, async (c) => {
      const p = (await c.query('select * from vendedor.pedido where id = $1', [pedidoId])).rows[0];
      const it = (await c.query('select * from vendedor.pedido_item where pedido_id = $1 order by sequencia', [pedidoId])).rows;
      const ev = (await c.query('select * from vendedor.pedido_evento where pedido_id = $1 order by ocorrido_em, created_at, (de is not null)', [pedidoId])).rows;
      return { p, it, ev };
    });
  }

  /** O papel da aplicação não apaga histórico (pedido_evento é só INSERT): a limpeza do teste usa o papel administrador. */
  async function limpar() {
    const admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    try {
      // T-0054: o retorno do ERP grava pedido_faturamento (0013, FK para o pedido)
      await admin.query('delete from vendedor.pedido_faturamento where pedido_id = any($1::uuid[])', [IDS]);
      await admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [IDS]);
      await admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [IDS]);
      await admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [IDS]);
    } finally {
      await admin.end();
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
    AGORA = new Date((await pool.query<{ agora: Date }>('select now() as agora')).rows[0]!.agora); // hora-fixa-ok: é a linha do tempo única do arquivo
    await limpar();
    prod1 = CADASTRO.produto.find((x) => x.sku === 'ALFA-001' && x.tenant_id === A.tenantId)!.id as string;
    prod2 = CADASTRO.produto.find((x) => x.sku === 'ALFA-002' && x.tenant_id === A.tenantId)!.id as string;
  });
  afterAll(async () => {
    await limpar();
    await pool?.end();
  });

  // ---------- receber ----------
  describe('receber (push do aparelho)', () => {
    it('RN-VEN-10: dentro da alçada (3%) o pedido fica aprovado na hora, com número, retrato, histórico, auditoria e eventos', async () => {
      const { ctx, registro } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]) });
      const [r] = await receber(ctx, push(id(1), { customer_id: A.clientes.c1, discount_pct: 3, items: itens(), total_cents: 1 }));
      expect(r).toMatchObject({ id: id(1), status: 'aceito' });
      expect((r as { em?: string }).em).toBeTruthy();
      const { p, it, ev } = await lerPedido(id(1));
      expect(p).toMatchObject({ status: 'approved', aprovacao_automatica: true, nivel_aprovacao: null, vendedor_id: A.usuarios.vendedor1, autor_id: A.usuarios.vendedor1, cliente_nome: 'Auto Peças Um' });
      expect(p.numero).toMatch(/^\d{6}$/);
      expect(p.hash_envio).toMatch(/^[0-9a-f]{64}$/);
      expect(p.cliente_resumo).toMatchObject({ razao_social: 'Auto Peças Um Ltda' });
      expect(p.vendedor_nome).toBeTruthy();
      // RN-VEN-02: o servidor recalcula (o total_cents=1 do aparelho é ignorado): (2×100000 + 50000) × 0,97
      expect(Number(p.total_tabela_cents)).toBe(250_000);
      expect(Number(p.total_cents)).toBe(242_500);
      expect(it.map((x) => [x.sequencia, x.produto_sku, x.unidade, Number(x.preco_tabela_cents)])).toEqual([[1, 'ALFA-001', 'PC', 100_000], [2, 'ALFA-002', 'PC', 50_000]]);
      expect(ev.map((e) => [e.de, e.para])).toEqual([[null, 'received'], ['received', 'approved']]);
      expect(ev[1].motivo).toMatch(/Dentro da alçada/);
      expect(registro.auditoria).toMatchObject([{ acao: 'pedido.criar', entidade_id: id(1), depois: { status: 'approved' } }]);
      expect(registro.eventos.map((e) => e.nome)).toEqual([
        'vendedor.pedido.criado@1',
        'vendedor.pedido.status_alterado@1',
        'vendedor.pedido.status_alterado@1',
        'vendedor.pedido.aprovado@1',
      ]);
      expect(registro.eventos[2]!.payload).toMatchObject({ de: 'recebido', para: 'aprovado' });
      expect(registro.eventos[3]!.payload).toMatchObject({ pedido_uuid: id(1), total_cents: 242_500 });
      // sem dado pessoal no payload
      expect(JSON.stringify(registro.eventos)).not.toMatch(/Auto Peças|33333333000191/);
    });

    it.each([
      [8, 'supervisor'],
      [12, 'gerente'],
      [20, 'analista'],
    ])('RN-VEN-10: desconto de %s%% vai para aprovação do nível %s', async (pct, nivel) => {
      const pid = id({ 8: 51, 12: 52, 20: 53 }[pct as 8 | 12 | 20]);
      const { ctx, registro } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]) });
      const [r] = await receber(ctx, push(pid, { customer_id: A.clientes.c1, discount_pct: pct, items: itens() }));
      expect(r!.status).toBe('aceito');
      const { p, ev } = await lerPedido(pid);
      expect(p).toMatchObject({ status: 'pending_approval', nivel_aprovacao: nivel, aprovacao_automatica: false, motivos_aprovacao: ['desconto'] });
      expect(ev.map((e) => e.para)).toEqual(['received', 'pending_approval']);
      expect(ev[1].motivo).toMatch(/acima da alçada de 5,0%: aguardando/);
      expect(registro.eventos.map((e) => e.nome)).toContain('vendedor.pedido.aprovacao_solicitada@1');
      expect(registro.eventos.map((e) => e.nome)).not.toContain('vendedor.pedido.aprovado@1');
      expect(registro.eventos.find((e) => e.nome.endsWith('aprovacao_solicitada@1'))!.payload).toMatchObject({ nivel, motivos: ['desconto'], credito: null });
    });

    it('RN-VEN-10: acima do gerente com acima_gerente = bloquear é rejeitado', async () => {
      const { ctx } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]), parametros: { 'alcada.acima_gerente': 'bloquear' } });
      const [r] = await receber(ctx, push(id(2), { customer_id: A.clientes.c1, discount_pct: 20, items: itens() }));
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-10' });
      expect((await lerPedido(id(2))).p).toBeUndefined();
    });

    it('RN-VEN-33: reenvio igual é aceito sem efeito; outro conteúdo = conflito; outro vendedor = ID_EM_USO', async () => {
      const { ctx, registro } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]) });
      const item = push(id(3), { customer_id: A.clientes.c1, discount_pct: 2, items: itens() });
      expect((await receber(ctx, item))[0]!.status).toBe('aceito');
      const antes = registro.eventos.length;
      const numero = (await lerPedido(id(3))).p.numero;
      expect((await receber(ctx, item))[0]!.status).toBe('aceito');
      expect((await receber(ctx, item))[0]!.status).toBe('aceito');
      const depois = await lerPedido(id(3));
      expect(depois.it).toHaveLength(2);
      expect(depois.ev).toHaveLength(2);
      expect(depois.p.numero).toBe(numero);
      expect(registro.eventos).toHaveLength(antes);
      // total informativo diferente não muda o conteúdo (reenvio do mesmo pedido)
      expect((await receber(ctx, push(id(3), { customer_id: A.clientes.c1, discount_pct: 2, items: itens(), total_cents: 77 })))[0]!.status).toBe('aceito');
      const [conf] = await receber(ctx, push(id(3), { customer_id: A.clientes.c1, discount_pct: 2, items: itens(3, 1) }));
      expect(conf).toMatchObject({ status: 'conflito' });
      const outro = contexto(vendedor2, { carteira: new Set([A.clientes.c2, A.clientes.c1]) });
      expect((await receber(outro.ctx, push(id(3), { customer_id: A.clientes.c1, discount_pct: 2, items: itens() })))[0]).toMatchObject({ status: 'rejeitado', codigo: 'ID_EM_USO' });
    });

    it('RN-VEN-33: dois envios simultâneos do mesmo pedido gravam um só', async () => {
      const { ctx } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]) });
      const item = push(id(4), { customer_id: A.clientes.c1, discount_pct: 1, items: itens() });
      const rs = await Promise.all([receber(ctx, item), receber(ctx, item), receber(ctx, item)]);
      expect(rs.every((r) => r[0]!.status === 'aceito')).toBe(true);
      const { it, ev } = await lerPedido(id(4));
      expect(it).toHaveLength(2);
      expect(ev).toHaveLength(2);
    });

    it('RN-CORE-04: cliente fora da carteira é rejeitado (FORA_DA_CARTEIRA) e nada é gravado', async () => {
      const { ctx } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]) });
      const [r] = await receber(ctx, push(id(5), { customer_id: A.clientes.c2, discount_pct: 0, items: itens() }));
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DA_CARTEIRA' });
      expect((await lerPedido(id(5))).p).toBeUndefined();
    });

    it('RN-CAT-06: produto sem preço na tabela do cliente é rejeitado com o SKU', async () => {
      const { ctx } = contexto(vendedor1, { carteira: new Set([A.clientes.c3]) });
      const [r] = await receber(ctx, push(id(6), { customer_id: A.clientes.c3, discount_pct: 0, items: itens() }));
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'RN-CAT-06' });
      expect((r as { mensagem: string }).mensagem).toContain('ALFA-001');
    });

    it('RN-VEN-14: condição de pagamento fora das permitidas ao cliente é rejeitada; padrão e permitida passam', async () => {
      const { avista, d28 } = A.condicoes;
      const { ctx } = contexto(vendedor2, { carteira: new Set([A.clientes.c2]) });
      // c2 não tem lista própria: só a condição padrão (À vista)
      const [ruim] = await receber(ctx, push(id(7), { customer_id: A.clientes.c2, discount_pct: 0, items: itens(), condicao_pagamento_id: d28 }));
      expect(ruim).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-14' });
      expect((await receber(ctx, push(id(8), { customer_id: A.clientes.c2, discount_pct: 0, items: itens(), condicao_pagamento_id: avista })))[0]!.status).toBe('aceito');
      expect((await receber(ctx, push(id(9), { customer_id: A.clientes.c2, discount_pct: 0, items: itens() })))[0]!.status).toBe('aceito');
      expect((await lerPedido(id(9))).p.condicao_pagamento_id).toBe(avista);
      // c1 tem as duas
      const c1 = contexto(vendedor1, { carteira: new Set([A.clientes.c1]) });
      expect((await receber(c1.ctx, push(id(20), { customer_id: A.clientes.c1, discount_pct: 0, items: itens(), condicao_pagamento_id: d28 })))[0]!.status).toBe('aceito');
      expect((await lerPedido(id(20))).p.condicao_pagamento_id).toBe(d28);
    });

    it('RN-PRO-01: promotor é recusado pelo módulo (e pela plataforma, antes dele); supervisor não cria pelo aparelho', async () => {
      const pro = contexto(promotor);
      expect((await receber(pro.ctx, push(id(21), { customer_id: A.clientes.c1, discount_pct: 0, items: itens() })))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-01' });
      const sup = contexto(supervisor);
      expect((await receber(sup.ctx, push(id(22), { customer_id: A.clientes.c1, discount_pct: 0, items: itens() })))[0]).toMatchObject({ status: 'rejeitado', codigo: 'PERFIL_SEM_ACESSO' });
      // a plataforma barra o promotor antes de chegar ao módulo
      const registro = criarRegistroSync([manifest]);
      registro.registrar(entidadePedido);
      const { rejeitados } = rejeitarItensInvalidos({ itens: [{ entidade: 'pedido', id: id(21), operacao: 'upsert', payload: { id: id(21), customer_id: A.clientes.c1, discount_pct: 0, items: itens() } }] } as never, registro, ['core', 'catalogo', 'vendedor'], { perfil: 'promotor' });
      expect(rejeitados[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-01' });
    });

    it('RN-VEN-13/01: cliente ou produto inexistente é rejeitado; remover é RN-VEN-31; id do payload diferente é PAYLOAD_INVALIDO', async () => {
      const { ctx } = contexto(vendedor1);
      expect((await receber(ctx, push(id(23), { customer_id: randomUUID(), discount_pct: 0, items: itens() })))[0]).toMatchObject({ codigo: 'RN-VEN-13' });
      expect((await receber(ctx, push(id(24), { customer_id: A.clientes.c1, discount_pct: 0, items: [{ product_id: randomUUID(), quantity: 1 }] })))[0]).toMatchObject({ codigo: 'RN-VEN-01' });
      expect((await receber(ctx, { ...push(id(25), { customer_id: A.clientes.c1, discount_pct: 0, items: itens() }), operacao: 'remover' } as ItemPush))[0]).toMatchObject({ codigo: 'RN-VEN-31' });
      expect((await receber(ctx, { ...push(id(26), { customer_id: A.clientes.c1, discount_pct: 0, items: itens() }), id: id(27) } as ItemPush))[0]).toMatchObject({ codigo: 'PAYLOAD_INVALIDO' });
      expect((await receber(ctx, push(id(28), { customer_id: A.clientes.c1, discount_pct: 0, items: [{ product_id: 'p1', quantity: 1 }] })))[0]).toMatchObject({ codigo: 'PAYLOAD_INVALIDO' });
    });

    it('RN-CORE-05: o mesmo id em outro tenant não é lido nem sobrescrito (ID_EM_USO)', async () => {
      const { ctx } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]) });
      expect((await receber(ctx, push(id(29), { customer_id: A.clientes.c1, discount_pct: 0, items: itens() })))[0]!.status).toBe('aceito');
      const b = contexto(vendedorB);
      const [r] = await receber(b.ctx, push(id(29), { customer_id: B.clientes.c1, discount_pct: 0, items: itens() }));
      expect(r!.status).toBe('rejeitado');
      expect((await lerPedido(id(29), B.tenantId)).p).toBeUndefined();
    });
  });

  // ---------- aprovar / rejeitar ----------
  describe('aprovar e rejeitar (RN-GES-04, RN-GES-08, P-3)', () => {
    const equipe1 = new Set([A.usuarios.supervisor, A.usuarios.vendedor1]);
    const gestao = new Set([A.usuarios.gerente, A.usuarios.supervisor, A.usuarios.vendedor1, A.usuarios.vendedor2]);

    async function pendente(pid: string, pct: number) {
      const { ctx } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]) });
      expect((await receber(ctx, push(pid, { customer_id: A.clientes.c1, discount_pct: pct, items: itens() })))[0]!.status).toBe('aceito');
    }

    it('RN-GES-08: a supervisora aprova sem corpo (1 toque); histórico, auditoria e eventos; repetir é idempotente', async () => {
      await pendente(id(30), 8);
      const s = contexto(supervisor, { visiveis: equipe1 });
      const d = OrderDetail.parse(await chamar(rotaAprovarPedido, s.ctx, { params: { id: id(30) } }));
      expect(d).toMatchObject({ status: 'approved', aprovacao: { nivel: 'supervisor', pode_decidir: false } });
      expect(d.history.map((h) => h.status)).toEqual(['received', 'pending_approval', 'approved']);
      expect(d.history[2]!.by).toBeTruthy();
      expect(s.registro.auditoria).toMatchObject([{ acao: 'pedido.aprovar', entidade_id: id(30), antes: { status: 'pending_approval' }, depois: { status: 'approved' } }]);
      expect(s.registro.eventos.map((e) => e.nome)).toEqual(['vendedor.pedido.status_alterado@1', 'vendedor.pedido.aprovado@1']);
      expect(s.registro.eventos[0]!.payload).toMatchObject({ de: 'em_aprovacao', para: 'aprovado', autor_id: A.usuarios.supervisor });
      const { p } = await lerPedido(id(30));
      expect(p).toMatchObject({ status: 'approved', decidido_por_id: A.usuarios.supervisor });
      // repetida: 200 com o estado atual, sem novo evento
      const de_novo = await chamar(rotaAprovarPedido, s.ctx, { params: { id: id(30) } });
      expect((de_novo as { status: string }).status).toBe('approved');
      expect(s.registro.eventos).toHaveLength(2);
    });

    it('RN-VEN-10 / P-3: supervisora não decide nível gerente (422); o gerente aprova (acima_do_nivel = false)', async () => {
      await pendente(id(31), 12);
      const s = contexto(supervisor, { visiveis: equipe1 });
      await expect(chamar(rotaAprovarPedido, s.ctx, { params: { id: id(31) } })).rejects.toMatchObject({ status: 422, codigo: 'RN-VEN-10' });
      const g = contexto(gerente, { visiveis: gestao });
      const d = await chamar(rotaAprovarPedido, g.ctx, { params: { id: id(31) }, corpo: { comentario: 'ok' } });
      expect(d).toMatchObject({ status: 'approved' });
      const ev = (await lerPedido(id(31))).ev;
      expect(ev[ev.length - 1]).toMatchObject({ autor_perfil: 'gerente', acima_do_nivel: false, nivel: 'gerente', motivo: 'ok' });
    });

    it('RN-GES-04: o gerente aprova pedido de nível supervisor e fica registrado acima_do_nivel = true', async () => {
      await pendente(id(32), 7);
      const g = contexto(gerente, { visiveis: gestao });
      const d = (await chamar(rotaAprovarPedido, g.ctx, { params: { id: id(32) } })) as { history: Array<{ note: string }> };
      expect(d.history.at(-1)!.note).toMatch(/nível do supervisor/);
      expect((await lerPedido(id(32))).ev.at(-1)).toMatchObject({ acima_do_nivel: true });
    });

    it('P-3: o analista decide só o nível analista; nível supervisor ou gerente = 422', async () => {
      await pendente(id(33), 20);
      await pendente(id(34), 7);
      const a = contexto(analista, { visiveis: 'tenant' });
      await expect(chamar(rotaAprovarPedido, a.ctx, { params: { id: id(34) } })).rejects.toMatchObject({ status: 422, codigo: 'RN-VEN-10' });
      expect(await chamar(rotaAprovarPedido, a.ctx, { params: { id: id(33) } })).toMatchObject({ status: 'approved' });
    });

    it('RN-GES-08: rejeitar sem motivo (ou com menos de 3 caracteres) = 422; com motivo rejeita; aprovar depois = 422 RN-VEN-30', async () => {
      await pendente(id(35), 8);
      const s = contexto(supervisor, { visiveis: equipe1 });
      await expect(chamar(rotaRejeitarPedido, s.ctx, { params: { id: id(35) }, corpo: { motivo: '' } })).rejects.toMatchObject({ status: 422, codigo: 'RN-GES-08' });
      await expect(chamar(rotaRejeitarPedido, s.ctx, { params: { id: id(35) }, corpo: { motivo: ' a ' } })).rejects.toMatchObject({ codigo: 'RN-GES-08' });
      expect((await lerPedido(id(35))).p.status).toBe('pending_approval');
      const d = await chamar(rotaRejeitarPedido, s.ctx, { params: { id: id(35) }, corpo: { motivo: 'Desconto alto para este cliente' } });
      expect(d).toMatchObject({ status: 'rejected', rejection_reason: 'Desconto alto para este cliente' });
      expect((await lerPedido(id(35))).p).toMatchObject({ status: 'rejected', motivo_rejeicao: 'Desconto alto para este cliente' });
      await expect(chamar(rotaAprovarPedido, s.ctx, { params: { id: id(35) } })).rejects.toMatchObject({ status: 422, codigo: 'RN-VEN-30' });
      expect(s.registro.eventos.map((e) => e.nome)).not.toContain('vendedor.pedido.aprovado@1');
    });

    it('RN-CORE-04: fora da equipe é 404 (não revela existência); outro tenant também', async () => {
      await pendente(id(36), 8);
      const outra = contexto(supervisor, { visiveis: new Set([A.usuarios.supervisor, A.usuarios.vendedor2]) });
      await expect(chamar(rotaAprovarPedido, outra.ctx, { params: { id: id(36) } })).rejects.toMatchObject({ status: 404, codigo: 'PEDIDO_NAO_ENCONTRADO' });
      await expect(chamar(rotaVerPedido, outra.ctx, { params: { id: id(36) } })).rejects.toMatchObject({ status: 404 });
      const b = contexto({ ...analista, id: B.usuarios.admin, tenant_id: B.tenantId }, { visiveis: 'tenant' });
      await expect(chamar(rotaVerPedido, b.ctx, { params: { id: id(36) } })).rejects.toMatchObject({ status: 404 });
      expect((await lerPedido(id(36))).p.status).toBe('pending_approval');
    });

    it('duas decisões ao mesmo tempo: uma vale e a outra repete (sem duplicar histórico)', async () => {
      await pendente(id(37), 8);
      const mk = () => contexto(supervisor, { visiveis: equipe1 });
      const rs = await Promise.all([1, 2, 3].map(() => chamar(rotaAprovarPedido, mk().ctx, { params: { id: id(37) } })));
      expect(rs.every((r) => (r as { status: string }).status === 'approved')).toBe(true);
      expect((await lerPedido(id(37))).ev.filter((e) => e.para === 'approved')).toHaveLength(1);
    });
  });

  // ---------- cancelar ----------
  describe('cancelar (doc 03 §4)', () => {
    it('RN-VEN-CANCELAR-APOS-ENVIO: aprovado ainda cancela, com histórico e evento; enviado ao ERP não', async () => {
      const { ctx } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]) });
      await receber(ctx, push(id(40), { customer_id: A.clientes.c1, discount_pct: 1, items: itens() }));
      const c = contexto(vendedor1);
      expect(await chamar(rotaCancelarPedido, c.ctx, { params: { id: id(40) }, corpo: { motivo: 'Cliente desistiu' } })).toEqual({ id: id(40), status: 'cancelled' });
      expect((await lerPedido(id(40))).p).toMatchObject({ status: 'cancelled', motivo_cancelamento: 'Cliente desistiu' });
      expect(c.registro.eventos[0]!.payload).toMatchObject({ de: 'aprovado', para: 'cancelado' });
      await receber(ctx, push(id(41), { customer_id: A.clientes.c1, discount_pct: 1, items: itens() }));
      await comTenant(pool, A.tenantId, (cl) => cl.query("update vendedor.pedido set status = 'sent_to_erp' where id = $1", [id(41)]));
      await expect(chamar(rotaCancelarPedido, contexto(vendedor1).ctx, { params: { id: id(41) } })).rejects.toMatchObject({ status: 422, codigo: 'RN-VEN-CANCELAR-APOS-ENVIO' });
    });
  });

  // ---------- leitura ----------
  describe('lista, detalhe e alçadas', () => {
    it('escopo: vendedor vê só os próprios; vendedor2 não vê o do vendedor1 (404); analista vê o tenant; promotor só a carteira', async () => {
      const v1 = contexto(vendedor1);
      const lista = (await chamar(rotaListarPedidos, v1.ctx)) as { itens: Array<{ id: string; seller_id: string }> };
      expect(lista.itens.length).toBeGreaterThan(0);
      expect(lista.itens.every((o) => o.seller_id === A.usuarios.vendedor1)).toBe(true);
      const v2 = contexto(vendedor2);
      const l2 = (await chamar(rotaListarPedidos, v2.ctx, { query: { limite: 200 } })) as { itens: Array<{ id: string }> };
      expect(l2.itens.map((o) => o.id)).not.toContain(id(1));
      await expect(chamar(rotaVerPedido, v2.ctx, { params: { id: id(1) } })).rejects.toMatchObject({ status: 404, codigo: 'PEDIDO_NAO_ENCONTRADO' });
      const an = contexto(analista, { visiveis: 'tenant' });
      const la = (await chamar(rotaListarPedidos, an.ctx, { query: { limite: 200 } })) as { itens: Array<{ id: string }> };
      expect(la.itens.map((o) => o.id)).toContain(id(1));
      const pro = contexto(promotor, { carteira: new Set([A.clientes.c2]) });
      const lp = (await chamar(rotaListarPedidos, pro.ctx, { query: { limite: 200 } })) as { itens: Array<{ customer_id: string }> };
      expect(lp.itens.every((o) => o.customer_id === A.clientes.c2)).toBe(true);
      await expect(chamar(rotaVerPedido, pro.ctx, { params: { id: id(1) } })).rejects.toMatchObject({ status: 404 });
    });

    it('filtros: status, busca por cliente ou número, vendedor e período (fuso do tenant); cursor sem repetir', async () => {
      const an = contexto(analista, { visiveis: 'tenant' });
      const pend = (await chamar(rotaListarPedidos, an.ctx, { query: { status: 'pending_approval', limite: 200 } })) as { itens: Array<{ status: string; id: string }> };
      expect(pend.itens.length).toBeGreaterThan(0);
      expect(pend.itens.every((o) => o.status === 'pending_approval')).toBe(true);
      const numero = (await lerPedido(id(1))).p.numero as string;
      const porNumero = (await chamar(rotaListarPedidos, an.ctx, { query: { q: numero, limite: 50 } })) as { itens: Array<{ id: string; number: string }> };
      expect(porNumero.itens.map((o) => o.number)).toContain(numero);
      const porCliente = (await chamar(rotaListarPedidos, an.ctx, { query: { q: 'peças um', limite: 200 } })) as { itens: Array<{ customer_name: string }> };
      expect(porCliente.itens.every((o) => /Um/.test(o.customer_name))).toBe(true);
      const vazio = (await chamar(rotaListarPedidos, an.ctx, { query: { seller_id: A.usuarios.promotor, limite: 50 } })) as { itens: unknown[] };
      expect(vazio.itens).toEqual([]);
      const futuro = (await chamar(rotaListarPedidos, an.ctx, { query: { from: '2999-01-01', limite: 50 } })) as { itens: unknown[] };
      expect(futuro.itens).toEqual([]);
      // paginação por cursor
      const vistos = new Set<string>();
      let cursor: string | undefined;
      for (let i = 0; i < 100; i++) {
        const pg1 = (await chamar(rotaListarPedidos, an.ctx, { query: { limite: 5, ...(cursor ? { cursor } : {}) } })) as { itens: Array<{ id: string }>; proximo_cursor: string | null };
        for (const o of pg1.itens) {
          expect(vistos.has(o.id)).toBe(false);
          vistos.add(o.id);
        }
        if (!pg1.proximo_cursor) break;
        cursor = pg1.proximo_cursor;
      }
      expect(vistos.size).toBeGreaterThan(5);
      await expect(chamar(rotaListarPedidos, an.ctx, { query: { cursor: 'lixo', limite: 5 } })).rejects.toMatchObject({ codigo: 'CURSOR_INVALIDO' });
    });

    it('período usa o fuso do tenant: 23:59 e 00:01 de Manaus caem em dias diferentes; em São Paulo os dois caem no mesmo dia', async () => {
      const a = id(54);
      const b = id(55);
      const { ctx } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]) });
      await receber(ctx, push(a, { customer_id: A.clientes.c1, discount_pct: 1, items: itens() }));
      await receber(ctx, push(b, { customer_id: A.clientes.c1, discount_pct: 1, items: itens() }));
      const admin = new pg.Client({ connectionString: banco().urlAdmin });
      await admin.connect();
      try {
        // 2026-10-31 23:59 e 2026-11-01 00:01 em Manaus (UTC-4)
        await admin.query('update vendedor.pedido set created_at = $2 where id = $1', [a, '2026-11-01T03:59:00Z']); // hora-fixa-ok: instantes escolhidos para provar a virada do dia, nunca comparados com o relógio
        await admin.query('update vendedor.pedido set created_at = $2 where id = $1', [b, '2026-11-01T04:01:00Z']); // hora-fixa-ok: idem (00:01 em Manaus)
      } finally {
        await admin.end();
      }
      const ids = async (fuso: string, de: string, ate: string) => {
        const an = contexto(analista, { visiveis: 'tenant', fuso });
        const l = (await chamar(rotaListarPedidos, an.ctx, { query: { from: de, to: ate, limite: 200 } })) as { itens: Array<{ id: string }> };
        return l.itens.map((o) => o.id).filter((x) => x === a || x === b);
      };
      expect(await ids('America/Manaus', '2026-11-01', '2026-11-01')).toEqual([b]);
      expect(await ids('America/Manaus', '2026-10-31', '2026-10-31')).toEqual([a]);
      expect((await ids('America/Sao_Paulo', '2026-11-01', '2026-11-01')).sort()).toEqual([a, b].sort());
      expect(await ids('America/Sao_Paulo', '2026-10-31', '2026-10-31')).toEqual([]);
    });

    it('detalhe: itens, histórico, retrato do cliente e aprovação com pode_decidir por perfil; passa no contrato OrderDetail', async () => {
      const pid = id(50);
      const { ctx } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]) });
      await receber(ctx, push(pid, { customer_id: A.clientes.c1, discount_pct: 8, items: itens(), observacao: 'Entregar pela manhã' }));
      const sup = contexto(supervisor, { visiveis: new Set([A.usuarios.supervisor, A.usuarios.vendedor1]) });
      const d = OrderDetail.parse(await chamar(rotaVerPedido, sup.ctx, { params: { id: pid } }));
      expect(d.items).toHaveLength(2);
      expect(d.items[0]).toMatchObject({ erp_code: 'ALFA-001', description: 'Pastilha de freio dianteira', unit_price_cents: 100_000 });
      expect(d.cliente).toMatchObject({ razao_social: 'Auto Peças Um Ltda' });
      expect(d.aprovacao).toMatchObject({ nivel: 'supervisor', pode_decidir: true, limite_vendedor_pct: 5, desconto_efetivo_pct: 8 });
      expect(d.pending_reason).toBe('Desconto de 8,0% acima da alçada de 5,0%: aguardando supervisor');
      expect(d.subtotal_cents).toBe(250_000);
      expect(d.discount_cents).toBe(20_000);
      expect(d.erp_order_code).toBe('');
      const g = contexto(analista, { visiveis: 'tenant' });
      expect(((await chamar(rotaVerPedido, g.ctx, { params: { id: pid } })) as OrderDetail).aprovacao!.pode_decidir).toBe(false);
    });

    it('alçadas: devolve a política dos parâmetros do tenant (padrão 5/10/15 e analista)', async () => {
      const pol = await chamar(rotaAlcadas, contexto(analista).ctx);
      expect(pol).toEqual({ seller_pct: 5, supervisor_pct: 10, manager_pct: 15, above_manager: 'director', exceptions: [] });
      const custom = await chamar(rotaAlcadas, contexto(analista, { parametros: { 'alcada.vendedor_pct': 3, 'alcada.acima_gerente': 'bloquear' } }).ctx);
      expect(custom).toMatchObject({ seller_pct: 3, above_manager: 'block' });
    });
  });

  // ---------- pull ----------
  describe('pull das entidades novas', () => {
    // uma linha do tempo só: AGORA (relógio do banco no beforeAll) vale para o ctx e para created_at/updated_at
    const pedidoPull = () => ({ desde: null, ate: new Date(AGORA.getTime() + 3_600_000).toISOString(), limite: 1000 });
    const prov = (nome: string) => provedoresSyncVendedor.find((p) => p.entidade.nome === nome)!;

    it('pedido, pedido_item e pedido_evento trazem as colunas novas e passam nos schemas do contrato', async () => {
      const { ctx } = contexto(supervisor, { visiveis: new Set([A.usuarios.supervisor, A.usuarios.vendedor1]), carteira: 'tenant' });
      const peds = await prov('pedido').puxar!(ctx, pedidoPull());
      const meu = peds.find((l) => l.id === id(1));
      expect(meu).toBeTruthy();
      for (const l of peds) PedidoSyncSchema.parse(l);
      expect(PedidoSyncSchema.parse(meu)).toMatchObject({ status: 'approved', aprovacao_automatica: true, vendedor_nome: expect.any(String) });
      const its = await prov('pedido_item').puxar!(ctx, pedidoPull());
      for (const l of its) PedidoItemSyncSchema.parse(l);
      expect(its.filter((l) => (l as { pedido_id?: string }).pedido_id === id(1))).toHaveLength(2);
      const evs = await prov('pedido_evento').puxar!(ctx, pedidoPull());
      for (const l of evs) PedidoEventoSyncSchema.parse(l);
      expect(evs.filter((l) => (l as { pedido_id?: string }).pedido_id === id(1)).map((l) => (l as { para?: string }).para).sort()).toEqual(['approved', 'received']);
    });

    it('RN-CORE-04: o pull de evento segue o escopo do pedido (vendedor2 não recebe o histórico do vendedor1)', async () => {
      const { ctx } = contexto(vendedor2, { carteira: new Set([A.clientes.c2]) });
      const evs = await prov('pedido_evento').puxar!(ctx, pedidoPull());
      expect(evs.some((l) => (l as { pedido_id?: string }).pedido_id === id(1))).toBe(false);
    });

    it('condicao_pagamento (tenant) e cliente_condicao (carteira) passam nos schemas e respeitam o tenant e a carteira', async () => {
      const { ctx } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]) });
      const conds = await prov('condicao_pagamento').puxar!(ctx, pedidoPull());
      for (const l of conds) CondicaoPagamentoSyncSchema.parse(l);
      expect(conds.map((l) => l.id)).toEqual(expect.arrayContaining([A.condicoes.avista, A.condicoes.d28]));
      const cc = await prov('cliente_condicao').puxar!(ctx, pedidoPull());
      for (const l of cc) ClienteCondicaoSyncSchema.parse(l);
      expect(cc.every((l) => (l as { cliente_id?: string }).cliente_id === A.clientes.c1)).toBe(true);
      expect(cc.length).toBeGreaterThan(0);
      const { ctx: b } = contexto(vendedorB, { carteira: 'tenant' });
      const condsB = await prov('condicao_pagamento').puxar!(b, pedidoPull());
      expect(condsB.map((l) => l.id)).not.toContain(A.condicoes.avista);
    });
  });
});

