/**
 * 0088 — aprovação por motivo do pedido (T-0184, P-6; desenho docs/desenho/T-0184.md §2 e §7.3). Dicionário:
 * docs/banco/vendedor.md, "0088".
 * - vendedor.pedido_aprovacao: uma linha por (pedido, ciclo, motivo), campos comuns, RLS forçado, isolamento_tenant,
 *   manutencao e leitura (0078); macuxi_app com select, insert e update (sem delete); fora do sync;
 * - vendedor.pedido: aprovacao_ciclo (>= 1, SELECT por coluna ao macuxi_leitura) e 'inadimplencia' em pedido_motivos_validos;
 * - backfill: os pending_approval vivos ganham uma pendente por motivo no ciclo 1, sem andar o updated_at do pedido.
 * Estático sempre; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down + backfill num banco efêmero.
 * Instantes: todos fixos e passados como parâmetro; nenhum relógio real no arquivo.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemVendedor from '../../modules/vendedor/db/nuvem';
import { MOTIVOS_APROVACAO, NIVEIS_APROVACAO } from '../../modules/vendedor/domain/aprovacao';
import { APROVACOES_FIXTURE, DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { idAprovacaoDoBackfill } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m88 = migracoes.find((m) => m.nome === 'vendedor_pedido_aprovacao')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m88.up);
const umaLinha = up.replace(/\s+/g, ' ');
const down = semComentarios(m88.down).replace(/\s+/g, ' ');
const T = 'vendedor.pedido_aprovacao';
/** Motivos do desenho §1 (o domínio do Vendedor ganha 'inadimplencia' no PR do modulo-vendedor). */
const MOTIVOS_0088 = ['desconto', 'credito', 'inadimplencia', 'estoque', 'preco_minimo'];
const ESTADOS = ['pendente', 'aprovada', 'rejeitada', 'devolvida', 'encerrada'];
/** Instante do teste (fixo; sempre passado como parâmetro). */
const T0 = '2026-11-19T12:00:00Z'; // hora-fixa-ok: instante do teste, sempre passado como parâmetro
const lista = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);

describe('0088 aprovação por motivo (estático)', () => {
  it('número e nome: a 0088 vem logo depois da 0087', () => {
    expect(m88.versao).toBe('0088');
    expect(migracoes[migracoes.indexOf(m88) - 1]!.versao).toBe('0087');
  });

  it('tabela com campos comuns, constraints nomeadas, índice da fila, external_uk, gatilho, RLS forçado e políticas', () => {
    const bloco = new RegExp(`create table ${T.replace('.', '\\.')} \\(([^;]*)\\);`).exec(umaLinha)?.[1] ?? '';
    for (const c of [
      'id uuid primary key default gen_random_uuid()', 'tenant_id uuid not null references plataforma.tenant (id)', 'pedido_id uuid not null,',
      'ciclo integer not null default 1,', 'motivo text not null,', 'nivel text not null,', "estado text not null default 'pendente',",
      "texto_pendencia text not null default '',", 'decidida_por uuid,', 'decidida_em timestamptz,', 'texto_decisao text,',
      'created_at timestamptz not null default now()', 'updated_at timestamptz not null default now()', 'deleted_at timestamptz,', 'external_id text,',
      'constraint pedido_aprovacao_tenant_id_uk unique (tenant_id, id)',
      'constraint pedido_aprovacao_ciclo_uk unique (tenant_id, pedido_id, ciclo, motivo)',
      'constraint pedido_aprovacao_pedido_fk foreign key (tenant_id, pedido_id) references vendedor.pedido (tenant_id, id)',
      'constraint pedido_aprovacao_ciclo_positivo check (ciclo >= 1)',
      'constraint pedido_aprovacao_texto_decisao_tamanho check (texto_decisao is null or char_length(texto_decisao) <= 500)',
      "constraint pedido_aprovacao_decisao_coerente check ((estado = 'pendente') = (decidida_em is null))",
    ]) {
      expect(bloco, c).toContain(c);
    }
    expect(lista(/pedido_aprovacao_motivo_valido check \(motivo in \(([^)]*)\)\)/.exec(bloco)?.[1] ?? '')).toEqual(MOTIVOS_0088);
    expect(lista(/pedido_aprovacao_nivel_valido check \(nivel in \(([^)]*)\)\)/.exec(bloco)?.[1] ?? '')).toEqual([...NIVEIS_APROVACAO]);
    expect(lista(/pedido_aprovacao_estado_valido check \(estado in \(([^)]*)\)\)/.exec(bloco)?.[1] ?? '')).toEqual(ESTADOS);
    expect(umaLinha).toContain(`create index pedido_aprovacao_fila_ix on ${T} (tenant_id, nivel) where estado = 'pendente' and deleted_at is null;`);
    expect(umaLinha).toContain(`create unique index pedido_aprovacao_external_uk on ${T} (tenant_id, external_id) where external_id is not null and deleted_at is null;`);
    expect(umaLinha).toContain(`create trigger pedido_aprovacao_updated_at before update on ${T} for each row execute function plataforma.definir_updated_at();`);
    expect(umaLinha).toContain(`alter table ${T} enable row level security;`);
    expect(umaLinha).toContain(`alter table ${T} force row level security;`);
    expect(umaLinha).toContain(`create policy isolamento_tenant on ${T} for all to macuxi_app using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());`);
    expect(umaLinha).toContain(`create policy manutencao on ${T} for all to macuxi_manutencao using (true) with check (true);`);
    expect(umaLinha).toContain(`create policy leitura on ${T} for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());`);
  });

  it('grants: app com select, insert e update (sem delete); leitura com select na tabela e na coluna nova do pedido; nada mais', () => {
    const grants = [...umaLinha.matchAll(/grant ([^;]*);/g)].map((g) => g[1]!);
    expect(grants).toEqual([
      'select (aprovacao_ciclo) on vendedor.pedido to macuxi_leitura',
      `select, insert, update on ${T} to macuxi_app`,
      `select on ${T} to macuxi_leitura`,
    ]);
  });

  it('fora do sync (o pull não muda, §7.3): sem índice (tenant_id, updated_at, id) e declarada em TABELAS_FORA_DO_SYNC', () => {
    expect(TABELAS_FORA_DO_SYNC as readonly string[]).toContain(T);
    expect(umaLinha).not.toContain('(tenant_id, updated_at, id)');
  });

  it('vendedor.pedido: aprovacao_ciclo >= 1 com default 1; pedido_motivos_validos com inadimplencia (e o domínio cabe nele)', () => {
    expect(up).toMatch(/^alter table vendedor\.pedido add column aprovacao_ciclo integer not null default 1 constraint pedido_aprovacao_ciclo_positivo check \(aprovacao_ciclo >= 1\);$/m);
    expect(umaLinha).toContain('alter table vendedor.pedido drop constraint pedido_motivos_validos;');
    const motivos = /add constraint pedido_motivos_validos check \(motivos_aprovacao <@ array\[([^\]]*)\]::text\[\]\)/.exec(umaLinha);
    expect(lista(motivos?.[1] ?? '')).toEqual(MOTIVOS_0088);
    for (const m of MOTIVOS_APROVACAO) expect(MOTIVOS_0088).toContain(m);
  });

  it('backfill: pending_approval vivo, uma pendente por motivo (vazio = desconto), ciclo 1, idempotente', () => {
    expect(umaLinha).toContain("plataforma.uuid_de_chave(p.tenant_id || ':vendedor.pedido_aprovacao:' || p.id || ':1:' || m.motivo)");
    expect(umaLinha).toContain("unnest(case when cardinality(p.motivos_aprovacao) = 0 then array['desconto']::text[] else p.motivos_aprovacao end)");
    expect(umaLinha).toContain("where p.status = 'pending_approval' and p.deleted_at is null on conflict (tenant_id, pedido_id, ciclo, motivo) do nothing;");
    expect(umaLinha).not.toMatch(/update vendedor\.pedido /);
  });

  it('down: drop da tabela e da coluna, tira inadimplencia dos arrays antes de recriar o CHECK da 0009 (idempotente)', () => {
    expect(down).toContain(`drop table if exists ${T};`);
    expect(down).toContain('alter table vendedor.pedido drop column if exists aprovacao_ciclo;');
    expect(down).toContain('alter table vendedor.pedido drop constraint if exists pedido_motivos_validos;');
    const remove = down.indexOf("array_remove(motivos_aprovacao, 'inadimplencia')");
    expect(remove).toBeGreaterThan(0);
    expect(down.indexOf("add constraint pedido_motivos_validos check (motivos_aprovacao <@ array['desconto', 'credito', 'estoque', 'preco_minimo']::text[]);")).toBeGreaterThan(remove);
  });

  it('espelho Drizzle: pedidoAprovacao (tipos e nulidade) e pedido.aprovacao_ciclo', () => {
    const tipos = (t: Parameters<typeof getTableConfig>[0]) => Object.fromEntries(getTableConfig(t).columns.map((c) => [c.name, [c.getSQLType(), c.notNull]]));
    expect(getTableConfig(nuvemVendedor.pedidoAprovacao).name).toBe('pedido_aprovacao');
    expect(tipos(nuvemVendedor.pedidoAprovacao)).toMatchObject({
      pedido_id: ['uuid', true], ciclo: ['integer', true], motivo: ['text', true], nivel: ['text', true], estado: ['text', true],
      texto_pendencia: ['text', true], decidida_por: ['uuid', false], decidida_em: ['timestamp with time zone', false], texto_decisao: ['text', false],
    });
    expect([...(nuvemVendedor.pedidoAprovacao.nivel.enumValues ?? [])]).toEqual([...NIVEIS_APROVACAO]);
    expect(tipos(nuvemVendedor.pedido)).toMatchObject({ aprovacao_ciclo: ['integer', true] });
  });
});

describe.skipIf(semBanco())('0088 aprovação por motivo (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);
  const INS = `insert into ${T} (tenant_id, pedido_id, ciclo, motivo, nivel, estado, decidida_em) values ($1, $2, $3, $4, $5, $6, $7)`;
  const noSavepoint = async (sql: string, p: unknown[]) => {
    await q('savepoint s');
    const e = await erroDe(q(sql, p));
    await q('rollback to savepoint s');
    return e;
  };

  it('fixture: A vê a pendente do p2 e B a aprovada do p1; o pedido começa no ciclo 1', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect((await q(`select id, pedido_id, ciclo, motivo, nivel, estado from ${T}`)).rows).toEqual([
        { id: APROVACOES_FIXTURE.A.p2Desconto, pedido_id: A.pedidos.p2, ciclo: 1, motivo: 'desconto', nivel: 'gerente', estado: 'pendente' },
      ]);
      expect((await q('select aprovacao_ciclo from vendedor.pedido where id = $1', [A.pedidos.p2])).rows).toEqual([{ aprovacao_ciclo: 1 }]);
    });
    await emTransacao(app, B.tenantId, async () => {
      expect((await q(`select id, estado from ${T}`)).rows).toEqual([{ id: APROVACOES_FIXTURE.B.p1Desconto, estado: 'aprovada' }]);
    });
  });

  it('multi-tenant: B não vê, não altera nem grava as aprovações de A', async () => {
    await emTransacao(app, B.tenantId, async () => {
      expect((await q(`select count(*)::int as n from ${T} where tenant_id = $1`, [A.tenantId])).rows).toEqual([{ n: 0 }]);
      expect((await q(`update ${T} set estado = 'aprovada', decidida_em = $2 where id = $1`, [APROVACOES_FIXTURE.A.p2Desconto, T0])).rowCount).toBe(0);
      expect(await noSavepoint(INS, [A.tenantId, A.pedidos.p2, 2, 'credito', 'gerente', 'pendente', null])).toMatchObject({ code: '42501' });
      // com o tenant da sessão, o pedido de A não existe para B (FK composta)
      expect(await noSavepoint(INS, [B.tenantId, A.pedidos.p2, 2, 'credito', 'gerente', 'pendente', null])).toMatchObject({ code: '23503' });
    });
    await emTransacao(app, A.tenantId, async () => {
      expect((await q(`select estado from ${T} where id = $1`, [APROVACOES_FIXTURE.A.p2Desconto])).rows).toEqual([{ estado: 'pendente' }]);
    });
  });

  it('estado x decidida_em: pendente sem decisão, decidida com decisão (23514); a decisão grava e anda o updated_at', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const id = APROVACOES_FIXTURE.A.p2Desconto;
      for (const [sql, p] of [
        [INS, [A.tenantId, A.pedidos.p2, 2, 'credito', 'gerente', 'aprovada', null]],
        [INS, [A.tenantId, A.pedidos.p2, 2, 'credito', 'gerente', 'pendente', T0]],
        [`update ${T} set decidida_em = $2 where id = $1`, [id, T0]],
        [`update ${T} set estado = 'rejeitada' where id = $1`, [id]],
      ] as const) {
        expect(await noSavepoint(sql, [...p]), sql).toMatchObject({ code: '23514', message: expect.stringContaining('pedido_aprovacao_decisao_coerente') });
      }
      const antes = (await q(`select updated_at from ${T} where id = $1`, [id])).rows[0]!.updated_at as Date;
      const r = await q(`update ${T} set estado = 'aprovada', decidida_por = $2, decidida_em = $3, texto_decisao = 'Ok' where id = $1 returning updated_at`, [id, A.usuarios.admin, T0]);
      expect(r.rowCount).toBe(1);
      expect((r.rows[0]!.updated_at as Date).getTime()).toBeGreaterThan(antes.getTime());
      expect(await noSavepoint(`update ${T} set texto_decisao = repeat('x', 501) where id = $1`, [id])).toMatchObject({
        code: '23514', message: expect.stringContaining('pedido_aprovacao_texto_decisao_tamanho'),
      });
    });
  });

  it('único (pedido, ciclo, motivo) mesmo com a linha excluída; outro ciclo ou motivo grava', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect(await noSavepoint(INS, [A.tenantId, A.pedidos.p2, 1, 'desconto', 'gerente', 'pendente', null])).toMatchObject({
        code: '23505', message: expect.stringContaining('pedido_aprovacao_ciclo_uk'),
      });
      await q(`update ${T} set deleted_at = $2 where id = $1`, [APROVACOES_FIXTURE.A.p2Desconto, T0]);
      expect(await noSavepoint(INS, [A.tenantId, A.pedidos.p2, 1, 'desconto', 'gerente', 'pendente', null])).toMatchObject({ code: '23505' });
      expect((await q(INS, [A.tenantId, A.pedidos.p2, 2, 'desconto', 'gerente', 'pendente', null])).rowCount).toBe(1);
      expect((await q(INS, [A.tenantId, A.pedidos.p2, 1, 'inadimplencia', 'analista', 'pendente', null])).rowCount).toBe(1);
    });
  });

  it('motivo, nivel, estado e ciclo inválidos dão 23514', async () => {
    await emTransacao(app, A.tenantId, async () => {
      for (const [p, nome] of [
        [[A.tenantId, A.pedidos.p2, 2, 'prazo', 'gerente', 'pendente', null], 'pedido_aprovacao_motivo_valido'],
        [[A.tenantId, A.pedidos.p2, 2, 'credito', 'diretor', 'pendente', null], 'pedido_aprovacao_nivel_valido'],
        [[A.tenantId, A.pedidos.p2, 2, 'credito', 'gerente', 'cancelada', T0], 'pedido_aprovacao_estado_valido'],
        [[A.tenantId, A.pedidos.p2, 0, 'credito', 'gerente', 'pendente', null], 'pedido_aprovacao_ciclo_positivo'],
      ] as const) {
        expect(await noSavepoint(INS, [...p]), nome).toMatchObject({ code: '23514', message: expect.stringContaining(nome) });
      }
    });
  });

  it('o app não apaga aprovação (42501)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect(await erroDe(q(`delete from ${T} where id = $1`, [APROVACOES_FIXTURE.A.p2Desconto]))).toMatchObject({ code: '42501' });
    });
  });

  it("vendedor.pedido: 'inadimplencia' aceita em motivos_aprovacao, motivo fora da lista não; aprovacao_ciclo >= 1", async () => {
    await emTransacao(app, A.tenantId, async () => {
      const r = await q("update vendedor.pedido set motivos_aprovacao = array['desconto', 'inadimplencia'], aprovacao_ciclo = 2 where id = $1 returning motivos_aprovacao", [A.pedidos.p2]);
      expect(r.rows).toEqual([{ motivos_aprovacao: ['desconto', 'inadimplencia'] }]);
      expect(await noSavepoint("update vendedor.pedido set motivos_aprovacao = array['prazo'] where id = $1", [A.pedidos.p2])).toMatchObject({
        code: '23514', message: expect.stringContaining('pedido_motivos_validos'),
      });
      expect(await noSavepoint('update vendedor.pedido set aprovacao_ciclo = 0 where id = $1', [A.pedidos.p2])).toMatchObject({
        code: '23514', message: expect.stringContaining('pedido_aprovacao_ciclo_positivo'),
      });
    });
  });

  it('macuxi_leitura: SELECT na tabela nova e na coluna nova do pedido; nada de escrita', async () => {
    const r = await q(
      `select has_table_privilege('macuxi_leitura', '${T}', 'select') as t,
              has_table_privilege('macuxi_leitura', '${T}', 'insert, update, delete') as e,
              has_column_privilege('macuxi_leitura', 'vendedor.pedido', 'aprovacao_ciclo', 'select') as c,
              has_table_privilege('macuxi_app', '${T}', 'delete, truncate') as d`,
    );
    expect(r.rows).toEqual([{ t: true, e: false, c: true, d: false }]);
  });
});

describe.skipIf(semBanco())('0088 up/down e backfill (banco efêmero)', () => {
  let b: BancoDeTeste;
  const TEN = 'cccccccc-0000-4000-8000-000000000884';
  const V = 'cccccccc-0000-4000-8000-000000001884';
  const PENDENTE = 'cccccccc-0000-4000-8000-000000002884';
  const APROVADO = 'cccccccc-0000-4000-8000-000000003884';
  const SEM_MOTIVO = 'cccccccc-0000-4000-8000-000000004884';
  const EXCLUIDO = 'cccccccc-0000-4000-8000-000000005884';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up sobre a 0087 com o backfill dos pending_approval (sem andar o updated_at), down volta ao catálogo da 0087 (idempotente) e up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0087' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'aprov88', 'Aprovação 0088')", [TEN]);
      const ins = `insert into vendedor.pedido (id, tenant_id, cliente_id, vendedor_id, autor_id, status, nivel_aprovacao, motivos_aprovacao, deleted_at, updated_at)
                   values ($1, $2, gen_random_uuid(), $3, $3, $4, $5, $6, $7, $8)`;
      await c.query(ins, [PENDENTE, TEN, V, 'pending_approval', 'analista', ['desconto', 'credito'], null, T0]);
      await c.query(ins, [APROVADO, TEN, V, 'approved', null, [], null, T0]);
      await c.query(ins, [SEM_MOTIVO, TEN, V, 'pending_approval', 'supervisor', [], null, T0]);
      await c.query(ins, [EXCLUIDO, TEN, V, 'pending_approval', 'gerente', ['credito'], T0, T0]);

      expect((await migrarUp(c, { ate: m88.versao })).aplicadas).toEqual([`${m88.versao}_${m88.nome}`]);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col vendedor.pedido.aprovacao_ciclo integer nn=true');
      const r = await c.query<{ id: string; pedido_id: string; ciclo: number; motivo: string; nivel: string; estado: string; texto_pendencia: string; decidida_em: Date | null }>(
        `select id, pedido_id, ciclo, motivo, nivel, estado, texto_pendencia, decidida_em from ${T} where tenant_id = $1 order by pedido_id, motivo`, [TEN],
      );
      expect(r.rows).toEqual([
        { id: idAprovacaoDoBackfill(TEN, PENDENTE, 'credito'), pedido_id: PENDENTE, ciclo: 1, motivo: 'credito', nivel: 'analista', estado: 'pendente', texto_pendencia: '', decidida_em: null },
        { id: idAprovacaoDoBackfill(TEN, PENDENTE, 'desconto'), pedido_id: PENDENTE, ciclo: 1, motivo: 'desconto', nivel: 'analista', estado: 'pendente', texto_pendencia: '', decidida_em: null },
        { id: idAprovacaoDoBackfill(TEN, SEM_MOTIVO, 'desconto'), pedido_id: SEM_MOTIVO, ciclo: 1, motivo: 'desconto', nivel: 'supervisor', estado: 'pendente', texto_pendencia: '', decidida_em: null },
      ]);
      const pedidos = await c.query<{ id: string; ok: boolean; aprovacao_ciclo: number }>(
        'select id, updated_at = $2::timestamptz as ok, aprovacao_ciclo from vendedor.pedido where tenant_id = $1 order by id', [TEN, T0],
      );
      expect(pedidos.rows).toEqual([PENDENTE, APROVADO, SEM_MOTIVO, EXCLUIDO].sort().map((id) => ({ id, ok: true, aprovacao_ciclo: 1 })));

      // um pedido com 'inadimplencia' (só a 0088 aceita): o down tira o motivo antes de recriar o CHECK antigo
      await c.query("update vendedor.pedido set motivos_aprovacao = array['inadimplencia', 'credito'] where id = $1", [PENDENTE]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${m88.versao}_${m88.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select motivos_aprovacao from vendedor.pedido where id = $1', [PENDENTE])).rows).toEqual([{ motivos_aprovacao: ['credito'] }]);
      await c.query(m88.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: m88.versao });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
