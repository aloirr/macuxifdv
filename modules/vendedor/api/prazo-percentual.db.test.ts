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
import { rotaEditarOrcamento } from './orcamentos';
import { preVendaSql, usarPreVenda } from './pre-venda';
import { provedoresSyncVendedor } from './sync';

const A = DOIS_TENANTS.A;
const id = (n: number) => `0f2a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PEDIDOS = [id(1), id(2), id(3), id(4), id(5)];
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
  let restaurarPreVenda: () => void = () => {};

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
              if (def.nome === 'core.financeiro_cliente@1') return { financeiro: { limite_cents: 100_000_000, saldo_aberto_cents: 0, credito_disponivel_erp_cents: null, bloqueado: false, motivo_bloqueio: null, vencidos_qtd: 0, vencidos_cents: 0, maior_atraso_dias: 0, atualizado_erp_em: null } }; // RN-VEN-12: crédito folgado (T-0184)
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
      await admin.query('delete from vendedor.pedido_aprovacao where pedido_id = any($1::uuid[])', [PEDIDOS]);
      await admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [PEDIDOS]);
      await admin.query('delete from vendedor.prazo_pagamento where id = $1', [PRAZO]);
      await admin.query('delete from vendedor.forma_pagamento where id = $1', [FORMA]);
    } finally {
      await admin.end();
    }
  }

  beforeAll(async () => {
    restaurarPreVenda = usarPreVenda(preVendaSql); // orçamento e Transformar dependem do repositório SQL da pré-venda
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
    restaurarPreVenda();
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

  describe('RN-VEN-45: o % gravado do orçamento vale no mesmo prazo, mesmo que o ERP mude o cadastro depois', () => {
    const mudarPrazoNoErp = async (pct: number) => {
      const admin = new pg.Client({ connectionString: banco().urlAdmin });
      await admin.connect();
      try {
        await admin.query('update vendedor.prazo_pagamento set percentual_ajuste = $2, updated_at = now() where id = $1', [PRAZO, pct]);
      } finally {
        await admin.end();
      }
    };
    const sinal = async (pedidoId: string) =>
      (await comTenant(pool, A.tenantId, async (c) => (await c.query("select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as t from vendedor.pedido where id = $1", [pedidoId])).rows[0])).t as string;
    const editar = (pedidoId: string, em: string, pct: number) =>
      rotaEditarOrcamento.executar({
        ...(contexto() as object),
        agora: () => new Date(agora.getTime() + 3_600_000), // depois da mudança do ERP: o % velho já não se explica pelo cadastro novo
        params: { id: pedidoId },
        corpo: { customer_id: A.clientes.c1, discount_pct: 0, payment_terms: 'Pix teste · À vista', forma_pagamento_id: FORMA, prazo_pagamento_id: PRAZO, prazo_percentual_ajuste: pct, items: [{ product_id: prod1, quantity: 2 }], atualizado_em: em },
      } as never);

    it('orçamento gravado a -1,71 %; o ERP muda o prazo para +2,50 %; o pull e o detalhe trazem o gravado; editar no mesmo prazo mantém -1,71 %; o vigente (+2,50) é recusado', async () => {
      const [r] = await receber(push(id(3), { tipo: 'orcamento', forma_pagamento_id: FORMA, prazo_pagamento_id: PRAZO, prazo_percentual_ajuste: -1.71 }));
      expect(r).toMatchObject({ id: id(3), status: 'aceito' });
      await mudarPrazoNoErp(2.5);

      const linhas = (await provedoresSyncVendedor[0]!.puxar!(contexto(), { ate: new Date(agora.getTime() + 86_400_000).toISOString(), desde: null, limite: 500 } as never)) as unknown as Array<Record<string, unknown>>;
      expect(linhas.find((l) => l.id === id(3))).toMatchObject({ prazo_pagamento_id: PRAZO, prazo_percentual_ajuste: -1.71 });
      expect(entidadePedido.schemaLinha!.parse(linhas.find((l) => l.id === id(3)))).toMatchObject({ prazo_percentual_ajuste: -1.71 });

      await expect(editar(id(3), await sinal(id(3)), 2.5)).rejects.toMatchObject({ codigo: 'RN-VEN-45' });
      await editar(id(3), await sinal(id(3)), -1.71);
      expect(await lerPercentual(id(3))).toEqual({ prazo_pagamento_id: PRAZO, pct: -1.71 });
    });

    it('Transformar no mesmo prazo leva e grava -1,71 %; o vigente (+2,50) é recusado com RN-VEN-45', async () => {
      await mudarPrazoNoErp(2.5);
      const origem = { orcamento_origem_id: id(3), created_offline_at: new Date(agora.getTime() + 3_600_000).toISOString(), forma_pagamento_id: FORMA, prazo_pagamento_id: PRAZO };
      const [recusado] = await receber(push(id(5), { ...origem, prazo_percentual_ajuste: 2.5 }));
      expect(recusado).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-45' });
      const [ok] = await receber(push(id(4), { ...origem, prazo_percentual_ajuste: -1.71 }));
      expect(ok).toMatchObject({ id: id(4), status: 'aceito' });
      expect(await lerPercentual(id(4))).toEqual({ prazo_pagamento_id: PRAZO, pct: -1.71 });
    });
  });
});
