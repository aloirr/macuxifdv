/**
 * 0034 — catalogo.produto_referencia.marca_nome (T-0085; ADR 0027 reescrita, "Caminho para fechar o risco 2"; aviso
 * R-20261105-225102-engenheiro-software). O que o BANCO garante: coluna text NULA (sem backfill: a migração do Catálogo não lê
 * o schema promotor, regra 1), CHECK produto_referencia_marca_nome_preenchida (nulo, ou não vazia e até 120 caracteres, como o
 * nome do concorrente do Promotor), sem índice, sem política nova, isolada pela isolamento_tenant da 0033; a fixture leva o
 * nome nas vivas e deixa a apagada nula. Down volta exatamente ao catálogo da 0033, com as referências intactas.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * Os casos de banco rodam no CI (sem Docker no PC do dono do produto, R-20261105-053835).
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCatalogo from '../../modules/catalogo/db/nuvem';
import { migracoesAparelho } from '../../modules/catalogo/db/aparelho';
import { dadosDoisTenants, DOIS_TENANTS, MARCA_NOME_FIXTURE, REFERENCIAS_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { PROMOTOR_FIXTURE } from '../seeds/fixtures/promotor';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m34 = migracoes.find((m) => m.versao === '0034')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

describe('0034 produto_referencia.marca_nome (estático)', () => {
  it('nome e posição: 0034_catalogo_referencia_marca_nome logo depois da 0033', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0033_catalogo_aplicacao_referencia') + 1]).toBe('0034_catalogo_referencia_marca_nome');
  });

  it('coluna text nula sem padrão e CHECK 1..120; sem índice, política, grant nem backfill', () => {
    const sql = semComentarios(m34.up);
    expect(sql).toContain('alter table catalogo.produto_referencia add column marca_nome text;');
    expect(sql).toContain(
      "check (marca_nome is null or (btrim(marca_nome) <> '' and char_length(marca_nome) <= 120));",
    );
    expect([...sql.matchAll(/add constraint ([a-z_]+)/g)].map((x) => x[1])).toEqual(['produto_referencia_marca_nome_preenchida']);
    expect(sql).not.toMatch(/create (unique )?index|create policy|grant |revoke |update |delete from|default |(?<!is )not null/);
  });

  it('regra 1 (ADR 0005): a migração do Catálogo não lê nem toca outro schema de módulo', () => {
    const sql = semComentarios(m34.up);
    expect(sql).not.toMatch(/\b(promotor|core|vendedor|gestor|pesquisa|treinamento|integracao)\./);
    expect([...sql.matchAll(/\b([a-z_]+)\.[a-z_]+/g)].map((x) => x[1])).toEqual(['catalogo', 'catalogo']);
  });

  it('down desfaz tudo o que o up cria (idempotente)', () => {
    const down = semComentarios(m34.down);
    expect(down).toContain('alter table catalogo.produto_referencia drop constraint if exists produto_referencia_marca_nome_preenchida;');
    expect(down).toContain('alter table catalogo.produto_referencia drop column if exists marca_nome;');
    expect(down.indexOf('drop constraint')).toBeLessThan(down.indexOf('drop column'));
  });

  it('espelho Drizzle: produto_referencia.marca_nome (text), nula e sem padrão', () => {
    const col = getTableConfig(nuvemCatalogo.produtoReferencia).columns.find((c) => c.name === 'marca_nome');
    expect(col?.getSQLType()).toBe('text');
    expect(col?.notNull).toBe(false);
    expect(col?.hasDefault).toBe(false);
  });

  it('aparelho: sem versão nova (o retrato viaja no JSON de ent_produto_referencia); a v4 (T-0085) só traz índices da lista por linha', () => {
    // até a v3 nada mudou por causa desta migração; a v4 é só de índices (produto_no e produto_relacao)
    expect(migracoesAparelho.map((m) => m.versao).slice(0, 3)).toEqual([1, 2, 3]);
    expect(migracoesAparelho.some((m) => m.sql.includes('marca_nome'))).toBe(false);
  });

  it('fixture: vivas com o nome do concorrente do Promotor do mesmo tenant (1..120); a apagada nula', () => {
    const d = dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA');
    const nomeDoConcorrente = new Map(d['promotor.concorrente'].map((c) => [c.id as string, c.nome as string]));
    expect(nomeDoConcorrente.get(PROMOTOR_FIXTURE.A.concorrente)).toBe(MARCA_NOME_FIXTURE.A);
    expect(nomeDoConcorrente.get(PROMOTOR_FIXTURE.B.concorrente)).toBe(MARCA_NOME_FIXTURE.B);
    const nomes = Object.fromEntries(d['catalogo.produto_referencia'].map((r) => [r.id as string, r.marca_nome]));
    expect(nomes).toEqual({
      [REFERENCIAS_FIXTURE.A.cb3401]: MARCA_NOME_FIXTURE.A,
      [REFERENCIAS_FIXTURE.A.fr772]: MARCA_NOME_FIXTURE.A,
      [REFERENCIAS_FIXTURE.A.apagada]: null,
      [REFERENCIAS_FIXTURE.B.lb0099]: MARCA_NOME_FIXTURE.B,
    });
    for (const r of d['catalogo.produto_referencia']) {
      if (r.marca_nome !== null) expect(nomeDoConcorrente.get(r.marca_id as string), String(r.codigo)).toBe(r.marca_nome);
    }
  });
});

describe.skipIf(semBanco())('0034 produto_referencia.marca_nome (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const codigo = async (tenant: string, fn: () => Promise<unknown>) => (await erroDe(emTransacao(app, tenant, fn)))?.code;
  const gravar = (id: string, nome: string | null) => q('update catalogo.produto_referencia set marca_nome = $2 where id = $1', [id, nome]);

  it('fixture: o pull de A traz o retrato nas vivas e nulo na apagada; B só vê o dele', async () => {
    const pull = (tenant: string) =>
      emTransacao(app, tenant, () =>
        q<{ id: string; marca_nome: string | null }>('select id, marca_nome from catalogo.produto_referencia order by updated_at, id').then((r) => r.rows),
      );
    expect(new Map((await pull(A.tenantId)).map((r) => [r.id, r.marca_nome]))).toEqual(
      new Map<string, string | null>([
        [REFERENCIAS_FIXTURE.A.cb3401, MARCA_NOME_FIXTURE.A],
        [REFERENCIAS_FIXTURE.A.fr772, MARCA_NOME_FIXTURE.A],
        [REFERENCIAS_FIXTURE.A.apagada, null],
      ]),
    );
    expect(await pull(B.tenantId)).toEqual([{ id: REFERENCIAS_FIXTURE.B.lb0099, marca_nome: MARCA_NOME_FIXTURE.B }]);
  });

  it('aceita nulo, 1 e 120 caracteres (com acento); regravar o nome avança updated_at', async () => {
    expect(await codigo(A.tenantId, async () => {
      await gravar(REFERENCIAS_FIXTURE.A.cb3401, null);
      await gravar(REFERENCIAS_FIXTURE.A.cb3401, 'F');
      await gravar(REFERENCIAS_FIXTURE.A.cb3401, 'é'.repeat(120));
      const r = await q<{ mudou: boolean }>("update catalogo.produto_referencia set marca_nome = 'Freiomax' where id = $1 returning updated_at > created_at as mudou", [
        REFERENCIAS_FIXTURE.A.cb3401,
      ]);
      expect(r.rows).toEqual([{ mudou: true }]);
    })).toBeUndefined();
  });

  it.each(['', '   ', 'x'.repeat(121)])('CHECK produto_referencia_marca_nome_preenchida recusa %j', async (valor) => {
    const e = await erroDe(emTransacao(app, A.tenantId, () => gravar(REFERENCIAS_FIXTURE.A.cb3401, valor)));
    expect(e).toMatchObject({ code: '23514', message: expect.stringContaining('produto_referencia_marca_nome_preenchida') });
  });

  it('vazamento entre tenants: B não lê nem muda o retrato de A; A não insere em B', async () => {
    await emTransacao(app, B.tenantId, async () => {
      expect((await q('select 1 from catalogo.produto_referencia where id = $1', [REFERENCIAS_FIXTURE.A.cb3401])).rowCount).toBe(0);
      expect((await gravar(REFERENCIAS_FIXTURE.A.cb3401, 'Outra')).rowCount).toBe(0);
    });
    expect(
      await codigo(A.tenantId, () =>
        q("insert into catalogo.produto_referencia (tenant_id, produto_id, marca_id, marca_nome, codigo, codigo_compacto, ordem) values ($1, gen_random_uuid(), gen_random_uuid(), 'X', 'X 1', 'x1', 1)", [
          B.tenantId,
        ]),
      ),
    ).toBe('42501');
  });
});

describe.skipIf(semBanco())('0034 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000034';
  const P = 'cccccccc-0034-4000-8000-000000000001';
  const R = 'cccccccc-0034-4000-8000-000000000002';
  const M = 'cccccccc-0034-4000-8000-000000000003';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0034_catalogo_referencia_marca_nome') - 1]!.slice(0, 4);
  const desde0034 = nomes.filter((n) => n >= '0034');
  // até a 0044: a 0045 (T-0113) preenche os nulos com o nome da marca; a 0034 sozinha não
  const ate0044 = desde0034.filter((n) => n < '0045');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('linha anterior fica nula (sem backfill) e intacta até a 0044; a 0045 preenche pelo nome da marca; down volta ao catálogo da 0033 com a referência; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo34', 'Antigo')", [T]);
      // a marca no cadastro antigo do Promotor (0015): a 0045 copia e confere que não há referência órfã
      await c.query("insert into promotor.concorrente (id, tenant_id, nome) values ($1, $2, 'Freiomax')", [M, T]);
      await c.query(
        "insert into catalogo.produto_referencia (id, tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem) values ($1, $2, $3, $4, 'CB 3401', 'cb3401', 1)",
        [R, T, P, M],
      );
      const linha = () => c.query('select id, marca_id, codigo, codigo_compacto, ordem, updated_at from catalogo.produto_referencia where id = $1', [R]).then((r) => r.rows[0]);
      const linhaAntes = await linha();
      expect((await migrarUp(c, { ate: '0044' })).aplicadas).toEqual(ate0044);
      expect((await c.query('select marca_nome from catalogo.produto_referencia where id = $1', [R])).rows).toEqual([{ marca_nome: null }]);
      expect(await linha()).toEqual(linhaAntes);
      expect((await migrarUp(c)).aplicadas).toEqual(desde0034.filter((n) => n >= '0045'));
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col catalogo.produto_referencia.marca_nome text nn=false');
      expect(depois.filter((l) => l.startsWith('idx ') && l.includes('marca_nome'))).toEqual([]);
      // a política leitura (0078, macuxi_leitura) entra depois da 0034 e fica fora da comparação
      expect(depois.filter((l) => l.startsWith('pol ') && l.includes('catalogo.produto_referencia') && !l.startsWith('pol catalogo.produto_referencia.leitura '))).toEqual(
        antes.filter((l) => l.startsWith('pol ') && l.includes('catalogo.produto_referencia')),
      );
      expect((await c.query('select marca_nome from catalogo.produto_referencia where id = $1', [R])).rows).toEqual([{ marca_nome: 'Freiomax' }]);
      expect((await migrarDown(c, { passos: desde0034.length })).aplicadas).toEqual([...desde0034].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select codigo from catalogo.produto_referencia where id = $1', [R])).rows).toEqual([{ codigo: 'CB 3401' }]);
      await c.query(m34.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
