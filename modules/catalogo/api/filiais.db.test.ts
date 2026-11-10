/**
 * Preço e estoque por filial × Postgres real (T-0149, RN-CORE-39, ADR 0040): `catalogo.precos_cliente@1` com 2 filiais e fallback
 * por tabela, estoque da filial (soma dos depósitos), pull só das filiais da carteira e `variacaoEscopo`. O Core é simulado por
 * `core.filiais@1` (`consultarFiliaisDeTeste`); a filial padrão é a semeada pela migração 0056 e a segunda e a terceira são ids
 * do teste (o Catálogo não tem FK para o Core). Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco, ContextoBase, ContextoConsulta, LinhaSync, PedidoPull } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrecosClienteEntradaSchema } from '../contracts';
import { estoqueVisivel } from '../domain/estoque';
import { resolverParametros } from '../domain/parametros';
import { consultaPrecosCliente } from './consultas';
import { consultarFiliaisDeTeste } from './filiais-teste';
import { criarRepositorioPostgres, SEM_MARCAS } from './repositorio-postgres';
import { provedoresSyncCatalogo } from './sync';

const A = DOIS_TENANTS.A;
const id = (n: number) => `0ca00000-0000-4000-8000-${String(700000 + n).padStart(12, '0')}`;
const F_BVB = id(1); // Boa Vista: tem item na tabela
const F_STM = id(2); // Santarém: a tabela não tem item nenhum nela
const TAB = id(10);
const P1 = id(21); // preço nas duas filiais
const P2 = id(22); // preço só na padrão
const CL_MAO = id(31); // sem filial no mapa = padrão
const CL_BVB = id(32);
const CL_STM = id(33);
const DEP_MAO = id(41);
const DEP_BVB1 = id(42);
const DEP_BVB2 = id(43);
const IDS = [F_BVB, F_STM, TAB, P1, P2, DEP_MAO, DEP_BVB1, DEP_BVB2, ...Array.from({ length: 40 }, (_, i) => id(100 + i))];
const AGORA = new Date('2026-11-10T15:00:00.000Z');
const CLIENTES = { [CL_BVB]: F_BVB, [CL_STM]: F_STM };
const NOMES = { [F_BVB]: 'Boa Vista', [F_STM]: 'Santarém' };

describe.skipIf(semBanco())('Catálogo × Postgres: preço e estoque por filial (T-0149, RN-CORE-39)', () => {
  let pool: pg.Pool;
  let padrao = '';

  const consultar = (cliente: string, produtos: string[]) =>
    comTenant(pool, A.tenantId, (c) =>
      consultaPrecosCliente.executar(PrecosClienteEntradaSchema.parse({ cliente_id: cliente, produto_ids: produtos, em: AGORA.toISOString() }), {
        db: c as unknown as ClienteBanco,
        usuario: { perfil: 'vendedor' },
        consultar: consultarFiliaisDeTeste(c, { clientes: CLIENTES, outras: NOMES }),
        agora: () => AGORA,
        fuso: () => 'America/Manaus',
        parametros: () => ({}),
      } as unknown as ContextoConsulta),
    ) as Promise<{ tabela_preco_id: string | null; filial_id?: string | null; filial_origem?: string; itens: Array<{ produto_id: string; preco_cents: number | null; motivo_sem_preco: string | null }> }>;

  const ctxPull = (daCarteira: string[] | null): ContextoBase =>
    ({
      usuario: { perfil: 'vendedor', tenant_id: A.tenantId },
      comTenant: (fn: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) =>
        comTenant(pool, A.tenantId, (c) => fn(c, { consultar: consultarFiliaisDeTeste(c, { clientes: CLIENTES, outras: NOMES, daCarteira }) })),
      carteira: async () => 'tenant',
      parametros: () => ({}),
    }) as unknown as ContextoBase;
  const pedido = (): PedidoPull => ({ ate: '2099-01-01T00:00:00.000Z', desde: null, limite: 500 }) as unknown as PedidoPull;
  const provedor = (nome: string) => provedoresSyncCatalogo.find((p) => p.entidade.nome === nome)!;
  const puxar = (nome: string, ctx: ContextoBase) => provedor(nome).puxar!(ctx, pedido()) as Promise<Array<LinhaSync & { filial_id?: string }>>;

  async function limpar() {
    await comTenant(pool, A.tenantId, async (c) => {
      await c.query('delete from catalogo.estoque_saldo where id = any($1::uuid[])', [IDS]);
      await c.query('delete from catalogo.deposito where id = any($1::uuid[])', [IDS]);
      await c.query('delete from catalogo.tabela_preco_item where id = any($1::uuid[])', [IDS]);
      await c.query('delete from catalogo.tabela_escalonada where id = any($1::uuid[])', [IDS]);
      await c.query('delete from catalogo.tabela_preco where id = any($1::uuid[])', [IDS]);
    });
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    await limpar();
    await comTenant(pool, A.tenantId, async (c) => {
      padrao = (await c.query<{ id: string }>('select core.filial_padrao_id(plataforma.tenant_atual()) as id')).rows[0]!.id;
      await c.query("insert into catalogo.tabela_preco (id, tenant_id, codigo, nome) values ($1, $2, 'T149-TAB', 'Atacado T149')", [TAB, A.tenantId]);
      const item = (n: number, produto: string, cents: number, filial: string) =>
        c.query('insert into catalogo.tabela_preco_item (id, tenant_id, tabela_preco_id, produto_id, preco_cents, filial_id) values ($1, $2, $3, $4, $5, $6)', [id(100 + n), A.tenantId, TAB, produto, cents, filial]);
      await item(1, P1, 1000, padrao);
      await item(2, P1, 1050, F_BVB);
      await item(3, P2, 700, padrao);
      for (const cliente of [CL_MAO, CL_BVB, CL_STM]) {
        await c.query('insert into catalogo.cliente_tabela_preco (tenant_id, cliente_id, tabela_preco_id) values ($1, $2, $3)', [A.tenantId, cliente, TAB]);
      }
      // escalonada: uma geral (filial nula) e uma só da Boa Vista, na mesma chave
      const faixa = (n: number, cents: number, filial: string | null) =>
        c.query(
          "insert into catalogo.tabela_escalonada (id, tenant_id, produto_id, medida, quantidade_minima, preco_unidade_cents, vigencia_inicio, filial_id) values ($1, $2, $3, null, 10, $4, '2026-11-01', $5)",
          [id(110 + n), A.tenantId, P1, cents, filial],
        );
      await faixa(1, 900, null);
      await faixa(2, 950, F_BVB);
      // estoque: Manaus 20; Boa Vista com 2 depósitos (5 + 7 = 12); Santarém nenhum
      const dep = (i: string, cod: string, filial: string) => c.query('insert into catalogo.deposito (id, tenant_id, codigo, nome, filial_id) values ($1, $2, $3, $3, $4)', [i, A.tenantId, cod, filial]);
      await dep(DEP_MAO, 'T149-MAO', padrao);
      await dep(DEP_BVB1, 'T149-BVB1', F_BVB);
      await dep(DEP_BVB2, 'T149-BVB2', F_BVB);
      const saldo = (n: number, deposito: string, q: number) =>
        c.query('insert into catalogo.estoque_saldo (id, tenant_id, deposito_id, produto_id, quantidade) values ($1, $2, $3, $4, $5)', [id(120 + n), A.tenantId, deposito, P1, q]);
      await saldo(1, DEP_MAO, 20);
      await saldo(2, DEP_BVB1, 5);
      await saldo(3, DEP_BVB2, 7);
    });
  });
  afterAll(async () => {
    await limpar();
    await pool?.end();
  });

  it('RN-CORE-39: cliente da filial padrão e cliente da Boa Vista veem o preço da própria filial', async () => {
    expect(await consultar(CL_MAO, [P1])).toMatchObject({ filial_id: padrao, filial_origem: 'cliente', itens: [{ preco_cents: 1000 }] });
    expect(await consultar(CL_BVB, [P1])).toMatchObject({ filial_id: F_BVB, filial_origem: 'cliente', itens: [{ preco_cents: 1050 }] });
  });

  it('RN-CORE-39: tabela sem nenhum item na filial do cliente usa os itens da MESMA tabela na padrão (fallback por tabela)', async () => {
    expect(await consultar(CL_STM, [P1])).toMatchObject({ tabela_preco_id: TAB, filial_id: padrao, filial_origem: 'padrao', itens: [{ preco_cents: 1000 }] });
  });

  it('RN-CAT-06: na filial escolhida, produto sem item continua "Sem preço para este cliente" (fallback por tabela, não por item)', async () => {
    const r = await consultar(CL_BVB, [P2]);
    expect(r.itens[0]).toEqual({ produto_id: P2, preco_cents: null, motivo_sem_preco: 'Sem preço para este cliente.' });
  });

  it('RN-CORE-39: a faixa da filial vence a geral na mesma chave; cliente de outra filial fica com a geral', async () => {
    const faixas = async (cliente: string) => (await consultar(cliente, [P1])).itens[0] as unknown as { faixas?: Array<{ preco_unidade_cents: number }> };
    expect((await faixas(CL_BVB)).faixas?.map((f) => f.preco_unidade_cents)).toEqual([950]);
    expect((await faixas(CL_MAO)).faixas?.map((f) => f.preco_unidade_cents)).toEqual([900]);
  });

  it('RN-CORE-39: o pull manda preço, depósito, saldo e escalonada só das filiais da carteira (nula na escalonada = todas)', async () => {
    const meus = (l: Array<LinhaSync & { filial_id?: string }>) => l.filter((x) => IDS.includes(x.id));
    const soPadrao = ctxPull([padrao]);
    expect(meus(await puxar('tabela_preco_item', soPadrao)).map((x) => x.filial_id)).toEqual([padrao, padrao]);
    expect(meus(await puxar('deposito', soPadrao)).map((x) => x.id)).toEqual([DEP_MAO]);
    expect(meus(await puxar('estoque_saldo', soPadrao))).toHaveLength(1);
    expect(meus(await puxar('tabela_escalonada', soPadrao)).map((x) => x.filial_id ?? null)).toEqual([null]);
    const duas = ctxPull([padrao, F_BVB]);
    expect(meus(await puxar('tabela_preco_item', duas))).toHaveLength(3);
    expect(meus(await puxar('deposito', duas)).map((x) => x.id).sort()).toEqual([DEP_MAO, DEP_BVB1, DEP_BVB2].sort());
    expect(meus(await puxar('estoque_saldo', duas))).toHaveLength(3);
    expect(meus(await puxar('tabela_escalonada', duas))).toHaveLength(2);
    expect(meus(await puxar('tabela_preco_item', ctxPull(null)))).toHaveLength(3);
  });

  it('RN-CORE-39: a variacaoEscopo muda quando a lista de filiais da carteira muda (o aparelho repuxa)', async () => {
    const v = (lista: string[] | null) => provedor('tabela_preco_item').variacaoEscopo!(ctxPull(lista));
    expect(await v([padrao])).not.toBe(await v([padrao, F_BVB]));
    expect(await v([F_BVB, padrao])).toBe(await v([padrao, F_BVB]));
  });

  it('RN-CORE-39: o estoque da filial é a soma dos depósitos dela; filial sem registro = 0; sem cliente, uma linha por filial da carteira', async () => {
    await comTenant(pool, A.tenantId, async (c) => {
      const ctx = { usuario: { id: id(900), tenant_id: A.tenantId, perfil: 'vendedor' }, agora: () => AGORA, carteira: async () => new Set([CL_MAO, CL_BVB, CL_STM]) } as unknown as ContextoBase;
      const tx = { consultar: consultarFiliaisDeTeste(c, { clientes: CLIENTES, outras: NOMES }) } as never;
      const repo = criarRepositorioPostgres({ marcas: SEM_MARCAS })(ctx, c as unknown as ClienteBanco, tx);
      const saldos = (await repo.saldos([P1])).get(P1) ?? [];
      const ver = async (cliente: string | null) =>
        estoqueVisivel(P1, saldos, { filiais: await repo.filiaisDoUsuario(cliente), agora: AGORA.toISOString(), parametros: resolverParametros({}) });
      expect(await ver(CL_BVB)).toMatchObject({ quantity: 12, by_branch: [{ branch_id: F_BVB, branch_name: 'Boa Vista', quantity: 12 }] });
      expect(await ver(CL_MAO)).toMatchObject({ quantity: 20 });
      expect(await ver(CL_STM)).toMatchObject({ quantity: 0, band: 'sem_estoque', by_branch: [] });
      expect((await ver(null)).by_branch.map((b) => b.quantity).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([12, 20]);
    });
  });
});
