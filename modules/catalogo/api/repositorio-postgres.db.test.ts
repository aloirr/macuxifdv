/**
 * Escritas do BKO do Catálogo × Postgres real (T-0052, revisão 🟡1-🟡3): sinônimo (ON CONFLICT com índice parcial e
 * `xmax = 0`), destaque (campanha e destaque coerentes), conteúdo com troca da lista de atributos, busca_log, idempotência
 * e RLS (o tenant B não vê nem altera o A). Pula sem Postgres; roda no CI.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoBase, LinhaSync, PedidoPull, TransacaoTenant } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SalvarConteudo } from '../contracts';
import type { RepositorioCatalogo } from './repositorio';
import { criarRepositorioPostgres } from './repositorio-postgres';
import { provedoresSyncCatalogo } from './sync';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n: number) => `0ca00000-0000-4000-8000-${String(910000 + n).padStart(12, '0')}`;
const SIN = id(1);
const SIN_OUTRO = id(2);
const SIN_B = id(3);
const P_SEED = id(11); // espelha DET-5L da seed: destaque=true, campanha=false
const P_CONT = id(12);
const P_VAZIO = id(13);
const USUARIO = id(90);
const TERMO_LOG = 't52-db-termo-unico';
const AGORA = '2026-11-05T12:00:00.000Z'; // hora-fixa-ok: instante injetado no contexto, não o relógio

describe.skipIf(semBanco())('Catálogo × Postgres: escritas do BKO (T-0052)', () => {
  let pool: pg.Pool;

  /** Repositório do tenant dentro da transação (como a rota faz em `ctx.comTenant`). */
  async function noTenant<T>(tenant: string, fn: (repo: RepositorioCatalogo, db: pg.ClientBase) => Promise<T>): Promise<T> {
    const ctx = { usuario: { id: USUARIO, tenant_id: tenant, perfil: 'analista' }, agora: () => new Date(AGORA) } as unknown as ContextoBase;
    return comTenant(pool, tenant, (c) => fn(criarRepositorioPostgres()(ctx, c as never, {} as TransacaoTenant), c));
  }
  const puxar = async (tenant: string, nome: string) => {
    const ctx = {
      usuario: { perfil: 'promotor', tenant_id: tenant },
      comTenant: (fn: (db: pg.ClientBase) => Promise<unknown>) => comTenant(pool, tenant, (c) => fn(c)),
      carteira: async () => 'tenant',
      parametros: () => ({}),
    } as unknown as ContextoBase;
    const pedido = { ate: '2099-01-01T00:00:00.000Z', desde: null, limite: 1000 } as unknown as PedidoPull;
    return (await provedoresSyncCatalogo.find((x) => x.entidade.nome === nome)!.puxar!(ctx, pedido)) as (LinhaSync & Record<string, unknown>)[];
  };

  async function limpar() {
    for (const t of [A.tenantId, B.tenantId]) {
      await comTenant(pool, t, async (c) => {
        await c.query('delete from catalogo.sinonimo where id = any($1::uuid[])', [[SIN, SIN_OUTRO, SIN_B]]);
        await c.query('delete from catalogo.produto_atributo where produto_id = any($1::uuid[])', [[P_SEED, P_CONT, P_VAZIO]]);
        await c.query('delete from catalogo.produto_conteudo where produto_id = any($1::uuid[])', [[P_SEED, P_CONT, P_VAZIO]]);
        await c.query('delete from catalogo.busca_log where termo = $1', [TERMO_LOG]);
      });
    }
  }

  const conteudo = (atributos: { name: string; value: string }[], descricao = 'Descrição'): SalvarConteudo => ({
    description: descricao,
    selling_points: ['Rende mais', 'Não mancha'],
    faq: [{ question: 'Serve em inox?', answer: 'Sim.' }],
    attributes: atributos,
  });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    await limpar();
    await comTenant(pool, A.tenantId, (c) =>
      c.query('insert into catalogo.produto_conteudo (tenant_id, produto_id, destaque, campanha) values ($1, $2, true, false)', [A.tenantId, P_SEED]),
    );
  });
  afterAll(async () => {
    await limpar();
    await pool?.end();
  });

  it('RF-CAT-02: PUT de sinônimo duas vezes com o mesmo id é idempotente (criado true, depois false) e atualiza', async () => {
    const s = { term: 'T52 Moto', synonyms: ['motocicleta'], active: true };
    expect(await noTenant(A.tenantId, (r) => r.salvarSinonimo(SIN, s))).toEqual({ criado: true });
    expect(await noTenant(A.tenantId, (r) => r.salvarSinonimo(SIN, { ...s, synonyms: ['motocicleta', 'moto'] }))).toEqual({ criado: false });
    const lista = (await noTenant(A.tenantId, (r) => r.sinonimos())).filter((x) => x.id === SIN);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ term: 'T52 Moto', synonyms: ['motocicleta', 'moto'], active: true });
  });

  it('RF-CAT-02: o mesmo termo em outro grupo (mesmo inativo) = 409 SINONIMO_EM_CONFLITO, não 500; em outro tenant pode', async () => {
    await expect(noTenant(A.tenantId, (r) => r.salvarSinonimo(SIN_OUTRO, { term: 't52 MOTO', synonyms: ['x1'], active: false }))).rejects.toMatchObject({
      status: 409,
      codigo: 'SINONIMO_EM_CONFLITO',
    });
    expect(await noTenant(B.tenantId, (r) => r.salvarSinonimo(SIN_B, { term: 'T52 Moto', synonyms: ['x1'], active: true }))).toEqual({ criado: true });
  });

  it('RF-CAT-02: remover é lógico e idempotente; o pull leva o deleted_at e o termo pode ser reusado', async () => {
    expect(await noTenant(A.tenantId, (r) => r.removerSinonimo(SIN))).toBe(true);
    expect(await noTenant(A.tenantId, (r) => r.removerSinonimo(SIN))).toBe(false);
    expect((await noTenant(A.tenantId, (r) => r.sinonimos())).map((x) => x.id)).not.toContain(SIN);
    const linha = (await puxar(A.tenantId, 'sinonimo')).find((l) => l.id === SIN);
    expect(linha?.deleted_at).not.toBeNull();
    expect(await noTenant(A.tenantId, (r) => r.salvarSinonimo(SIN_OUTRO, { term: 'T52 Moto', synonyms: ['x1'], active: true }))).toEqual({ criado: true });
  });

  it('RF-CAT-07: desmarcar o destaque da linha da seed (destaque=true) tem efeito; as duas colunas ficam coerentes', async () => {
    const ler = () =>
      noTenant(A.tenantId, async (_r, c) => (await c.query('select campanha, destaque from catalogo.produto_conteudo where produto_id = $1 and deleted_at is null', [P_SEED])).rows[0]);
    expect(await ler()).toEqual({ campanha: false, destaque: true });
    await noTenant(A.tenantId, (r) => r.marcarDestaque(P_SEED, false));
    expect(await ler()).toEqual({ campanha: false, destaque: false });
    await noTenant(A.tenantId, (r) => r.marcarDestaque(P_SEED, true));
    expect(await ler()).toEqual({ campanha: true, destaque: true });
    expect((await puxar(A.tenantId, 'produto_conteudo')).find((l) => l.produto_id === P_SEED)?.campanha).toBe(true);
    await noTenant(A.tenantId, (r) => r.marcarDestaque(P_SEED, false));
    expect((await puxar(A.tenantId, 'produto_conteudo')).find((l) => l.produto_id === P_SEED)?.campanha).toBe(false);
  });

  it('RF-CAT-07: destaque num produto sem conteúdo cria a linha (upsert) e repetir não duplica', async () => {
    await noTenant(A.tenantId, (r) => r.marcarDestaque(P_VAZIO, true));
    await noTenant(A.tenantId, (r) => r.marcarDestaque(P_VAZIO, true));
    const n = await noTenant(A.tenantId, async (_r, c) => (await c.query('select count(*)::int as n from catalogo.produto_conteudo where produto_id = $1 and deleted_at is null', [P_VAZIO])).rows[0].n);
    expect(n).toBe(1);
  });

  it('RF-CAT-03: salvarConteudo duas vezes (criado true, depois false); o atributo removido sai com deleted_at e aparece no pull', async () => {
    const a1 = [
      { name: 'Cor', value: 'Azul' },
      { name: 'Peso', value: '1 kg' },
    ];
    expect(await noTenant(A.tenantId, (r) => r.salvarConteudo(P_CONT, conteudo(a1), AGORA))).toEqual({ criado: true });
    const a2 = [
      { name: 'Peso', value: '2 kg' },
      { name: 'Marca', value: 'Macuxi' },
    ];
    expect(await noTenant(A.tenantId, (r) => r.salvarConteudo(P_CONT, conteudo(a2, 'Nova'), AGORA))).toEqual({ criado: false });

    const { conteudo: c } = await noTenant(A.tenantId, (r) => r.conteudo(P_CONT));
    expect(c).toMatchObject({ descricao: 'Nova' });
    const vivos = await noTenant(A.tenantId, async (_r, db) => (await db.query('select nome, valor from catalogo.produto_atributo where produto_id = $1 and deleted_at is null order by ordem', [P_CONT])).rows);
    expect(vivos).toEqual([
      { nome: 'Peso', valor: '2 kg' },
      { nome: 'Marca', valor: 'Macuxi' },
    ]);

    const pull = (await puxar(A.tenantId, 'produto_atributo')).filter((l) => l.produto_id === P_CONT);
    expect(pull.find((l) => l.nome === 'Cor')?.deleted_at).not.toBeNull();
    expect(pull.find((l) => l.nome === 'Peso')).toMatchObject({ valor: '2 kg', deleted_at: null });

    // atributo removido e reenviado volta a viver (índice parcial: nova linha viva)
    await noTenant(A.tenantId, (r) => r.salvarConteudo(P_CONT, conteudo([...a2, { name: 'Cor', value: 'Verde' }]), AGORA));
    const vivos2 = await noTenant(A.tenantId, async (_r, db) => (await db.query('select nome from catalogo.produto_atributo where produto_id = $1 and deleted_at is null', [P_CONT])).rows.map((x) => x.nome as string));
    expect(vivos2.sort()).toEqual(['Cor', 'Marca', 'Peso']);
  });

  it('RF-CAT-03: argumentos e FAQ saem do pull no formato do contrato', async () => {
    const l = (await puxar(A.tenantId, 'produto_conteudo')).find((x) => x.produto_id === P_CONT);
    expect(l).toMatchObject({ argumentos: ['Rende mais', 'Não mancha'], faq: [{ pergunta: 'Serve em inox?', resposta: 'Sim.' }] });
  });

  it('RLS: o tenant B não vê nem grava no conteúdo, no destaque e no sinônimo do A', async () => {
    expect((await noTenant(B.tenantId, (r) => r.conteudo(P_CONT))).conteudo).toBeNull();
    expect((await puxar(B.tenantId, 'produto_conteudo')).map((l) => l.produto_id)).not.toContain(P_CONT);
    expect((await puxar(B.tenantId, 'produto_atributo')).map((l) => l.produto_id)).not.toContain(P_CONT);
    expect((await noTenant(B.tenantId, (r) => r.sinonimos())).map((x) => x.id)).not.toContain(SIN_OUTRO);
    expect(await noTenant(B.tenantId, (r) => r.removerSinonimo(SIN_OUTRO))).toBe(false);
    // o mesmo id do A, gravado pelo B, não toca a linha do A (a política de RLS recusa)
    await noTenant(B.tenantId, (r) => r.salvarSinonimo(SIN_OUTRO, { term: 'T52 invasor', synonyms: ['x2'], active: true })).catch(() => undefined);
    const doA = (await noTenant(A.tenantId, (r) => r.sinonimos())).find((x) => x.id === SIN_OUTRO);
    expect(doA?.term).toBe('T52 Moto');
  });

  it('RF-CAT-07: registrarBusca grava o termo normalizado no tenant (llm vira llm; o resto, regras)', async () => {
    await noTenant(A.tenantId, (r) => r.registrarBusca({ termo: TERMO_LOG, resultados: 0, interpretado_por: 'llm', em: AGORA }));
    await noTenant(A.tenantId, (r) => r.registrarBusca({ termo: TERMO_LOG, resultados: 3, interpretado_por: 'nenhum', em: AGORA }));
    const linhas = await noTenant(A.tenantId, async (_r, db) => (await db.query('select origem, resultados, usuario_id from catalogo.busca_log where termo = $1 order by resultados', [TERMO_LOG])).rows);
    expect(linhas).toEqual([
      { origem: 'llm', resultados: 0, usuario_id: USUARIO },
      { origem: 'regras', resultados: 3, usuario_id: USUARIO },
    ]);
    const sem = await noTenant(A.tenantId, (r) => r.termosSemResultado('2026-11-01T00:00:00.000Z', 50));
    expect(sem.find((t) => t.term === TERMO_LOG)).toMatchObject({ count: 1 });
    expect((await noTenant(B.tenantId, (r) => r.termosSemResultado('2026-11-01T00:00:00.000Z', 50))).map((t) => t.term)).not.toContain(TERMO_LOG);
  });
});
