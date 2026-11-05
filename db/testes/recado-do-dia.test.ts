/**
 * 0021 — recado do dia em core.notificacao (T-0073, desenho docs/desenho/T-0073.md §3.4; pedido
 * R-20261103-184906-engenheiro-software). O que o BANCO garante: a marcação (recado_do_dia + recado_do_dia_por) só em
 * tipo = 'recado', sempre em par, por usuário do PRÓPRIO tenant (FK composta), no máximo um recado do dia vivo por pessoa
 * por dia, e isolada por tenant pela política isolamento_tenant que já existe (nenhuma política nova, grants iguais).
 * Na mesma 0021 (R-20261103-235827-gerente-projetos, desenho §1.1): core.indicador_diario.clientes_positivados integer
 * null (>= 0, sem backfill), fallback da positivação do Início com o Vendedor desligado.
 * Migração aditiva com down que volta exatamente ao catálogo da 0020.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * As datas são dias civis literais (coluna date): nada aqui compara com o relógio real.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const UA = DOIS_TENANTS.A.usuarios;
const UB = DOIS_TENANTS.B.usuarios;
const migracoes = lerMigracoes();
const m21 = migracoes.find((m) => m.versao === '0021')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const DIA = '2026-11-04';
const OUTRO_DIA = '2026-11-05';

describe('0021 recado do dia (estático)', () => {
  it('nome e posição: 0021_core_recado_do_dia logo depois da 0020', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0020_pedido_ajuste_valor_produto_relacao') + 1]).toBe('0021_core_recado_do_dia');
  });

  it('colunas, checks, FK composta e índices exatamente como o §3.4', () => {
    for (const trecho of [
      'alter table core.notificacao add column recado_do_dia date;',
      'alter table core.notificacao add column recado_do_dia_por uuid;',
      "alter table core.notificacao add constraint notificacao_recado_do_dia_so_recado check (recado_do_dia is null or tipo = 'recado');",
      'alter table core.notificacao add constraint notificacao_recado_do_dia_par check ((recado_do_dia is null) = (recado_do_dia_por is null));',
      'alter table core.notificacao add constraint notificacao_recado_do_dia_por_fk foreign key (tenant_id, recado_do_dia_por) references core.usuario (tenant_id, id);',
      'create index notificacao_envio_ix on core.notificacao (tenant_id, envio_id) where envio_id is not null;',
    ]) expect(m21.up).toContain(trecho);
    expect(m21.up).toMatch(
      /create unique index notificacao_recado_do_dia_uk on core\.notificacao \(tenant_id, usuario_id, recado_do_dia\)\s+where recado_do_dia is not null and deleted_at is null;/,
    );
  });

  it('indicador_diario.clientes_positivados: integer nulo, check >= 0, sem backfill', () => {
    expect(m21.up).toContain('alter table core.indicador_diario add column clientes_positivados integer;');
    expect(m21.up).toContain(
      'alter table core.indicador_diario add constraint indicador_diario_clientes_positivados_nao_negativo check (clientes_positivados is null or clientes_positivados >= 0);',
    );
    expect(semComentarios(m21.up)).not.toMatch(/clientes_positivados integer not null|update core\.indicador_diario/);
  });

  it('aditiva: sem política nova, sem grant, sem reescrever dado, sem padrão nas colunas novas', () => {
    const sql = semComentarios(m21.up);
    expect(sql).not.toMatch(/create policy|grant |revoke |update core\.|delete from|default /);
    expect(sql).not.toMatch(/references (?!core\.)/);
  });

  it('down desfaz tudo o que o up cria (idempotente)', () => {
    for (const trecho of [
      'drop index if exists core.notificacao_envio_ix;',
      'drop index if exists core.notificacao_recado_do_dia_uk;',
      'alter table core.notificacao drop constraint if exists notificacao_recado_do_dia_por_fk;',
      'alter table core.notificacao drop constraint if exists notificacao_recado_do_dia_par;',
      'alter table core.notificacao drop constraint if exists notificacao_recado_do_dia_so_recado;',
      'alter table core.notificacao drop column if exists recado_do_dia_por;',
      'alter table core.notificacao drop column if exists recado_do_dia;',
      'alter table core.indicador_diario drop constraint if exists indicador_diario_clientes_positivados_nao_negativo;',
      'alter table core.indicador_diario drop column if exists clientes_positivados;',
    ]) expect(m21.down).toContain(trecho);
  });

  it('espelho Drizzle: notificacao.recado_do_dia (date) e recado_do_dia_por (uuid), ambas nulas', () => {
    const cols = new Map(getTableConfig(nuvemCore.notificacao).columns.map((c) => [c.name, c]));
    expect(cols.get('recado_do_dia')?.getSQLType()).toBe('date');
    expect(cols.get('recado_do_dia')?.notNull).toBe(false);
    expect(cols.get('recado_do_dia_por')?.getSQLType()).toBe('uuid');
    expect(cols.get('recado_do_dia_por')?.notNull).toBe(false);
  });

  it('espelho Drizzle: indicadorDiario.clientes_positivados (integer), nula e sem padrão', () => {
    const col = getTableConfig(nuvemCore.indicadorDiario).columns.find((c) => c.name === 'clientes_positivados');
    expect(col?.getSQLType()).toBe('integer');
    expect(col?.notNull).toBe(false);
    expect(col?.hasDefault).toBe(false);
  });
});

describe.skipIf(semBanco())('0021 recado do dia (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const contexto = (tenant: string) => q("select set_config('app.tenant_id', $1, true)", [tenant]);
  const codigo = async (tenant: string, fn: () => Promise<unknown>) => (await erroDe(emTransacao(app, tenant, fn)))?.code;
  /** O recado da fixture (A, vendedor-1, com envio_id, autor supervisor). */
  const recadoDeA = () =>
    q<{ id: string; envio_id: string }>("select id, envio_id from core.notificacao where tipo = 'recado' and usuario_id = $1 limit 1", [UA.vendedor1]).then(
      (r) => r.rows[0]!,
    );
  const novoRecado = (tenant: string, usuario: string, extra: { dia?: string | null; por?: string | null; tipo?: string } = {}) =>
    q<{ id: string }>(
      `insert into core.notificacao (tenant_id, usuario_id, tipo, titulo, corpo, recado_do_dia, recado_do_dia_por)
       values ($1, $2, $3, 'Recado', 'Corpo', $4, $5) returning id`,
      [tenant, usuario, extra.tipo ?? 'recado', extra.dia ?? null, extra.por ?? null],
    );

  it('fixture: nenhuma marcação; marcar por envio (notificacao_envio_ix) grava dia e autor', async () => {
    await emTransacao(app, A, async () => {
      expect((await q<{ n: number }>('select count(*)::int as n from core.notificacao where recado_do_dia is not null')).rows[0]!.n).toBe(0);
      const r = await recadoDeA();
      const upd = await q(
        'update core.notificacao set recado_do_dia = $1, recado_do_dia_por = $2 where tenant_id = $3 and envio_id = $4 and deleted_at is null',
        [DIA, UA.supervisor, A, r.envio_id],
      );
      expect(upd.rowCount).toBe(1);
      const lido = await q<{ dia: string; por: string }>(
        "select to_char(recado_do_dia, 'YYYY-MM-DD') as dia, recado_do_dia_por as por from core.notificacao where tenant_id = $1 and usuario_id = $2 and recado_do_dia = $3 and deleted_at is null",
        [A, UA.vendedor1, DIA],
      );
      expect(lido.rows).toEqual([{ dia: DIA, por: UA.supervisor }]);
    });
  });

  it('check so_recado: marcação em notificação que não é recado (sistema, pedido) é recusada', async () => {
    expect(await codigo(A, () => q(
      "update core.notificacao set recado_do_dia = $1, recado_do_dia_por = $2 where tipo = 'sistema' and usuario_id = $3",
      [DIA, UA.supervisor, UA.vendedor1],
    ))).toBe('23514');
    expect(await codigo(A, () => novoRecado(A, UA.vendedor1, { tipo: 'pedido', dia: DIA, por: UA.supervisor }))).toBe('23514');
    // e um recado marcado não pode virar outro tipo
    expect(await codigo(A, async () => {
      await novoRecado(A, UA.vendedor2, { dia: DIA, por: UA.supervisor });
      await q("update core.notificacao set tipo = 'sistema' where recado_do_dia is not null");
    })).toBe('23514');
  });

  it('check par: dia sem autor e autor sem dia são recusados; desmarcar zera os dois', async () => {
    expect(await codigo(A, () => novoRecado(A, UA.vendedor1, { dia: DIA }))).toBe('23514');
    expect(await codigo(A, () => novoRecado(A, UA.vendedor1, { por: UA.supervisor }))).toBe('23514');
    expect(await codigo(A, async () => {
      const { id } = (await novoRecado(A, UA.vendedor1, { dia: DIA, por: UA.supervisor })).rows[0]!;
      await q('update core.notificacao set recado_do_dia = null where id = $1', [id]);
    })).toBe('23514');
    expect(await codigo(A, async () => {
      const { id } = (await novoRecado(A, UA.vendedor1, { dia: DIA, por: UA.supervisor })).rows[0]!;
      const r = await q('update core.notificacao set recado_do_dia = null, recado_do_dia_por = null where id = $1', [id]);
      expect(r.rowCount).toBe(1);
    })).toBeUndefined();
  });

  it('único: um recado do dia vivo por pessoa por dia (outro dia, outra pessoa e depois do soft delete passam)', async () => {
    expect(await codigo(A, async () => {
      await novoRecado(A, UA.vendedor1, { dia: DIA, por: UA.supervisor });
      await novoRecado(A, UA.vendedor1, { dia: DIA, por: UA.gerente });
    })).toBe('23505');
    expect(await codigo(A, async () => {
      const { id } = (await novoRecado(A, UA.vendedor1, { dia: DIA, por: UA.supervisor })).rows[0]!;
      await novoRecado(A, UA.vendedor1, { dia: OUTRO_DIA, por: UA.supervisor });
      await novoRecado(A, UA.vendedor2, { dia: DIA, por: UA.supervisor });
      // vários recados do mesmo dia SEM marcação continuam livres
      await novoRecado(A, UA.vendedor1);
      await novoRecado(A, UA.vendedor1);
      // troca: soft delete (ou desmarcar) o anterior libera o dia
      await q('update core.notificacao set deleted_at = created_at where id = $1', [id]);
      await novoRecado(A, UA.vendedor1, { dia: DIA, por: UA.gerente });
    })).toBeUndefined();
  });

  it('FK composta: quem marcou tem de ser usuário do PRÓPRIO tenant', async () => {
    expect(await codigo(A, async () => {
      const r = await recadoDeA();
      await q('update core.notificacao set recado_do_dia = $1, recado_do_dia_por = $2 where id = $3', [DIA, UB.admin, r.id]);
    })).toBe('23503');
    expect(await codigo(A, () => novoRecado(A, UA.vendedor1, { dia: DIA, por: '00000000-0000-4000-8000-000000000000' }))).toBe('23503');
  });

  it('vazamento entre tenants: a marcação de A não aparece nem muda no contexto de B; B não escreve em A', async () => {
    await emTransacao(app, A, async () => {
      const r = await recadoDeA();
      await q('update core.notificacao set recado_do_dia = $1, recado_do_dia_por = $2 where id = $3', [DIA, UA.supervisor, r.id]);
      // mesma transação, contexto trocado para B
      await contexto(B);
      const visto = await q<{ n: number; marcadas: number }>(
        'select count(*) filter (where id = $1)::int as n, count(*) filter (where recado_do_dia is not null or recado_do_dia_por is not null)::int as marcadas from core.notificacao',
        [r.id],
      );
      expect(visto.rows[0]).toEqual({ n: 0, marcadas: 0 });
      const porDia = await q<{ n: number }>('select count(*)::int as n from core.notificacao where recado_do_dia = $1 and tenant_id = $2', [DIA, A]);
      expect(porDia.rows[0]!.n).toBe(0);
      const desmarcar = await q('update core.notificacao set recado_do_dia = null, recado_do_dia_por = null where id = $1 or envio_id = $2', [r.id, r.envio_id]);
      expect(desmarcar.rowCount).toBe(0);
      // de volta a A: a marcação segue intacta
      await contexto(A);
      const aindaMarcada = await q<{ dia: string; por: string }>(
        "select to_char(recado_do_dia, 'YYYY-MM-DD') as dia, recado_do_dia_por as por from core.notificacao where id = $1",
        [r.id],
      );
      expect(aindaMarcada.rows).toEqual([{ dia: DIA, por: UA.supervisor }]);
    });
    // B inserindo recado do dia no tenant A: recusado pela política (with check)
    expect(await codigo(B, () => novoRecado(A, UA.vendedor1, { dia: DIA, por: UA.supervisor }))).toBe('42501');
    // B marca o próprio recado com o próprio usuário (a regra vale igual nos dois tenants)
    expect(await codigo(B, async () => {
      await novoRecado(B, UB.vendedor, { dia: DIA, por: UB.admin });
      const r = await q<{ n: number }>('select count(*)::int as n from core.notificacao where recado_do_dia is not null');
      expect(r.rows[0]!.n).toBe(1);
    })).toBeUndefined();
    // sem contexto, nenhuma linha
    const semCtx = await emTransacao(app, null, () => q<{ n: number }>('select count(*)::int as n from core.notificacao'));
    expect(semCtx.rows[0]!.n).toBe(0);
  });
});

describe.skipIf(semBanco())('0021 indicador_diario.clientes_positivados (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const contexto = (tenant: string) => q("select set_config('app.tenant_id', $1, true)", [tenant]);
  const codigo = async (tenant: string, fn: () => Promise<unknown>) => (await erroDe(emTransacao(app, tenant, fn)))?.code;
  /** A linha da fixture (A, vendedor-1, ontem). */
  const linhaDeA = () =>
    q<{ id: string; clientes_positivados: number | null }>(
      'select id, clientes_positivados from core.indicador_diario where usuario_id = $1 and deleted_at is null limit 1',
      [UA.vendedor1],
    ).then((r) => r.rows[0]!);

  it('fixture sem backfill (null); o consumidor grava 0 e > 0 e volta a null; linha nova sem a coluna fica null', async () => {
    expect(await codigo(A, async () => {
      const l = await linhaDeA();
      expect(l.clientes_positivados).toBeNull();
      for (const v of [0, 7, null]) {
        await q('update core.indicador_diario set clientes_positivados = $1 where id = $2', [v, l.id]);
        expect((await linhaDeA()).clientes_positivados).toBe(v);
      }
      const nova = await q<{ c: number | null }>(
        "insert into core.indicador_diario (tenant_id, usuario_id, data, pedidos) values ($1, $2, '2026-11-04', 1) returning clientes_positivados as c",
        [A, UA.vendedor2],
      );
      expect(nova.rows[0]!.c).toBeNull();
    })).toBeUndefined();
  });

  it('check indicador_diario_clientes_positivados_nao_negativo: negativo é recusado (update e insert)', async () => {
    expect(await codigo(A, async () => {
      const l = await linhaDeA();
      await q('update core.indicador_diario set clientes_positivados = -1 where id = $1', [l.id]);
    })).toBe('23514');
    expect(await codigo(A, () =>
      q("insert into core.indicador_diario (tenant_id, usuario_id, data, clientes_positivados) values ($1, $2, '2026-11-04', -3)", [A, UA.vendedor2]),
    )).toBe('23514');
  });

  it('vazamento entre tenants: B não vê nem altera a contagem de A, nem insere em A', async () => {
    await emTransacao(app, A, async () => {
      const l = await linhaDeA();
      await q('update core.indicador_diario set clientes_positivados = 4 where id = $1', [l.id]);
      await contexto(B);
      const visto = await q<{ n: number }>('select count(*)::int as n from core.indicador_diario where id = $1 or clientes_positivados = 4', [l.id]);
      expect(visto.rows[0]!.n).toBe(0);
      expect((await q('update core.indicador_diario set clientes_positivados = 0 where id = $1', [l.id])).rowCount).toBe(0);
      await contexto(A);
      expect((await linhaDeA()).clientes_positivados).toBe(4);
    });
    expect(await codigo(B, () =>
      q("insert into core.indicador_diario (tenant_id, usuario_id, data, clientes_positivados) values ($1, $2, '2026-11-04', 1)", [A, UA.vendedor1]),
    )).toBe('42501');
  });
});

describe.skipIf(semBanco())('0021 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000021';
  const U = 'cccccccc-0021-4000-8000-000000000001';
  const S = 'cccccccc-0021-4000-8000-000000000002';
  const N = 'cccccccc-0021-4000-8000-000000000003';
  const I = 'cccccccc-0021-4000-8000-000000000004';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0021_core_recado_do_dia') - 1]!.slice(0, 4);
  const desde0021 = nomes.filter((n) => n >= '0021');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('recado e indicador existentes ficam intactos (sem mexer em updated_at); down apaga só a marcação e a contagem e volta ao catálogo da 0020; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo21', 'Antigo')", [T]);
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'V', 'v21@exemplo.com.br', 'vendedor')", [U, T]);
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'S', 's21@exemplo.com.br', 'supervisor')", [S, T]);
      await c.query(
        "insert into core.notificacao (id, tenant_id, usuario_id, tipo, titulo, corpo, autor_id) values ($1, $2, $3, 'recado', 'Bom dia', 'Foco no mix', $4)",
        [N, T, U, S],
      );
      await c.query(
        "insert into core.indicador_diario (id, tenant_id, usuario_id, data, pedidos, vendido_cents, cancelado_cents) values ($1, $2, $3, '2026-11-03', 3, 450000, 1000)",
        [I, T, U],
      );
      const recado = () => c.query('select id, tipo, titulo, corpo, autor_id, updated_at from core.notificacao where id = $1', [N]).then((r) => r.rows);
      const indicador = () =>
        c.query('select id, pedidos, vendido_cents, cancelado_cents, updated_at from core.indicador_diario where id = $1', [I]).then((r) => r.rows);
      const recadoAntes = await recado();
      const indicadorAntes = await indicador();
      // políticas conferidas logo depois da 0021: as migrações seguintes podem acrescentar a sua (a 0031 cria a manutencao
      // em toda tabela com RLS), mas a 0021 não cria, troca nem apaga política nenhuma
      const ate0021 = await migrarUp(c, { ate: '0021' });
      const polNa0021 = (await retratoDoCatalogo(c)).filter((l) => l.startsWith('pol '));
      const seguintes = await migrarUp(c);
      expect([...ate0021.aplicadas, ...seguintes.aplicadas]).toEqual(desde0021);
      expect(ate0021.aplicadas).toEqual([desde0021[0]]);
      const depois = await retratoDoCatalogo(c);
      expect(await recado()).toEqual(recadoAntes);
      // indicador existente: números e updated_at intactos, contagem null (sem backfill)
      expect(await indicador()).toEqual(indicadorAntes);
      expect((await c.query('select clientes_positivados from core.indicador_diario where id = $1', [I])).rows).toEqual([{ clientes_positivados: null }]);
      expect((await c.query('select recado_do_dia, recado_do_dia_por from core.notificacao where id = $1', [N])).rows).toEqual([
        { recado_do_dia: null, recado_do_dia_por: null },
      ]);
      // a RLS da tabela é a mesma de antes (enable/force), nenhuma política nova
      expect(depois).toContain('rel core.notificacao r rls=true force=true');
      expect(polNa0021.filter((l) => l.includes('core.notificacao'))).toEqual(
        antes.filter((l) => l.includes('core.notificacao') && l.startsWith('pol ')),
      );
      // marca e desfaz: o down apaga a marcação e mantém o recado
      await c.query('update core.notificacao set recado_do_dia = $1, recado_do_dia_por = $2 where id = $3', [DIA, S, N]);
      await c.query('update core.indicador_diario set clientes_positivados = 2 where id = $1', [I]);
      expect((await migrarDown(c, { passos: desde0021.length })).aplicadas).toEqual([...desde0021].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select id, tipo, titulo, corpo, autor_id from core.notificacao where id = $1', [N])).rows).toEqual([
        { id: N, tipo: 'recado', titulo: 'Bom dia', corpo: 'Foco no mix', autor_id: S },
      ]);
      // down apaga só a contagem: pedidos e valores do indicador ficam
      expect((await c.query('select id, pedidos, vendido_cents, cancelado_cents from core.indicador_diario where id = $1', [I])).rows).toEqual([
        { id: I, pedidos: 3, vendido_cents: '450000', cancelado_cents: '1000' },
      ]);
      await c.query(m21.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
