/**
 * 0057 — fotos do PDV (T-0147, RN-CORE-38, ADR 0041; desenho docs/desenho/T-0147.md §3 e §7; pedido
 * R-20261110-065020-engenheiro-software). O que o BANCO garante:
 * - core.foto_tipo: nome único vivo sem diferenciar maiúsculas, UM tipo fachada vivo, fachada nunca sensível nem apagada; a
 *   "Fachada" (obrigatória) nasce com o tenant (gatilho tenant_semear_foto_tipo) e foi semeada nos que já existiam;
 * - core.cliente_foto: uma viva por (cliente, tipo), arquivo único no tenant, origem camera|galeria, FKs compostas;
 * - core.cliente.inativado_em: gatilho marca ao inativar, limpa ao reativar;
 * - plataforma.arquivo.perfis_leitura: nula ou 1..7 PERFIS sem nulo;
 * - a consulta do pull devolve arquivo_id NULO para tipo sensível.
 * Banco: papel de APLICAÇÃO sobre a fixture dois-tenants (ROLLBACK); up/down com dados num banco efêmero (CI).
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { PERFIS } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import * as esquemaPlataforma from '../esquema/plataforma';
import { DOIS_TENANTS, FOTOS_PDV_FIXTURE, PERFIS_LEITURA_DOC_SENSIVEL } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { idFotoTipoFachada } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const FA = FOTOS_PDV_FIXTURE.A;
const migracoes = lerMigracoes();
const m57 = migracoes.find((m) => m.versao === '0057')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m57.up);

/**
 * Consulta de referência do pull de `cliente_foto` (docs/banco/core.md, "0057"): arquivo_id NULO quando o tipo é sensível.
 * O Core usa a mesma expressão na coluna `colunas` do provedor de sync.
 */
const COLUNAS_PULL_CLIENTE_FOTO =
  "cliente_id, foto_tipo_id, case when (select t.sensivel from core.foto_tipo t where t.tenant_id = core.cliente_foto.tenant_id and t.id = core.cliente_foto.foto_tipo_id) then null else arquivo_id end as arquivo_id, origem, to_char(tirada_em at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as tirada_em";

describe('0057 fotos do PDV (estático)', () => {
  it('nome e posição: 0057_core_foto_pdv logo depois da 0056', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0056_core_filial') + 1]).toBe('0057_core_foto_pdv');
  });

  it('foto_tipo: nome único sem maiúsculas, uma fachada viva, fachada não sensível nem apagada; semeadura pelo gatilho', () => {
    expect(up).toContain('create unique index foto_tipo_nome_uk on core.foto_tipo (tenant_id, lower(nome)) where deleted_at is null;');
    expect(up).toContain('create unique index foto_tipo_fachada_uk on core.foto_tipo (tenant_id) where fachada and deleted_at is null;');
    expect(up).toContain('constraint foto_tipo_fachada_nao_sensivel check (not (fachada and sensivel))');
    expect(up).toContain('constraint foto_tipo_fachada_viva check (not fachada or deleted_at is null)');
    expect(up).toContain("plataforma.uuid_de_chave(p_tenant::text || ':core.foto_tipo:fachada'), p_tenant, 'Fachada', true, false, true, 0, true");
    expect(up).toMatch(/create trigger tenant_semear_foto_tipo after insert on plataforma\.tenant\s+for each row execute function core\.semear_tenant_foto_tipo\(\);/);
    expect(up).toContain('select core.semear_foto_tipo(t.id) from plataforma.tenant t;');
    expect(up).not.toMatch(/provisionar_tenant/);
  });

  it('cliente_foto: uma viva por (cliente, tipo), arquivo único, sem FK para plataforma.arquivo', () => {
    expect(up).toContain('create unique index cliente_foto_vigente_uk on core.cliente_foto (tenant_id, cliente_id, foto_tipo_id) where deleted_at is null;');
    expect(up).toContain('create unique index cliente_foto_arquivo_uk on core.cliente_foto (tenant_id, arquivo_id);');
    expect(up).not.toMatch(/references plataforma\.arquivo/);
    expect(up).toContain("constraint cliente_foto_origem_valida check (origem in ('camera', 'galeria'))");
  });

  it('perfis_leitura: CHECK com exatamente os PERFIS do platform-sdk', () => {
    const m = /perfis_leitura <@ array\[([^\]]*)\]::text\[\]/.exec(up);
    expect([...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort()).toEqual([...PERFIS].sort());
    for (const p of PERFIS_LEITURA_DOC_SENSIVEL) expect(PERFIS).toContain(p);
  });

  it('espelho Drizzle: foto_tipo, cliente_foto, cliente.inativado_em e arquivo.perfis_leitura', () => {
    expect(getTableConfig(nuvemCore.fotoTipo).columns.map((c) => c.name).sort()).toEqual(
      ['id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at', 'external_id', 'nome', 'obrigatorio', 'sensivel', 'fachada', 'ordem', 'ativo'].sort(),
    );
    expect(getTableConfig(nuvemCore.clienteFoto).columns.map((c) => c.name).sort()).toEqual(
      ['id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at', 'external_id', 'cliente_id', 'foto_tipo_id', 'arquivo_id', 'origem', 'enviado_por', 'tirada_em'].sort(),
    );
    const ina = getTableConfig(nuvemCore.cliente).columns.find((c) => c.name === 'inativado_em');
    expect([ina?.getSQLType(), ina?.notNull]).toEqual(['timestamp with time zone', false]);
    const pl = getTableConfig(esquemaPlataforma.arquivo).columns.find((c) => c.name === 'perfis_leitura');
    expect([pl?.getSQLType(), pl?.notNull]).toEqual(['text[]', false]);
  });

  it('fixture: a Fachada é a do gatilho (idFotoTipoFachada)', () => {
    expect(FA.tipos.fachada).toBe(idFotoTipoFachada(A.tenantId));
    expect(FOTOS_PDV_FIXTURE.B.tipos.fachada).toBe(idFotoTipoFachada(B.tenantId));
  });
});

describe.skipIf(semBanco())('0057 fotos do PDV (banco, papel de aplicação)', () => {
  let app: pg.Client;
  let admin: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await app.connect();
    await admin.connect();
  });
  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);

  it('tipos de A: Fachada (gatilho) e CNH (fixture); B não aparece', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const r = await q('select id, nome, obrigatorio, sensivel, fachada from core.foto_tipo order by ordem');
      expect(r.rows).toEqual([
        { id: FA.tipos.fachada, nome: 'Fachada', obrigatorio: true, sensivel: false, fachada: true },
        { id: FA.tipos.cnh, nome: 'CNH do sócio', obrigatorio: true, sensivel: true, fachada: false },
      ]);
    });
  });

  it('foto_tipo: nome repetido sem diferenciar maiúsculas = 23505; segunda fachada = 23505; fachada sensível ou apagada = 23514', async () => {
    await emTransacao(app, A.tenantId, async () => {
      for (const [sql, p, code] of [
        ["insert into core.foto_tipo (tenant_id, nome) values ($1, 'cnh DO SÓCIO')", [A.tenantId], '23505'],
        ["insert into core.foto_tipo (tenant_id, nome, fachada) values ($1, 'Frente', true)", [A.tenantId], '23505'],
        ['update core.foto_tipo set sensivel = true where id = $1', [FA.tipos.fachada], '23514'],
        ['update core.foto_tipo set deleted_at = now() where id = $1', [FA.tipos.fachada], '23514'],
        ["insert into core.foto_tipo (tenant_id, nome) values ($1, '   ')", [A.tenantId], '23514'],
      ] as const) {
        await q('savepoint s');
        expect(await erroDe(q(sql, [...p])), sql).toMatchObject({ code });
        await q('rollback to savepoint s');
      }
    });
  });

  it('cliente_foto: segunda viva do mesmo tipo = 23505; substituir (apaga a antiga e grava a nova) passa; origem inválida = 23514; arquivo repetido = 23505', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const nova = (id: string, arquivo: string, origem = 'camera') =>
        q('insert into core.cliente_foto (id, tenant_id, cliente_id, foto_tipo_id, arquivo_id, origem, enviado_por) values ($1, $2, $3, $4, $5, $6, $7)', [
          id, A.tenantId, A.clientes.c1, FA.tipos.fachada, arquivo, origem, A.usuarios.supervisor,
        ]);
      const id1 = 'aaaaaaaa-000c-4000-8000-000000000901';
      const arq1 = 'aaaaaaaa-002c-4000-8000-000000000901';
      await q('savepoint s');
      expect(await erroDe(nova(id1, arq1))).toMatchObject({ code: '23505', message: expect.stringContaining('cliente_foto_vigente_uk') });
      await q('rollback to savepoint s');
      await q('update core.cliente_foto set deleted_at = now() where id = $1', [FA.fotos.c1Fachada]);
      await nova(id1, arq1);
      for (const [args, code] of [[['aaaaaaaa-000c-4000-8000-000000000902', 'aaaaaaaa-002c-4000-8000-000000000902', 'scanner'], '23514'], [['aaaaaaaa-000c-4000-8000-000000000903', FA.arquivos.c1Fachada], '23505']] as const) {
        await q('update core.cliente_foto set deleted_at = now() where id = $1', [id1]);
        await q('savepoint s');
        expect(await erroDe(nova(...(args as unknown as [string, string, string?])))).toMatchObject({ code });
        await q('rollback to savepoint s');
      }
    });
  });

  it('pull: arquivo_id nulo no tipo sensível, presente na fachada', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const r = await q(`select id, ${COLUNAS_PULL_CLIENTE_FOTO} from core.cliente_foto where cliente_id = $1 order by id`, [A.clientes.c1]);
      expect(r.rows.map((x: { id: string; arquivo_id: string | null }) => [x.id, x.arquivo_id])).toEqual([
        [FA.fotos.c1Fachada, FA.arquivos.c1Fachada],
        [FA.fotos.c1Cnh, null],
      ]);
    });
  });

  it('cliente.inativado_em: marca ao inativar, mantém em outra alteração, limpa ao reativar', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const ler = async () => (await q('select inativado_em from core.cliente where id = $1', [A.clientes.c2])).rows[0]!.inativado_em as Date | null;
      expect(await ler()).toBeNull();
      await q('update core.cliente set ativo = false where id = $1', [A.clientes.c2]);
      const marcado = await ler();
      expect(marcado).toBeInstanceOf(Date);
      await q("update core.cliente set nome_fantasia = 'Outro', ativo = false where id = $1", [A.clientes.c2]);
      expect(await ler()).toEqual(marcado);
      await q('update core.cliente set ativo = true where id = $1', [A.clientes.c2]);
      expect(await ler()).toBeNull();
      const novo = await q("insert into core.cliente (tenant_id, razao_social, ativo) values ($1, 'Inativo T57', false) returning inativado_em", [A.tenantId]);
      expect(novo.rows[0]!.inativado_em).toBeInstanceOf(Date);
    });
  });

  it('arquivo.perfis_leitura: a CNH da fixture restrita; vazio, perfil desconhecido ou nulo na lista = 23514', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect((await q('select perfis_leitura from plataforma.arquivo where id = $1', [FA.arquivos.c1Cnh])).rows[0]!.perfis_leitura).toEqual([...PERFIS_LEITURA_DOC_SENSIVEL]);
      for (const v of ['{}', '{diretor}', '{admin,NULL}']) {
        await q('savepoint s');
        expect(await erroDe(q('update plataforma.arquivo set perfis_leitura = $2::text[] where id = $1', [FA.arquivos.c1Fachada, v])), v).toMatchObject({
          code: '23514',
          message: expect.stringContaining('arquivo_perfis_leitura_validos'),
        });
        await q('rollback to savepoint s');
      }
      await q("update plataforma.arquivo set perfis_leitura = '{admin}' where id = $1", [FA.arquivos.c1Fachada]);
    });
  });

  it('vazamento: B não vê nem altera tipos e fotos de A', async () => {
    await emTransacao(app, B.tenantId, async () => {
      expect((await q('select id from core.cliente_foto where id = $1', [FA.fotos.c1Cnh])).rowCount).toBe(0);
      expect((await q('update core.foto_tipo set nome = $2 where id = $1', [FA.tipos.cnh, 'X'])).rowCount).toBe(0);
    });
  });

  it('tenant novo (gatilho, como o provisionar_tenant) nasce com a Fachada obrigatória; semear de novo não duplica', async () => {
    await emTransacao(admin, null, async () => {
      const t = (await admin.query<{ id: string }>("insert into plataforma.tenant (codigo, nome) values ('t57-novo', 'Novo T57') returning id")).rows[0]!.id;
      const f = await admin.query('select id, nome, obrigatorio, sensivel, fachada from core.foto_tipo where tenant_id = $1', [t]);
      expect(f.rows).toEqual([{ id: idFotoTipoFachada(t), nome: 'Fachada', obrigatorio: true, sensivel: false, fachada: true }]);
      await admin.query('select core.semear_foto_tipo($1)', [t]);
      expect((await admin.query('select count(*)::int as n from core.foto_tipo where tenant_id = $1', [t])).rows[0]!.n).toBe(1);
    });
  });

  it('pull por cliente usa cliente_foto_cliente_ix', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await q('set local enable_seqscan = off');
      const plano = (await q(`explain select id from core.cliente_foto where tenant_id = '${A.tenantId}' and cliente_id = '${A.clientes.c1}'`)).rows
        .map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN'])
        .join('\n');
      expect(plano).toMatch(/cliente_foto_(cliente_ix|vigente_uk)/);
    });
  });
});

describe.skipIf(semBanco())('0057 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000057';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('backfill: Fachada no tenant que já existia e inativado_em do cliente inativo; down volta ao catálogo da 0056; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0056' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo57', 'Antigo')", [T]);
      await c.query("insert into core.cliente (id, tenant_id, razao_social, ativo) values ('cccccccc-0004-4000-8000-000000000057', $1, 'C', false)", [T]);
      expect((await migrarUp(c, { ate: '0057' })).aplicadas).toEqual(['0057_core_foto_pdv']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col plataforma.arquivo.perfis_leitura text[] nn=false');
      expect((await c.query('select id, nome from core.foto_tipo where tenant_id = $1', [T])).rows).toEqual([{ id: idFotoTipoFachada(T), nome: 'Fachada' }]);
      expect((await c.query('select inativado_em is not null as ok from core.cliente where tenant_id = $1', [T])).rows).toEqual([{ ok: true }]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0057_core_foto_pdv']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m57.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0057' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
