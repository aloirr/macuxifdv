/** 0077 (T-0176, RN-CORE-39; R-20261115-093000/094500): filial de cadastro e filiais de venda. O que o banco garante: docs/banco/core.md, "0077". */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { dadosDoisTenants, DOIS_TENANTS, FILIAIS_FIXTURE, ORDEM_TABELAS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { idFilialPadrao } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, HASH_TESTE, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m77 = migracoes.find((m) => m.versao === '0077')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m77.up);
const down = semComentarios(m77.down);
const umaLinha = (s: string) => s.replace(/\s+/g, ' ');
const TABELA = 'core.usuario_filial';
const ERRO = { code: '23514', constraint: 'usuario_filial_inclui_cadastro' };

describe('0077 filial de cadastro e filiais de venda (estático)', () => {
  it('nome e posição: 0077_core_usuario_filial na posição 77 (0070–0076 são de outros lotes)', () => {
    expect(migracoes.map((m) => `${m.versao}_${m.nome}`)[76]).toBe('0077_core_usuario_filial');
  });

  it('core.usuario.filial_cadastro_id: nula, FK composta usuario_filial_cadastro_fk e índice vivo usuario_filial_cadastro_ix', () => {
    const u = umaLinha(up);
    expect(u).toContain('alter table core.usuario add column filial_cadastro_id uuid;');
    expect(u).toContain('alter table core.usuario add constraint usuario_filial_cadastro_fk foreign key (tenant_id, filial_cadastro_id) references core.filial (tenant_id, id);');
    expect(u).toContain('create index usuario_filial_cadastro_ix on core.usuario (tenant_id, filial_cadastro_id) where deleted_at is null;');
  });

  it('core.usuario_filial (venda): FKs compostas, único vivo (usuário, filial), índices, RLS e app sem DELETE', () => {
    const u = umaLinha(up);
    expect(u).toContain('constraint usuario_filial_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id)');
    expect(u).toContain('constraint usuario_filial_filial_fk foreign key (tenant_id, filial_id) references core.filial (tenant_id, id)');
    expect(u).toContain(`create unique index usuario_filial_uk on ${TABELA} (tenant_id, usuario_id, filial_id) where deleted_at is null;`);
    expect(u).toContain(`create index usuario_filial_filial_ix on ${TABELA} (tenant_id, filial_id) where deleted_at is null;`);
    expect(u).toContain(`create index usuario_filial_sync_ix on ${TABELA} (tenant_id, updated_at, id);`);
    expect(u).toContain(`create policy manutencao on ${TABELA} for all to macuxi_manutencao using (true) with check (true);`);
    expect(up).toContain(`grant select, insert, update on ${TABELA} to macuxi_app;`);
    expect(up).not.toMatch(/to macuxi_(worker|portal)/);
  });

  it('invariante: usuario_filial_inclui_cadastro ADIADO nas 2 tabelas, função DEFINER sem EXECUTE, 23514 com hint RN-CORE-39; sem o "máximo 1 do vendedor"', () => {
    const u = umaLinha(up);
    expect(u).toContain('create constraint trigger usuario_filial_inclui_cadastro after insert or update of filial_cadastro_id, deleted_at on core.usuario deferrable initially deferred for each row when (new.filial_cadastro_id is not null and new.deleted_at is null) execute function core.filial_cadastro_conferir();');
    expect(u).toContain(`create constraint trigger usuario_filial_inclui_cadastro after update of usuario_id, filial_id, deleted_at or delete on ${TABELA} deferrable initially deferred for each row when (old.deleted_at is null) execute function core.filial_cadastro_conferir();`);
    expect(u).toContain('create function core.filial_cadastro_conferir() returns trigger language plpgsql security definer set search_path = pg_catalog, core, pg_temp');
    expect(u).toContain("errcode = '23514', constraint = 'usuario_filial_inclui_cadastro'");
    expect(u).toContain("hint = 'RN-CORE-39'");
    expect(u).toContain('for no key update');
    expect(up).toContain('revoke all on function core.filial_cadastro_conferir() from public;');
    expect(up).not.toMatch(/grant execute/);
    for (const velho of ['usuario_filial_vendedor_uma', 'usuario_filial_conferir_vendedor', 'usuario_conferir_filial_vendedor', 'usuario_perfil_conferir_filial_vendedor', 'perfil_conferir_filial_vendedor', 'conferir_filial_vendedor', 'filial_vendedor_conferir', 'usuario_filial_travar', 'pg_advisory_xact_lock']) {
      expect(up, velho).not.toContain(velho);
    }
  });

  it('backfill (R-20261115-094500 item 5): só a empresa com UMA filial viva; usuário vivo recebe venda e cadastro', () => {
    const u = umaLinha(up);
    expect(u).toContain('where f.deleted_at is null group by f.tenant_id having count(*) = 1');
    expect(u).toMatch(/insert into core\.usuario_filial \(tenant_id, usuario_id, filial_id\) select u\.tenant_id, u\.id, fu\.filial_id .* where u\.deleted_at is null;/);
    expect(u).toContain('update core.usuario u set filial_cadastro_id = uf.filial_id');
    expect(up).not.toMatch(/f\.padrao/);
  });

  it('down: gatilho de core.usuario, tabela, função, índice, FK e coluna; idempotente (if exists)', () => {
    const ordem = [
      'drop trigger if exists usuario_filial_inclui_cadastro on core.usuario;',
      `drop table if exists ${TABELA};`,
      'drop function if exists core.filial_cadastro_conferir();',
      'drop index if exists core.usuario_filial_cadastro_ix;',
      'alter table core.usuario drop constraint if exists usuario_filial_cadastro_fk;',
      'alter table core.usuario drop column if exists filial_cadastro_id;',
    ];
    const posicoes = ordem.map((s) => down.indexOf(s));
    expect(posicoes.every((p) => p >= 0)).toBe(true);
    expect([...posicoes].sort((x, y) => x - y)).toEqual(posicoes);
  });

  it('espelho Drizzle e fixture: filial_cadastro_id nula; toda filial de cadastro da fixture está entre as de venda do usuário', () => {
    const colU = getTableConfig(nuvemCore.usuario).columns.find((c) => c.name === 'filial_cadastro_id');
    expect(colU?.notNull).toBe(false);
    const cols = getTableConfig(nuvemCore.usuarioFilial).columns;
    expect(cols.filter((c) => ['usuario_id', 'filial_id'].includes(c.name)).map((c) => [c.name, c.notNull])).toEqual([['usuario_id', true], ['filial_id', true]]);
    expect(ORDEM_TABELAS.indexOf(TABELA)).toBeGreaterThan(ORDEM_TABELAS.indexOf('core.filial'));
    const dados = dadosDoisTenants(HASH_TESTE);
    const venda = (u: string) => dados[TABELA].filter((l) => l.usuario_id === u).map((l) => l.filial_id);
    const cadastro = (u: string) => dados['core.usuario'].find((l) => l.id === u)!.filial_cadastro_id;
    expect([cadastro(A.usuarios.vendedor1), venda(A.usuarios.vendedor1)]).toEqual([FILIAIS_FIXTURE.A.padrao, [FILIAIS_FIXTURE.A.padrao]]);
    expect([cadastro(A.usuarios.supervisor), venda(A.usuarios.supervisor)]).toEqual([FILIAIS_FIXTURE.A.padrao, [FILIAIS_FIXTURE.A.padrao, FILIAIS_FIXTURE.A.boaVista]]);
    expect([cadastro(A.usuarios.vendedor2), venda(A.usuarios.vendedor2)]).toEqual([null, []]);
    expect([cadastro(B.usuarios.vendedor), venda(B.usuarios.vendedor)]).toEqual([FILIAIS_FIXTURE.B.padrao, [FILIAIS_FIXTURE.B.padrao, FILIAIS_FIXTURE.B.campinas]]);
    for (const u of dados['core.usuario']) {
      if (u.filial_cadastro_id) expect(venda(u.id as string), String(u.id)).toContain(u.filial_cadastro_id);
    }
  });
});

type ErroPg = { code: string; constraint: string | null; hint?: string; detail?: string } | null;

describe.skipIf(semBanco())('0077 filial de cadastro e de venda (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  /** Roda os comandos (como o papel dado, no contexto do tenant) e força as conferências do COMMIT; sempre desfaz. */
  async function noCommit(comandos: Array<[string, unknown[]?]>, papel: string | null = null, tenant: string | null = null): Promise<ErroPg> {
    await admin.query('savepoint caso');
    try {
      await admin.query('set constraints all deferred');
      if (papel) {
        await admin.query(`set local role ${papel}`);
        await admin.query("select set_config('app.tenant_id', $1, true)", [tenant ?? '']);
      }
      for (const [sql, params] of comandos) await admin.query(sql, params ?? []);
      await admin.query('set constraints all immediate');
      return null;
    } catch (e) {
      const err = e as { code?: string; constraint?: string; hint?: string; detail?: string };
      return { code: err.code ?? '?', constraint: err.constraint ?? null, hint: err.hint, detail: err.detail };
    } finally {
      await admin.query('rollback to savepoint caso');
      await admin.query('reset role');
    }
  }
  const curto = (e: ErroPg) => (e ? { code: e.code, constraint: e.constraint } : null);
  const vincular = (usuario: string, filial: string, tenant = A.tenantId): [string, unknown[]] => [
    `insert into ${TABELA} (tenant_id, usuario_id, filial_id) values ($1, $2, $3)`, [tenant, usuario, filial],
  ];
  const desvincular = (usuario: string, filial: string): [string, unknown[]] => [
    `update ${TABELA} set deleted_at = now() where usuario_id = $1 and filial_id = $2 and deleted_at is null`, [usuario, filial],
  ];
  const cadastrar = (usuario: string, filial: string | null): [string, unknown[]] => [
    'update core.usuario set filial_cadastro_id = $2 where id = $1', [usuario, filial],
  ];

  it('trocar o cadastro sem a venda = 23514 no COMMIT (hint RN-CORE-39, detail com o usuário); com a venda, em qualquer ordem, passa', async () => {
    await emTransacao(admin, null, async () => {
      const V1 = A.usuarios.vendedor1;
      const BV = FILIAIS_FIXTURE.A.boaVista;
      const app = (cmds: Array<[string, unknown[]?]>) => noCommit(cmds, 'macuxi_app', A.tenantId);
      const e = await app([cadastrar(V1, BV)]);
      expect(curto(e)).toEqual(ERRO);
      expect(e?.hint).toBe('RN-CORE-39');
      expect(e?.detail).toBe(`usuario_id=${V1}`);
      expect(await app([cadastrar(V1, BV), vincular(V1, BV)])).toBeNull();
      expect(await app([vincular(V1, BV), cadastrar(V1, BV), desvincular(V1, FILIAIS_FIXTURE.A.padrao)])).toBeNull();
      // usuário novo com cadastro e sem venda falha; com a venda passa; sem cadastro (bloqueado) passa
      const novo = 'aaaaaaaa-0077-4000-8000-000000000001';
      const criar = (filial: string | null): [string, unknown[]] => [
        "insert into core.usuario (id, tenant_id, nome, email, perfil, filial_cadastro_id) values ($1, $2, 'Novo 77', 'novo77@exemplo.com.br', 'analista', $3)",
        [novo, A.tenantId, filial],
      ];
      expect(curto(await noCommit([criar(BV)]))).toEqual(ERRO);
      expect(await noCommit([criar(BV), vincular(novo, BV)])).toBeNull();
      expect(await noCommit([criar(null)])).toBeNull();
      // o erro sai no comando com set constraints ... immediate
      expect(curto(await app([['set constraints core.usuario_filial_inclui_cadastro immediate'], cadastrar(V1, BV)]))).toEqual(ERRO);
    });
  });

  it('apagar a venda que é o cadastro = 23514 (soft delete, troca de filial_id ou delete); outra venda ou zerar o cadastro junto passa', async () => {
    await emTransacao(admin, null, async () => {
      const V1 = A.usuarios.vendedor1;
      const SUP = A.usuarios.supervisor;
      const PA = FILIAIS_FIXTURE.A.padrao;
      const BV = FILIAIS_FIXTURE.A.boaVista;
      const app = (cmds: Array<[string, unknown[]?]>) => noCommit(cmds, 'macuxi_app', A.tenantId);
      expect(curto(await app([desvincular(V1, PA)]))).toEqual(ERRO);
      expect(curto(await app([[`update ${TABELA} set filial_id = $2 where usuario_id = $1 and deleted_at is null`, [V1, BV]]]))).toEqual(ERRO);
      expect(curto(await noCommit([[`delete from ${TABELA} where usuario_id = $1 and filial_id = $2`, [V1, PA]]]))).toEqual(ERRO);
      expect(await app([desvincular(SUP, BV)])).toBeNull();
      expect(await app([desvincular(V1, PA), cadastrar(V1, null)])).toBeNull();
      expect(await app([cadastrar(V1, null), desvincular(V1, PA)])).toBeNull();
      // usuário apagado não confere; restaurado sem a venda do cadastro, confere
      const apagado: Array<[string, unknown[]?]> = [['update core.usuario set deleted_at = now() where id = $1', [V1]], desvincular(V1, PA)];
      expect(await noCommit(apagado)).toBeNull();
      expect(curto(await noCommit([...apagado, ['set constraints all immediate'], ['update core.usuario set deleted_at = null where id = $1', [V1]]]))).toEqual(ERRO);
    });
  });

  it('isolamento: B não vê nem grava em A; filial de outro tenant = 23503 (venda e cadastro); app sem DELETE; worker e portal sem acesso', async () => {
    await emTransacao(admin, null, async () => {
      const contar = async (tenant: string) => {
        await admin.query('savepoint ver');
        try {
          await admin.query('set local role macuxi_app');
          await admin.query("select set_config('app.tenant_id', $1, true)", [tenant]);
          return (await admin.query<{ t: string }>(`select distinct tenant_id as t from ${TABELA}`)).rows.map((r) => r.t);
        } finally {
          await admin.query('rollback to savepoint ver');
          await admin.query('reset role');
        }
      };
      expect(await contar(A.tenantId)).toEqual([A.tenantId]);
      expect(await contar(B.tenantId)).toEqual([B.tenantId]);
      expect((await noCommit([vincular(A.usuarios.vendedor2, FILIAIS_FIXTURE.A.padrao)], 'macuxi_app', B.tenantId))?.code).toBe('42501');
      expect(curto(await noCommit([vincular(A.usuarios.vendedor2, FILIAIS_FIXTURE.B.campinas)]))).toEqual({ code: '23503', constraint: 'usuario_filial_filial_fk' });
      expect(curto(await noCommit([cadastrar(A.usuarios.vendedor2, FILIAIS_FIXTURE.B.campinas)]))).toEqual({ code: '23503', constraint: 'usuario_filial_cadastro_fk' });
      expect((await noCommit([[`delete from ${TABELA} where usuario_id = $1`, [A.usuarios.supervisor]]], 'macuxi_app', A.tenantId))?.code).toBe('42501');
      for (const papel of ['macuxi_worker', 'macuxi_portal']) {
        expect((await noCommit([[`select 1 from ${TABELA} limit 1`]], papel))?.code, papel).toBe('42501');
      }
    });
  });
});

describe.skipIf(semBanco())('0077 up/down e backfill (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T1 = 'cccccccc-0000-4000-8000-000000000771'; // 1 filial viva (a padrão) -> backfill
  const T2 = 'cccccccc-0000-4000-8000-000000000772'; // 2 filiais vivas -> sem backfill (bloqueados)
  const T3 = 'cccccccc-0000-4000-8000-000000000773'; // 2 filiais, 1 apagada -> backfill na viva
  const F2 = 'cccccccc-0077-4000-8000-000000000202';
  const F3 = 'cccccccc-0077-4000-8000-000000000203';
  const U = {
    ativo: 'cccccccc-0077-4000-8000-000000000101',
    inativo: 'cccccccc-0077-4000-8000-000000000102',
    apagado: 'cccccccc-0077-4000-8000-000000000103',
    t2: 'cccccccc-0077-4000-8000-000000000104',
    t3: 'cccccccc-0077-4000-8000-000000000105',
  };
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('backfill só na empresa com 1 filial viva (venda + cadastro, usuário vivo ativo ou não); down volta ao catálogo da 0076; idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0076' });
      const antes = await retratoDoCatalogo(c);
      for (const [t, cod] of [[T1, 'antigo771'], [T2, 'antigo772'], [T3, 'antigo773']]) {
        await c.query('insert into plataforma.tenant (id, codigo, nome) values ($1, $2, $2)', [t, cod]);
      }
      await c.query("insert into core.filial (id, tenant_id, codigo, nome) values ($1, $2, '0002', 'Filial 2')", [F2, T2]);
      await c.query("insert into core.filial (id, tenant_id, codigo, nome, deleted_at) values ($1, $2, '0002', 'Filial 3', now())", [F3, T3]);
      const usuario = (id: string, tenant: string, email: string, ativo = true, apagado = false) =>
        c.query(
          "insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash, ativo, deleted_at) values ($1, $2, 'Pessoa', $3, 'analista', $4, $5, case when $6 then now() end)",
          [id, tenant, email, HASH_TESTE, ativo, apagado],
        );
      await usuario(U.ativo, T1, 'a77@exemplo.com.br');
      await usuario(U.inativo, T1, 'i77@exemplo.com.br', false);
      await usuario(U.apagado, T1, 'x77@exemplo.com.br', true, true);
      await usuario(U.t2, T2, 'b77@exemplo.com.br');
      await usuario(U.t3, T3, 'c77@exemplo.com.br');

      expect((await migrarUp(c, { ate: '0077' })).aplicadas).toEqual(['0077_core_usuario_filial']);
      const depois = await retratoDoCatalogo(c);
      const estado = async () =>
        (
          await c.query<{ id: string; cadastro: string | null; venda: string[] }>(
            `select u.id, u.filial_cadastro_id as cadastro,
                    coalesce(array_agg(uf.filial_id::text order by uf.filial_id) filter (where uf.id is not null), '{}') as venda
               from core.usuario u left join ${TABELA} uf on uf.usuario_id = u.id and uf.deleted_at is null
              where u.id = any($1) group by u.id, u.filial_cadastro_id order by u.id`,
            [Object.values(U)],
          )
        ).rows;
      const esperado = [
        { id: U.ativo, cadastro: idFilialPadrao(T1), venda: [idFilialPadrao(T1)] },
        { id: U.inativo, cadastro: idFilialPadrao(T1), venda: [idFilialPadrao(T1)] },
        { id: U.apagado, cadastro: null, venda: [] },
        { id: U.t2, cadastro: null, venda: [] },
        { id: U.t3, cadastro: idFilialPadrao(T3), venda: [idFilialPadrao(T3)] },
      ];
      expect(await estado()).toEqual(esperado);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0077_core_usuario_filial']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m77.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);

      await migrarUp(c, { ate: '0077' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect(await estado()).toEqual(esperado);
    });
  });

  it('concorrência: um troca o cadastro para X, outro apaga a venda X do mesmo usuário; o 2º espera o 1º e falha no COMMIT', async () => {
    await comAdmin(b.nome, async (c) => {
      await c.query(`insert into ${TABELA} (tenant_id, usuario_id, filial_id) values ($1, $2, $3), ($1, $2, $4)`, [T2, U.t2, idFilialPadrao(T2), F2]);
      await c.query('update core.usuario set filial_cadastro_id = $2 where id = $1', [U.t2, idFilialPadrao(T2)]);
      const outra = new pg.Client({ connectionString: b.urlAdmin });
      await outra.connect();
      try {
        await c.query('begin');
        await c.query('update core.usuario set filial_cadastro_id = $2 where id = $1', [U.t2, F2]);
        await outra.query('begin');
        await outra.query(`update ${TABELA} set deleted_at = now() where usuario_id = $1 and filial_id = $2`, [U.t2, F2]);
        const segunda = outra.query('commit');
        await new Promise((r) => setTimeout(r, 300));
        await c.query('commit');
        const erro = await segunda.then(
          () => null,
          (e: { code?: string; constraint?: string }) => ({ code: e.code, constraint: e.constraint }),
        );
        expect(erro).toEqual(ERRO);
        const vivas = await c.query(`select filial_id from ${TABELA} where usuario_id = $1 and deleted_at is null order by filial_id`, [U.t2]);
        expect(vivas.rows.map((r: { filial_id: string }) => r.filial_id).sort()).toEqual([idFilialPadrao(T2), F2].sort());
      } finally {
        await outra.query('rollback').catch(() => undefined);
        await outra.end();
      }
    });
  });
});
