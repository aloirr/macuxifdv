/**
 * Cadastros de trade do BKO × Postgres real (T-0069): as rotas de escrita, com o repositório SQL, e o PULL do app lendo as
 * mesmas tabelas (`provedoresPullCadastros`, cursor `(updated_at, id)`). Prova que criar, editar e desativar chegam ao
 * aparelho no próximo pull, sem migração: a edição volta com o `updated_at` novo e a desativação como lápide
 * (`deleted_at`). Também cobre RLS (tenant B não vê nem mexe), nome duplicado (409) e FK composta da categoria.
 * Pula sem Postgres/Docker (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { agoraDaFixture, comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { type ContextoBase, type ErroHttpModulo, type LinhaSync, type RotaModulo } from '@macuxi/platform-sdk';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAMINHO_CADASTRO, EDICAO_CADASTRO, FiltroCadastro, type CadastroBko, type CadastroGravavel } from '../contracts';
import { criarCtx } from './apoio-teste';
import { criarModuloApiPromotor, criarRepositorioSql, provedoresPullCadastros } from './index';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;

describe.skipIf(semBanco())('Promotor: cadastros do BKO × pull no Postgres (updated_at, lápide, RLS)', () => {
  let pool: pg.Pool;
  const relogio = criarRelogio({ agora: agoraDaFixture(), fuso: A.fuso });
  const api = criarModuloApiPromotor({ repositorio: criarRepositorioSql() });
  const rota = (metodo: string, caminho: string): RotaModulo => api.rotas!.find((r) => r.metodo === metodo && r.caminho === caminho)!;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  /** Contexto de rota com `comTenant` no Postgres (transação do tenant, macuxi_app) e `tx` do teste (auditoria capturada). */
  function ctxRota(tenant: string, perfil: 'analista' | 'supervisor' = 'analista') {
    const c = criarCtx(relogio, { tenant, usuario: randomUUID(), perfil, carteira: 'tenant', usuarios: 'tenant' });
    const ctx: ContextoBase = { ...c.ctx, comTenant: (fn) => c.ctx.comTenant((_falso, tx) => comTenant(pool, tenant, (db) => fn(db, tx))) };
    return { ...c, rota: <C, Q, P>(e: { corpo?: C; query?: Q; params?: P }) => ({ ...ctx, corpo: e.corpo as never, query: e.query as never, params: e.params as never }) };
  }
  const post = (c: CadastroGravavel, corpo: unknown, t = A.tenantId) => rota('POST', CAMINHO_CADASTRO[c]).executar(ctxRota(t).rota({ corpo: EDICAO_CADASTRO[c].parse(corpo) })) as Promise<Record<string, unknown>>;
  const put = (c: CadastroGravavel, id: string, corpo: unknown) => rota('PUT', `${CAMINHO_CADASTRO[c]}/:id`).executar(ctxRota(A.tenantId).rota({ corpo: EDICAO_CADASTRO[c].parse(corpo), params: { id } })) as Promise<Record<string, unknown>>;
  const del = (c: CadastroBko, id: string, t = A.tenantId) => rota('DELETE', `${CAMINHO_CADASTRO[c]}/:id`).executar(ctxRota(t).rota({ params: { id } })) as Promise<Record<string, unknown>>;
  const erro = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as ErroHttpModulo);

  const pullCtx = (tenant: string): ContextoBase => ({ usuario: { id: A.usuarios.promotor, tenant_id: tenant, perfil: 'promotor' }, comTenant: (fn: (db: pg.ClientBase) => Promise<unknown>) => comTenant(pool, tenant, (c) => fn(c)) }) as unknown as ContextoBase;
  const horizonte = async () => ((await pool.query<{ t: Date }>("select now() + interval '1 minute' as t")).rows[0]!.t).toISOString();
  /** Tudo que o pull entrega depois do cursor (a promotora que já sincronizou até `ate`). */
  async function pullDepois(entidade: string, tenant: string, ult: LinhaSync | null): Promise<LinhaSync[]> {
    const p = provedoresPullCadastros.find((x) => x.entidade.nome === entidade)!;
    return p.puxar!(pullCtx(tenant), { desde: ult ? { updated_at: ult.updated_at, id: ult.id } : null, ate: await horizonte(), limite: 500 });
  }
  const ultima = async (entidade: string, tenant: string) => (await pullDepois(entidade, tenant, null)).at(-1) ?? null;

  it('RN-PRO-12: categoria com meta viva = 422 CADASTRO_EM_USO (contagem no tenant); desativada a meta, a categoria desativa', async () => {
    const cat = randomUUID();
    const metaId = randomUUID();
    await post('categoria_gondola', { id: cat, nome: `Uso ${cat}`, ordem: 1, ativo: true });
    await post('meta_share', { id: metaId, categoria_gondola_id: cat, meta_pct: 40, cliente_id: null, segmento: null, vigencia_inicio: '2026-11-01', vigencia_fim: null });
    expect(await erro(del('categoria_gondola', cat))).toMatchObject({ status: 422, codigo: 'CADASTRO_EM_USO', detalhes: { metas_share: 1, mix_obrigatorio: 0, produtos_concorrente: 0 } });
    await del('meta_share', metaId);
    expect(await del('categoria_gondola', cat)).toMatchObject({ ativo: false });
  });

  it('categoria e meta de share: criar, editar e desativar aparecem no pull seguinte (updated_at novo; lápide com deleted_at)', async () => {
    const cat = randomUUID();
    const metaId = randomUUID();
    const cursorCat = await ultima('categoria_gondola', A.tenantId);
    const cursorMeta = await ultima('meta_share', A.tenantId);

    await post('categoria_gondola', { id: cat, nome: `Cat BKO ${cat.slice(0, 8)}`, ordem: 90, ativo: true });
    await post('meta_share', { id: metaId, categoria_gondola_id: cat, meta_pct: 42.5, cliente_id: null, segmento: null, vigencia_inicio: '2026-11-01', vigencia_fim: null });
    const criada = (await pullDepois('categoria_gondola', A.tenantId, cursorCat)).find((l) => l.id === cat)!;
    expect(criada.deleted_at).toBeNull();
    expect((await pullDepois('meta_share', A.tenantId, cursorMeta)).find((l) => l.id === metaId)).toMatchObject({ meta_pct: 42.5 });

    // a promotora já sincronizou até aqui; agora o admin edita e desativa
    const cursor1 = await ultima('categoria_gondola', A.tenantId);
    await put('categoria_gondola', cat, { id: cat, nome: `Cat BKO ${cat.slice(0, 8)} editada`, ordem: 91, ativo: true });
    const editada = await pullDepois('categoria_gondola', A.tenantId, cursor1);
    expect(editada.map((l) => l.id)).toEqual([cat]);
    expect(editada[0]).toMatchObject({ ordem: 91, deleted_at: null });
    expect(Date.parse(editada[0]!.updated_at)).toBeGreaterThan(Date.parse(criada.updated_at));

    const cursor2 = await ultima('categoria_gondola', A.tenantId);
    await del('meta_share', metaId);
    await del('categoria_gondola', cat);
    const lapide = await pullDepois('categoria_gondola', A.tenantId, cursor2);
    expect(lapide.map((l) => l.id)).toEqual([cat]);
    expect(lapide[0]!.deleted_at).toMatch(/Z$/);
    expect(lapide[0]).toMatchObject({ ativo: false });
    expect((await pullDepois('meta_share', A.tenantId, cursorMeta)).find((l) => l.id === metaId)!.deleted_at).toMatch(/Z$/);
    // a linha continua no banco (nunca apaga)
    const n = await comTenant(pool, A.tenantId, (c) => c.query<{ n: string }>('select count(*) as n from promotor.categoria_gondola where id = $1', [cat]));
    expect(n.rows[0]!.n).toBe('1');
  });

  it('checklist com etapas obrigatórias e opcionais chega ao pull no formato do contrato', async () => {
    const id = randomUUID();
    const cursor = await ultima('checklist_loja', A.tenantId);
    const itens = [1, 2].map((n) => ({ id: randomUUID(), rotulo: `Etapa ${n}`, tipo: 'marcar', obrigatoria: n === 1, ordem: n, categoria_gondola_id: null }));
    await post('checklist_loja', { id, nome: `Rotina ${id.slice(0, 8)}`, itens, cliente_id: null, segmento: 'Atacado', vigencia_inicio: '2026-11-01', vigencia_fim: null });
    const linha = (await pullDepois('checklist_loja', A.tenantId, cursor)).find((l) => l.id === id)!;
    expect(() => provedoresPullCadastros.find((p) => p.entidade.nome === 'checklist_loja')!.entidade.schema.parse(linha)).not.toThrow();
    expect((linha as unknown as { itens: { obrigatoria: boolean }[] }).itens.map((i) => i.obrigatoria)).toEqual([true, false]);
  });

  it('nome duplicado entre as vivas = 409; categoria inexistente na meta = 422; leitura lista só as vivas', async () => {
    const nome = `Dup ${randomUUID().slice(0, 8)}`;
    const id = randomUUID();
    await post('categoria_gondola', { id, nome, ordem: 1, ativo: true });
    expect(await erro(post('categoria_gondola', { id: randomUUID(), nome: nome.toUpperCase(), ordem: 2, ativo: true }))).toMatchObject({ status: 409, codigo: 'CADASTRO_DUPLICADO' });
    expect(await erro(post('meta_share', { id: randomUUID(), categoria_gondola_id: randomUUID(), meta_pct: 10, cliente_id: null, segmento: null, vigencia_inicio: '2026-11-01', vigencia_fim: null }))).toMatchObject({ status: 422, codigo: 'REFERENCIA_INVALIDA' });
    await del('categoria_gondola', id);
    const lista = (await rota('GET', CAMINHO_CADASTRO.categoria_gondola).executar(ctxRota(A.tenantId).rota({ query: FiltroCadastro.parse({}) }))) as { itens: { id: string }[] };
    expect(lista.itens.map((i) => i.id)).not.toContain(id);
  });

  it('RLS (RN-CORE-05): o tenant B não lê nem desativa cadastro de A; o pull de B não traz a linha', async () => {
    const id = randomUUID();
    await post('categoria_gondola', { id, nome: `Só A ${id.slice(0, 8)}`, ordem: 1, ativo: true });
    expect(await erro(del('categoria_gondola', id, B.tenantId))).toMatchObject({ status: 404 });
    expect((await pullDepois('categoria_gondola', B.tenantId, null)).map((l) => l.id)).not.toContain(id);
  });
});
