/**
 * Retrato do percentual do prazo no pedido × Postgres real (RN-VEN-45, 0082): o INSERT do `receber` grava
 * `prazo_percentual_ajuste` NULL sem prazo (condição legada, RN-VEN-14) e o percentual com prazo, sem violar o CHECK
 * `pedido_prazo_percentual_com_prazo`. Consultas entre módulos simuladas como em `pedido.db.test.ts`. Pula sem Postgres.
 */
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { CONSULTA_CADASTRO_RESUMO, CONSULTA_FILIAIS } from '@macuxi/core/contracts';
import { comTenant, dadosDoisTenants, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco, ContextoBase, ItemPush, UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entidadePedido } from '../contracts/entidades';
import { responderFiliais } from './filial-simulada';
import { provedoresSyncVendedor } from './sync';

const A = DOIS_TENANTS.A;
const id = (n: number) => `0f2a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PEDIDOS = [id(1), id(2)];
const FORMA = id(10);
const PRAZO = id(11);
const CADASTRO = (() => {
  const d = dadosDoisTenants('hash-de-teste');
  return { cliente: d['core.cliente']!, produto: d['core.produto']!, usuario: d['core.usuario']! };
})();
const vendedor1: UsuarioAutenticado = { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' };

describe.skipIf(semBanco())('Vendedor × Postgres: retrato do percentual do prazo (RN-VEN-45)', () => {
  let pool: pg.Pool;
  let agora!: Date;
  let prod1 = '';

  const contexto = () =>
    ({
      usuario: { ...vendedor1, modulos: ['core', 'catalogo', 'vendedor'] },
      requestId: 'r-teste',
      agora: () => agora,
      fuso: () => 'America/Manaus',
      carteira: async () => 'tenant',
      usuariosVisiveis: async () => new Set([vendedor1.id]),
      parametros: () => ({}),
      log: { info() {}, warn() {}, error() {} },
      comTenant: <T>(fn: (db: ClienteBanco, tx: unknown) => Promise<T>) =>
        comTenant(pool, A.tenantId, (c) => {
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
              if (def.nome === 'catalogo.estoque_filial@1') return { itens: [] };
              throw new Error(`consulta não simulada: ${def.nome}`);
            },
            async publicar() {
              return {};
            },
            async auditar() {},
            async registrarArquivo() {
              throw new Error('não usado');
            },
          };
          return fn(c as unknown as ClienteBanco, tx);
        }),
    }) as unknown as ContextoBase;

  const push = (pedidoId: string, extra: Record<string, unknown>): ItemPush =>
    ({ entidade: 'pedido', id: pedidoId, operacao: 'upsert', payload: entidadePedido.schema.parse({ id: pedidoId, customer_id: A.clientes.c1, discount_pct: 0, items: [{ product_id: prod1, quantity: 1 }], total_cents: 1, ...extra }) }) as unknown as ItemPush;
  const lerPercentual = (pedidoId: string) =>
    comTenant(pool, A.tenantId, async (c) => (await c.query('select prazo_pagamento_id, prazo_percentual_ajuste::float8 as pct from vendedor.pedido where id = $1', [pedidoId])).rows[0] as { prazo_pagamento_id: string | null; pct: number | null });

  async function limpar() {
    const admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    try {
      await admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [PEDIDOS]);
      await admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [PEDIDOS]);
      await admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [PEDIDOS]);
      await admin.query('delete from vendedor.prazo_pagamento where id = $1', [PRAZO]);
      await admin.query('delete from vendedor.forma_pagamento where id = $1', [FORMA]);
    } finally {
      await admin.end();
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    agora = new Date((await pool.query<{ agora: Date }>('select now() as agora')).rows[0]!.agora); // hora-fixa-ok: relógio único do arquivo
    prod1 = CADASTRO.produto.find((x) => x.sku === 'ALFA-001' && x.tenant_id === A.tenantId)!.id as string;
    await limpar();
    const admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    try {
      await admin.query("insert into vendedor.forma_pagamento (id, tenant_id, codigo, nome) values ($1, $2, 'PCT', 'Pix teste')", [FORMA, A.tenantId]);
      await admin.query(
        "insert into vendedor.prazo_pagamento (id, tenant_id, forma_pagamento_id, codigo, descricao, parcelas_dias, prazo_medio_dias, percentual_ajuste) values ($1, $2, $3, 'PCT-AV', 'À vista', '{0}', 0, -1.71)",
        [PRAZO, A.tenantId, FORMA],
      );
    } finally {
      await admin.end();
    }
  });
  afterAll(async () => {
    await limpar();
    await pool?.end();
  });

  const receber = (...itens: ItemPush[]) => provedoresSyncVendedor[0]!.receber!(contexto(), itens);

  it('RN-VEN-45: pedido sem prazo (condição legada) grava prazo_percentual_ajuste NULL e não viola o CHECK da 0082', async () => {
    const [r] = await receber(push(id(1), {}));
    expect(r).toMatchObject({ id: id(1), status: 'aceito' });
    expect(await lerPercentual(id(1))).toEqual({ prazo_pagamento_id: null, pct: null });
  });

  it('RN-VEN-45: pedido com prazo grava o percentual congelado junto do prazo', async () => {
    const [r] = await receber(push(id(2), { forma_pagamento_id: FORMA, prazo_pagamento_id: PRAZO, prazo_percentual_ajuste: -1.71 }));
    expect(r).toMatchObject({ id: id(2), status: 'aceito' });
    expect(await lerPercentual(id(2))).toEqual({ prazo_pagamento_id: PRAZO, pct: -1.71 });
  });
});
