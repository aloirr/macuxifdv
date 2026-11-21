/**
 * 0092 — código do nó único entre os irmãos (RN-CAT-18, RF-CAT-04; R-20261120-235317-alexandre).
 * Dicionário: docs/banco/catalogo.md, "0092".
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { comoPapel, emTransacao, erroDe, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0092';
const m92 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m92) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m92.up);
const down = semComentarios(m92.down);
const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const INDICE_NOVO =
  "CREATE UNIQUE INDEX catalogo_no_pai_codigo_uk ON catalogo.catalogo_no USING btree (tenant_id, COALESCE(pai_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo) WHERE (deleted_at IS NULL)";
const INDICE_ANTIGO = 'CREATE UNIQUE INDEX catalogo_no_codigo_uk ON catalogo.catalogo_no USING btree (tenant_id, codigo) WHERE (deleted_at IS NULL)';

describe('0092 código do nó único entre os irmãos (estático)', () => {
  it('nome; up troca só o índice; down recria o da 0013', () => {
    expect(m92.nome).toBe('catalogo_no_codigo_por_pai');
    expect(up).toContain('drop index catalogo.catalogo_no_codigo_uk;');
    expect(up).toMatch(
      /create unique index catalogo_no_pai_codigo_uk on catalogo\.catalogo_no\s+\(tenant_id, coalesce\(pai_id, '00000000-0000-0000-0000-000000000000'::uuid\), codigo\) where deleted_at is null;/,
    );
    expect(up).not.toMatch(/create table|alter table|create policy|alter policy|create (or replace )?function|\bgrant\b|\brevoke\b/);
    expect(down).toContain('drop index catalogo.catalogo_no_pai_codigo_uk;');
    expect(down).toContain('create unique index catalogo_no_codigo_uk on catalogo.catalogo_no (tenant_id, codigo) where deleted_at is null;');
    expect(m92.up).toContain('RN-CAT-18');
    expect(m92.up).toContain('R-20261120-235317-alexandre');
  });
});

describe.skipIf(semBanco())('0092 código do nó único entre os irmãos (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  /** Insere um nó como o macuxi_app (RLS do tenant); devolve o id. */
  async function no(t: string, pai: string | null, codigo: string, nome = codigo): Promise<string> {
    const id = randomUUID();
    await comoPapel(
      admin,
      'macuxi_app',
      'insert into catalogo.catalogo_no (id, tenant_id, pai_id, nivel, codigo, nome) values ($1, $2, $3, $4, $5, $6)',
      [id, t, pai, pai ? 2 : 1, codigo, nome],
      t,
    );
    return id;
  }
  /** null = aceito; senão o SQLSTATE e se a recusa veio do índice novo. */
  const recusa = async (p: Promise<unknown>) => {
    const e = await erroDe(p);
    return e && { code: e.code, indice: e.message.includes('catalogo_no_pai_codigo_uk') };
  };

  it('o índice novo está no banco e o antigo não', async () => {
    const r = await admin.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'catalogo' and tablename = 'catalogo_no' and indexname in ('catalogo_no_codigo_uk', 'catalogo_no_pai_codigo_uk')",
    );
    expect(r.rows.map((x) => x.indexdef)).toEqual([INDICE_NOVO]);
  });

  it('mesmo código sob pais diferentes é aceito (NAO_CLASSIFICADO sob Outros e sob Filtração)', async () => {
    await emTransacao(admin, null, async () => {
      const outros = await no(A, null, 'OUTROS', 'Outros');
      const filtracao = await no(A, null, 'FILTRACAO', 'Filtração');
      await no(A, outros, 'NAO_CLASSIFICADO');
      expect(await recusa(no(A, filtracao, 'NAO_CLASSIFICADO'))).toBeNull();
    });
  });

  it('OUTROS raiz + OUTROS filho de Outros é aceito', async () => {
    await emTransacao(admin, null, async () => {
      const raiz = await no(A, null, 'OUTROS', 'Outros');
      expect(await recusa(no(A, raiz, 'OUTROS', 'Outros'))).toBeNull();
    });
  });

  it('dois iguais sob o mesmo pai são recusados (23505)', async () => {
    await emTransacao(admin, null, async () => {
      const pai = await no(A, null, 'OUTROS');
      await no(A, pai, 'NAO_CLASSIFICADO');
      expect(await recusa(no(A, pai, 'NAO_CLASSIFICADO'))).toEqual({ code: '23505', indice: true });
    });
  });

  it('duas raízes iguais são recusadas (23505); a raiz da fixture também conta', async () => {
    await emTransacao(admin, null, async () => {
      await no(A, null, 'OUTROS');
      expect(await recusa(no(A, null, 'OUTROS'))).toEqual({ code: '23505', indice: true });
      expect(await recusa(no(A, null, 'FREIOS'))).toEqual({ code: '23505', indice: true });
    });
  });

  it('nó apagado (deleted_at) não conta: sob o mesmo pai e entre as raízes', async () => {
    await emTransacao(admin, null, async () => {
      const pai = await no(A, null, 'OUTROS');
      const filho = await no(A, pai, 'NAO_CLASSIFICADO');
      await comoPapel(admin, 'macuxi_app', 'update catalogo.catalogo_no set deleted_at = now() where id = $1', [filho], A);
      expect(await recusa(no(A, pai, 'NAO_CLASSIFICADO'))).toBeNull();
      const raiz = await no(A, null, 'ACESSORIOS');
      await comoPapel(admin, 'macuxi_app', 'update catalogo.catalogo_no set deleted_at = now() where id = $1', [raiz], A);
      expect(await recusa(no(A, null, 'ACESSORIOS'))).toBeNull();
    });
  });

  it('isolamento por tenant: o mesmo código de raiz em A e em B é aceito', async () => {
    await emTransacao(admin, null, async () => {
      await no(A, null, 'OUTROS');
      expect(await recusa(no(B, null, 'OUTROS'))).toBeNull();
      // a raiz FREIOS da fixture é só do A
      expect(await recusa(no(B, null, 'FREIOS'))).toBeNull();
      expect(await recusa(no(A, null, 'LUB'))).toBeNull();
    });
  });
});

describe.skipIf(semBanco())('0092 código do nó único entre os irmãos (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up troca só o índice; down volta ao catálogo anterior; up de novo = igual; down falha com código repetido em ramos diferentes', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual(['0092_catalogo_no_codigo_por_pai']);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((x) => !depois.includes(x))).toEqual([`idx catalogo ${INDICE_ANTIGO}`, 'rel catalogo.catalogo_no_codigo_uk i rls=false force=false']);
      expect(depois.filter((x) => !antes.includes(x))).toEqual([`idx catalogo ${INDICE_NOVO}`, 'rel catalogo.catalogo_no_pai_codigo_uk i rls=false force=false']);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0092_catalogo_no_codigo_por_pai']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);

      // com OUTROS raiz + OUTROS filho, o down falha (23505) e a 0092 continua aplicada
      const t = randomUUID();
      await c.query("insert into plataforma.tenant (id, nome, codigo) values ($1, 'Tenant 0092', 'teste-0092')", [t]);
      const raiz = randomUUID();
      await c.query("insert into catalogo.catalogo_no (id, tenant_id, pai_id, nivel, codigo, nome) values ($1, $2, null, 1, 'OUTROS', 'Outros')", [raiz, t]);
      await c.query("insert into catalogo.catalogo_no (id, tenant_id, pai_id, nivel, codigo, nome) values ($1, $2, $3, 2, 'OUTROS', 'Outros')", [randomUUID(), t, raiz]);
      const falha = await migrarDown(c, { passos: 1 }).then(() => null, (e: Error) => e);
      expect(falha?.message).toContain('Falha ao desfazer 0092_catalogo_no_codigo_por_pai.down.sql');
      expect((falha?.cause as { code?: string } | undefined)?.code).toBe('23505');
      expect((await c.query<{ versao: string }>("select versao from public.macuxi_migracao where versao = '0092'")).rows).toHaveLength(1);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
