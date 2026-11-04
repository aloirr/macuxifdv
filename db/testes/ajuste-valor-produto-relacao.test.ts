/**
 * 0020 — ajuste em R$ no pedido e no item (vendedor) e relacionados do produto (catalogo.produto_relacao). T-0071, desenho
 * docs/desenho/T-0071.md §5 (premissas de R$ confirmadas em R-20261103-140707). O que o BANCO garante:
 * - pedido: R$ do ajuste do pedido >= 0, desconto e acréscimo em R$ excludentes, sentido coerente com o % (desconto em %
 *   com acréscimo em R$, e o contrário, recusados), ajuste_em em ('pct','valor'); padrão 0/0/'pct' sem reescrever linha;
 *   índice parcial dos orçamentos abertos (RN-VEN-18);
 * - item: R$ por unidade vendida >= 0, excludentes, coerentes com o %, desconto em R$ <= preço de tabela e, com R$
 *   gravado, preço unitário = tabela − desconto + acréscimo (RN-VEN-02);
 * - produto_relacao: RLS forçado por tenant, tipo da lista fechada, produto <> relacionado, único vivo, external_id único
 *   vivo, gatilho de updated_at, sem FK para core.produto (fronteira).
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TIPOS_RELACAO_PRODUTO } from '../../modules/catalogo/contracts/sync';
import * as nuvemCatalogo from '../../modules/catalogo/db/nuvem';
import * as nuvemVendedor from '../../modules/vendedor/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { idFixo } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m20 = migracoes.find((m) => m.versao === '0020')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const lista = (trecho: string) => [...trecho.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
/** Itens do pedido p1 de A na fixture: tabela 100.000, 5% => unitário 95.000 (sequências 1 e 2). */
const ITEM_P1 = idFixo('aaaaaaaa', 0x31, 1);

describe('0020 ajuste em R$ e produto_relacao (estático)', () => {
  it('nome e posição: 0020_pedido_ajuste_valor_produto_relacao logo depois da 0019', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0019_core_nota_erp_meta_tipo') + 1]).toBe('0020_pedido_ajuste_valor_produto_relacao');
  });

  it('aditiva: colunas novas com padrão constante, sem UPDATE de dado existente', () => {
    for (const trecho of [
      'alter table vendedor.pedido add column desconto_valor_cents bigint not null default 0;',
      'alter table vendedor.pedido add column acrescimo_valor_cents bigint not null default 0;',
      "alter table vendedor.pedido add column ajuste_em text not null default 'pct';",
      'alter table vendedor.pedido_item add column desconto_unitario_cents bigint not null default 0;',
      'alter table vendedor.pedido_item add column acrescimo_unitario_cents bigint not null default 0;',
      "alter table vendedor.pedido_item add column ajuste_em text not null default 'pct';",
    ]) expect(m20.up).toContain(trecho);
    expect(semComentarios(m20.up)).not.toMatch(/^\s*update /m);
  });

  it('checks do ajuste (pedido e item) e índice parcial dos orçamentos abertos', () => {
    for (const trecho of [
      'add constraint pedido_ajuste_valor_exclusivo check (desconto_valor_cents = 0 or acrescimo_valor_cents = 0);',
      'add constraint pedido_ajuste_sentido_coerente check ((desconto_valor_cents = 0 or acrescimo_pct = 0) and (acrescimo_valor_cents = 0 or desconto_pct = 0));',
      'add constraint pedido_item_ajuste_valor_exclusivo check (desconto_unitario_cents = 0 or acrescimo_unitario_cents = 0);',
      'add constraint pedido_item_desconto_unitario_ate_tabela check (desconto_unitario_cents <= preco_tabela_cents);',
      'add constraint pedido_item_ajuste_unitario_coerente check ((desconto_unitario_cents = 0 and acrescimo_unitario_cents = 0) or preco_unitario_cents = preco_tabela_cents - desconto_unitario_cents + acrescimo_unitario_cents);',
      "create index pedido_orcamento_aberto_ix on vendedor.pedido (tenant_id, vendedor_id, orcamento_validade) where tipo = 'orcamento' and convertido_em is null and deleted_at is null;",
    ]) expect(m20.up).toContain(trecho);
  });

  it('produto_relacao: sem FK para core (fronteira), único vivo, external_id único vivo, índice de sync, no pull', () => {
    expect(semComentarios(m20.up)).not.toMatch(/references core\./);
    expect(m20.up).toContain('create unique index produto_relacao_uk on catalogo.produto_relacao (tenant_id, produto_id, relacionado_id, tipo) where deleted_at is null;');
    expect(m20.up).toContain('create unique index produto_relacao_external_uk on catalogo.produto_relacao (tenant_id, external_id) where external_id is not null and deleted_at is null;');
    expect(m20.up).toContain('create index produto_relacao_sync_ix on catalogo.produto_relacao (tenant_id, updated_at, id);');
    expect(m20.up).toContain('constraint produto_relacao_nao_e_de_si check (produto_id <> relacionado_id)');
    expect(TABELAS_FORA_DO_SYNC as readonly string[]).not.toContain('catalogo.produto_relacao');
  });

  it('listas fechadas do SQL = espelho Drizzle = contrato (tipo da relação, modo do ajuste)', () => {
    const tipo = /constraint produto_relacao_tipo_valido check \(tipo in \(([^)]*)\)\)/.exec(m20.up)?.[1] ?? '';
    expect(lista(tipo)).toEqual([...TIPOS_RELACAO_PRODUTO]);
    expect([...nuvemCatalogo.TIPOS_RELACAO_PRODUTO_BANCO]).toEqual([...TIPOS_RELACAO_PRODUTO]);
    expect([...(nuvemCatalogo.produtoRelacao.tipo.enumValues ?? [])]).toEqual([...TIPOS_RELACAO_PRODUTO]);
    for (const t of ['pedido', 'pedido_item']) {
      const modo = new RegExp(`add constraint ${t}_ajuste_em_valido check \\(ajuste_em in \\(([^)]*)\\)\\);`).exec(m20.up)?.[1] ?? '';
      expect(lista(modo), t).toEqual([...nuvemVendedor.MODOS_AJUSTE]);
    }
    expect([...(nuvemVendedor.pedido.ajuste_em.enumValues ?? [])]).toEqual(['pct', 'valor']);
    expect([...(nuvemVendedor.pedidoItem.ajuste_em.enumValues ?? [])]).toEqual(['pct', 'valor']);
  });

  it('down desfaz tudo o que o up cria (idempotente)', () => {
    for (const trecho of [
      'drop table if exists catalogo.produto_relacao;',
      'drop index if exists vendedor.pedido_orcamento_aberto_ix;',
      'alter table vendedor.pedido drop column if exists desconto_valor_cents;',
      'alter table vendedor.pedido drop column if exists acrescimo_valor_cents;',
      'alter table vendedor.pedido drop column if exists ajuste_em;',
      'alter table vendedor.pedido_item drop column if exists desconto_unitario_cents;',
      'alter table vendedor.pedido_item drop column if exists acrescimo_unitario_cents;',
      'alter table vendedor.pedido_item drop column if exists ajuste_em;',
    ]) expect(m20.down).toContain(trecho);
    const constraints = [...m20.up.matchAll(/add constraint ([a-z_]+) /g)].map((x) => x[1]!);
    expect(constraints).toHaveLength(10); // 4 no pedido + 6 no item
    for (const c of constraints) expect(m20.down, c).toMatch(new RegExp(`drop constraint if exists ${c};`));
  });
});

describe.skipIf(semBanco())('0020 ajuste em R$ e produto_relacao (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const erroEmA = async (fn: () => Promise<unknown>) => erroDe(emTransacao(app, A.tenantId, fn));

  it('pedido e item da fixture ficam no padrão 0/0/pct (pedido antigo, sem backfill)', async () => {
    const r = await emTransacao(app, A.tenantId, async () => ({
      pedidos: (await q<{ n: number }>("select count(*)::int as n from vendedor.pedido where desconto_valor_cents <> 0 or acrescimo_valor_cents <> 0 or ajuste_em <> 'pct'")).rows[0]!.n,
      itens: (await q<{ n: number }>("select count(*)::int as n from vendedor.pedido_item where desconto_unitario_cents <> 0 or acrescimo_unitario_cents <> 0 or ajuste_em <> 'pct'")).rows[0]!.n,
      total: (await q<{ n: number }>('select count(*)::int as n from vendedor.pedido')).rows[0]!.n,
    }));
    expect(r).toEqual({ pedidos: 0, itens: 0, total: 3 });
  });

  it('pedido: desconto em R$ sobre o total dos itens grava junto do % equivalente; R$ e % em sentidos opostos, os dois R$, negativo e modo fora da lista são recusados', async () => {
    // p1 de A: desconto_pct 5 → R$ 150,00 como derivado, modo 'valor' (o vendedor digitou R$)
    await emTransacao(app, A.tenantId, async () => {
      const ok = await q<{ d: string; m: string }>(
        "update vendedor.pedido set desconto_valor_cents = 15000, ajuste_em = 'valor' where id = $1 returning desconto_valor_cents::text as d, ajuste_em as m",
        [A.pedidos.p1],
      );
      expect(ok.rows).toEqual([{ d: '15000', m: 'valor' }]);
    });
    const p1 = A.pedidos.p1;
    expect((await erroEmA(() => q('update vendedor.pedido set desconto_valor_cents = 100, acrescimo_valor_cents = 1, desconto_pct = 0 where id = $1', [p1]))))
      .toMatchObject({ code: '23514', message: expect.stringContaining('pedido_ajuste_valor_exclusivo') });
    // desconto de 5% (p1) com acréscimo em R$: % e R$ juntos em sentidos opostos
    expect(await erroEmA(() => q('update vendedor.pedido set acrescimo_valor_cents = 100 where id = $1', [p1])))
      .toMatchObject({ code: '23514', message: expect.stringContaining('pedido_ajuste_sentido_coerente') });
    // acréscimo em % com desconto em R$
    expect(await erroEmA(() => q('update vendedor.pedido set desconto_pct = 0, acrescimo_pct = 2, desconto_valor_cents = 100 where id = $1', [p1])))
      .toMatchObject({ code: '23514', message: expect.stringContaining('pedido_ajuste_sentido_coerente') });
    expect((await erroEmA(() => q('update vendedor.pedido set desconto_valor_cents = -1 where id = $1', [p1])))?.code).toBe('23514');
    expect((await erroEmA(() => q("update vendedor.pedido set ajuste_em = 'reais' where id = $1", [p1])))?.code).toBe('23514');
    expect((await erroEmA(() => q('update vendedor.pedido set ajuste_em = null where id = $1', [p1])))?.code).toBe('23502');
    // acréscimo do pedido em R$ com acrescimo_pct (mesmo sentido) passa
    await emTransacao(app, A.tenantId, async () => {
      await q("update vendedor.pedido set desconto_pct = 0, acrescimo_pct = 1, acrescimo_valor_cents = 2850, ajuste_em = 'pct' where id = $1", [p1]);
    });
  });

  it('item: R$ por unidade vendida coerente com o preço (tabela − desconto); R$ maior que a tabela, os dois R$, sentido oposto ao % e preço incoerente são recusados', async () => {
    // item 1 de p1: tabela 100.000, 5% → unitário 95.000 = 100.000 − 5.000
    await emTransacao(app, A.tenantId, async () => {
      const r = await q<{ d: string }>("update vendedor.pedido_item set desconto_unitario_cents = 5000, ajuste_em = 'valor' where id = $1 returning desconto_unitario_cents::text as d", [ITEM_P1]);
      expect(r.rows).toEqual([{ d: '5000' }]);
      // no limite: desconto = tabela (preço final 0) é aceito
      await q('update vendedor.pedido_item set desconto_pct = 100, desconto_unitario_cents = 100000, preco_unitario_cents = 0, total_cents = 0 where id = $1', [ITEM_P1]);
    });
    // R$ do item maior que a tabela (com o preço final coerente, -1): pedido_item_desconto_unitario_ate_tabela
    expect(await erroEmA(() => q('update vendedor.pedido_item set desconto_unitario_cents = 100001, preco_unitario_cents = -1, total_cents = 0 where id = $1', [ITEM_P1])))
      .toMatchObject({ code: '23514', message: expect.stringContaining('pedido_item_desconto_unitario_ate_tabela') });
    // desconto e acréscimo em R$ no mesmo item (preço e % coerentes, para isolar o CHECK)
    expect(await erroEmA(() => q('update vendedor.pedido_item set desconto_pct = 0, desconto_unitario_cents = 5000, acrescimo_unitario_cents = 1, preco_unitario_cents = 95001 where id = $1', [ITEM_P1])))
      .toMatchObject({ code: '23514', message: expect.stringContaining('pedido_item_ajuste_valor_exclusivo') });
    // desconto de 5% no item com acréscimo em R$
    expect(await erroEmA(() => q('update vendedor.pedido_item set acrescimo_unitario_cents = 100, preco_unitario_cents = 100100 where id = $1', [ITEM_P1])))
      .toMatchObject({ code: '23514', message: expect.stringContaining('pedido_item_ajuste_sentido_coerente') });
    // R$ gravado que não fecha com o preço unitário
    expect(await erroEmA(() => q('update vendedor.pedido_item set desconto_unitario_cents = 4999 where id = $1', [ITEM_P1])))
      .toMatchObject({ code: '23514', message: expect.stringContaining('pedido_item_ajuste_unitario_coerente') });
    expect((await erroEmA(() => q('update vendedor.pedido_item set desconto_unitario_cents = -1 where id = $1', [ITEM_P1])))?.code).toBe('23514');
    expect((await erroEmA(() => q("update vendedor.pedido_item set ajuste_em = 'x' where id = $1", [ITEM_P1])))?.code).toBe('23514');
  });

  it('índice parcial dos orçamentos abertos existe com o predicado do desenho', async () => {
    const r = await q<{ def: string }>("select indexdef as def from pg_indexes where schemaname = 'vendedor' and indexname = 'pedido_orcamento_aberto_ix'");
    expect(r.rows[0]?.def).toMatch(/\(tenant_id, vendedor_id, orcamento_validade\) WHERE \(\(tipo = 'orcamento'::text\) AND \(convertido_em IS NULL\) AND \(deleted_at IS NULL\)\)/);
  });

  it('produto_relacao — RLS: cada tenant só vê as próprias; sem contexto, nenhuma; escrever no alheio é recusado', async () => {
    const contar = (ctx: string | null) =>
      emTransacao(app, ctx, () =>
        q<{ n: number; vivas: number; alheias: number }>(
          `select count(*)::int as n, count(*) filter (where deleted_at is null and ativo)::int as vivas,
                  count(*) filter (where tenant_id <> coalesce(nullif(current_setting('app.tenant_id', true), ''), '00000000-0000-4000-8000-000000000000')::uuid)::int as alheias
             from catalogo.produto_relacao`,
        ),
      );
    expect((await contar(A.tenantId)).rows[0]).toEqual({ n: 4, vivas: 2, alheias: 0 });
    expect((await contar(B.tenantId)).rows[0]).toEqual({ n: 1, vivas: 1, alheias: 0 });
    expect((await contar(null)).rows[0]!.n).toBe(0);
    const inserirEmB = () =>
      q("insert into catalogo.produto_relacao (tenant_id, produto_id, relacionado_id, tipo) values ($1, gen_random_uuid(), gen_random_uuid(), 'complementar')", [B.tenantId]);
    expect((await erroEmA(inserirEmB))?.code).toBe('42501');
    const upd = await emTransacao(app, A.tenantId, () => q('update catalogo.produto_relacao set ordem = 9 where tenant_id = $1', [B.tenantId]));
    expect(upd.rowCount).toBe(0);
    const del = await emTransacao(app, A.tenantId, () => q('delete from catalogo.produto_relacao where tenant_id = $1', [B.tenantId]));
    expect(del.rowCount).toBe(0);
  });

  it('produto_relacao — checks, único vivo (volta a valer depois do soft delete), external_id único vivo, gatilho de updated_at, sem FK', async () => {
    const inserir = (produto: string, relacionado: string, tipo: string, external: string | null = null) =>
      q('insert into catalogo.produto_relacao (tenant_id, produto_id, relacionado_id, tipo, external_id) values ($1, $2, $3, $4, $5)', [A.tenantId, produto, relacionado, tipo, external]);
    const { p1, p2 } = A.produtos;
    expect((await erroEmA(() => inserir(p1, p2, 'cruzado')))?.code).toBe('23514');
    expect((await erroEmA(() => inserir(p1, p1, 'complementar')))?.code).toBe('23514');
    expect((await erroEmA(() => q('insert into catalogo.produto_relacao (tenant_id, produto_id, relacionado_id, tipo, ordem) values ($1, $2, $3, $4, null)', [A.tenantId, p2, p1, 'superior'])))?.code).toBe('23502');
    // (p1, p2, complementar) já vivo na fixture
    expect((await erroEmA(() => inserir(p1, p2, 'complementar')))?.code).toBe('23505');
    // o mesmo par com outro tipo e o par apagado (p2 -> p1 complementar, soft delete na fixture) passam
    expect(await erroEmA(() => inserir(p1, p2, 'substituto'))).toBeNull();
    expect(await erroEmA(() => inserir(p2, p1, 'complementar'))).toBeNull();
    // external_id único vivo por tenant; o mesmo valor em B é outra linha
    expect((await erroEmA(() => inserir(p2, p1, 'superior', 'REL-A-1')))?.code).toBe('23505');
    expect(await erroDe(emTransacao(app, B.tenantId, () => q("insert into catalogo.produto_relacao (tenant_id, produto_id, relacionado_id, tipo, external_id) values ($1, gen_random_uuid(), gen_random_uuid(), 'superior', 'REL-A-1')", [B.tenantId])))).toBeNull();
    // sem FK para core.produto (fronteira): ids que não existem no Core passam (a API do Catálogo valida)
    expect(await erroEmA(() => q("insert into catalogo.produto_relacao (tenant_id, produto_id, relacionado_id, tipo) values ($1, gen_random_uuid(), gen_random_uuid(), 'complementar')", [A.tenantId]))).toBeNull();
    // gatilho de updated_at
    await emTransacao(app, A.tenantId, async () => {
      const r = await q<{ mudou: boolean }>("update catalogo.produto_relacao set ordem = 7 where external_id = 'REL-A-1' returning updated_at > created_at as mudou");
      expect(r.rows).toEqual([{ mudou: true }]);
    });
  });

  it('consulta das sugestões (catalogo.sugestoes_pedido@1): relações vivas e ativas dos produtos do pedido, complementar e superior', async () => {
    const r = await emTransacao(app, A.tenantId, () =>
      q<{ produto_id: string; relacionado_id: string; tipo: string }>(
        `select produto_id, relacionado_id, tipo from catalogo.produto_relacao
          where produto_id = any($1::uuid[]) and tipo in ('complementar', 'superior') and ativo and deleted_at is null order by produto_id, ordem`,
        [[A.produtos.p1, A.produtos.p2]],
      ),
    );
    expect(r.rows).toEqual([{ produto_id: A.produtos.p1, relacionado_id: A.produtos.p2, tipo: 'complementar' }]);
  });
});

describe.skipIf(semBanco())('0020 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000020';
  const P = 'cccccccc-0020-4000-8000-000000000001';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0020_pedido_ajuste_valor_produto_relacao') - 1]!.slice(0, 4);
  const desde0020 = nomes.filter((n) => n >= '0020');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('pedido e item existentes ficam 0/0/pct sem mexer em updated_at; down volta ao catálogo da 0019 com o pedido intacto; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo20', 'Antigo')", [T]);
      await c.query(
        `insert into vendedor.pedido (id, tenant_id, cliente_id, vendedor_id, autor_id, status, desconto_pct, total_tabela_cents, total_cents)
         values ($1, $2, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'received', 1, 39830, 37979)`,
        [P, T],
      );
      await c.query(
        `insert into vendedor.pedido_item (tenant_id, pedido_id, sequencia, produto_id, quantidade, preco_tabela_cents, preco_unitario_cents, desconto_pct, total_cents, unidade)
         values ($1, $2, 1, gen_random_uuid(), 12, 1890, 1790, 5.29, 21480, 'UN')`,
        [T, P],
      );
      const pedidoAntes = (await c.query('select id, total_cents, desconto_pct, updated_at from vendedor.pedido where tenant_id = $1', [T])).rows;
      const itemAntes = (await c.query('select id, preco_unitario_cents, total_cents, updated_at from vendedor.pedido_item where tenant_id = $1', [T])).rows;
      expect((await migrarUp(c)).aplicadas).toEqual(desde0020);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('rel catalogo.produto_relacao r rls=true force=true');
      expect((await c.query('select id, total_cents, desconto_pct, updated_at from vendedor.pedido where tenant_id = $1', [T])).rows).toEqual(pedidoAntes);
      expect((await c.query('select id, preco_unitario_cents, total_cents, updated_at from vendedor.pedido_item where tenant_id = $1', [T])).rows).toEqual(itemAntes);
      expect((await c.query('select desconto_valor_cents::int as d, acrescimo_valor_cents::int as a, ajuste_em from vendedor.pedido where tenant_id = $1', [T])).rows).toEqual([{ d: 0, a: 0, ajuste_em: 'pct' }]);
      expect((await c.query('select desconto_unitario_cents::int as d, acrescimo_unitario_cents::int as a, ajuste_em from vendedor.pedido_item where tenant_id = $1', [T])).rows).toEqual([{ d: 0, a: 0, ajuste_em: 'pct' }]);
      // com R$ gravado e uma relação, o down apaga as colunas e a tabela; o pedido segue com o % e o preço final
      await c.query("update vendedor.pedido_item set desconto_unitario_cents = 100, ajuste_em = 'valor' where tenant_id = $1", [T]);
      await c.query("insert into catalogo.produto_relacao (tenant_id, produto_id, relacionado_id, tipo) values ($1, gen_random_uuid(), gen_random_uuid(), 'complementar')", [T]);
      expect((await migrarDown(c, { passos: desde0020.length })).aplicadas).toEqual([...desde0020].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select id, total_cents, desconto_pct from vendedor.pedido where tenant_id = $1', [T])).rows).toEqual(pedidoAntes.map(({ id, total_cents, desconto_pct }) => ({ id, total_cents, desconto_pct })));
      expect((await c.query('select preco_unitario_cents::int as u, total_cents::int as t from vendedor.pedido_item where tenant_id = $1', [T])).rows).toEqual([{ u: 1790, t: 21480 }]);
      // down idempotente e up de novo chega ao mesmo catálogo
      await c.query(m20.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
