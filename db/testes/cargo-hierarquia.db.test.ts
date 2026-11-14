/**
 * 0069 — cargo do perfil, um perfil por usuário e hierarquia do cadastro (decisão do dono do produto de 14/11/2026,
 * R-20261114-153500). Dicionário: docs/banco/plataforma.md e docs/banco/core.md, "0069". O que o BANCO garante:
 * - plataforma.perfil.cargo NOT NULL, sem padrão, em vendedor | promotor | supervisor | gerente | administrativo
 *   (perfil_cargo_valido; promotor desde R-20261114-153800); backfill e semeadura por plataforma.cargo_da_base;
 * - promotor (R-20261114-154000, RN-CORE-56): gerente obrigatório e supervisor opcional; com supervisor, o gerente é o do
 *   supervisor — gatilhos adiados (promotor_sem_gerente, promotor_gerente_do_supervisor, hint RN-CORE-56) em gravações
 *   novas/alteradas do promotor COM equipe (sem equipe = domain/API do Core); legado não trava; a função de gatilho é
 *   SECURITY DEFINER (o COMMIT do portal, fora da sa_*, não tem acesso a core: ver conferencias-no-commit.test.ts);
 * - no máximo um vínculo vivo por usuário (usuario_perfil_um_vivo, exclusão adiada: 23P01 no COMMIT); trocar
 *   core.usuario.perfil substitui o vínculo; a migração deixa quem tinha vários com o de nível mais alto;
 * - core.v_usuario_hierarquia (security_invoker): cargo, equipe, supervisor_id e gerente_id derivados de core.equipe;
 * - RLS: o tenant B não vê nem altera o cargo/hierarquia do A; worker e portal sem acesso à view;
 * - up/down: o down devolve os vínculos apagados e volta exatamente ao catálogo da 0068; up de novo igual.
 * Estático no PC; banco (fixture dois-tenants, sempre com ROLLBACK) e up/down num banco efêmero no CI.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { CARGO_DA_BASE, CARGOS, PERFIS } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as esquemaPlataforma from '../esquema/plataforma';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { idPerfilFabrica } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m41 = migracoes.find((m) => m.versao === '0041')!;
const m51 = migracoes.find((m) => m.versao === '0051')!;
const m69 = migracoes.find((m) => m.versao === '0069')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m69.up);
const down = semComentarios(m69.down);
const umaLinha = (s: string) => s.replace(/\s+/g, ' ');
/** Bloco de uma função do `create [or replace] function <nome>` até o "$$;" que fecha o corpo. */
const bloco = (sql: string, nome: string) => {
  const i = sql.search(new RegExp(`create (or replace )?function ${nome.replace('.', '\\.')}\\(`));
  if (i < 0) return '';
  const fim = /^\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length).replace(/^create (or replace )?function/, 'create function') : '';
};
const VIEW = 'core.v_usuario_hierarquia';
const EXCLUSAO = 'usuario_perfil_um_vivo';
/** Gatilhos do promotor (R-20261114-154000): nome e "quando" (o texto entre o nome e o deferrable). */
const GATILHOS_PROMOTOR: Array<[string, string]> = [
  ['usuario_conferir_promotor', 'after insert or update of perfil, equipe_id, ativo, deleted_at on core.usuario'],
  ['equipe_conferir_promotor', 'after update of responsavel_id, equipe_pai_id, deleted_at on core.equipe'],
  ['usuario_perfil_conferir_promotor', 'after insert or update of perfil_id, deleted_at on plataforma.usuario_perfil'],
  ['perfil_conferir_promotor', 'after update of cargo on plataforma.perfil'],
];
const SEM_GERENTE = { code: '23514', constraint: 'promotor_sem_gerente' };
/** hint dos 2 erros do promotor (ADR 0049). */
const HINT_PROMOTOR = 'RN-CORE-56';
const GERENTE_DO_SUPERVISOR = { code: '23514', constraint: 'promotor_gerente_do_supervisor' };
/** Hash argon2id de teste (formato PHC exigido pelo CHECK de core.usuario.senha_hash). */
const HASH = '$argon2id$v=19$m=1,t=1,p=1$b3V0cm8$b3V0cm9oYXNo';

describe('0069 cargo, um perfil por usuário e hierarquia (estático)', () => {
  it('nome e posição: 0069_core_cargo_hierarquia logo depois da 0068_plataforma_tenant_numero_licenca', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0068_plataforma_tenant_numero_licenca') + 1]).toBe('0069_core_cargo_hierarquia');
  });

  it('cargo: lista fixa (5, com promotor) = CARGOS do SDK; NOT NULL sem padrão; mapeamento promotor -> promotor', () => {
    const check = /constraint perfil_cargo_valido\s+check \(cargo in \(([^)]*)\)\)/.exec(up)?.[1] ?? '';
    expect([...check.matchAll(/'([a-z]+)'/g)].map((x) => x[1])).toEqual([...CARGOS]);
    expect(up).toContain('alter table plataforma.perfil add column cargo text;');
    expect(up).toContain('alter table plataforma.perfil alter column cargo set not null;');
    expect(up).not.toMatch(/cargo text (not null )?default/);
    expect(up).toContain("when 'promotor' then 'promotor'");
    expect(m69.up).not.toMatch(/a confirmar/i);
    expect(up.indexOf('update plataforma.perfil set cargo = plataforma.cargo_da_base(base);')).toBeLessThan(up.indexOf('alter column cargo set not null'));
    // toda base dos PERFIS tem cargo na lista
    for (const p of PERFIS) expect(CARGOS as readonly string[]).toContain(CARGO_DA_BASE[p]);
  });

  it('semeadura com o cargo: o texto da 0051 + a coluna cargo (mesmos nomes de fábrica)', () => {
    const da51 = bloco(semComentarios(m51.up), 'plataforma.semear_perfis_fabrica');
    const da68 = bloco(up, 'plataforma.semear_perfis_fabrica');
    expect(da51).not.toBe('');
    expect(da68.replace(', cargo)', ')').replace(/, true, true,\s+plataforma\.cargo_da_base\(f\.base\)/, ', true, true')).toBe(da51);
  });

  it('um perfil por usuário: exclusão adiada nos vínculos vivos, criada DEPOIS da limpeza; gatilho do principal substitui', () => {
    expect(umaLinha(up)).toContain(
      `alter table plataforma.usuario_perfil add constraint ${EXCLUSAO} exclude using btree (tenant_id with =, usuario_id with =) where (deleted_at is null) deferrable initially deferred;`,
    );
    expect(up.indexOf('update plataforma.usuario_perfil up set deleted_at = now()\n  from ordem o')).toBeLessThan(up.indexOf(`add constraint ${EXCLUSAO}`));
    expect(umaLinha(up)).toContain("array_position(array['admin', 'gerente', 'supervisor', 'analista', 'assistente', 'vendedor', 'promotor']::text[], p.base)");
    const g = bloco(up, 'plataforma.garantir_perfil_principal');
    expect(g).toContain('update plataforma.usuario_perfil up set deleted_at = now()');
    expect(g).not.toContain('v_vivos');
  });

  it('hierarquia: view security_invoker sem coluna nova em core.usuario; select só ao macuxi_app; nenhum índice novo (equipe_responsavel_ix é da 0004)', () => {
    expect(up).toContain(`create view ${VIEW} with (security_invoker = true) as`);
    expect(up).toContain(`grant select on ${VIEW} to macuxi_app;`);
    expect(up).not.toMatch(/alter table core\.usuario/);
    expect(up).not.toMatch(/create table/);
    expect(up).not.toMatch(/create (unique )?index/);
  });

  it('promotor: 4 gatilhos de restrição ADIADOS na mesma função (DEFINER, sem EXECUTE a ninguém), que confere pela view; 2 erros nomeados com hint RN-CORE-56; só promotor com equipe; criados depois da view', () => {
    const u1 = umaLinha(up);
    for (const [gatilho, quando] of GATILHOS_PROMOTOR) {
      expect(u1).toContain(`create constraint trigger ${gatilho} ${quando} deferrable initially deferred for each row execute function core.promotor_conferir();`);
    }
    const f = bloco(up, 'core.conferir_promotores');
    expect(f).toContain('from core.v_usuario_hierarquia h');
    expect(f).toContain("constraint = 'promotor_sem_gerente'");
    expect(f).toContain("constraint = 'promotor_gerente_do_supervisor'");
    expect(f).toContain("h.cargo = 'promotor' and u.ativo and u.equipe_id is not null");
    expect(f.match(new RegExp(`hint = '${HINT_PROMOTOR}'`, 'g'))).toHaveLength(2);
    expect(f).not.toContain('R-20261114-154000');
    // a função de gatilho roda como o dono (COMMIT do portal); nenhuma das 2 tem EXECUTE para papel da aplicação
    expect(umaLinha(bloco(up, 'core.promotor_conferir'))).toContain('returns trigger language plpgsql security definer set search_path = pg_catalog, core, plataforma, pg_temp');
    expect(f).not.toMatch(/security definer/);
    expect(up).not.toMatch(/grant execute on function core\.(conferir_promotores|promotor_conferir)/);
    expect(up).toContain('revoke all on function core.conferir_promotores(uuid, uuid[], uuid[]) from public;');
    expect(up).toContain('revoke all on function core.promotor_conferir() from public;');
    expect(up.indexOf(`create view ${VIEW}`)).toBeLessThan(up.indexOf('create constraint trigger'));
    // view: promotor com supervisor (equipe de um supervisor) ou direto no gerente (equipe de um gerente)
    expect(u1).toContain("when p.cargo = 'promotor' and r.cargo = 'supervisor' then e.responsavel_id end as supervisor_id");
    expect(u1).toContain("when p.cargo = 'promotor' and r.cargo = 'gerente' then e.responsavel_id when p.cargo = 'promotor' and r.cargo = 'supervisor' then ep.responsavel_id end as gerente_id");
  });

  it('down: desfaz tudo e volta as 2 funções aos textos da 0041 e da 0051; devolve os vínculos pelo instante da 0069', () => {
    for (const [gatilho, quando] of GATILHOS_PROMOTOR) {
      const tabela = /on ([a-z_.]+)$/.exec(quando)![1];
      expect(down).toContain(`drop trigger if exists ${gatilho} on ${tabela};`);
      // os gatilhos saem antes de o down mexer nos vínculos
      expect(down.indexOf(`drop trigger if exists ${gatilho}`)).toBeLessThan(down.indexOf('update plataforma.usuario_perfil up set deleted_at = null'));
    }
    for (const s of [
      'drop function if exists core.promotor_conferir();',
      'drop function if exists core.conferir_promotores(uuid, uuid[], uuid[]);',
      `drop view if exists ${VIEW};`,
      `alter table plataforma.usuario_perfil drop constraint if exists ${EXCLUSAO};`,
      'alter table plataforma.perfil drop column if exists cargo;',
      'drop function if exists plataforma.cargo_da_base(text);',
    ]) expect(down).toContain(s);
    expect(bloco(down, 'plataforma.garantir_perfil_principal')).toBe(bloco(semComentarios(m41.up), 'plataforma.garantir_perfil_principal'));
    expect(bloco(down, 'plataforma.semear_perfis_fabrica')).toBe(bloco(semComentarios(m51.up), 'plataforma.semear_perfis_fabrica'));
    expect(umaLinha(down)).toContain("where up.deleted_at = (select m.aplicada_em from public.macuxi_migracao m where m.versao = '0069')");
    // a exclusão sai antes de os vínculos voltarem (senão 23P01 no COMMIT do down)
    expect(down.indexOf(`drop constraint if exists ${EXCLUSAO}`)).toBeLessThan(down.indexOf('update plataforma.usuario_perfil up set deleted_at = null'));
  });

  it('espelho Drizzle: perfil.cargo com a lista CARGOS, NOT NULL e sem padrão', () => {
    const col = getTableConfig(esquemaPlataforma.perfil).columns.find((c) => c.name === 'cargo');
    expect([col?.getSQLType(), col?.notNull, col?.default]).toEqual(['text', true, undefined]);
    expect([...(esquemaPlataforma.perfil.cargo.enumValues ?? [])]).toEqual([...CARGOS]);
  });
});

type ErroPg = { code: string; constraint: string | null } | null;

describe.skipIf(semBanco())('0069 cargo, um perfil por usuário e hierarquia (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
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
      const err = e as { code?: string; constraint?: string };
      return { code: err.code ?? '?', constraint: err.constraint ?? null };
    } finally {
      await admin.query('rollback to savepoint caso');
      await admin.query('reset role');
    }
  }
  async function como<T extends pg.QueryResultRow = Record<string, unknown>>(papel: string, tenant: string | null, sql: string, params: unknown[] = []) {
    await admin.query('savepoint como');
    try {
      await admin.query(`set local role ${papel}`);
      await admin.query("select set_config('app.tenant_id', $1, true)", [tenant ?? '']);
      return (await admin.query<T>(sql, params)).rows;
    } finally {
      await admin.query('rollback to savepoint como');
      await admin.query('reset role');
    }
  }
  const vivos = (usuario: string) =>
    q<{ codigo: string }>(
      `select p.codigo from plataforma.usuario_perfil up join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
        where up.usuario_id = $1 and up.deleted_at is null order by p.codigo`,
      [usuario],
    ).then((r) => r.map((x) => x.codigo));

  it('cargo dos 7 de fábrica (A, B e tenant novo) pelo mapeamento; personalizado da fixture = vendedor', async () => {
    await emTransacao(admin, null, async () => {
      const T = 'cccccccc-0069-4000-8000-000000000001';
      await admin.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 't68-novo', 'Novo 68')", [T]);
      for (const t of [A.tenantId, B.tenantId, T]) {
        const r = await q<{ base: string; cargo: string }>('select base, cargo from plataforma.perfil where tenant_id = $1 and fabrica order by base', [t]);
        expect(r).toEqual([...PERFIS].sort().map((base) => ({ base, cargo: CARGO_DA_BASE[base] })));
      }
      expect(await q('select cargo from plataforma.perfil where id = $1', [A.perfis.vendedorExterno])).toEqual([{ cargo: 'vendedor' }]);
      expect(await como('macuxi_app', A.tenantId, "select plataforma.cargo_da_base('promotor') as c, plataforma.cargo_da_base('admin') as d"))
        .toEqual([{ c: 'promotor', d: 'administrativo' }]);
    });
  });

  it('cargo obrigatório e da lista: sem cargo = 23502; fora da lista = 23514 perfil_cargo_valido; troca para outro da lista passa', async () => {
    await emTransacao(admin, null, async () => {
      const ins = (cargo: string | null): Array<[string, unknown[]]> => [[
        'insert into plataforma.perfil (tenant_id, codigo, nome, base, cargo) values ($1, $2, $3, $4, $5)', [A.tenantId, 'coord_68', 'Coordenador', 'analista', cargo],
      ]];
      expect(await noCommit([["insert into plataforma.perfil (tenant_id, codigo, nome, base) values ($1, 'sem_cargo_68', 'Sem cargo', 'vendedor')", [A.tenantId]]], 'macuxi_app', A.tenantId))
        .toMatchObject({ code: '23502' });
      expect(await noCommit(ins(null))).toMatchObject({ code: '23502' });
      expect(await noCommit(ins('diretor'))).toEqual({ code: '23514', constraint: 'perfil_cargo_valido' });
      expect(await noCommit(ins('Supervisor'))).toEqual({ code: '23514', constraint: 'perfil_cargo_valido' });
      expect(await noCommit(ins('supervisor'), 'macuxi_app', A.tenantId)).toBeNull();
      expect(await noCommit([['update plataforma.perfil set cargo = null where id = $1', [A.perfis.vendedorExterno]]])).toMatchObject({ code: '23502' });
      expect(await noCommit([["update plataforma.perfil set cargo = 'gerente' where id = $1", [A.perfis.vendedorExterno]]], 'macuxi_app', A.tenantId)).toBeNull();
    });
  });

  it('um perfil por usuário: 2º vínculo vivo = 23P01 no COMMIT; trocar (apaga + insere, qualquer ordem) passa; trocar o principal substitui', async () => {
    await emTransacao(admin, null, async () => {
      const V1 = A.usuarios.vendedor1;
      expect(await vivos(V1)).toEqual(['vendedor']);
      const segundo: [string, unknown[]] = ['insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [A.tenantId, V1, A.perfis.vendedorExterno]];
      const apagaVivo: [string, unknown[]] = ['update plataforma.usuario_perfil set deleted_at = now() where usuario_id = $1 and perfil_id = $2 and deleted_at is null', [V1, idPerfilFabrica(A.tenantId, 'vendedor')]];
      expect(await noCommit([segundo])).toEqual({ code: '23P01', constraint: EXCLUSAO });
      expect(await noCommit([segundo], 'macuxi_app', A.tenantId)).toEqual({ code: '23P01', constraint: EXCLUSAO });
      expect(await noCommit([segundo, apagaVivo], 'macuxi_app', A.tenantId)).toBeNull();
      expect(await noCommit([apagaVivo, segundo], 'macuxi_app', A.tenantId)).toBeNull();
      // o mesmo perfil duas vezes continua 23505 na hora (o único da 0041)
      expect(await noCommit([[segundo[0], [A.tenantId, V1, idPerfilFabrica(A.tenantId, 'vendedor')]]])).toEqual({ code: '23505', constraint: 'usuario_perfil_uk' });
      // trocar o principal substitui o vínculo (os anteriores ficam apagados e não contam)
      await admin.query("update core.usuario set perfil = 'supervisor' where id = $1", [V1]);
      expect(await vivos(V1)).toEqual(['supervisor']);
      await admin.query("update core.usuario set perfil = 'promotor' where id = $1", [V1]);
      expect(await vivos(V1)).toEqual(['promotor']);
      expect(await q('select count(*)::int as n from plataforma.usuario_perfil where usuario_id = $1 and deleted_at is not null', [V1])).toEqual([{ n: 2 }]);
      await admin.query('set constraints all immediate');
    });
  });

  it('view da hierarquia: cargo, equipe, supervisor e gerente derivados de core.equipe (fixture A)', async () => {
    await emTransacao(admin, null, async () => {
      const u = A.usuarios;
      const ids = Object.values(u);
      const r = await como<Record<string, unknown>>(
        'macuxi_app', A.tenantId,
        `select usuario_id, cargo, equipe_id, equipe_nome, supervisor_id, gerente_id from ${VIEW} where usuario_id = any($1::uuid[]) order by usuario_id`,
        [ids],
      );
      const linha = (usuario: string, cargo: string, equipe: string | null, nome: string | null, sup: string | null, ger: string | null) =>
        ({ usuario_id: usuario, cargo, equipe_id: equipe, equipe_nome: nome, supervisor_id: sup, gerente_id: ger });
      const esperado = [
        linha(u.admin, 'administrativo', null, null, null, null),
        linha(u.analista, 'administrativo', null, null, null, null),
        linha(u.assistente, 'administrativo', null, null, null, null),
        linha(u.gerente, 'gerente', A.equipes.regional, 'Regional Alfa', null, null),
        linha(u.supervisor, 'supervisor', A.equipes.equipe1, 'Equipe 1', null, u.gerente),
        linha(u.vendedor1, 'vendedor', A.equipes.equipe1, 'Equipe 1', u.supervisor, u.gerente),
        linha(u.vendedor2, 'vendedor', A.equipes.equipe2, 'Equipe 2', null, u.gerente),
        linha(u.promotor, 'promotor', A.equipes.equipe1, 'Equipe 1', u.supervisor, u.gerente),
      ].sort((x, y) => (x.usuario_id < y.usuario_id ? -1 : 1));
      expect(r).toEqual(esperado);
      // trocar o supervisor do vendedor = trocar a equipe dele; o gerente vem junto (não é gravado no vendedor)
      await admin.query('update core.equipe set responsavel_id = $2 where id = $1', [A.equipes.equipe2, u.supervisor]);
      const v2 = await como('macuxi_app', A.tenantId, `select supervisor_id, gerente_id from ${VIEW} where usuario_id = $1`, [u.vendedor2]);
      expect(v2).toEqual([{ supervisor_id: u.supervisor, gerente_id: u.gerente }]);
    });
  });

  it('promotor (R-20261114-154000): com supervisor (gerente do supervisor) e sem supervisor (direto no gerente) passam; sem gerente ou com gerente que não é o do supervisor = 23514 no COMMIT', async () => {
    await emTransacao(admin, null, async () => {
      const u = A.usuarios;
      const P = u.promotor;
      const hier = (id: string) => como('macuxi_app', A.tenantId, `select cargo, supervisor_id, gerente_id from ${VIEW} where usuario_id = $1`, [id]);
      const app = (cmds: Array<[string, unknown[]?]>) => noCommit(cmds, 'macuxi_app', A.tenantId);
      // fixture: promotor na Equipe 1 (supervisor), gerente = o da equipe-pai (o mesmo do supervisor)
      expect(await hier(P)).toEqual([{ cargo: 'promotor', supervisor_id: u.supervisor, gerente_id: u.gerente }]);
      expect(await hier(u.supervisor)).toEqual([{ cargo: 'supervisor', supervisor_id: null, gerente_id: u.gerente }]);
      expect(await app([['update core.usuario set equipe_id = $2 where id = $1', [P, A.equipes.equipe1]]])).toBeNull();
      // sem supervisor: direto na equipe do gerente (Regional) — supervisor_id nulo, gerente_id preenchido
      expect(await app([['update core.usuario set equipe_id = $2 where id = $1', [P, A.equipes.regional]]])).toBeNull();
      await admin.query('update core.usuario set equipe_id = $2 where id = $1', [P, A.equipes.regional]);
      expect(await hier(P)).toEqual([{ cargo: 'promotor', supervisor_id: null, gerente_id: u.gerente }]);
      await admin.query('update core.usuario set equipe_id = $2 where id = $1', [P, A.equipes.equipe1]);
      // sem equipe: o banco não confere (ainda não alocado; RN-CORE-56 no domain/API do Core, 422)
      expect(await app([['update core.usuario set equipe_id = null where id = $1', [P]]])).toBeNull();
      // sem gerente: equipe sem responsável (Equipe 2); equipe de um vendedor
      expect(await app([['update core.usuario set equipe_id = $2 where id = $1', [P, A.equipes.equipe2]]])).toEqual(SEM_GERENTE);
      expect(await noCommit([
        ['update core.equipe set responsavel_id = $2 where id = $1', [A.equipes.equipe2, u.vendedor2]],
        ['update core.usuario set equipe_id = $2 where id = $1', [P, A.equipes.equipe2]],
      ])).toEqual(SEM_GERENTE);
      // ... e passa se, na mesma transação, a Equipe 2 ganha o supervisor (gerente na equipe-pai): ordem não importa
      expect(await app([
        ['update core.usuario set equipe_id = $2 where id = $1', [P, A.equipes.equipe2]],
        ['update core.equipe set responsavel_id = $2 where id = $1', [A.equipes.equipe2, u.supervisor]],
      ])).toBeNull();
      // promotor novo: sem equipe passa no banco (a API do Core recusa); na equipe do gerente passa; na Equipe 2 (sem responsável) falha
      const novo = (equipe: string | null): [string, unknown[]] => [
        "insert into core.usuario (id, tenant_id, nome, email, perfil, equipe_id, senha_hash) values ('aaaaaaaa-0069-4000-8000-000000000301', $1, 'Promotor Novo', 'prom69@exemplo.com.br', 'promotor', $2, $3)",
        [A.tenantId, equipe, HASH],
      ];
      expect(await app([novo(null)])).toBeNull();
      expect(await app([novo(A.equipes.regional)])).toBeNull();
      expect(await app([novo(A.equipes.equipe2)])).toEqual(SEM_GERENTE);
      // inativo não confere (desligado)
      expect(await app([['update core.usuario set ativo = false, equipe_id = null where id = $1', [P]]])).toBeNull();
      // o gerente do supervisor diverge do do promotor: supervisor membro de outra equipe que não a que lidera
      expect(await app([['update core.usuario set equipe_id = null where id = $1', [u.supervisor]]])).toEqual(GERENTE_DO_SUPERVISOR);
      // a árvore muda por cima: equipe do supervisor sem pai; gerente perde o cargo (perfil) ou o perfil dele muda de cargo; gerente apagado
      expect(await app([['update core.equipe set equipe_pai_id = null where id = $1', [A.equipes.equipe1]]])).toEqual(SEM_GERENTE);
      expect(await app([["update core.usuario set perfil = 'analista' where id = $1", [u.gerente]]])).toEqual(SEM_GERENTE);
      expect(await noCommit([["update plataforma.perfil set cargo = 'administrativo' where id = $1", [idPerfilFabrica(A.tenantId, 'gerente')]]])).toEqual(SEM_GERENTE);
      expect(await noCommit([['update core.equipe set deleted_at = now() where id = $1', [A.equipes.regional]]])).toEqual(SEM_GERENTE);
      // cargo promotor aceito: vendedor-1 (Equipe 1) vira promotor e passa; vendedor-2 (Equipe 2, sem responsável) não
      expect(await app([["update core.usuario set perfil = 'promotor' where id = $1", [u.vendedor1]]])).toBeNull();
      expect(await app([["update core.usuario set perfil = 'promotor' where id = $1", [u.vendedor2]]])).toEqual(SEM_GERENTE);
      // perfil personalizado de cargo promotor (base vendedor) dado ao vendedor-2 = vira promotor: precisa de gerente
      expect(await app([
        ["insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ('aaaaaaaa-0069-4000-8000-000000000302', $1, 'repositor_69', 'Repositor', 'vendedor', 'promotor')", [A.tenantId]],
        ['update plataforma.usuario_perfil set deleted_at = now() where usuario_id = $1 and deleted_at is null', [u.vendedor2]],
        ["insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, 'aaaaaaaa-0069-4000-8000-000000000302')", [A.tenantId, u.vendedor2]],
      ])).toEqual(SEM_GERENTE);
      // vendedor e supervisor seguem sem trava no banco (regra no Core)
      expect(await app([['update core.usuario set equipe_id = null where id = $1', [u.vendedor1]]])).toBeNull();
      await admin.query('set constraints all immediate');
    });
  });

  it('RLS: B não vê a hierarquia nem o cargo de A e não altera o cargo de A; sem contexto = 0 linhas; worker e portal sem acesso', async () => {
    await emTransacao(admin, null, async () => {
      const deB = await como<{ tenant_id: string }>('macuxi_app', B.tenantId, `select tenant_id from ${VIEW}`);
      expect(deB.length).toBeGreaterThan(0);
      expect(deB.every((x) => x.tenant_id === B.tenantId)).toBe(true);
      expect(await como('macuxi_app', B.tenantId, `select 1 from ${VIEW} where usuario_id = $1`, [A.usuarios.vendedor1])).toEqual([]);
      expect(await como('macuxi_app', null, `select 1 from ${VIEW}`)).toEqual([]);
      expect(await como('macuxi_app', B.tenantId, 'select cargo from plataforma.perfil where id = $1', [A.perfis.vendedorExterno])).toEqual([]);
      expect(await como('macuxi_app', B.tenantId, "update plataforma.perfil set cargo = 'gerente' where id = $1 returning id", [A.perfis.vendedorExterno])).toEqual([]);
      expect(await noCommit([["insert into plataforma.perfil (tenant_id, codigo, nome, base, cargo) values ($1, 'de_a_68', 'X', 'vendedor', 'vendedor')", [A.tenantId]]], 'macuxi_app', B.tenantId))
        .toEqual({ code: '42501', constraint: null });
      for (const papel of ['macuxi_worker', 'macuxi_portal']) {
        expect((await noCommit([[`select 1 from ${VIEW} limit 1`]], papel))?.code, papel).toBe('42501');
      }
    });
  });
});

describe.skipIf(semBanco())('0069 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000069';
  const H = '$argon2id$v=19$m=1,t=1,p=1$b3V0cm8$b3V0cm9oYXNo';
  const U = {
    adm: 'cccccccc-0069-4000-8000-000000000101', // admin + admin_x (personalizado) + analista -> fica o admin de FÁBRICA
    multi: 'cccccccc-0069-4000-8000-000000000102', // vendedor + promotor + supervisor -> fica supervisor (principal muda)
    pers: 'cccccccc-0069-4000-8000-000000000103', // vendedor + vendedor_x (personalizado) -> fica vendedor_x
    so: 'cccccccc-0069-4000-8000-000000000104', // só vendedor -> não muda
    prom: 'cccccccc-0069-4000-8000-000000000105', // promotor legado sem equipe -> a 0069 aplica; só trava quando entra numa equipe sem gerente
  };
  const PERS = { adminX: 'cccccccc-0069-4000-8000-000000000201', vendedorX: 'cccccccc-0069-4000-8000-000000000202' };
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('limpa o multiperfil pelo nível, cargo pelo mapeamento; down devolve os vínculos e o catálogo da 0068; idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      const vivos = async (u: string) =>
        (await c.query<{ codigo: string }>(
          `select p.codigo from plataforma.usuario_perfil up join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
            where up.usuario_id = $1 and up.deleted_at is null order by p.codigo`, [u])).rows.map((x) => x.codigo);
      const principal = async (u: string) => (await c.query<{ perfil: string }>('select perfil from core.usuario where id = $1', [u])).rows[0]!.perfil;
      const ligar = (u: string, perfil: string) =>
        c.query('insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [T, u, perfil]);

      await migrarUp(c, { ate: '0068' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo68', 'Antigo 68')", [T]);
      const usuario = (id: string, email: string, perfil: string) =>
        c.query('insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash) values ($1, $2, $3, $4, $5, $6)', [id, T, `Pessoa ${perfil}`, email, perfil, H]);
      await usuario(U.adm, 'adm68@exemplo.com.br', 'admin');
      await usuario(U.multi, 'multi68@exemplo.com.br', 'vendedor');
      await usuario(U.pers, 'pers68@exemplo.com.br', 'vendedor');
      await usuario(U.so, 'so68@exemplo.com.br', 'vendedor');
      await usuario(U.prom, 'prom69@exemplo.com.br', 'promotor');
      await c.query("insert into plataforma.perfil (id, tenant_id, codigo, nome, base) values ($1, $2, 'admin_x', 'Admin X', 'admin')", [PERS.adminX, T]);
      await c.query("insert into plataforma.perfil (id, tenant_id, codigo, nome, base) values ($1, $2, 'vendedor_x', 'Vendedor X', 'vendedor')", [PERS.vendedorX, T]);
      await ligar(U.adm, PERS.adminX);
      await ligar(U.adm, idPerfilFabrica(T, 'analista'));
      await ligar(U.multi, idPerfilFabrica(T, 'promotor'));
      await ligar(U.multi, idPerfilFabrica(T, 'supervisor'));
      await ligar(U.pers, PERS.vendedorX);
      const multiAntes = {
        adm: await vivos(U.adm), multi: await vivos(U.multi), pers: await vivos(U.pers), so: await vivos(U.so),
      };
      expect(multiAntes).toEqual({
        adm: ['admin', 'admin_x', 'analista'], multi: ['promotor', 'supervisor', 'vendedor'], pers: ['vendedor', 'vendedor_x'], so: ['vendedor'],
      });

      expect((await migrarUp(c, { ate: '0069' })).aplicadas).toEqual(['0069_core_cargo_hierarquia']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col plataforma.perfil.cargo text nn=true');
      expect(depois.some((l) => l.startsWith(`con plataforma.${EXCLUSAO} EXCLUDE USING btree`) && l.includes('DEFERRABLE INITIALLY DEFERRED'))).toBe(true);
      expect(depois).toContain(`rel ${VIEW} v rls=false force=false`);
      expect(depois).toContain('fn plataforma.cargo_da_base(p_base text)');
      expect(depois).toContain('fn core.conferir_promotores(p_tenant uuid, p_usuarios uuid[], p_equipes uuid[])');
      for (const [gatilho, quando] of GATILHOS_PROMOTOR) expect(depois).toContain(`trg ${/on ([a-z_.]+)$/.exec(quando)![1]}.${gatilho}`);
      // promotor legado sem gerente: a 0069 aplica; gravação que não o alcança passa; sem equipe o banco não confere (Core);
      // entrar numa equipe sem responsável é recusado no COMMIT, com o hint RN-CORE-56
      expect((await c.query(`select cargo, supervisor_id, gerente_id from ${VIEW} where usuario_id = $1`, [U.prom])).rows)
        .toEqual([{ cargo: 'promotor', supervisor_id: null, gerente_id: null }]);
      await c.query("update core.usuario set nome = 'Promotor Legado' where id = $1", [U.prom]);
      await c.query('update core.usuario set equipe_id = null where id = $1', [U.prom]);
      await c.query("insert into core.equipe (id, tenant_id, nome) values ('cccccccc-0069-4000-8000-000000000301', $1, 'Sem responsável 69')", [T]);
      await expect(c.query("update core.usuario set equipe_id = 'cccccccc-0069-4000-8000-000000000301' where id = $1", [U.prom]))
        .rejects.toMatchObject({ ...SEM_GERENTE, hint: HINT_PROMOTOR });
      // a função de gatilho é DEFINER; nenhuma das 2 tem EXECUTE fora do dono
      const fns = await c.query<{ nome: string; definer: boolean; outros: number }>(
        `select p.proname as nome, p.prosecdef as definer,
                (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) as outros
           from pg_proc p where p.oid in ('core.promotor_conferir()'::regprocedure, 'core.conferir_promotores(uuid, uuid[], uuid[])'::regprocedure)
          order by 1`);
      expect(fns.rows).toEqual([{ nome: 'conferir_promotores', definer: false, outros: 0 }, { nome: 'promotor_conferir', definer: true, outros: 0 }]);
      expect({ adm: await vivos(U.adm), multi: await vivos(U.multi), pers: await vivos(U.pers), so: await vivos(U.so) })
        .toEqual({ adm: ['admin'], multi: ['supervisor'], pers: ['vendedor_x'], so: ['vendedor'] });
      expect([await principal(U.adm), await principal(U.multi), await principal(U.pers), await principal(U.so)]).toEqual(['admin', 'supervisor', 'vendedor', 'vendedor']);
      const cargos = (await c.query<{ codigo: string; cargo: string }>('select codigo, cargo from plataforma.perfil where tenant_id = $1 order by codigo', [T])).rows;
      expect(cargos).toEqual([
        ...PERFIS.map((p) => ({ codigo: p, cargo: CARGO_DA_BASE[p] })),
        { codigo: 'admin_x', cargo: 'administrativo' },
        { codigo: 'vendedor_x', cargo: 'vendedor' },
      ].sort((x, y) => (x.codigo < y.codigo ? -1 : 1)));
      // os apagados pela 0069 têm o instante da migração (é por ele que o down os devolve)
      const marcados = await c.query<{ n: number }>(
        "select count(*)::int as n from plataforma.usuario_perfil where deleted_at = (select aplicada_em from public.macuxi_migracao where versao = '0069')");
      expect(marcados.rows).toEqual([{ n: 5 }]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0069_core_cargo_hierarquia']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect({ adm: await vivos(U.adm), multi: await vivos(U.multi), pers: await vivos(U.pers), so: await vivos(U.so) }).toEqual(multiAntes);
      // o principal fica com a base mais alta (continua entre os perfis do usuário)
      expect(await principal(U.multi)).toBe('supervisor');
      await c.query(m69.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect(await vivos(U.multi)).toEqual(multiAntes.multi);

      await migrarUp(c, { ate: '0069' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect(await vivos(U.multi)).toEqual(['supervisor']);
    });
  });
});
