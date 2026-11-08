/**
 * 0041 — perfis de acesso (T-0111 motor de permissões, T-0112 multiperfil; ADR 0033; pedido R-20261107-195859-engenheiro-software;
 * RN-CORE-01, RN-CORE-04, RN-CORE-33, RN-CORE-35, RN-PRO-01). O que o BANCO garante:
 * - plataforma.perfil: 7 de fábrica em todo tenant (existente e novo; ids idPerfilFabrica, nome = ROTULO_PERFIL), código no
 *   formato do SDK e único no tenant (apagados inclusive), base dos PERFIS, código/base/fábrica imutáveis, fábrica sempre ativa;
 * - plataforma.perfil_permissao: só o que o tenant mudou (a migração não grava nada); nível e alvos no formato; travas RN-CORE-33,
 *   RN-PRO-01 e RN-CORE-04 (23514);
 * - plataforma.usuario_perfil: todo usuário com o perfil principal (core.usuario.perfil) entre os seus; no COMMIT, nenhum usuário
 *   sem perfil, com perfil desativado ou sem o principal; sempre um admin ativo com a gestão (tenant_ultimo_admin);
 * - perfil_modulo por código (FK para o perfil do tenant); perfis_do_usuario só no tenant do contexto;
 * - RLS: macuxi_app só no próprio tenant; worker e portal sem acesso; nada SECURITY DEFINER;
 * - up/down: semeadura dos existentes e conferência; o down volta exatamente ao catálogo e às ACLs da 0040.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero). Nada roda em base real.
 */
import pg from 'pg';
import {
  ACAO_RE,
  BASES_SEM_BKO,
  CHAVES_GESTAO_DO_ACESSO,
  CODIGO_PERFIL_RE,
  escopoMaximoDaBase,
  matrizDeFabrica,
  NIVEIS_ALCADA,
  NIVEIS_ESCOPO,
  PERFIS,
  ROTULO_PERFIL,
} from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as esquemaPlataforma from '../esquema/plataforma';
import { dadosDoisTenants, DOIS_TENANTS, ORDEM_TABELAS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { idDeChave, idPerfilFabrica, idUsuarioPerfil } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m41 = migracoes.find((m) => m.versao === '0041')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m41.up);
const down = semComentarios(m41.down);
const corpoDe = (tabela: string) => new RegExp(`create table ${tabela.replace('.', '\\.')} \\(([\\s\\S]*?)\\n\\);`).exec(up)?.[1] ?? '';
const lista = (texto: string) => [...texto.matchAll(/'([a-z_.]+)'/g)].map((x) => x[1]!);
const TABELAS = ['plataforma.perfil', 'plataforma.perfil_permissao', 'plataforma.usuario_perfil'] as const;
const FUNCOES = [
  'plataforma.semear_perfis_fabrica(uuid)',
  'plataforma.semear_tenant_perfis()',
  'plataforma.garantir_perfil_principal()',
  'plataforma.perfil_imutavel()',
  'plataforma.perfil_permissao_travas()',
  'plataforma.usuario_admin_com_gestao(uuid, uuid)',
  'plataforma.tenant_tem_admin_com_gestao(uuid)',
  'plataforma.conferir_perfis_do_usuario(uuid, uuid)',
  'plataforma.conferir_ultimo_admin(uuid)',
  'plataforma.usuario_conferir_acesso()',
  'plataforma.usuario_perfil_conferir()',
  'plataforma.perfil_conferir()',
  'plataforma.perfil_permissao_conferir()',
  'plataforma.perfis_do_usuario(uuid)',
] as const;
/** Funções que o macuxi_app executa (direto ou de dentro dos gatilhos, que rodam como ele). */
const DO_APP = [
  'plataforma.semear_perfis_fabrica(uuid)',
  'plataforma.usuario_admin_com_gestao(uuid, uuid)',
  'plataforma.tenant_tem_admin_com_gestao(uuid)',
  'plataforma.conferir_perfis_do_usuario(uuid, uuid)',
  'plataforma.conferir_ultimo_admin(uuid)',
  'plataforma.perfis_do_usuario(uuid)',
];

describe('0041 perfis de acesso (estático)', () => {
  it('nome e posição: 0041_plataforma_perfis_de_acesso logo depois da 0040', () => {
    expect(m41.nome).toBe('plataforma_perfis_de_acesso');
    expect(migracoes[40]?.versao).toBe('0041');
    expect(migracoes[39]?.versao).toBe('0040');
  });

  it('CHECKs = SDK: base = PERFIS, código = CODIGO_PERFIL_RE, chave = ACAO_RE, nível = NIVEIS_ESCOPO ∪ NIVEIS_ALCADA (dados.escopo só escopo)', () => {
    const perfil = corpoDe('plataforma.perfil');
    expect(lista(/perfil_base_valida\s+check \(base in \(([^)]*)\)\)/.exec(perfil)![1]!).sort()).toEqual([...PERFIS].sort());
    expect(perfil).toContain(`check (codigo ~ '${CODIGO_PERFIL_RE.source}')`);
    expect(perfil).toContain('constraint perfil_fabrica_codigo check (not fabrica or codigo = base)');
    expect(perfil).toContain('constraint perfil_fabrica_ativo check (not fabrica or (ativo and deleted_at is null))');
    expect(perfil).toContain('constraint perfil_codigo_uk unique (tenant_id, codigo)');
    const pp = corpoDe('plataforma.perfil_permissao');
    expect(pp).toContain(`check (chave ~ '${ACAO_RE.source}')`);
    expect(lista(/perfil_permissao_nivel_valido\s+check \(nivel is null or nivel in \(([^)]*)\)\)/.exec(pp)![1]!)).toEqual([...NIVEIS_ESCOPO, ...NIVEIS_ALCADA]);
    expect(lista(/perfil_permissao_nivel_escopo\s+check \(chave <> 'dados\.escopo' or nivel is null or nivel in \(([^)]*)\)\)/.exec(pp)![1]!)).toEqual([...NIVEIS_ESCOPO]);
    expect(pp).toContain('check (concedida or (nivel is null and alvos is null))');
    // alvos: códigos no formato do SDK ou '*'
    const alvo = /\(\\\*\|([^)]+)\)\(,/.exec(pp)?.[1];
    expect(alvo).toBe(CODIGO_PERFIL_RE.source.slice(1, -1));
  });

  it('semeadura dos 7 de fábrica: nome = ROTULO_PERFIL; id = idPerfilFabrica (uuid_de_chave)', () => {
    const valores = /from \(values([\s\S]*?)\) as f \(base, nome\)/.exec(up)![1]!;
    const pares = Object.fromEntries([...valores.matchAll(/\('([a-z]+)', '([^']+)'\)/g)].map((x) => [x[1]!, x[2]!]));
    expect(pares).toEqual(ROTULO_PERFIL);
    expect(up).toContain("plataforma.uuid_de_chave(p_tenant::text || ':plataforma.perfil:' || f.base)");
    expect(idPerfilFabrica('t', 'admin')).toBe(idDeChave('t:plataforma.perfil:admin'));
    expect(up).toContain("plataforma.uuid_de_chave(u.tenant_id::text || ':plataforma.usuario_perfil:' || u.id::text || ':' || p.id::text)");
    expect(up).toContain("plataforma.uuid_de_chave(new.tenant_id::text || ':plataforma.usuario_perfil:' || new.id::text || ':' || v_perfil::text)");
    expect(idUsuarioPerfil('t', 'u', 'p')).toBe(idDeChave('t:plataforma.usuario_perfil:u:p'));
    // a migração NÃO grava sobreposição (tabela vazia = padrão de fábrica)
    expect(up).not.toMatch(/insert into plataforma\.perfil_permissao/);
  });

  it('travas e último admin = SDK (BASES_SEM_BKO, portal só admin, escrita de pedido, escopo máximo, fábrica do acesso.bko e da gestão)', () => {
    const travas = /create function plataforma\.perfil_permissao_travas\(\)[\s\S]*?\n\$\$;/.exec(up)![0];
    expect(lista(/new\.chave = 'acesso\.bko' and v_base in \(([^)]*)\)/.exec(travas)![1]!)).toEqual([...BASES_SEM_BKO]);
    expect(travas).toContain("new.chave = 'acesso.portal' and v_base <> 'admin'");
    expect(travas).toContain("v_base = 'promotor' and new.chave ~ '^pedido(_[a-z0-9_]+)?\\.' and split_part(new.chave, '.', 2) <> 'ver'");
    const caso = /v_max := case v_base ([\s\S]*?) end;/.exec(travas)![1]!;
    const maximos = Object.fromEntries([...caso.matchAll(/when '([a-z]+)' then '([a-z_]+)'/g)].map((x) => [x[1]!, x[2]!]));
    const resto = /else '([a-z_]+)'/.exec(caso)![1]!;
    for (const base of PERFIS) expect(maximos[base] ?? resto, base).toBe(escopoMaximoDaBase(base));
    const admin = /create function plataforma\.usuario_admin_com_gestao[\s\S]*?\n {2}\$\$;/.exec(up)![0];
    expect(lista(/unnest\(array\[([^\]]*)\]\)/.exec(admin)![1]!)).toEqual(['acesso.bko', ...CHAVES_GESTAO_DO_ACESSO]);
    expect(lista(/f\.base in \('vendedor'[^)]*\)/.exec(admin)![0])).toEqual([...BASES_SEM_BKO]);
    const fabrica = matrizDeFabrica([]);
    const comBko = PERFIS.filter((p) => 'acesso.bko' in fabrica[p]);
    expect(lista(/k\.chave = 'acesso\.bko' then f\.base in \(([^)]*)\)/.exec(admin)![1]!).sort()).toEqual([...comBko].sort());
    for (const chave of CHAVES_GESTAO_DO_ACESSO) expect(PERFIS.filter((p) => chave in fabrica[p])).toEqual(['admin']);
    expect(admin).toContain("else f.base = 'admin' end");
  });

  it('tabelas: FKs compostas, únicos parciais, RLS forçado, manutencao, grants (perfil sem delete), fora do sync; worker e portal sem nada', () => {
    expect(corpoDe('plataforma.perfil_permissao')).toContain('foreign key (tenant_id, perfil_id) references plataforma.perfil (tenant_id, id)');
    expect(corpoDe('plataforma.usuario_perfil')).toContain('foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id) on delete cascade');
    expect(corpoDe('plataforma.usuario_perfil')).toContain('foreign key (tenant_id, perfil_id) references plataforma.perfil (tenant_id, id)');
    expect(up).toContain('create unique index perfil_permissao_uk on plataforma.perfil_permissao (tenant_id, perfil_id, chave) where deleted_at is null;');
    expect(up).toContain('create unique index usuario_perfil_uk on plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) where deleted_at is null;');
    expect(up).toContain('create index usuario_perfil_usuario_ix on plataforma.usuario_perfil (tenant_id, usuario_id);');
    for (const t of TABELAS) {
      expect(up).toContain(`alter table ${t} force row level security;`);
      expect([...up.matchAll(new RegExp(`create policy ([a-z_]+) on ${t.replace('.', '\\.')} for ([a-z]+) to ([a-z_]+)`, 'g'))].map((x) => `${x[1]} ${x[2]} ${x[3]}`))
        .toEqual(['isolamento_tenant all macuxi_app', 'manutencao all macuxi_manutencao']);
      expect(up).toContain(`revoke all on ${t} from public;`);
      expect(TABELAS_FORA_DO_SYNC as readonly string[]).toContain(t);
    }
    const grants = [...up.matchAll(/^grant ([^;]+) on (plataforma\.[a-z_]+) to ([a-z_]+);/gm)].map((g) => `${g[2]} ${g[3]}: ${g[1]}`);
    expect(grants).toEqual([
      'plataforma.perfil macuxi_app: select, insert, update',
      'plataforma.perfil_permissao macuxi_app: select, insert, update, delete',
      'plataforma.usuario_perfil macuxi_app: select, insert, update, delete',
    ]);
    expect(up).not.toMatch(/macuxi_(worker|portal)/);
    expect(up).toContain('alter table plataforma.perfil_modulo drop constraint perfil_modulo_perfil_valido;');
    expect(up).toContain('foreign key (tenant_id, perfil) references plataforma.perfil (tenant_id, codigo);');
  });

  it('funções: todas invoker (nada SECURITY DEFINER), search_path fixo com pg_temp, revoke de PUBLIC; EXECUTE só ao app nas que ele usa', () => {
    expect(up).not.toMatch(/security definer/i);
    const criadas = [...up.matchAll(/create function (plataforma\.[a-z_]+)\(/g)].map((x) => x[1]);
    expect(criadas.sort()).toEqual(FUNCOES.map((f) => f.slice(0, f.indexOf('('))).sort());
    expect(up.match(/set search_path = pg_catalog, plataforma, pg_temp/g)).toHaveLength(FUNCOES.length);
    for (const f of FUNCOES) expect(up, f).toContain(`revoke all on function ${f} from public;`);
    const exec = [...up.matchAll(/^grant execute on function ([^ ]+(?: [a-z]+)?\)) to ([a-z_]+);/gm)].map((g) => `${g[1]} ${g[2]}`);
    expect(exec).toEqual(DO_APP.map((f) => `${f} macuxi_app`));
  });

  it('conferências no COMMIT: gatilhos de restrição adiáveis; principal ligado por gatilho imediato; semeadura do tenant novo por gatilho', () => {
    for (const [nome, alvo] of [
      ['usuario_conferir_acesso', 'after insert or update of perfil, ativo, deleted_at on core.usuario'],
      ['usuario_perfil_conferir', 'after insert or update or delete on plataforma.usuario_perfil'],
      ['perfil_conferir', 'after update of ativo, deleted_at or delete on plataforma.perfil'],
      ['perfil_permissao_conferir', 'after insert or update or delete on plataforma.perfil_permissao'],
    ]) {
      expect(up).toMatch(new RegExp(`create constraint trigger ${nome} ${alvo!.replace(/[.()]/g, '\\$&')}\\s+deferrable initially deferred`));
    }
    expect(up).toContain('create trigger usuario_perfil_principal after insert or update of perfil, deleted_at on core.usuario');
    expect(up).toContain('create trigger tenant_semear_perfis after insert on plataforma.tenant');
    expect(up).toContain('create trigger perfil_imutavel before update on plataforma.perfil');
    expect(up).toContain('create trigger perfil_permissao_travas before insert or update on plataforma.perfil_permissao');
    // conferência do fim da migração
    expect(up).toContain("raise exception '0041: % usuário(s) sem perfil (RN-CORE-01)'");
    expect(up).toContain("raise exception '0041: % tenant(s) sem os 7 perfis de fábrica'");
  });

  it('down: devolve o CHECK da 0001, apaga linhas de perfis personalizados em perfil_modulo, tira gatilhos, tabelas e todas as funções', () => {
    const m01 = migracoes.find((m) => m.versao === '0001')!;
    const check = /constraint perfil_modulo_perfil_valido\s+(check \(perfil in \([^)]*\)\))/.exec(m01.up)![1]!;
    expect(down).toContain(`add constraint perfil_modulo_perfil_valido\n  ${check};`);
    expect(down.indexOf('delete from plataforma.perfil_modulo')).toBeLessThan(down.indexOf('add constraint perfil_modulo_perfil_valido'));
    for (const t of ['usuario_conferir_acesso on core.usuario', 'usuario_perfil_principal on core.usuario', 'tenant_semear_perfis on plataforma.tenant']) {
      expect(down).toContain(`drop trigger if exists ${t};`);
    }
    for (const t of TABELAS) expect(down).toContain(`drop table if exists ${t};`);
    for (const f of FUNCOES) expect(down).toContain(`drop function if exists ${f};`);
  });

  it('Drizzle: perfil.base com os PERFIS, perfil_permissao.nivel com os níveis do SDK, perfil_modulo.perfil é código livre', () => {
    expect([...(esquemaPlataforma.perfil.base.enumValues ?? [])].sort()).toEqual([...PERFIS].sort());
    expect([...(esquemaPlataforma.perfilPermissao.nivel.enumValues ?? [])]).toEqual([...NIVEIS_ESCOPO, ...NIVEIS_ALCADA]);
    expect(esquemaPlataforma.perfilModulo.perfil.enumValues ?? []).toEqual([]);
  });

  it('fixture: personalizado em A e em B, uma sobreposição em cada, vendedor-B com vendedor + promotor e vendedor-2 com o personalizado', () => {
    const d = dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA');
    const A = DOIS_TENANTS.A;
    const B = DOIS_TENANTS.B;
    expect(d['plataforma.perfil'].map((p) => `${String(p.tenant_id).slice(0, 8)} ${p.codigo} ${p.base} ${p.fabrica}`)).toEqual([
      'aaaaaaaa vendedor_externo vendedor false', 'bbbbbbbb vendedor_balcao vendedor false',
    ]);
    for (const p of d['plataforma.perfil']) expect(CODIGO_PERFIL_RE.test(String(p.codigo))).toBe(true);
    expect(d['plataforma.usuario_perfil']).toEqual([
      expect.objectContaining({ tenant_id: A.tenantId, usuario_id: A.usuarios.vendedor2, perfil_id: A.perfis.vendedorExterno }),
      expect.objectContaining({ tenant_id: B.tenantId, usuario_id: B.usuarios.vendedor, perfil_id: idPerfilFabrica(B.tenantId, 'promotor') }),
    ]);
    // ordem de carga: perfis antes de perfil_modulo (FK por código); vínculos depois dos usuários
    const i = (t: string) => ORDEM_TABELAS.indexOf(t as (typeof ORDEM_TABELAS)[number]);
    expect(i('plataforma.perfil')).toBeLessThan(i('plataforma.perfil_permissao'));
    expect(i('plataforma.perfil_permissao')).toBeLessThan(i('plataforma.perfil_modulo'));
    expect(i('core.usuario')).toBeLessThan(i('plataforma.usuario_perfil'));
  });
});

/** Erro do Postgres com o nome da restrição (o 23514 dos gatilhos leva constraint). */
type ErroPg = { code: string; constraint: string | null } | null;

describe.skipIf(semBanco())('0041 perfis de acesso (banco, fixture dois-tenants)', () => {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
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
  /** Consulta como o papel dado no contexto do tenant (desfeita). */
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
  const H = '$argon2id$v=19$m=1,t=1,p=1$b3V0cm8$b3V0cm9oYXNo';

  it('semeadura: 7 de fábrica em A e B (ids, nomes, ativos); todo usuário com o principal; nenhuma sobreposição de fábrica', async () => {
    await emTransacao(admin, null, async () => {
      for (const t of [A.tenantId, B.tenantId]) {
        const r = await q<{ id: string; codigo: string; nome: string; base: string; ativo: boolean }>(
          'select id, codigo, nome, base, ativo from plataforma.perfil where tenant_id = $1 and fabrica order by codigo', [t]);
        expect(r).toEqual([...PERFIS].sort().map((p) => ({ id: idPerfilFabrica(t, p), codigo: p, nome: ROTULO_PERFIL[p], base: p, ativo: true })));
      }
      expect(await q(`select count(*)::int as n from core.usuario u
                       where not exists (select 1 from plataforma.usuario_perfil up join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
                                          where up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null and p.base = u.perfil)`))
        .toEqual([{ n: 0 }]);
      expect(await vivos(B.usuarios.vendedor)).toEqual(['promotor', 'vendedor']);
      expect(await vivos(A.usuarios.vendedor2)).toEqual(['vendedor', 'vendedor_externo']);
      expect(await vivos(A.usuarios.admin)).toEqual(['admin']);
      const principal = await q<{ id: string }>('select id from plataforma.usuario_perfil where usuario_id = $1 and perfil_id = $2', [A.usuarios.admin, idPerfilFabrica(A.tenantId, 'admin')]);
      expect(principal).toEqual([{ id: idUsuarioPerfil(A.tenantId, A.usuarios.admin, idPerfilFabrica(A.tenantId, 'admin')) }]);
      expect(await q("select count(*)::int as n from plataforma.perfil_permissao p join plataforma.perfil f on f.id = p.perfil_id where f.fabrica")).toEqual([{ n: 0 }]);
      expect(await q('select plataforma.tenant_tem_admin_com_gestao($1) as a, plataforma.tenant_tem_admin_com_gestao($2) as b', [A.tenantId, B.tenantId])).toEqual([{ a: true, b: true }]);
    });
  });

  it('perfis_do_usuario (macuxi_app): perfis, sobreposições e módulos do tenant do contexto; outro tenant e sem contexto = 0 linhas', async () => {
    await emTransacao(admin, null, async () => {
      const v2 = await como('macuxi_app', A.tenantId, 'select codigo, base, fabrica, sobreposicoes, modulos from plataforma.perfis_do_usuario($1)', [A.usuarios.vendedor2]);
      expect(v2).toEqual([
        { codigo: 'vendedor', base: 'vendedor', fabrica: true, sobreposicoes: [], modulos: ['catalogo', 'core', 'teste', 'vendedor'] },
        { codigo: 'vendedor_externo', base: 'vendedor', fabrica: false, sobreposicoes: [{ chave: 'dados.escopo', concedida: true, nivel: 'proprio', alvos: null }], modulos: [] },
      ]);
      const vb = await como<{ codigo: string }>('macuxi_app', B.tenantId, 'select codigo from plataforma.perfis_do_usuario($1)', [B.usuarios.vendedor]);
      expect(vb.map((x) => x.codigo)).toEqual(['promotor', 'vendedor']);
      expect(await como('macuxi_app', A.tenantId, 'select * from plataforma.perfis_do_usuario($1)', [B.usuarios.vendedor])).toEqual([]);
      expect(await como('macuxi_app', null, 'select * from plataforma.perfis_do_usuario($1)', [A.usuarios.vendedor2])).toEqual([]);
    });
  });

  it('tenant novo: 7 de fábrica pelo gatilho; usuário novo (macuxi_app) ligado ao principal; troca do perfil único substitui; com 2 perfis só acrescenta', async () => {
    await emTransacao(admin, null, async () => {
      const T = 'cccccccc-0041-4000-8000-000000000001';
      await admin.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 't41-novo', 'Novo 41')", [T]);
      expect(await q('select count(*)::int as n from plataforma.perfil where tenant_id = $1 and fabrica and ativo', [T])).toEqual([{ n: 7 }]);

      const U = 'cccccccc-0041-4000-8000-000000000002';
      const erro = await noCommit([
        ["insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash) values ($1, $2, 'Pessoa', 'p41@exemplo.com.br', 'vendedor', $3)", [U, A.tenantId, H]],
        ['select 1'],
      ], 'macuxi_app', A.tenantId);
      expect(erro).toBeNull();
      // de novo, fora do noCommit, para conferir o efeito
      await admin.query("insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash) values ($1, $2, 'Pessoa', 'p41@exemplo.com.br', 'vendedor', $3)", [U, A.tenantId, H]);
      expect(await vivos(U)).toEqual(['vendedor']);
      await admin.query("update core.usuario set perfil = 'supervisor' where id = $1", [U]);
      expect(await vivos(U)).toEqual(['supervisor']);
      expect(await q('select deleted_at is not null as apagado from plataforma.usuario_perfil where usuario_id = $1 and perfil_id = $2', [U, idPerfilFabrica(A.tenantId, 'vendedor')]))
        .toEqual([{ apagado: true }]);
      await admin.query("update core.usuario set perfil = 'vendedor' where id = $1", [U]);
      expect(await vivos(U)).toEqual(['vendedor']);
      // multiperfil: o vendedor-B já tem promotor; trocar o principal para promotor não mexe; para supervisor só acrescenta
      await admin.query("update core.usuario set perfil = 'promotor' where id = $1", [B.usuarios.vendedor]);
      expect(await vivos(B.usuarios.vendedor)).toEqual(['promotor', 'vendedor']);
      await admin.query("update core.usuario set perfil = 'supervisor' where id = $1", [B.usuarios.vendedor]);
      expect(await vivos(B.usuarios.vendedor)).toEqual(['promotor', 'supervisor', 'vendedor']);
      await admin.query('set constraints all immediate');
    });
  });

  it('travas (23514): BKO e portal (RN-CORE-33), escrita de pedido do promotor (RN-PRO-01), escopo acima da base (RN-CORE-04); o resto passa', async () => {
    await emTransacao(admin, null, async () => {
      const ins = (base: string, chave: string, nivel: string | null = null, concedida = true): Array<[string, unknown[]]> => [[
        'insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida, nivel) values ($1, $2, $3, $4, $5)',
        [A.tenantId, idPerfilFabrica(A.tenantId, base), chave, concedida, nivel],
      ]];
      const casos: Array<[string, string, string | null, string | null]> = [
        ['vendedor', 'acesso.bko', null, 'perfil_permissao_trava_bko'],
        ['promotor', 'acesso.bko', null, 'perfil_permissao_trava_bko'],
        ['supervisor', 'acesso.bko', null, 'perfil_permissao_trava_bko'],
        ['gerente', 'acesso.portal', null, 'perfil_permissao_trava_portal'],
        ['promotor', 'pedido.criar', null, 'perfil_permissao_trava_pedido'],
        ['promotor', 'pedido_item.editar', null, 'perfil_permissao_trava_pedido'],
        ['vendedor', 'dados.escopo', 'equipe', 'perfil_permissao_escopo_da_base'],
        ['supervisor', 'dados.escopo', 'equipes_abaixo', 'perfil_permissao_escopo_da_base'],
        ['promotor', 'pedido.ver', null, null],
        ['analista', 'acesso.bko', null, null],
        ['admin', 'acesso.portal', null, null],
        ['vendedor', 'dados.escopo', 'proprio', null],
        ['gerente', 'dados.escopo', 'equipes_abaixo', null],
      ];
      for (const [base, chave, nivel, restricao] of casos) {
        const e = await noCommit(ins(base, chave, nivel));
        expect(e, `${base} ${chave} ${nivel ?? ''}`).toEqual(restricao ? { code: '23514', constraint: restricao } : null);
      }
      // revogar é sempre permitido (a trava só olha o que é concedido)
      expect(await noCommit(ins('vendedor', 'acesso.bko', null, false))).toBeNull();
      // formatos: chave, nível fora da lista, nível de alçada em dados.escopo, revogação com valor, alvo inválido
      for (const [sql, restricao] of [
        ["insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, 'Pedido.criar', true)", 'perfil_permissao_chave_formato'],
        ["insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida, nivel) values ($1, $2, 'pedido.aprovar', true, 'muito')", 'perfil_permissao_nivel_valido'],
        ["insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida, nivel) values ($1, $2, 'dados.escopo', true, 'acima_alcada')", 'perfil_permissao_nivel_escopo'],
        ["insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida, nivel) values ($1, $2, 'pedido.aprovar', false, 'ate_alcada')", 'perfil_permissao_revogada_sem_valor'],
        ["insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida, alvos) values ($1, $2, 'senha.redefinir', true, '{Vendedor}')", 'perfil_permissao_alvos_formato'],
        ["insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida, alvos) values ($1, $2, 'senha.redefinir', true, '{}')", 'perfil_permissao_alvos_formato'],
      ] as const) {
        expect(await noCommit([[sql, [A.tenantId, idPerfilFabrica(A.tenantId, 'gerente')]]]), sql).toEqual({ code: '23514', constraint: restricao });
      }
      expect(await noCommit([["insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida, alvos) values ($1, $2, 'senha.redefinir', true, '{vendedor,*}')",
        [A.tenantId, idPerfilFabrica(A.tenantId, 'gerente')]]])).toBeNull();
      // única viva por (tenant, perfil, chave)
      expect(await noCommit([...ins('gerente', 'meta.editar'), ...ins('gerente', 'meta.editar')])).toEqual({ code: '23505', constraint: 'perfil_permissao_uk' });
    });
  });

  it('perfil: código no formato e único no tenant (apagado inclusive), base válida; código, base e fábrica imutáveis; fábrica sempre ativa', async () => {
    await emTransacao(admin, null, async () => {
      const novo = (codigo: string, base = 'vendedor') =>
        [['insert into plataforma.perfil (tenant_id, codigo, nome, base) values ($1, $2, $3, $4)', [A.tenantId, codigo, 'Teste 41', base]]] as Array<[string, unknown[]]>;
      expect(await noCommit(novo('Vendedor_x'))).toEqual({ code: '23514', constraint: 'perfil_codigo_formato' });
      expect(await noCommit(novo('x'))).toEqual({ code: '23514', constraint: 'perfil_codigo_formato' });
      expect(await noCommit(novo('vendedor_x', 'diretor'))).toEqual({ code: '23514', constraint: 'perfil_base_valida' });
      expect(await noCommit(novo('vendedor'))).toEqual({ code: '23505', constraint: 'perfil_codigo_uk' });
      expect(await noCommit([...novo('vendedor_x'), ["update plataforma.perfil set deleted_at = now() where tenant_id = $1 and codigo = 'vendedor_x'", [A.tenantId]], ...novo('vendedor_x')]))
        .toEqual({ code: '23505', constraint: 'perfil_codigo_uk' });
      expect(await noCommit([["insert into plataforma.perfil (tenant_id, codigo, nome, base, fabrica) values ($1, 'vendedor_x', 'X', 'vendedor', true)", [A.tenantId]]]))
        .toEqual({ code: '23514', constraint: 'perfil_fabrica_codigo' });
      for (const set of ["codigo = 'outro_codigo'", "base = 'analista'", 'fabrica = true']) {
        expect(await noCommit([[`update plataforma.perfil set ${set} where id = $1`, [A.perfis.vendedorExterno]]]), set).toEqual({ code: '23514', constraint: 'perfil_imutavel' });
      }
      for (const set of ['ativo = false', 'deleted_at = now()']) {
        expect(await noCommit([[`update plataforma.perfil set ${set} where id = $1`, [idPerfilFabrica(A.tenantId, 'analista')]]]), set).toEqual({ code: '23514', constraint: 'perfil_fabrica_ativo' });
      }
      // apagar fisicamente um de fábrica com o tenant vivo (só o dono do banco consegue): recusado no COMMIT
      expect(await noCommit([['delete from plataforma.perfil where id = $1', [idPerfilFabrica(B.tenantId, 'assistente')]]])).toEqual({ code: '23514', constraint: 'perfil_fabrica_presente' });
      // nome e descrição editáveis; personalizado sem usuário pode ser desativado e apagado
      expect(await noCommit([["update plataforma.perfil set nome = 'Externo', descricao = null, ativo = false where id = $1", [A.perfis.vendedorExterno]],
        ['delete from plataforma.usuario_perfil where id = $1', [A.vinculos.vendedor2Externo]]])).toBeNull();
    });
  });

  it('no COMMIT (RN-CORE-01/35): usuário sem perfil, com perfil desativado ou sem o principal é recusado; perfil em uso não desativa', async () => {
    await emTransacao(admin, null, async () => {
      const prin = (u: string, base: string, t = A.tenantId) => idUsuarioPerfil(t, u, idPerfilFabrica(t, base));
      expect(await noCommit([['delete from plataforma.usuario_perfil where usuario_id = $1', [A.usuarios.analista]]])).toEqual({ code: '23514', constraint: 'usuario_sem_perfil' });
      expect(await noCommit([['update plataforma.usuario_perfil set deleted_at = now() where id = $1', [prin(A.usuarios.analista, 'analista')]]])).toEqual({ code: '23514', constraint: 'usuario_sem_perfil' });
      // o vendedor-B sem o vínculo de vendedor fica só com promotor: o principal (vendedor) não está entre os perfis
      expect(await noCommit([['update plataforma.usuario_perfil set deleted_at = now() where id = $1', [prin(B.usuarios.vendedor, 'vendedor', B.tenantId)]]]))
        .toEqual({ code: '23514', constraint: 'usuario_perfil_principal' });
      // ... e passa trocando o principal na mesma transação
      expect(await noCommit([['update plataforma.usuario_perfil set deleted_at = now() where id = $1', [prin(B.usuarios.vendedor, 'vendedor', B.tenantId)]],
        ["update core.usuario set perfil = 'promotor' where id = $1", [B.usuarios.vendedor]]])).toBeNull();
      // perfil personalizado em uso (vendedor-2) não é desativado nem apagado
      expect(await noCommit([['update plataforma.perfil set ativo = false where id = $1', [A.perfis.vendedorExterno]]])).toEqual({ code: '23514', constraint: 'perfil_em_uso' });
      expect(await noCommit([['update plataforma.perfil set deleted_at = now() where id = $1', [A.perfis.vendedorExterno]]])).toEqual({ code: '23514', constraint: 'perfil_em_uso' });
      // vínculo novo com perfil inativo (criado já inativo: a desativação de um perfil em uso cai antes, em perfil_em_uso)
      const INATIVO = 'bbbbbbbb-0017-4000-8000-000000000041';
      expect(await noCommit([["insert into plataforma.perfil (id, tenant_id, codigo, nome, base, ativo) values ($1, $2, 'vendedor_inativo', 'Inativo', 'vendedor', false)", [INATIVO, B.tenantId]],
        ['insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [B.tenantId, B.usuarios.vendedor, INATIVO]]]))
        .toEqual({ code: '23514', constraint: 'usuario_perfil_indisponivel' });
      // vínculo repetido vivo
      expect(await noCommit([['insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [A.tenantId, A.usuarios.vendedor2, A.perfis.vendedorExterno]]]))
        .toEqual({ code: '23505', constraint: 'usuario_perfil_uk' });
      // vínculo com perfil ou usuário de outro tenant (FK composta)
      expect((await noCommit([['insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [A.tenantId, A.usuarios.admin, B.perfis.vendedorBalcao]]]))?.code).toBe('23503');
      // usuário apagado (anonimizado) não é conferido; apagar fisicamente o usuário leva os vínculos (cascade)
      expect(await noCommit([['update core.usuario set deleted_at = now(), ativo = false where id = $1', [A.usuarios.assistente]],
        ['delete from plataforma.usuario_perfil where usuario_id = $1', [A.usuarios.assistente]]])).toBeNull();
    });
  });

  it('último admin (RN-CORE-35): desativar, rebaixar, apagar o vínculo, ligar perfil que fecha o BKO ou tirar a gestão do único admin = recusado; com outro admin passa', async () => {
    await emTransacao(admin, null, async () => {
      const ADM = A.usuarios.admin;
      const fabAdmin = idPerfilFabrica(A.tenantId, 'admin');
      const ultimo = { code: '23514', constraint: 'tenant_ultimo_admin' };
      expect(await noCommit([['update core.usuario set ativo = false where id = $1', [ADM]]])).toEqual(ultimo);
      expect(await noCommit([["update core.usuario set perfil = 'analista' where id = $1", [ADM]]])).toEqual(ultimo);
      expect(await noCommit([["update core.usuario set deleted_at = now() where id = $1", [ADM]]])).toEqual(ultimo);
      expect(await noCommit([['insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [A.tenantId, ADM, idPerfilFabrica(A.tenantId, 'vendedor')]]]))
        .toEqual(ultimo);
      for (const chave of ['acesso.bko', 'perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar']) {
        expect(await noCommit([['insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, $3, false)', [A.tenantId, fabAdmin, chave]]]), chave)
          .toEqual(ultimo);
      }
      // a gestão pode vir de outro perfil do mesmo usuário (união): admin sem perfil.gerir + analista com perfil.gerir
      const analista = idPerfilFabrica(A.tenantId, 'analista');
      expect(await noCommit([
        ['insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, $3, false)', [A.tenantId, fabAdmin, 'perfil.gerir']],
        ['insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, $3, true)', [A.tenantId, analista, 'perfil.gerir']],
        ['insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [A.tenantId, ADM, analista]],
      ])).toBeNull();
      // com um segundo admin, o primeiro pode sair
      expect(await noCommit([
        ["insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash) values ('cccccccc-0041-4000-8000-000000000003', $1, 'Outra', 'adm41@exemplo.com.br', 'admin', $2)", [A.tenantId, H]],
        ['update core.usuario set ativo = false where id = $1', [ADM]],
      ])).toBeNull();
      // o mesmo pelo papel da aplicação (como o Core faria)
      expect(await noCommit([['update core.usuario set ativo = false where id = $1', [ADM]]], 'macuxi_app', A.tenantId)).toEqual(ultimo);
      // tenant sem nenhum admin (provisionado com sem_admin): quem não mexe em admin não é barrado
      const T = 'cccccccc-0041-4000-8000-000000000010';
      expect(await noCommit([
        ["insert into plataforma.tenant (id, codigo, nome) values ($1, 't41-sem-admin', 'Sem admin')", [T]],
        ["insert into core.usuario (tenant_id, nome, email, perfil, senha_hash) values ($1, 'V', 'v41@exemplo.com.br', 'vendedor', $2)", [T, H]],
        ["insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, 'usuario.criar', true)", [T, idPerfilFabrica(T, 'analista')]],
      ])).toBeNull();
    });
  });

  it('RLS: macuxi_app só no próprio tenant (não lê nem grava perfis de B; perfil sem DELETE); worker e portal sem acesso', async () => {
    await emTransacao(admin, null, async () => {
      for (const t of TABELAS) {
        const deA = await como<{ n: number; outros: number }>('macuxi_app', A.tenantId, `select count(*)::int as n, count(*) filter (where tenant_id <> $1)::int as outros from ${t}`, [A.tenantId]);
        expect(deA[0]!.n, t).toBeGreaterThan(0);
        expect(deA[0]!.outros, t).toBe(0);
        expect(await como('macuxi_app', null, `select 1 from ${t}`), t).toEqual([]);
        for (const papel of ['macuxi_worker', 'macuxi_portal']) expect((await noCommit([[`select 1 from ${t} limit 1`]], papel))?.code, `${papel} ${t}`).toBe('42501');
      }
      expect(await noCommit([["insert into plataforma.perfil (tenant_id, codigo, nome, base) values ($1, 'de_b', 'B', 'vendedor')", [B.tenantId]]], 'macuxi_app', A.tenantId))
        .toEqual({ code: '42501', constraint: null });
      expect((await noCommit([['delete from plataforma.perfil where id = $1', [A.perfis.vendedorExterno]]], 'macuxi_app', A.tenantId))?.code).toBe('42501');
      // o app cria um personalizado, sobrepõe, liga a um usuário e o restaura ao padrão (apaga as sobreposições)
      expect(await noCommit([
        ["insert into plataforma.perfil (id, tenant_id, codigo, nome, base) values ('aaaaaaaa-0017-4000-8000-000000000041', $1, 'promotor_lider', 'Promotor líder', 'promotor')", [A.tenantId]],
        ["insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, 'aaaaaaaa-0017-4000-8000-000000000041', 'coleta.registrar', false)", [A.tenantId]],
        ["insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, 'aaaaaaaa-0017-4000-8000-000000000041')", [A.tenantId, A.usuarios.promotor]],
        ["delete from plataforma.perfil_permissao where perfil_id = 'aaaaaaaa-0017-4000-8000-000000000041'"],
      ], 'macuxi_app', A.tenantId)).toBeNull();
    });
  });
});

describe.skipIf(semBanco())('0041 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000041';
  const U = 'cccccccc-0041-4000-8000-000000000101';
  const V = 'cccccccc-0041-4000-8000-000000000102';
  const W = 'cccccccc-0041-4000-8000-000000000103';
  const H = '$argon2id$v=19$m=1,t=1,p=1$b3V0cm8$b3V0cm9oYXNo';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('semeia os 7 de fábrica e o principal de todo usuário (ativo, inativo e apagado); down volta exatamente à 0040 e apaga o personalizado do perfil_modulo; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0040' });
      const catalogo = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo41', 'Antigo')", [T]);
      await c.query(
        `insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash, ativo, deleted_at) values
           ($1, $4, 'Pessoa', 'pessoa@exemplo.com.br', 'vendedor', $5, true, null),
           ($2, $4, 'Admin', 'admin@exemplo.com.br', 'admin', $5, true, null),
           ($3, $4, 'Antiga', 'antiga@exemplo.com.br', 'promotor', $5, false, now())`,
        [U, V, W, T, H],
      );
      await c.query("insert into plataforma.perfil_modulo (tenant_id, perfil, modulo) values ($1, 'vendedor', 'core')", [T]);

      expect((await migrarUp(c, { ate: '0041' })).aplicadas).toEqual(['0041_plataforma_perfis_de_acesso']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toEqual(expect.arrayContaining([
        expect.stringMatching(/^rel plataforma\.perfil r rls=true force=true$/),
        expect.stringMatching(/^rel plataforma\.usuario_perfil r rls=true force=true$/),
        expect.stringMatching(/^con plataforma\.perfil_modulo_perfil_fk FOREIGN KEY \(tenant_id, perfil\) REFERENCES plataforma\.perfil\(tenant_id, codigo\)$/),
      ]));
      expect(depois.some((l) => l.startsWith('con plataforma.perfil_modulo_perfil_valido'))).toBe(false);
      expect((await c.query('select codigo from plataforma.perfil where tenant_id = $1 and fabrica order by codigo', [T])).rows.map((x) => x.codigo)).toEqual([...PERFIS].sort());
      const vinc = await c.query<{ usuario_id: string; codigo: string; id: string }>(
        `select up.usuario_id, p.codigo, up.id from plataforma.usuario_perfil up join plataforma.perfil p on p.id = up.perfil_id
          where up.tenant_id = $1 and up.deleted_at is null order by up.usuario_id`, [T]);
      expect(vinc.rows).toEqual([
        { usuario_id: U, codigo: 'vendedor', id: idUsuarioPerfil(T, U, idPerfilFabrica(T, 'vendedor')) },
        { usuario_id: V, codigo: 'admin', id: idUsuarioPerfil(T, V, idPerfilFabrica(T, 'admin')) },
        { usuario_id: W, codigo: 'promotor', id: idUsuarioPerfil(T, W, idPerfilFabrica(T, 'promotor')) },
      ]);
      expect((await c.query('select count(*)::int as n from plataforma.perfil_permissao')).rows).toEqual([{ n: 0 }]);

      // com dados novos (personalizado com módulo e multiperfil): o down apaga e volta ao catálogo da 0040
      await c.query("insert into plataforma.perfil (id, tenant_id, codigo, nome, base) values ('cccccccc-0041-4000-8000-000000000201', $1, 'vendedor_x', 'X', 'vendedor')", [T]);
      await c.query("insert into plataforma.perfil_modulo (tenant_id, perfil, modulo) values ($1, 'vendedor_x', 'core')", [T]);
      await c.query("insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, 'cccccccc-0041-4000-8000-000000000201')", [T, U]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0041_plataforma_perfis_de_acesso']);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      expect((await c.query('select perfil from plataforma.perfil_modulo where tenant_id = $1', [T])).rows).toEqual([{ perfil: 'vendedor' }]);
      expect((await c.query('select count(*)::int as n from core.usuario where tenant_id = $1', [T])).rows).toEqual([{ n: 3 }]);
      await c.query(m41.down);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);

      await migrarUp(c, { ate: '0041' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
