/**
 * Pull dos 9 cadastros de trade × Postgres real (cursor `(updated_at, id)`, lápide, RLS; fixture dois-tenants, macuxi_app).
 * Pula sem Postgres/Docker (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 * Cobre: as colunas de cada provedor passam no schema estrito da linha (`contracts/cadastros.ts`); o cursor pagina sem
 * repetir nem pular; a linha removida vai como lápide; o horizonte `ate` corta; tenant B nunca recebe linha de A (RN-CORE-05).
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { codificarCursor, decodificarCursor, type ContextoBase, type LinhaSync, type PedidoPull, type ProvedorSync } from '@macuxi/platform-sdk';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENTIDADES_CADASTRO } from '../contracts';
import { provedoresPullCadastros, sqlDoPullCadastro, TABELAS_CADASTRO } from './sync-cadastros';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;

describe('Promotor: SQL do pull de cadastro (texto)', () => {
  it('ordem (updated_at, id), limite e cursor; sem filtro de deleted_at (a lápide vai)', () => {
    const { sql, valores } = sqlDoPullCadastro(TABELAS_CADASTRO.categoria_gondola, { desde: { updated_at: 'x', id: 'y' }, ate: 'z', limite: 7 });
    expect(sql).toMatch(/order by updated_at, id\s+limit \$4/);
    expect(sql).toContain('(updated_at, id) > ($2::timestamptz, $3::uuid)');
    expect(sql).not.toMatch(/deleted_at\s+is\s+null/);
    expect(valores).toEqual(['z', 'x', 'y', 7]);
  });

  it('há um provedor de pull (escopo tenant) para cada um dos 9 cadastros do contrato', () => {
    expect(provedoresPullCadastros.map((p) => p.entidade.nome)).toEqual(ENTIDADES_CADASTRO.map((e) => e.nome));
    expect(provedoresPullCadastros.every((p) => p.escopo === 'tenant' && typeof p.puxar === 'function' && !p.receber)).toBe(true);
  });
});

describe.skipIf(semBanco())('Promotor: pull dos cadastros de trade × Postgres (cursor, lápide, RLS)', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  const ctx = (tenant: string): ContextoBase =>
    ({ usuario: { id: A.usuarios.promotor, tenant_id: tenant, perfil: 'promotor' }, comTenant: (fn: (db: pg.ClientBase) => Promise<unknown>) => comTenant(pool, tenant, (c) => fn(c)) }) as unknown as ContextoBase;
  const prov = (nome: string): ProvedorSync => provedoresPullCadastros.find((p) => p.entidade.nome === nome)!;
  /** Horizonte seguro pelo relógio do BANCO (as linhas têm updated_at = now() do banco), nunca por data fixa. */
  const horizonte = async (): Promise<string> => ((await pool.query<{ t: Date }>("select now() + interval '1 minute' as t")).rows[0]!.t).toISOString();
  const pagina = (p: ProvedorSync, tenant: string, pedido: PedidoPull) => p.puxar!(ctx(tenant), pedido);

  /** Percorre todas as páginas pelo cursor e devolve as linhas e quantas páginas leu. */
  async function tudo(p: ProvedorSync, tenant: string, limite: number): Promise<{ linhas: LinhaSync[]; paginas: number }> {
    const ate = await horizonte();
    const linhas: LinhaSync[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    for (;;) {
      const lote: LinhaSync[] = await pagina(p, tenant, { desde: decodificarCursor(cursor), ate, limite });
      paginas++;
      linhas.push(...lote);
      if (lote.length < limite) break;
      const ult = lote[lote.length - 1]!;
      cursor = codificarCursor({ updated_at: ult.updated_at, id: ult.id });
    }
    return { linhas, paginas };
  }

  it('cada provedor devolve as linhas do tenant A no formato estrito do contrato (colunas, datas, números, itens do checklist)', async () => {
    for (const p of provedoresPullCadastros) {
      const { linhas } = await tudo(p, A.tenantId, 50);
      // ADR 0034: o provedor legado `concorrente` devolve página vazia de propósito (a lista é do Catálogo)
      if (p.entidade.nome === 'concorrente') expect(linhas, p.entidade.nome).toEqual([]);
      else expect(linhas.length, p.entidade.nome).toBeGreaterThan(0);
      for (const l of linhas) expect(() => p.entidade.schema.parse(l), p.entidade.nome).not.toThrow();
    }
    const metas = (await tudo(prov('meta_share'), A.tenantId, 50)).linhas as unknown as { meta_pct: number; vigencia_inicio: string; vigencia_fim: string | null }[];
    expect(typeof metas[0]!.meta_pct).toBe('number');
    expect(metas[0]!.vigencia_inicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const checklists = (await tudo(prov('checklist_loja'), A.tenantId, 50)).linhas as unknown as { itens: { id: string }[] }[];
    expect(Array.isArray(checklists[0]!.itens)).toBe(true);
  });

  it('cursor (updated_at, id): pagina sem repetir nem pular, em ordem, com a lápide e a edição aparecendo no fim', async () => {
    const p = prov('categoria_gondola');
    const novos = Array.from({ length: 5 }, (_, i) => ({ id: randomUUID(), nome: `Cat pull ${randomUUID().slice(0, 8)} ${i}` }));
    for (const n of novos) {
      // transações separadas: cada uma com o próprio updated_at (now() do banco)
      await comTenant(pool, A.tenantId, (c) => c.query('insert into promotor.categoria_gondola (id, tenant_id, nome, ordem, ativo) values ($1, $2, $3, $4, true)', [n.id, A.tenantId, n.nome, 99]));
    }
    // Outros arquivos .db.test gravam no mesmo banco/tenant em paralelo: as asserções valem sobre o que existia ANTES da
    // paginação (nenhuma pulada) e sobre os ids deste caso (ordem), nunca sobre o total nem sobre as últimas linhas.
    const existentes = (await comTenant(pool, A.tenantId, (c) => c.query<{ id: string }>('select id from promotor.categoria_gondola'))).rows.map((r) => r.id);
    const antes = await tudo(p, A.tenantId, 2);
    const idsAntes = antes.linhas.map((l) => l.id);
    expect(new Set(idsAntes).size).toBe(idsAntes.length); // nenhuma repetida
    expect(antes.paginas).toBeGreaterThan(2); // de fato paginou
    for (const id of existentes) expect(idsAntes, `linha ${id} pulada pela paginação`).toContain(id); // nenhuma pulada (inclui removidas)
    const ordenada = [...antes.linhas].sort((x, y) => Date.parse(x.updated_at) - Date.parse(y.updated_at) || (x.id < y.id ? -1 : 1));
    expect(idsAntes).toEqual(ordenada.map((l) => l.id));
    const ids = new Set(novos.map((n) => n.id));
    expect(idsAntes.filter((id) => ids.has(id))).toEqual(novos.map((n) => n.id)); // a ordem de gravação

    // remoção lógica de um e edição de outro: voltam depois do cursor, o removido como lápide
    const [remover, editar] = [novos[1]!, novos[3]!];
    await comTenant(pool, A.tenantId, (c) => c.query('update promotor.categoria_gondola set deleted_at = now() where id = $1', [remover.id]));
    await comTenant(pool, A.tenantId, (c) => c.query('update promotor.categoria_gondola set nome = $2 where id = $1', [editar.id, `${editar.nome} editada`]));
    const ult = antes.linhas[antes.linhas.length - 1]!;
    const depois = (await pagina(p, A.tenantId, { desde: { updated_at: ult.updated_at, id: ult.id }, ate: await horizonte(), limite: 50 })).filter((l) => ids.has(l.id)); // só as deste caso
    expect(depois.map((l) => l.id)).toEqual([remover.id, editar.id]);
    expect(depois[0]!.deleted_at).toMatch(/Z$/); // lápide
    expect(depois[1]!.deleted_at).toBeNull();
    expect((depois[1] as unknown as { nome: string }).nome).toBe(`${editar.nome} editada`);
    // cursor no fim: nada mais
    const fim = depois[depois.length - 1]!;
    expect((await pagina(p, A.tenantId, { desde: { updated_at: fim.updated_at, id: fim.id }, ate: await horizonte(), limite: 50 })).filter((l) => ids.has(l.id))).toEqual([]);
  });

  it('horizonte seguro: linha com updated_at >= `ate` não vem ainda', async () => {
    const p = prov('categoria_gondola');
    const id = randomUUID();
    await comTenant(pool, A.tenantId, (c) => c.query('insert into promotor.categoria_gondola (id, tenant_id, nome, ordem, ativo) values ($1, $2, $3, 1, true)', [id, A.tenantId, `Cat ${id.slice(0, 8)}`]));
    const antesDela = new Date(Date.now() - 3_600_000).toISOString();
    expect((await pagina(p, A.tenantId, { desde: null, ate: antesDela, limite: 500 })).map((l) => l.id)).not.toContain(id);
    expect((await pagina(p, A.tenantId, { desde: null, ate: await horizonte(), limite: 500 })).map((l) => l.id)).toContain(id);
  });

  it('ADR 0034: a entidade legada `concorrente` devolve página vazia (o APK antigo não recebe 404 e a lista é do Catálogo)', async () => {
    expect(await pagina(prov('concorrente'), A.tenantId, { desde: null, ate: await horizonte(), limite: 500 })).toEqual([]);
  });

  it('RN-CORE-05: o tenant B recebe só os cadastros dele, nos 8 com tabela; nenhum id de A', async () => {
    for (const p of provedoresPullCadastros.filter((x) => x.entidade.nome !== 'concorrente')) {
      const deA = new Set((await tudo(p, A.tenantId, 50)).linhas.map((l) => l.id));
      const deB = (await tudo(p, B.tenantId, 50)).linhas.map((l) => l.id);
      expect(deB.length, p.entidade.nome).toBeGreaterThan(0);
      expect(deB.some((id) => deA.has(id)), p.entidade.nome).toBe(false);
    }
  });
});
