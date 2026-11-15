/** 0070 (T-0176, RN-CORE-39; R-20261115-073000): filiais do usuário. O que o banco garante está em docs/banco/core.md, "0070". */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { dadosDoisTenants, DOIS_TENANTS, FILIAIS_FIXTURE, ORDEM_TABELAS, USUARIO_FILIAL_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { idDeChave, idFilialPadrao, idPerfilFabrica } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, HASH_TESTE, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m70 = migracoes.find((m) => m.versao === '0070')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m70.up);
const down = semComentarios(m70.down);
const umaLinha = (s: string) => s.replace(/\s+/g, ' ');
const TABELA = 'core.usuario_filial';
const ERRO = { code: '23514', constraint: 'usuario_filial_vendedor_uma' };
/** Gatilhos de restrição da filial do vendedor: nome e "quando" (o texto entre o nome e o deferrable). */
const GATILHOS: Array<[string, string]> = [
  ['usuario_filial_conferir_vendedor', 'after insert or update of usuario_id, filial_id, deleted_at on core.usuario_filial'],
  ['usuario_conferir_filial_vendedor', 'after update of deleted_at on core.usuario'],
  ['usuario_perfil_conferir_filial_vendedor', 'after insert or update of perfil_id, deleted_at on plataforma.usuario_perfil'],
  ['perfil_conferir_filial_vendedor', 'after update of cargo on plataforma.perfil'],
];

describe('0070 filiais do usuário (estático)', () => {
  it('nome e posição: 0070_core_usuario_filial logo depois da 0069_core_cargo_hierarquia', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0069_core_cargo_hierarquia') + 1]).toBe('0070_core_usuario_filial');
  });

  it('tabela: colunas-padrão, FKs compostas, único vivo (usuário, filial), índices, RLS e app sem DELETE', () => {
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

  it('backfill: vendedor (cargo) vivo e ativo sem vínculo vivo -> filial padrão, id determinístico, ANTES dos gatilhos', () => {
    const u = umaLinha(up);
    expect(u).toContain("plataforma.uuid_de_chave(h.tenant_id::text || ':core.usuario_filial:' || h.usuario_id::text || ':' || f.id::text)");
    expect(u).toContain("join core.filial f on f.tenant_id = h.tenant_id and f.padrao and f.deleted_at is null");
    expect(u).toContain("where h.cargo = 'vendedor' and u.ativo and u.deleted_at is null");
    expect(up.indexOf(`insert into ${TABELA}`)).toBeLessThan(up.indexOf('create trigger usuario_filial_travar'));
    expect(up.indexOf(`insert into ${TABELA}`)).toBeLessThan(up.indexOf('create constraint trigger'));
  });

  it('máximo de 1: 4 gatilhos ADIADOS na mesma função (DEFINER, sem EXECUTE a ninguém), erro nomeado com hint RN-CORE-39; trava por usuário', () => {
    const u = umaLinha(up);
    for (const [gatilho, quando] of GATILHOS) {
      expect(u).toContain(`create constraint trigger ${gatilho} ${quando} deferrable initially deferred for each row execute function core.filial_vendedor_conferir();`);
    }
    expect(u).toContain('create trigger usuario_filial_travar before insert or update of usuario_id, deleted_at on core.usuario_filial for each row execute function core.usuario_filial_travar();');
    expect(u).toContain("create function core.filial_vendedor_conferir() returns trigger language plpgsql security definer set search_path = pg_catalog, core, plataforma, pg_temp");
    expect(u).toContain("constraint = 'usuario_filial_vendedor_uma'");
    expect(u).toContain("hint = 'RN-CORE-39'");
    expect(u).toContain("h.cargo = 'vendedor'");
    expect(u).toContain('count(distinct uf.id) > 1');
    expect(up.match(/pg_advisory_xact_lock\(hashtextextended\('core\.usuario_filial:'/g)).toHaveLength(2);
    expect(up).not.toMatch(/grant execute/);
    for (const f of ['core.usuario_filial_travar()', 'core.conferir_filial_vendedor(uuid, uuid[])', 'core.filial_vendedor_conferir()']) {
      expect(up).toContain(`revoke all on function ${f} from public;`);
    }
  });

  it('down: tira os gatilhos das tabelas que ficam, a tabela e as 3 funções; idempotente (if exists)', () => {
    for (const [gatilho, quando] of GATILHOS.slice(1)) {
      const tabela = /on ([a-z_.]+)$/.exec(quando)![1];
      expect(down).toContain(`drop trigger if exists ${gatilho} on ${tabela};`);
    }
    for (const s of [
      `drop table if exists ${TABELA};`,
      'drop function if exists core.filial_vendedor_conferir();',
      'drop function if exists core.conferir_filial_vendedor(uuid, uuid[]);',
      'drop function if exists core.usuario_filial_travar();',
    ]) expect(down).toContain(s);
    expect(down.indexOf(`drop table if exists ${TABELA}`)).toBeLessThan(down.indexOf('drop function if exists core.filial_vendedor_conferir'));
  });

  it('espelho Drizzle e fixture: usuario_id e filial_id NOT NULL; A com vendedor-1 (1) e supervisor (2), vendedor-2 sem; B com o vendedor', () => {
    const cols = getTableConfig(nuvemCore.usuarioFilial).columns;
    expect(cols.filter((c) => ['usuario_id', 'filial_id'].includes(c.name)).map((c) => [c.name, c.notNull])).toEqual([['usuario_id', true], ['filial_id', true]]);
    expect(ORDEM_TABELAS.indexOf(TABELA)).toBeGreaterThan(ORDEM_TABELAS.indexOf('core.filial'));
    const linhas = dadosDoisTenants(HASH_TESTE)[TABELA];
    const de = (u: string) => linhas.filter((l) => l.usuario_id === u).map((l) => l.filial_id);
    expect(de(A.usuarios.vendedor1)).toEqual([FILIAIS_FIXTURE.A.padrao]);
    expect(de(A.usuarios.supervisor)).toEqual([FILIAIS_FIXTURE.A.padrao, FILIAIS_FIXTURE.A.boaVista]);
    expect(de(A.usuarios.vendedor2)).toEqual([]);
    expect(de(B.usuarios.vendedor)).toEqual([FILIAIS_FIXTURE.B.campinas]);
  });
});

type ErroPg = { code: string; constraint: string | null; hint?: string; detail?: string } | null;

describe.skipIf(semBanco())('0070 filiais do usuário (banco, fixture dois-tenants)', () => {
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

  it('vendedor: 2ª filial viva = 23514 usuario_filial_vendedor_uma no COMMIT (hint RN-CORE-39, detail com o usuário); trocar em qualquer ordem passa', async () => {
    await emTransacao(admin, null, async () => {
      const V1 = A.usuarios.vendedor1;
      const app = (cmds: Array<[string, unknown[]?]>) => noCommit(cmds, 'macuxi_app', A.tenantId);
      const e = await app([vincular(V1, FILIAIS_FIXTURE.A.boaVista)]);
      expect(curto(e)).toEqual(ERRO);
      expect(e?.hint).toBe('RN-CORE-39');
      expect(e?.detail).toBe(`usuario_id=${V1}`);
      expect(await app([vincular(V1, FILIAIS_FIXTURE.A.boaVista), desvincular(V1, FILIAIS_FIXTURE.A.padrao)])).toBeNull();
      expect(await app([desvincular(V1, FILIAIS_FIXTURE.A.padrao), vincular(V1, FILIAIS_FIXTURE.A.boaVista)])).toBeNull();
      // trocar a filial da linha (update de filial_id) também passa
      expect(await app([[`update ${TABELA} set filial_id = $2 where id = $1`, [USUARIO_FILIAL_FIXTURE.A.vendedor1Padrao, FILIAIS_FIXTURE.A.boaVista]]])).toBeNull();
      // vendedor sem filial passa no banco (o mínimo é do domain/API do Core); a 1ª passa
      expect(await app([vincular(A.usuarios.vendedor2, FILIAIS_FIXTURE.A.boaVista)])).toBeNull();
      // a mesma filial viva duas vezes = 23505 na hora (único parcial)
      expect(curto(await app([vincular(V1, FILIAIS_FIXTURE.A.padrao)]))).toEqual({ code: '23505', constraint: 'usuario_filial_uk' });
      // inativo continua com no máximo 1
      expect(curto(await noCommit([['update core.usuario set ativo = false where id = $1', [V1]], vincular(V1, FILIAIS_FIXTURE.A.boaVista)]))).toEqual(ERRO);
    });
  });

  it('supervisor com várias passa; virar vendedor (perfil, cargo do perfil ou restaurar o apagado) com 2 filiais = 23514', async () => {
    await emTransacao(admin, null, async () => {
      const AN = A.usuarios.analista;
      expect(await noCommit([desvincular(A.usuarios.supervisor, FILIAIS_FIXTURE.A.padrao), vincular(A.usuarios.supervisor, FILIAIS_FIXTURE.A.padrao)])).toBeNull();
      const duas: Array<[string, unknown[]]> = [vincular(AN, FILIAIS_FIXTURE.A.padrao), vincular(AN, FILIAIS_FIXTURE.A.boaVista)];
      expect(await noCommit(duas)).toBeNull();
      // o perfil principal muda (gatilho usuario_perfil_principal troca o vínculo de perfil)
      expect(curto(await noCommit([...duas, ["update core.usuario set perfil = 'vendedor' where id = $1", [AN]]]))).toEqual(ERRO);
      // ... e passa se, na mesma transação, uma das filiais sai (ordem não importa)
      expect(await noCommit([["update core.usuario set perfil = 'vendedor' where id = $1", [AN]], ...duas, desvincular(AN, FILIAIS_FIXTURE.A.boaVista)])).toBeNull();
      // o cargo do perfil dele vira vendedor
      expect(curto(await noCommit([...duas, ["update plataforma.perfil set cargo = 'vendedor' where id = $1", [idPerfilFabrica(A.tenantId, 'analista')]]]))).toEqual(ERRO);
      // usuário apagado não confere; restaurado, confere
      const V2 = A.usuarios.vendedor2;
      const apagadoComDuas: Array<[string, unknown[]]> = [
        ['update core.usuario set deleted_at = now() where id = $1', [V2]],
        vincular(V2, FILIAIS_FIXTURE.A.padrao),
        vincular(V2, FILIAIS_FIXTURE.A.boaVista),
      ];
      expect(await noCommit(apagadoComDuas)).toBeNull();
      expect(curto(await noCommit([...apagadoComDuas, ['set constraints all immediate'], ['update core.usuario set deleted_at = null where id = $1', [V2]]]))).toEqual(ERRO);
    });
  });

  it('isolamento: B não vê nem grava em A; filial de outro tenant = 23503; app sem DELETE; worker e portal sem acesso', async () => {
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
      expect((await noCommit([[`delete from ${TABELA} where id = $1`, [USUARIO_FILIAL_FIXTURE.A.vendedor1Padrao]]], 'macuxi_app', A.tenantId))?.code).toBe('42501');
      for (const papel of ['macuxi_worker', 'macuxi_portal']) {
        expect((await noCommit([[`select 1 from ${TABELA} limit 1`]], papel))?.code, papel).toBe('42501');
      }
    });
  });
});

describe.skipIf(semBanco())('0070 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000070';
  const U = {
    vendedor: 'cccccccc-0070-4000-8000-000000000101', // vivo e ativo -> recebe a padrão
    inativo: 'cccccccc-0070-4000-8000-000000000102', // inativo -> fica sem
    apagado: 'cccccccc-0070-4000-8000-000000000103', // apagado -> fica sem
    supervisor: 'cccccccc-0070-4000-8000-000000000104', // não é vendedor -> fica sem
  };
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('backfill só do vendedor vivo e ativo, na padrão; down volta ao catálogo da 0069; idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0069' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo70', 'Antigo 70')", [T]);
      const usuario = (id: string, email: string, perfil: string, ativo = true, apagado = false) =>
        c.query(
          'insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash, ativo, deleted_at) values ($1, $2, $3, $4, $5, $6, $7, case when $8 then now() end)',
          [id, T, `Pessoa ${perfil}`, email, perfil, HASH_TESTE, ativo, apagado],
        );
      await usuario(U.vendedor, 'v70@exemplo.com.br', 'vendedor');
      await usuario(U.inativo, 'i70@exemplo.com.br', 'vendedor', false);
      await usuario(U.apagado, 'a70@exemplo.com.br', 'vendedor', true, true);
      await usuario(U.supervisor, 's70@exemplo.com.br', 'supervisor');

      expect((await migrarUp(c, { ate: '0070' })).aplicadas).toEqual(['0070_core_usuario_filial']);
      const depois = await retratoDoCatalogo(c);
      const padrao = idFilialPadrao(T);
      const linhas = async () => (await c.query(`select id, usuario_id, filial_id from ${TABELA} where tenant_id = $1 and deleted_at is null order by usuario_id`, [T])).rows;
      expect(await linhas()).toEqual([{ id: idDeChave(`${T}:core.usuario_filial:${U.vendedor}:${padrao}`), usuario_id: U.vendedor, filial_id: padrao }]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0070_core_usuario_filial']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m70.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);

      await migrarUp(c, { ate: '0070' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect(await linhas()).toHaveLength(1);
    });
  });

  it('concorrência: duas transações dão a 2ª filial ao mesmo vendedor; a 2ª espera a 1ª e falha no COMMIT', async () => {
    const OUTRA_FILIAL = 'cccccccc-0070-4000-8000-000000000201';
    await comAdmin(b.nome, async (c) => {
      await c.query("insert into core.filial (id, tenant_id, codigo, nome) values ($1, $2, '0002', 'Filial 70')", [OUTRA_FILIAL, T]);
      await c.query(`update ${TABELA} set deleted_at = now() where usuario_id = $1`, [U.vendedor]);
      const outra = new pg.Client({ connectionString: b.urlAdmin });
      await outra.connect();
      try {
        const sql = `insert into ${TABELA} (tenant_id, usuario_id, filial_id) values ($1, $2, $3)`;
        await c.query('begin');
        await c.query(sql, [T, U.vendedor, idFilialPadrao(T)]);
        await outra.query('begin');
        const segunda = outra.query(sql, [T, U.vendedor, OUTRA_FILIAL]).then(() => outra.query('commit'));
        await new Promise((r) => setTimeout(r, 300));
        await c.query('commit');
        const erro = await segunda.then(
          () => null,
          (e: { code?: string; constraint?: string }) => ({ code: e.code, constraint: e.constraint }),
        );
        expect(erro).toEqual(ERRO);
        const vivas = await c.query(`select filial_id from ${TABELA} where usuario_id = $1 and deleted_at is null`, [U.vendedor]);
        expect(vivas.rows).toEqual([{ filial_id: idFilialPadrao(T) }]);
      } finally {
        await outra.query('rollback').catch(() => undefined);
        await outra.end();
      }
    });
  });
});
