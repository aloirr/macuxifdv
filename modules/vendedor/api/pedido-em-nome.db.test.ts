/**
 * Pedido em nome do vendedor × Postgres real (RF-GES-05, RN-VEN-35): o push do supervisor/gerente grava `vendedor_id` = vendedor e
 * `autor_id` = gestor, na alçada do gestor, e o pedido aparece para o vendedor (pull) e na meta dele (consulta `vendedor.pedidos_da_meta@1`).
 * Cadastro e preço simulados em memória (como em `pedido.db.test.ts`); roda no CI (pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha).
 */
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { CONSULTA_CADASTRO_RESUMO, CONSULTA_FILIAIS } from '@macuxi/core/contracts';
import { comTenant, dadosDoisTenants, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco, ContextoBase, DefinicaoEvento, ItemPush, ResultadoItemPush, UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entidadePedido } from '../contracts/entidades';
import { responderFiliais } from './filial-simulada';
import { escopoDoPedido } from './sync';
import { provedoresSyncVendedor } from './sync';

const A = DOIS_TENANTS.A;
let AGORA!: Date;
const id = (n: number) => `0f350000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CADASTRO = (() => {
  const d = dadosDoisTenants('hash-de-teste');
  return { cliente: d['core.cliente']!, produto: d['core.produto']!, usuario: d['core.usuario']! };
})();
const IDS = Array.from({ length: 10 }, (_, i) => id(i + 1));

const vendedor1: UsuarioAutenticado = { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' };
const supervisor: UsuarioAutenticado = { id: A.usuarios.supervisor, tenant_id: A.tenantId, perfil: 'supervisor' };
const gerente: UsuarioAutenticado = { id: A.usuarios.gerente, tenant_id: A.tenantId, perfil: 'gerente' };
const promotor: UsuarioAutenticado = { id: A.usuarios.promotor, tenant_id: A.tenantId, perfil: 'promotor' };

interface Registro {
  eventos: Array<{ nome: string; payload: Record<string, unknown> }>;
  auditoria: Array<{ acao: string; entidade_id: string | null; depois: unknown }>;
}

describe.skipIf(semBanco())('Pedido em nome do vendedor × Postgres (RF-GES-05, RN-VEN-35)', () => {
  let pool: pg.Pool;
  let prod1 = '';

  function contexto(u: UsuarioAutenticado, visiveis: ReadonlySet<string> | 'tenant') {
    const registro: Registro = { eventos: [], auditoria: [] };
    const base = {
      usuario: { ...u, modulos: ['core', 'catalogo', 'vendedor'] },
      requestId: 'r-teste',
      agora: () => AGORA,
      fuso: () => 'America/Manaus',
      carteira: async () => 'tenant' as const,
      usuariosVisiveis: async () => visiveis,
      parametros: () => ({}),
      log: { info() {}, warn() {}, error() {} },
      comTenant: <T>(fn: (db: ClienteBanco, tx: unknown) => Promise<T>) =>
        comTenant(pool, u.tenant_id, (c) => {
          const tx = {
            async consultar(def: { nome: string }, entrada: Record<string, unknown>) {
              if (def.nome === CONSULTA_FILIAIS.nome) return responderFiliais(entrada);
              if (def.nome === CONSULTA_CADASTRO_RESUMO.nome) {
                const ent = CONSULTA_CADASTRO_RESUMO.entrada.parse(entrada);
                const pegar = (tabela: 'cliente' | 'produto' | 'usuario', ids: string[], campos: string[]) =>
                  CADASTRO[tabela].filter((l) => ids.includes(l.id as string)).map((l) => Object.fromEntries(campos.map((k) => [k, l[k] ?? null])));
                return CONSULTA_CADASTRO_RESUMO.saida.parse({
                  clientes: pegar('cliente', ent.cliente_ids, ['id', 'razao_social', 'nome_fantasia', 'documento', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'ativo', 'external_id']),
                  produtos: pegar('produto', ent.produto_ids, ['id', 'sku', 'nome', 'unidade', 'ativo', 'external_id']),
                  usuarios: pegar('usuario', ent.usuario_ids, ['id', 'nome', 'perfil', 'external_id']),
                });
              }
              if (def.nome === CONSULTA_PRECOS_CLIENTE.nome) {
                const ent = CONSULTA_PRECOS_CLIENTE.entrada.parse(entrada);
                return { tabela_preco_id: id(59), itens: ent.produto_ids.map((p) => ({ produto_id: p, preco_cents: 100_000, motivo_sem_preco: null })) };
              }
              if (def.nome === 'catalogo.estoque_filial@1') return { itens: [] }; // Catálogo sem saldo: estoque não controlado
              throw new Error(`consulta não simulada: ${def.nome}`);
            },
            async publicar(def: DefinicaoEvento, payload: unknown) {
              registro.eventos.push({ nome: def.nome, payload: def.schema.parse(payload) as Record<string, unknown> });
              return {};
            },
            async auditar(r: { acao: string; entidade_id: string | null; depois?: unknown }) {
              registro.auditoria.push({ acao: r.acao, entidade_id: r.entidade_id, depois: r.depois });
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
  const itens = () => [{ product_id: prod1, quantity: 2 }];
  const lerPedido = (pedidoId: string) => comTenant(pool, A.tenantId, async (c) => (await c.query('select * from vendedor.pedido where id = $1', [pedidoId])).rows[0]);

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
  });
  afterAll(async () => {
    await limpar();
    await pool?.end();
  });

  it('RN-VEN-35: supervisor grava o pedido com vendedor_id = vendedor e autor_id = supervisor; histórico e auditoria guardam o autor', async () => {
    const { ctx, registro } = contexto(supervisor, new Set([supervisor.id, vendedor1.id]));
    const [r] = await receber(ctx, push(id(1), { customer_id: A.clientes.c1, discount_pct: 8, items: itens(), vendedor_id: vendedor1.id }));
    expect(r).toMatchObject({ id: id(1), status: 'aceito' });
    const p = await lerPedido(id(1));
    // RN-VEN-10: 8% está na alçada do supervisor (10%); o vendedor (5%) mandaria para aprovação
    expect(p).toMatchObject({ vendedor_id: vendedor1.id, autor_id: supervisor.id, status: 'approved' });
    const ev = await comTenant(pool, A.tenantId, async (c) => (await c.query('select autor_id, autor_perfil from vendedor.pedido_evento where pedido_id = $1', [id(1)])).rows);
    expect(ev.every((e) => e.autor_id === supervisor.id && e.autor_perfil === 'supervisor')).toBe(true);
    expect(registro.auditoria[0]).toMatchObject({ acao: 'pedido.criar', entidade_id: id(1), depois: expect.objectContaining({ em_nome: true, vendedor_id: vendedor1.id, autor_id: supervisor.id }) });
    expect(registro.eventos.find((e) => e.nome === 'vendedor.pedido.criado@1')!.payload).toMatchObject({ vendedor_id: vendedor1.id, autor_id: supervisor.id });
  });

  it('RN-CORE-21: o pedido conta para o vendedor (consulta da meta) e ele o recebe no pull; o gestor também vê', async () => {
    const dono = escopoDoPedido('vendedor', new Set([vendedor1.id]), 'tenant');
    expect(dono.vendedores).toEqual([vendedor1.id]);
    const linhas = await comTenant(pool, A.tenantId, async (c) =>
      (await c.query('select vendedor_id, autor_id from vendedor.pedido where id = $1 and vendedor_id = any($2::uuid[])', [id(1), dono.vendedores])).rows,
    );
    expect(linhas).toEqual([{ vendedor_id: vendedor1.id, autor_id: supervisor.id }]);
    const gestor = escopoDoPedido('supervisor', new Set([supervisor.id, vendedor1.id]), 'tenant');
    expect(gestor.vendedores).toContain(vendedor1.id);
  });

  it('RN-VEN-35: 12% passa da alçada do supervisor e vai ao gerente; o gerente em nome usa a dele (12% direto)', async () => {
    const s = contexto(supervisor, new Set([supervisor.id, vendedor1.id]));
    await receber(s.ctx, push(id(2), { customer_id: A.clientes.c1, discount_pct: 12, items: itens(), vendedor_id: vendedor1.id }));
    expect(await lerPedido(id(2))).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'gerente', autor_id: supervisor.id });
    const g = contexto(gerente, new Set([gerente.id, supervisor.id, vendedor1.id]));
    await receber(g.ctx, push(id(3), { customer_id: A.clientes.c1, discount_pct: 12, items: itens(), vendedor_id: vendedor1.id }));
    expect(await lerPedido(id(3))).toMatchObject({ status: 'approved', autor_id: gerente.id, vendedor_id: vendedor1.id });
  });

  it('RN-VEN-35: vendedor de outra equipe ou área é recusado e nada é gravado', async () => {
    const { ctx } = contexto(supervisor, new Set([supervisor.id])); // vendedor1 fora da equipe
    const [r] = await receber(ctx, push(id(4), { customer_id: A.clientes.c1, discount_pct: 0, items: itens(), vendedor_id: vendedor1.id }));
    expect(r).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DA_EQUIPE' });
    expect(await lerPedido(id(4))).toBeUndefined();
  });

  it('RN-PRO-01: o promotor nunca cria pedido, nem em nome de vendedor', async () => {
    const { ctx } = contexto(promotor, 'tenant');
    const [r] = await receber(ctx, push(id(5), { customer_id: A.clientes.c1, discount_pct: 0, items: itens(), vendedor_id: vendedor1.id }));
    expect(r).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-01' });
    expect(await lerPedido(id(5))).toBeUndefined();
  });

  it('RN-VEN-33: o mesmo id reenviado pelo mesmo gestor é idempotente (um só pedido)', async () => {
    const { ctx } = contexto(supervisor, new Set([supervisor.id, vendedor1.id]));
    const item = push(id(6), { customer_id: A.clientes.c1, discount_pct: 0, items: itens(), vendedor_id: vendedor1.id });
    expect((await receber(ctx, item))[0]).toMatchObject({ status: 'aceito' });
    expect((await receber(ctx, item))[0]).toMatchObject({ status: 'aceito' });
    const n = await comTenant(pool, A.tenantId, async (c) => (await c.query('select count(*)::int as n from vendedor.pedido where id = $1', [id(6)])).rows[0].n);
    expect(n).toBe(1);
  });
});
