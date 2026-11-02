/**
 * 0013 — regras que o BANCO garante: cota de IA atômica por (tenant, usuário, dia no fuso do tenant) — RN-CAT-03,
 * R-20261101-222233-3 —, documento de busca do servidor, orçamento, frete, unidade de venda e cadastro mínimo.
 * Como o papel de APLICAÇÃO (macuxi_app, sujeito a RLS) sobre a fixture dois-tenants. Linha do tempo: a do teste,
 * derivada do "hoje" da fixture (hojeDaFixture); nenhum relógio real comparado (ADR 0015).
 * A cota grava com COMMIT (concorrência de verdade entre conexões) num usuário aleatório, apagado no fim.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comTenant } from '../src/contexto';
import { instante, somarDias } from '../src/datas';
import { banco, hojeDaFixture, semBanco } from './estado';
import { comCliente, emTransacao, erroDe } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const tA = A.tenantId;
const tB = B.tenantId;
const P = (n: number) => `9d0c2f4e-0013-4000-8000-${String(n).padStart(12, '0')}`;

describe.skipIf(semBanco())('0013: cota de IA (RN-CAT-03) — débito atômico no banco', () => {
  let pool: pg.Pool;
  const usuarios: string[] = [];
  const novoUsuario = () => {
    const u = randomUUID();
    usuarios.push(u);
    return u;
  };
  /** Dia D da fixture em Manaus (tenant A, UTC−4): 03:59Z ainda é D−1 local; 04:00Z já é D. */
  const diaA = () => hojeDaFixture('America/Manaus');
  const debitar = (tenant: string, usuario: string, limite: number, agora: string) =>
    comTenant(pool, tenant, async (c) => (await c.query<{ n: number | null }>('select catalogo.debitar_cota_ia($1, $2, $3) as n', [usuario, limite, agora])).rows[0]!.n);
  const doDia = (tenant: string, usuario: string, agora: string) =>
    comTenant(pool, tenant, async (c) => (await c.query<{ n: number }>('select catalogo.consultas_ia_do_dia($1, $2) as n', [usuario, agora])).rows[0]!.n);

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 16 });
  });
  afterAll(async () => {
    await pool?.end();
    if (usuarios.length > 0) {
      await comCliente(banco().urlAdmin, (c) => c.query('delete from catalogo.uso_ia where usuario_id = any($1::uuid[])', [usuarios]));
    }
  });

  it('RN-CAT-03: 40 requisições simultâneas com limite 7 debitam exatamente 7 (1..7) e as outras recebem null', async () => {
    const u = novoUsuario();
    const agora = instante(diaA(), '15:00');
    const r = await Promise.all(Array.from({ length: 40 }, () => debitar(tA, u, 7, agora)));
    const ok = r.filter((x): x is number => x !== null).sort((x, y) => x - y);
    expect(ok).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.filter((x) => x === null)).toHaveLength(33);
    expect(await doDia(tA, u, agora)).toBe(7);
    const linhas = await comCliente(banco().urlAdmin, (c) => c.query('select dia::text as dia, consultas from catalogo.uso_ia where usuario_id = $1', [u]));
    expect(linhas.rows).toEqual([{ dia: diaA(), consultas: 7 }]);
  });

  it('RN-CAT-03: o dia vira no fuso do tenant (Manaus: 03:59Z = dia anterior; 04:00Z = dia novo, cota nova)', async () => {
    const u = novoUsuario();
    const antes = instante(diaA(), '03:59');
    const depois = instante(diaA(), '04:00');
    expect(await debitar(tA, u, 1, antes)).toBe(1);
    expect(await debitar(tA, u, 1, antes)).toBeNull();
    expect(await debitar(tA, u, 1, depois)).toBe(1);
    expect(await doDia(tA, u, antes)).toBe(1);
    expect(await doDia(tA, u, depois)).toBe(1);
    const dias = await comCliente(banco().urlAdmin, (c) => c.query<{ dia: string }>('select dia::text as dia from catalogo.uso_ia where usuario_id = $1 order by dia', [u]));
    expect(dias.rows.map((x) => x.dia)).toEqual([somarDias(diaA(), -1), diaA()]);
  });

  it('RN-CAT-03: limite 0 (IA desligada) não grava; sem contexto de tenant falha fechado; B não vê nem consome a cota de A', async () => {
    const u = novoUsuario();
    const agora = instante(diaA(), '16:00');
    expect(await debitar(tA, u, 0, agora)).toBeNull();
    expect(await doDia(tA, u, agora)).toBe(0);
    expect(await debitar(tA, u, 2, agora)).toBe(1);
    // B: o mesmo usuário (uuid) tem contador próprio no tenant B, e não enxerga o de A
    expect(await doDia(tB, u, agora)).toBe(0);
    expect(await debitar(tB, u, 2, agora)).toBe(1);
    expect(await doDia(tA, u, agora)).toBe(1);
    const c = await pool.connect();
    try {
      const e = await erroDe(c.query('select catalogo.debitar_cota_ia($1, 5, $2)', [u, agora]));
      expect(e?.code).toBe('42501');
    } finally {
      c.release();
    }
  });
});

describe.skipIf(semBanco())('0013: catálogo, vendedor e core — regras garantidas pelo banco (papel de aplicação)', () => {
  let app: pg.Client;

  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });

  const comA = <T>(fn: () => Promise<T>) => emTransacao(app, tA, fn);
  /** erroDe dentro de um SAVEPOINT: o erro esperado não aborta a transação do teste. */
  const tentar = async (fn: () => Promise<unknown>) => {
    await app.query('savepoint t');
    const e = await erroDe(fn());
    await app.query(e ? 'rollback to savepoint t' : 'release savepoint t');
    return e;
  };
  const inserir = (tabela: string, cols: Record<string, unknown>) => {
    const nomes = Object.keys(cols);
    return app.query(`insert into ${tabela} (${nomes.join(', ')}) values (${nomes.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(cols));
  };
  const pedido = (id: string, extra: Record<string, unknown> = {}) =>
    inserir('vendedor.pedido', { id, tenant_id: tA, cliente_id: A.clientes.c1, vendedor_id: A.usuarios.vendedor1, autor_id: A.usuarios.vendedor1, status: 'received', ...extra });

  it('RF-CAT-01: documento de busca preenchido pelo gatilho, sem acento, acha "pastilha 150" e "pastílha" (fixture A)', async () => {
    await comA(async () => {
      const busca = (texto: string) =>
        app.query<{ produto_id: string }>(
          "select produto_id from catalogo.produto_busca where documento @@ websearch_to_tsquery('portuguese', catalogo.sem_acento($1)) and deleted_at is null",
          [texto],
        );
      const produtoA = (await app.query<{ produto_id: string }>('select produto_id from catalogo.produto_busca where tenant_id = $1', [tA])).rows[0]!.produto_id;
      expect((await busca('pastilha 150')).rows.map((x) => x.produto_id)).toEqual([produtoA]);
      expect((await busca('pastílha freio')).rowCount).toBe(1);
      expect((await busca('oleo')).rowCount).toBe(0); // o óleo é do tenant B
      // gravar `documento` à mão não adianta: o gatilho recalcula
      const r = await app.query<{ ok: boolean }>(
        "update catalogo.produto_busca set documento = ''::tsvector, nome = nome where tenant_id = $1 returning documento @@ to_tsquery('portuguese', 'pastilh') as ok",
        [tA],
      );
      expect(r.rows.every((x) => x.ok)).toBe(true);
    });
  });

  it('RN-VEN-13/32: orçamento só em draft/queued/received/cancelled; conversão única; validade só no orçamento', async () => {
    await comA(async () => {
      expect(await tentar(() => pedido(P(1), { tipo: 'orcamento', orcamento_validade: somarDias(hojeDaFixture(), 7) }))).toBeNull();
      expect((await tentar(() => pedido(P(2), { tipo: 'orcamento', status: 'approved' })))?.code).toBe('23514');
      expect((await tentar(() => pedido(P(3), { tipo: 'orcamento', status: 'pending_approval', nivel_aprovacao: 'supervisor' })))?.code).toBe('23514');
      expect((await tentar(() => pedido(P(4), { orcamento_validade: hojeDaFixture() })))?.code).toBe('23514');
      expect((await tentar(() => pedido(P(5), { tipo: 'cotacao' })))?.code).toBe('23514');
      expect(await tentar(() => pedido(P(6), { orcamento_id: P(1) }))).toBeNull();
      expect((await tentar(() => pedido(P(7), { orcamento_id: P(1) })))?.code).toBe('23505');
      expect((await tentar(() => pedido(P(8), { orcamento_id: P(999) })))?.code).toBe('23503');
    });
  });

  it('RN-VEN-02/16: desconto e acréscimo excludentes; CIF sem transportadora; FOB exige transportadora (cadastrada ou digitada com nome e CNPJ)', async () => {
    await comA(async () => {
      expect((await tentar(() => pedido(P(11), { desconto_pct: 5, acrescimo_pct: 2 })))?.code).toBe('23514');
      expect(await tentar(() => pedido(P(12), { acrescimo_pct: 3 }))).toBeNull();
      expect((await tentar(() => pedido(P(13), { frete_modalidade: 'CIF', transportadora_digitada: true, transportadora_nome: 'X' })))?.code).toBe('23514');
      expect((await tentar(() => pedido(P(14), { frete_modalidade: 'FOB', transportadora_digitada: true })))?.code).toBe('23514');
      expect((await tentar(() => pedido(P(19), { frete_modalidade: 'FOB', transportadora_digitada: true, transportadora_nome: 'Frete do Zé' })))?.code).toBe('23514');
      expect(await tentar(() => pedido(P(15), { frete_modalidade: 'FOB', transportadora_digitada: true, transportadora_nome: 'Frete do Zé', transportadora_documento: '11444777000161' }))).toBeNull();
      expect((await tentar(() => pedido(P(16), { frete_modalidade: 'FOB' })))?.code).toBe('23514');
      expect(await tentar(() => pedido(P(20), { frete_modalidade: 'CIF' }))).toBeNull();
      const transportadoraA = (await app.query<{ id: string }>('select id from vendedor.transportadora where tenant_id = $1 limit 1', [tA])).rows[0]!.id;
      expect(await tentar(() => pedido(P(17), { frete_modalidade: 'FOB', transportadora_id: transportadoraA }))).toBeNull();
      expect((await tentar(() => pedido(P(18), { frete_modalidade: 'FOB', transportadora_id: B.tenantId })))?.code).toBe('23503');
    });
  });

  it('RN-VEN-15: quantidade_base = quantidade x fator pelo gatilho (o valor enviado é ignorado); faturada <= quantidade', async () => {
    await comA(async () => {
      await pedido(P(21));
      const item = (id: number, extra: Record<string, unknown>) =>
        inserir('vendedor.pedido_item', {
          id: P(100 + id), tenant_id: tA, pedido_id: P(21), sequencia: id, produto_id: P(500), quantidade: 3, preco_tabela_cents: 100, preco_unitario_cents: 100, total_cents: 300, ...extra,
        });
      const r = await item(1, { unidade: 'CX', fator: 12, quantidade_base: 1 });
      expect(r.rows[0].quantidade_base).toBe(36);
      const u = await app.query("update vendedor.pedido_item set quantidade = 5 where id = $1 returning quantidade_base", [P(101)]);
      expect(u.rows[0].quantidade_base).toBe(60);
      // faturada na UNIDADE BASE (T-0061 §2.1): até 60 (5 CX c/ 12) passa; 61 não
      const fat = (n: number) => app.query('update vendedor.pedido_item set quantidade_faturada = $2 where id = $1', [P(101), n]);
      expect(await tentar(() => fat(60))).toBeNull();
      expect((await tentar(() => fat(61)))?.code).toBe('23514');
      expect((await tentar(() => item(2, { fator: 0 })))?.code).toBe('23514');
      expect((await tentar(() => item(3, { quantidade_faturada: 4 })))?.code).toBe('23514');
      expect((await tentar(() => item(4, { desconto_pct: 5, acrescimo_pct: 5 })))?.code).toBe('23514');
    });
  });

  it('RN-CORE-16/17: cadastro_incompleto coerente com a lista de campos faltantes', async () => {
    await comA(async () => {
      const upd = (inc: boolean, faltam: string) =>
        app.query('update core.cliente set cadastro_incompleto = $2, cadastro_campos_faltantes = $3::text[] where id = $1', [A.clientes.c1, inc, faltam]);
      expect((await tentar(() => upd(true, '{}')))?.code).toBe('23514');
      expect((await tentar(() => upd(false, '{cep}')))?.code).toBe('23514');
      expect(await tentar(() => upd(true, '{cep,documento}'))).toBeNull();
    });
  });
});
