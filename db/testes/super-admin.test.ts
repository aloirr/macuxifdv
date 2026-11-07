/**
 * 0035 — super-admin de plataforma (T-0087 fatia P, ADR 0029; pedidos R-20261106-002308 e R-20261106-004109-engenheiro-software;
 * desenho T-0087 §6). O que o BANCO garante:
 * - 4 tabelas sem tenant_id, RLS forçado SEM política e SEM grant para macuxi_app/macuxi_worker (42501 direto; com um grant
 *   indevido, 0 linhas); só a política manutencao (0031);
 * - 20 funções SECURITY DEFINER com search_path fixo (pg_temp por último), sem EXECUTE para PUBLIC; na 0035 só ao macuxi_app,
 *   desde a 0038 (T-0091) só ao macuxi_portal: macuxi_app e macuxi_worker recebem 42501 em todas (papel-portal.test.ts tem o resto);
 * - primeiro acesso só com ZERO super-admins (2x = 1 linha; em paralelo também, pela trava consultiva);
 * - desafio de uso único com prazo; sessão com teto de 8 h, revogável, conferida a cada chamada; TOTP sem reuso de passo;
 *   códigos de recuperação de uso único; 5 falhas = bloqueio de 15 min;
 * - auditoria append-only (update/delete/truncate recusados para todos), sem dado pessoal, que sobrevive à exclusão do tenant;
 * - sa_provisionar_tenant recusa sessão revogada/vencida; provisionar_tenant com sem_admin e parametros é idempotente.
 * Banco: fixture dois-tenants (migrada até a última: as sa_* rodam como macuxi_portal), sempre com ROLLBACK (admin, com SET
 * ROLE para o papel testado); up/down e a corrida do primeiro acesso num banco efêmero parado na 0035 (lá, como macuxi_app).
 * Nada roda em base real.
 */
import { createHash } from 'node:crypto';
import { ListaEmpresasSchema, MODULOS } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { FUNCOES_SA } from './funcoes-sa';
import { emTransacao, erroDe, retratoDoCatalogo, tabelasComTenant } from './util';

const migracoes = lerMigracoes();
const m35 = migracoes.find((m) => m.versao === '0035')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

/** Dados de mentira (nunca de uma pessoa real). */
const EMAIL = 'operador.t87@macuxi.exemplo';
const NOME = 'Operador T87';
const H1 = '$argon2id$v=19$m=1,t=1,p=1$c2FsdW0$aGFzaHVt';
const CIFRADO = 'v1.aXZpdml2aXZpdg.dGFndGFndGFn.Y2lmcmFjaWZyYQ';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const RECUPERACAO = Array.from({ length: 10 }, (_, i) => sha(`codigo-recuperacao-${i}`));
const PARAMETROS = [
  { modulo: 'vendedor', chave: 'alcada.vendedor_pct', valor: 5 },
  { modulo: 'vendedor', chave: 'alcada.supervisor_pct', valor: 10 },
  { modulo: 'vendedor', chave: 'alcada.gerente_pct', valor: 15 },
  { modulo: 'vendedor', chave: 'validade_orcamento_dias', valor: 7 },
  { modulo: 'vendedor', chave: 'aplicacao_no_orcamento_padrao', valor: true },
];
const TODOS = ['admin', 'analista', 'assistente', 'supervisor', 'gerente', 'vendedor', 'promotor'];
/** Entrada do portal (a mesma forma de EntradaProvisionarPlataforma em apps/api/src/plataforma.ts). */
const entradaPortal = (codigo: string, extra: Record<string, unknown> = {}) => ({
  codigo, nome: 'Distribuidora T87', documento: '12345678000195', fuso: 'America/Manaus', plano: 'piloto',
  modulos: [
    { modulo: 'core', licencas: null, perfis: TODOS },
    { modulo: 'catalogo', licencas: null, perfis: TODOS },
    { modulo: 'integracao', licencas: null, perfis: ['admin', 'analista'] },
    { modulo: 'vendedor', licencas: 20, perfis: ['admin', 'analista', 'supervisor', 'gerente', 'vendedor'] },
  ],
  sem_admin: true, parametros: PARAMETROS, ...extra,
});

describe('0035 super-admin (estático)', () => {
  it('nome e posição: 0035_plataforma_super_admin logo depois da 0034', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0034_catalogo_referencia_marca_nome') + 1]).toBe('0035_plataforma_super_admin');
  });

  it('20 funções sa_*: SECURITY DEFINER, search_path com pg_temp por último, revoke de PUBLIC e EXECUTE só ao macuxi_app', () => {
    const sql = semComentarios(m35.up);
    const definers = [...sql.matchAll(/create function (plataforma\.sa_[a-z_]+)\([^)]*\)[^;]*?language [a-z]+ [a-z]+ security definer\s+set search_path = ([^\n]+)/g)];
    expect(definers.map((x) => x[1]).sort()).toEqual(FUNCOES_SA.map((f) => f.slice(0, f.indexOf('('))).sort());
    for (const x of definers) expect(x[2], x[1]).toBe('pg_catalog, plataforma, pg_temp');
    for (const f of FUNCOES_SA) {
      expect(sql).toContain(`revoke all on function ${f} from public;`);
      expect(sql).toContain(`grant execute on function ${f} to macuxi_app;`);
      expect(m35.down).toContain(`drop function if exists ${f};`);
    }
    expect([...sql.matchAll(/grant execute on function ([^;]+) to macuxi_app;/g)].map((x) => x[1]).sort()).toEqual([...FUNCOES_SA].sort());
    expect(sql).not.toMatch(/to macuxi_worker/);
    // plano B do DBaaS: nada de atributo de papel nem papel novo
    expect(sql).not.toMatch(/alter role|create role|bypassrls|\bsuperuser\b/i);
    // a interna e a provisionar_tenant não são SECURITY DEFINER nem executáveis por ninguém além do dono
    expect(sql).toMatch(/create function plataforma\.sa_registrar_auditoria\([^)]*\)\s+returns void\s+language sql volatile security invoker/);
    expect(sql).toContain('revoke all on function plataforma.sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb) from public;');
    expect(sql).toMatch(/create function plataforma\.provisionar_tenant\(p jsonb\)\s+returns jsonb\s+language plpgsql volatile security invoker/);
    expect(sql).not.toMatch(/grant [^;]*provisionar_tenant\(jsonb\)/);
  });

  it('tabelas sem tenant_id (tenant_alvo_id na auditoria, sem FK), RLS forçado, só a manutencao, nenhum grant de tabela', () => {
    const sql = semComentarios(m35.up);
    for (const t of TABELAS_SO_POR_FUNCAO) {
      const corpo = new RegExp(`create table ${t.replace('.', '\\.')} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? '';
      expect(corpo, t).not.toBe('');
      expect(corpo, t).not.toMatch(/^\s+tenant_id\s/m);
      expect(sql).toContain(`alter table ${t} force row level security;`);
      expect(sql).toContain(`revoke all on ${t} from public, macuxi_app, macuxi_worker;`);
      expect([...sql.matchAll(new RegExp(`create policy ([a-z_]+) on ${t.replace('.', '\\.')} `, 'g'))].map((x) => x[1])).toEqual(['manutencao']);
    }
    expect(sql).not.toMatch(/grant [a-z, ]+ on plataforma\.(super_admin|super_admin_desafio|super_admin_sessao|auditoria_plataforma) /);
    expect(sql).toMatch(/^ {2}tenant_alvo_id {2}uuid,$/m);
    expect(sql).toMatch(/before update or delete on plataforma\.auditoria_plataforma/);
    expect(sql).toMatch(/before truncate on plataforma\.auditoria_plataforma/);
  });

  it('sa_listar_tenants só devolve os módulos do contrato (MODULOS do platform-sdk)', () => {
    const lista = /tm\.modulo = any \(array\[([^\]]+)\]\)/.exec(m35.up)?.[1] ?? '';
    expect([...lista.matchAll(/'([a-z]+)'/g)].map((x) => x[1])).toEqual([...MODULOS]);
  });

  it('down: apaga as funções e as tabelas e devolve a provisionar_tenant da 0029 sem mudança', () => {
    const m29 = migracoes.find((m) => m.versao === '0029')!;
    const corpo29 = m29.up.slice(m29.up.indexOf('drop function if exists plataforma.provisionar_tenant(jsonb);'));
    expect(m35.down.endsWith(corpo29)).toBe(true);
    for (const t of TABELAS_SO_POR_FUNCAO) expect(m35.down).toContain(`drop table if exists ${t};`);
    expect(m35.down).toContain('drop function if exists plataforma.sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb);');
    expect(m35.down).toContain('drop function if exists plataforma.auditoria_plataforma_recusar();');
  });
});

describe.skipIf(semBanco())('0035 super-admin (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  /** Roda como o papel dado dentro da transação aberta (savepoint: um erro não aborta a transação do caso). */
  async function como<T extends pg.QueryResultRow = Record<string, unknown>>(papel: string, sql: string, params: unknown[] = []): Promise<T[]> {
    await admin.query('savepoint como');
    try {
      await admin.query(`set local role ${papel}`);
      const r = await admin.query<T>(sql, params);
      await admin.query('reset role');
      await admin.query('release savepoint como');
      return r.rows;
    } catch (e) {
      await admin.query('rollback to savepoint como');
      throw e;
    }
  }
  /** Como o portal do super-admin: desde a 0038 (T-0091) o único papel com EXECUTE nas sa_*. */
  const portal = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => como<T>('macuxi_portal', sql, params);
  const um = async <T>(sql: string, params: unknown[] = []): Promise<T> => ((await portal<{ r: T }>(`select ${sql} as r`, params))[0]!).r;

  /** Super-admin com TOTP confirmado e uma sessão aberta, tudo pelas funções, como o Core fará. */
  async function prontoComSessao(): Promise<{ id: string; sid: string; expira: Date }> {
    const id = await um<string>('plataforma.sa_criar_primeiro($1, $2, $3)', [EMAIL, NOME, H1]);
    await portal('select * from plataforma.sa_abrir_desafio($1, $2)', [id, sha('d-cadastro')]);
    expect(await um<boolean>('plataforma.sa_gravar_totp_pendente($1, $2)', [id, CIFRADO])).toBe(true);
    expect(await um<boolean>('plataforma.sa_confirmar_totp($1, $2, $3)', [id, 1000, RECUPERACAO])).toBe(true);
    const [s] = await portal<{ sessao_id: string; super_admin_id: string; expira_em: Date }>('select * from plataforma.sa_abrir_sessao($1)', [sha('d-cadastro')]);
    expect(s?.super_admin_id).toBe(id);
    return { id, sid: s!.sessao_id, expira: s!.expira_em };
  }
  const auditoria = async () =>
    (await admin.query<{ acao: string; super_admin_id: string | null; sessao_id: string | null; tenant_alvo_id: string | null; detalhes: unknown }>(
      'select acao, super_admin_id, sessao_id, tenant_alvo_id, detalhes from plataforma.auditoria_plataforma order by ocorrido_em, acao',
    )).rows;

  it('macuxi_app e macuxi_worker não leem nem gravam direto (42501); com um grant indevido, a RLS dá 0 linhas', async () => {
    await emTransacao(admin, DOIS_TENANTS.A.tenantId, async () => {
      await prontoComSessao();
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        for (const t of TABELAS_SO_POR_FUNCAO) {
          expect((await erroDe(como(papel, `select * from ${t}`)))?.code, `${papel} ${t}`).toBe('42501');
          expect((await erroDe(como(papel, `delete from ${t}`)))?.code, `${papel} delete ${t}`).toBe('42501');
        }
      }
      expect((await admin.query('select count(*)::int as n from plataforma.super_admin')).rows[0].n).toBe(1);
      for (const t of TABELAS_SO_POR_FUNCAO) {
        await admin.query(`grant select on ${t} to macuxi_app`);
        expect(await como('macuxi_app', `select * from ${t}`), t).toEqual([]);
      }
    });
  });

  it('catálogo: as 20 funções são SECURITY DEFINER, search_path fixo, sem PUBLIC, EXECUTE só do macuxi_portal (0038), nem app nem worker', async () => {
    const r = await admin.query<{ f: string; definer: boolean; config: string[]; portal: boolean; app: boolean; worker: boolean; publico: boolean }>(
      `select f, p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('macuxi_portal', p.oid, 'execute') as portal,
              has_function_privilege('macuxi_app', p.oid, 'execute') as app,
              has_function_privilege('macuxi_worker', p.oid, 'execute') as worker,
              coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false) as publico
         from unnest($1::text[]) f join pg_proc p on p.oid = f::regprocedure`,
      [[...FUNCOES_SA]],
    );
    expect(r.rows).toHaveLength(FUNCOES_SA.length);
    for (const { f, ...resto } of r.rows) {
      expect(resto, f).toEqual({ definer: true, config: ['search_path=pg_catalog, plataforma, pg_temp'], portal: true, app: false, worker: false, publico: false });
    }
    const internas = await admin.query<{ app: boolean; definer: boolean }>(
      `select has_function_privilege('macuxi_app', p.oid, 'execute') or has_function_privilege('macuxi_portal', p.oid, 'execute') as app,
              p.prosecdef as definer from pg_proc p
        where p.oid in ('plataforma.sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb)'::regprocedure, 'plataforma.provisionar_tenant(jsonb)'::regprocedure)`,
    );
    expect(internas.rows).toEqual([{ app: false, definer: false }, { app: false, definer: false }]);
  });

  it('macuxi_app (desde a 0038, T-0091) e macuxi_worker recebem 42501 em TODAS as funções sa_*', async () => {
    await emTransacao(admin, null, async () => {
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        for (const f of FUNCOES_SA) {
          const nome = f.slice(0, f.indexOf('('));
          const tipos = f.slice(f.indexOf('(') + 1, -1).split(', ').filter(Boolean);
          const erro = await erroDe(como(papel, `select ${nome}(${tipos.map((t) => `null::${t}`).join(', ')})`));
          expect(erro?.code, `${papel} ${f}`).toBe('42501');
        }
      }
    });
  });

  it('primeiro acesso: só com zero linhas (2x = 1 linha, a 2ª devolve nulo); entrada inválida = 22023 sem dado pessoal', async () => {
    await emTransacao(admin, null, async () => {
      expect(await um<boolean>('plataforma.sa_existe()')).toBe(false);
      for (const [email, nome, hash] of [['sem-arroba', NOME, H1], [EMAIL, '  ', H1], [EMAIL, NOME, 'senha-em-claro-123']]) {
        const erro = await erroDe(portal('select plataforma.sa_criar_primeiro($1, $2, $3)', [email, nome, hash]));
        expect(erro?.code).toBe('22023');
        for (const segredo of [EMAIL, 'senha-em-claro-123', H1]) expect(erro!.message).not.toContain(segredo);
      }
      const id = await um<string>('plataforma.sa_criar_primeiro($1, $2, $3)', [EMAIL, NOME, H1]);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await um<string | null>('plataforma.sa_criar_primeiro($1, $2, $3)', ['outro.t87@macuxi.exemplo', 'Outro', H1])).toBeNull();
      expect((await admin.query('select count(*)::int as n from plataforma.super_admin')).rows[0].n).toBe(1);
      expect(await um<boolean>('plataforma.sa_existe()')).toBe(true);
      // apagado continua contando: o primeiro acesso nunca reabre
      await admin.query('update plataforma.super_admin set deleted_at = now()');
      expect(await um<boolean>('plataforma.sa_existe()')).toBe(true);
      expect(await um<string | null>('plataforma.sa_criar_primeiro($1, $2, $3)', [EMAIL, NOME, H1])).toBeNull();
    });
  });

  it('login: sem TOTP o desafio é cadastrar_totp e não abre sessão (e é consumido); com TOTP abre sessão de 8 h; desafio de uso único', async () => {
    await emTransacao(admin, null, async () => {
      const id = await um<string>('plataforma.sa_criar_primeiro($1, $2, $3)', [EMAIL, NOME, H1]);
      const [linha] = await portal('select * from plataforma.sa_para_login($1)', [EMAIL.toUpperCase()]);
      expect(linha).toMatchObject({ id, email: EMAIL, nome: NOME, senha_hash: H1, ativo: true, falhas: 0, bloqueado_ate: null, totp_confirmado_em: null,
        totp_segredo_cifrado: null, totp_pendente_cifrado: null, totp_ultimo_passo: null, recuperacao_restantes: 0 });
      expect(Object.keys(linha!)).not.toContain('recuperacao_hashes');
      expect(await portal('select * from plataforma.sa_para_login($1)', ['ninguem@macuxi.exemplo'])).toEqual([]);
      expect((await portal('select * from plataforma.sa_por_id($1)', [id]))[0]).toEqual(linha);
      expect((await erroDe(portal('select * from plataforma.sa_abrir_desafio($1, $2)', [id, 'nao-e-hash'])))?.code).toBe('22023');

      expect(await portal('select * from plataforma.sa_abrir_desafio($1, $2)', [id, sha('d1')])).toEqual([{ etapa: 'cadastrar_totp', expira_em: expect.any(Date) }]);
      expect(await portal('select super_admin_id, etapa from plataforma.sa_ver_desafio($1)', [sha('d1')])).toEqual([{ super_admin_id: id, etapa: 'cadastrar_totp' }]);
      expect(await portal('select * from plataforma.sa_abrir_sessao($1)', [sha('d1')])).toEqual([]);
      expect(await portal('select * from plataforma.sa_ver_desafio($1)', [sha('d1')])).toEqual([]);

      await portal('select * from plataforma.sa_abrir_desafio($1, $2)', [id, sha('d2')]);
      expect((await erroDe(portal('select plataforma.sa_gravar_totp_pendente($1, $2)', [id, 'segredo-em-claro'])))?.code).toBe('22023');
      expect(await um<boolean>('plataforma.sa_gravar_totp_pendente($1, $2)', [id, CIFRADO])).toBe(true);
      expect((await erroDe(portal('select plataforma.sa_confirmar_totp($1, $2, $3)', [id, 1000, ['x']])))?.code).toBe('22023');
      expect((await erroDe(portal('select plataforma.sa_confirmar_totp($1, $2, $3)', [id, 1000, [RECUPERACAO[0], RECUPERACAO[0]]])))?.code).toBe('22023');
      expect(await um<boolean>('plataforma.sa_confirmar_totp($1, $2, $3)', [id, 1000, RECUPERACAO])).toBe(true);
      expect(await um<boolean>('plataforma.sa_confirmar_totp($1, $2, $3)', [id, 1001, RECUPERACAO])).toBe(false);
      // redefinir o 2º fator não é pelo portal (comando de administração, ADR 0029 §2)
      expect(await um<boolean>('plataforma.sa_gravar_totp_pendente($1, $2)', [id, CIFRADO])).toBe(false);
      const [depois] = await portal('select * from plataforma.sa_por_id($1)', [id]);
      expect(depois).toMatchObject({ totp_segredo_cifrado: CIFRADO, totp_pendente_cifrado: null, totp_ultimo_passo: '1000', recuperacao_restantes: 10 }); // bigint chega como texto no node-pg

      const [s] = await portal<{ sessao_id: string; super_admin_id: string; expira_em: Date }>('select * from plataforma.sa_abrir_sessao($1)', [sha('d2')]);
      expect(s?.super_admin_id).toBe(id);
      const agora = (await admin.query<{ t: Date }>('select now() as t')).rows[0]!.t;
      expect(s!.expira_em.getTime() - agora.getTime()).toBe(8 * 3600 * 1000);
      expect(await portal('select * from plataforma.sa_abrir_sessao($1)', [sha('d2')])).toEqual([]);
      expect(await portal('select super_admin_id from plataforma.sa_sessao_valida($1)', [s!.sessao_id])).toEqual([{ super_admin_id: id }]);
      // um desafio novo invalida o anterior ainda aberto
      await portal('select * from plataforma.sa_abrir_desafio($1, $2)', [id, sha('d3')]);
      expect(await portal('select etapa from plataforma.sa_abrir_desafio($1, $2)', [id, sha('d4')])).toEqual([{ etapa: 'segundo_fator' }]);
      expect(await portal('select * from plataforma.sa_ver_desafio($1)', [sha('d3')])).toEqual([]);
    });
  });

  it('sessão: falsa depois de sa_revogar, depois do teto de 8 h, de super-admin inativo; CHECK do teto', async () => {
    await emTransacao(admin, null, async () => {
      const { id, sid } = await prontoComSessao();
      expect(await um<boolean>('plataforma.sa_revogar($1)', [sid])).toBe(true);
      expect(await portal('select * from plataforma.sa_sessao_valida($1)', [sid])).toEqual([]);
      expect(await um<boolean>('plataforma.sa_revogar($1)', [sid])).toBe(false);

      const vencida = (await admin.query<{ id: string }>(
        `insert into plataforma.super_admin_sessao (super_admin_id, criada_em, ultimo_uso_em, expira_em)
         values ($1, now() - interval '8 hours 1 minute', now() - interval '8 hours 1 minute', now() - interval '1 minute') returning id`,
        [id],
      )).rows[0]!.id;
      expect(await portal('select * from plataforma.sa_sessao_valida($1)', [vencida])).toEqual([]);
      const erro = await erroDe(admin.query('savepoint teto').then(() => admin.query(
        "insert into plataforma.super_admin_sessao (super_admin_id, expira_em) values ($1, now() + interval '9 hours')", [id])));
      expect(erro?.code).toBe('23514');
      await admin.query('rollback to savepoint teto');

      const [s2] = await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao($1)', [sha('x')]);
      expect(s2).toBeUndefined();
      await portal('select * from plataforma.sa_abrir_desafio($1, $2)', [id, sha('d-viva')]);
      const [viva] = await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao($1)', [sha('d-viva')]);
      await admin.query('update plataforma.super_admin set ativo = false where id = $1', [id]);
      expect(await portal('select * from plataforma.sa_sessao_valida($1)', [viva!.sessao_id])).toEqual([]);
      expect(await um<boolean>('plataforma.sa_tenant_ativo($1, $2)', [viva!.sessao_id, DOIS_TENANTS.A.tenantId])).toBe(false);
    });
  });

  it('desafio vencido não vale; TOTP sem reuso de passo; recuperação de uso único; regerar', async () => {
    await emTransacao(admin, null, async () => {
      const { id } = await prontoComSessao();
      await admin.query(
        `insert into plataforma.super_admin_desafio (super_admin_id, desafio_hash, etapa, expira_em, created_at)
         values ($1, $2, 'segundo_fator', now() - interval '1 minute', now() - interval '6 minutes')`,
        [id, sha('vencido')],
      );
      expect(await portal('select * from plataforma.sa_ver_desafio($1)', [sha('vencido')])).toEqual([]);
      expect(await portal('select * from plataforma.sa_abrir_sessao($1)', [sha('vencido')])).toEqual([]);

      expect(await um<boolean>('plataforma.sa_marcar_passo($1, $2)', [id, 1000])).toBe(false);
      expect(await um<boolean>('plataforma.sa_marcar_passo($1, $2)', [id, 999])).toBe(false);
      expect(await um<boolean>('plataforma.sa_marcar_passo($1, $2)', [id, 1001])).toBe(true);
      expect(await um<boolean>('plataforma.sa_marcar_passo($1, $2)', [id, 1001])).toBe(false);

      expect(await um<number>('plataforma.sa_usar_recuperacao($1, $2)', [id, RECUPERACAO[3]])).toBe(9);
      expect(await um<number | null>('plataforma.sa_usar_recuperacao($1, $2)', [id, RECUPERACAO[3]])).toBeNull();
      expect(await um<number | null>('plataforma.sa_usar_recuperacao($1, $2)', [id, sha('nunca-gerado')])).toBeNull();
      expect(await um<number | null>('plataforma.sa_usar_recuperacao($1, $2)', [id, 'XXXXX-XXXXX'])).toBeNull();
      const novos = Array.from({ length: 10 }, (_, i) => sha(`novo-${i}`));
      expect(await um<number>('plataforma.sa_regerar_recuperacao($1, $2)', [id, novos])).toBe(10);
      expect(await um<number | null>('plataforma.sa_usar_recuperacao($1, $2)', [id, RECUPERACAO[0]])).toBeNull();
      expect(await um<number>('plataforma.sa_usar_recuperacao($1, $2)', [id, novos[0]])).toBe(9);
    });
  });

  it('5 falhas seguidas = bloqueio de 15 min (sem desafio, sem sessão nova); sucesso não desbloqueia; bloqueio vencido limpa', async () => {
    await emTransacao(admin, null, async () => {
      const { id } = await prontoComSessao();
      await portal('select * from plataforma.sa_abrir_desafio($1, $2)', [id, sha('antes-do-bloqueio')]);
      for (let i = 1; i <= 4; i++) {
        expect(await portal('select * from plataforma.sa_registrar_falha($1)', [id])).toEqual([{ falhas: i, bloqueado_ate: null }]);
      }
      const [bloq] = await portal<{ falhas: number; bloqueado_ate: Date }>('select * from plataforma.sa_registrar_falha($1)', [id]);
      const agora = (await admin.query<{ t: Date }>('select now() as t')).rows[0]!.t;
      expect(bloq!.falhas).toBe(0);
      expect(bloq!.bloqueado_ate.getTime() - agora.getTime()).toBe(15 * 60 * 1000);
      // bloqueado: falha não estende, desafio não abre, o aberto não vale, sucesso não desbloqueia
      expect(await portal('select * from plataforma.sa_registrar_falha($1)', [id])).toEqual([bloq]);
      expect(await portal('select * from plataforma.sa_abrir_desafio($1, $2)', [id, sha('durante')])).toEqual([]);
      expect(await portal('select * from plataforma.sa_ver_desafio($1)', [sha('antes-do-bloqueio')])).toEqual([]);
      expect(await portal('select * from plataforma.sa_abrir_sessao($1)', [sha('antes-do-bloqueio')])).toEqual([]);
      await portal('select plataforma.sa_registrar_sucesso($1)', [id]);
      expect((await portal('select bloqueado_ate from plataforma.sa_por_id($1)', [id]))[0]).toEqual({ bloqueado_ate: bloq!.bloqueado_ate });
      await admin.query("update plataforma.super_admin set bloqueado_ate = now() - interval '1 second' where id = $1", [id]);
      await portal('select plataforma.sa_registrar_sucesso($1)', [id]);
      expect((await portal('select falhas, bloqueado_ate from plataforma.sa_por_id($1)', [id]))[0]).toEqual({ falhas: 0, bloqueado_ate: null });
      expect(await portal('select etapa from plataforma.sa_abrir_desafio($1, $2)', [id, sha('depois')])).toEqual([{ etapa: 'segundo_fator' }]);
      expect((await auditoria()).filter((a) => a.acao === 'sa.bloqueio')).toHaveLength(1);
    });
  });

  it('auditoria: sa_auditar grava a linha (rota sem query, IP só prefixo); append-only para todos; sem dado pessoal', async () => {
    await emTransacao(admin, null, async () => {
      const { id, sid } = await prontoComSessao();
      const linha = { super_admin_id: id, sessao_id: sid, tenant_id: DOIS_TENANTS.A.tenantId, acao: 'sa.requisicao', metodo: 'get',
        rota: '/v1/integracao/lotes/:id?cliente=Fulano', status: 200, request_id: 'req-1', ip_prefixo: '10.1.2.0/24' };
      const aid = await um<string>('plataforma.sa_auditar($1::jsonb)', [JSON.stringify(linha)]);
      const gravada = (await admin.query('select super_admin_id, sessao_id, tenant_alvo_id, acao, metodo, rota, status, request_id, ip_prefixo, detalhes from plataforma.auditoria_plataforma where id = $1', [aid])).rows;
      expect(gravada).toEqual([{ super_admin_id: id, sessao_id: sid, tenant_alvo_id: DOIS_TENANTS.A.tenantId, acao: 'sa.requisicao', metodo: 'GET',
        rota: '/v1/integracao/lotes/:id', status: 200, request_id: 'req-1', ip_prefixo: '10.1.2.0/24', detalhes: {} }]);
      // falha de login com e-mail inexistente: sem super-admin; IP inteiro não é gravado
      const sem = await um<string>('plataforma.sa_auditar($1::jsonb)', [JSON.stringify({ super_admin_id: null, acao: 'sa.login.falha', ip_prefixo: '10.1.2.3', status: 401 })]);
      expect((await admin.query('select super_admin_id, ip_prefixo, tenant_alvo_id from plataforma.auditoria_plataforma where id = $1', [sem])).rows)
        .toEqual([{ super_admin_id: null, ip_prefixo: null, tenant_alvo_id: null }]);
      expect((await um<string>('plataforma.sa_auditar($1::jsonb)', [JSON.stringify({ acao: 'sa.x', ip_prefixo: '2001:db8:0::/48' })]))).toBeTruthy();
      for (const ruim of [{ acao: 'Login Falhou' }, { acao: 'sa.x', detalhes: [1] }, { acao: 'sa.x', metodo: 'get /x' }, { acao: 'sa.x', detalhes: { t: 'x'.repeat(5000) } }]) {
        expect((await erroDe(portal('select plataforma.sa_auditar($1::jsonb)', [JSON.stringify(ruim)])))?.code, JSON.stringify(ruim).slice(0, 40)).toBe('22023');
      }
      // append-only: o app não tem grant; o dono esbarra no gatilho
      expect((await erroDe(portal('update plataforma.auditoria_plataforma set acao = acao')))?.code).toBe('42501');
      for (const sql of ['update plataforma.auditoria_plataforma set acao = acao', 'delete from plataforma.auditoria_plataforma', 'truncate plataforma.auditoria_plataforma']) {
        await admin.query('savepoint ap');
        const erro = await erroDe(admin.query(sql));
        await admin.query('rollback to savepoint ap');
        expect(erro?.code, sql).toBe('42501');
        expect(erro?.message).toContain('append-only');
      }
      // fatos gravados pelo próprio banco, sem e-mail, nome, hash ou segredo
      const acoes = (await auditoria()).map((a) => a.acao);
      expect(acoes).toEqual(expect.arrayContaining(['sa.primeiro_acesso', 'sa.totp.confirmado', 'sa.sessao.aberta', 'sa.requisicao', 'sa.login.falha']));
      const texto = JSON.stringify(await auditoria());
      for (const segredo of [EMAIL, NOME, H1, CIFRADO, RECUPERACAO[0]!, 'Fulano']) expect(texto).not.toContain(segredo);
    });
  });

  it('sa_listar_tenants e sa_tenant_ativo conferem a sessão; a lista bate com ListaEmpresasSchema e só tem módulos do contrato', async () => {
    await emTransacao(admin, null, async () => {
      const { sid } = await prontoComSessao();
      const lista = ListaEmpresasSchema.parse(await um('plataforma.sa_listar_tenants($1)', [sid]));
      const a = lista.itens.find((t) => t.id === DOIS_TENANTS.A.tenantId);
      expect(a).toMatchObject({ codigo: DOIS_TENANTS.A.codigo, fuso: 'America/Manaus', status: 'ativo' });
      expect(a!.modulos.map((m) => m.modulo)).not.toContain('teste');
      expect(lista.itens.some((t) => t.id === DOIS_TENANTS.B.tenantId)).toBe(true);
      expect(await um<boolean>('plataforma.sa_tenant_ativo($1, $2)', [sid, DOIS_TENANTS.A.tenantId])).toBe(true);
      expect(await um<boolean>('plataforma.sa_tenant_ativo($1, $2)', [sid, '00000000-0000-4000-8000-000000000000'])).toBe(false);
      await admin.query("update plataforma.tenant set status = 'suspenso' where id = $1", [DOIS_TENANTS.B.tenantId]);
      expect(await um<boolean>('plataforma.sa_tenant_ativo($1, $2)', [sid, DOIS_TENANTS.B.tenantId])).toBe(false);
      await portal('select plataforma.sa_revogar($1)', [sid]);
      expect(await um<boolean>('plataforma.sa_tenant_ativo($1, $2)', [sid, DOIS_TENANTS.A.tenantId])).toBe(false);
      expect((await erroDe(portal('select plataforma.sa_listar_tenants($1)', [sid])))?.code).toBe('28000');
    });
  });

  it('sa_provisionar_tenant: sem admin, com parâmetros, idempotente (2x = mesmas linhas); sessão revogada ou vencida = 28000; admin = 22023', async () => {
    await emTransacao(admin, null, async () => {
      const { id, sid } = await prontoComSessao();
      const r1 = await um<Record<string, unknown>>('plataforma.sa_provisionar_tenant($1, $2::jsonb)', [sid, JSON.stringify(entradaPortal('t87-portal'))]);
      expect(r1).toEqual({ tenant_id: expect.any(String), resultado: 'criado', modulos_adicionados: ['catalogo', 'core', 'integracao', 'vendedor'],
        parametros_gravados: ['alcada.gerente_pct', 'alcada.supervisor_pct', 'alcada.vendedor_pct', 'aplicacao_no_orcamento_padrao', 'validade_orcamento_dias'],
        admin: 'sem_admin', avisos: [] });
      const tenant = r1.tenant_id as string;
      expect((await admin.query('select count(*)::int as n from core.usuario where tenant_id = $1', [tenant])).rows[0].n).toBe(0);
      const params = await admin.query('select chave, valor from plataforma.parametro where tenant_id = $1 and modulo = $2 order by chave', [tenant, 'vendedor']);
      expect(params.rows).toEqual([...PARAMETROS].sort((x, y) => x.chave.localeCompare(y.chave)).map((p) => ({ chave: p.chave, valor: p.valor })));
      const aud = await admin.query('select usuario_id, depois from plataforma.auditoria where tenant_id = $1 and acao = $2', [tenant, 'tenant.provisionar']);
      expect(aud.rows).toEqual([{ usuario_id: id, depois: { resultado: 'criado', modulos_adicionados: ['catalogo', 'core', 'integracao', 'vendedor'], admin: 'sem_admin',
        parametros_gravados: r1.parametros_gravados } }]);

      const retrato = async () => {
        const out: Record<string, number> = {};
        for (const t of await tabelasComTenant(admin)) {
          out[t.nome] = (await admin.query<{ n: number }>(`select count(*)::int as n from ${t.schema}.${t.tabela} where tenant_id = $1`, [tenant])).rows[0]!.n;
        }
        return out;
      };
      const antes = await retrato();
      // 2ª chamada (até com valor diferente e ator forjado): nada muda
      const r2 = await um<Record<string, unknown>>('plataforma.sa_provisionar_tenant($1, $2::jsonb)', [sid, JSON.stringify(entradaPortal('t87-portal', {
        parametros: PARAMETROS.map((p) => ({ ...p, valor: 99 })), ator_id: '00000000-0000-4000-8000-000000000000' }))]);
      expect(r2).toEqual({ tenant_id: tenant, resultado: 'sem_mudanca', modulos_adicionados: [], parametros_gravados: [], admin: 'sem_admin', avisos: [] });
      expect(await retrato()).toEqual(antes);
      expect((await admin.query('select count(*)::int as n from plataforma.parametro where tenant_id = $1 and valor = $2', [tenant, '99'])).rows[0].n).toBe(0);
      expect((await auditoria()).filter((a) => a.acao === 'sa.tenant.provisionar').map((a) => a.tenant_alvo_id)).toEqual([tenant, tenant]);

      for (const extra of [{ admin: { email: 'a@b.com', nome: 'A', senha_hash: H1 } }, { redefinir_senha: true }]) {
        expect((await erroDe(portal('select plataforma.sa_provisionar_tenant($1, $2::jsonb)', [sid, JSON.stringify(entradaPortal('t87-adm', extra))])))?.code).toBe('22023');
      }
      await portal('select plataforma.sa_revogar($1)', [sid]);
      expect((await erroDe(portal('select plataforma.sa_provisionar_tenant($1, $2::jsonb)', [sid, JSON.stringify(entradaPortal('t87-revogada'))])))?.code).toBe('28000');
      const vencida = (await admin.query<{ id: string }>(
        `insert into plataforma.super_admin_sessao (super_admin_id, criada_em, ultimo_uso_em, expira_em)
         values ($1, now() - interval '8 hours', now() - interval '8 hours', now()) returning id`, [id])).rows[0]!.id;
      expect((await erroDe(portal('select plataforma.sa_provisionar_tenant($1, $2::jsonb)', [vencida, JSON.stringify(entradaPortal('t87-vencida'))])))?.code).toBe('28000');
      expect((await admin.query("select count(*)::int as n from plataforma.tenant where codigo in ('t87-adm', 't87-revogada', 't87-vencida')")).rows[0].n).toBe(0);
    });
  });

  it('provisionar_tenant (conexão de administração): sem_admin + parâmetros idempotente; módulo fora do tenant, repetição ou sem_admin com admin = 22023', async () => {
    await emTransacao(admin, null, async () => {
      const chamar = async (e: unknown) => (await admin.query<{ r: Record<string, unknown> }>('select plataforma.provisionar_tenant($1::jsonb) as r', [JSON.stringify(e)])).rows[0]!.r;
      const r1 = await chamar(entradaPortal('t87-cli'));
      expect(r1).toMatchObject({ resultado: 'criado', admin: 'sem_admin' });
      expect(await chamar(entradaPortal('t87-cli'))).toMatchObject({ resultado: 'sem_mudanca', parametros_gravados: [] });
      // parâmetro novo num tenant existente = atualizado, só ele entra
      const r3 = await chamar(entradaPortal('t87-cli', { parametros: [...PARAMETROS, { modulo: 'core', chave: 'sync_auto_min_t87', valor: 30 }] }));
      expect(r3).toMatchObject({ resultado: 'atualizado', parametros_gravados: ['sync_auto_min_t87'], modulos_adicionados: [] });
      for (const [caso, e] of [
        ['módulo do parâmetro fora do tenant', entradaPortal('t87-x1', { parametros: [{ modulo: 'pesquisa', chave: 'a', valor: 1 }] })],
        ['parâmetro repetido', entradaPortal('t87-x2', { parametros: [PARAMETROS[0], PARAMETROS[0]] })],
        ['valor nulo', entradaPortal('t87-x3', { parametros: [{ modulo: 'vendedor', chave: 'a', valor: null }] })],
        ['chave inválida', entradaPortal('t87-x4', { parametros: [{ modulo: 'vendedor', chave: 'A B', valor: 1 }] })],
        ['sem_admin com admin', entradaPortal('t87-x5', { admin: { email: 'a@b.com', nome: 'A', senha_hash: H1 } })],
        ['ator_id que não é UUID', entradaPortal('t87-x6', { ator_id: 'eu' })],
        ['sem sem_admin e sem admin (T-0083 continua exigindo)', entradaPortal('t87-x7', { sem_admin: false })],
      ] as const) {
        await admin.query('savepoint caso');
        const erro = await erroDe(chamar(e));
        await admin.query('rollback to savepoint caso');
        expect(erro?.code, caso).toBe('22023');
      }
    });
  });

  it('retenção: a auditoria da plataforma sobrevive à plataforma.excluir_tenant (tenant_alvo_id sem FK)', async () => {
    await emTransacao(admin, null, async () => {
      const { sid } = await prontoComSessao();
      const r = await um<{ tenant_id: string }>('plataforma.sa_provisionar_tenant($1, $2::jsonb)', [sid, JSON.stringify(entradaPortal('t87-excluir'))]);
      await um('plataforma.sa_auditar($1::jsonb)', [JSON.stringify({ acao: 'sa.requisicao', tenant_id: r.tenant_id, status: 200 })]);
      const antes = (await auditoria()).filter((a) => a.tenant_alvo_id === r.tenant_id).length;
      expect(antes).toBe(2);
      await admin.query("update plataforma.tenant set status = 'encerrado' where id = $1", [r.tenant_id]);
      await admin.query('select * from plataforma.excluir_tenant($1, $2)', [r.tenant_id, 't87-excluir']);
      expect((await admin.query('select count(*)::int as n from plataforma.tenant where id = $1', [r.tenant_id])).rows[0].n).toBe(0);
      expect((await auditoria()).filter((a) => a.tenant_alvo_id === r.tenant_id)).toHaveLength(antes);
    });
  });
});

describe.skipIf(semBanco())('0035 up/down e corrida do primeiro acesso (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up cria tabelas e funções; down volta exatamente ao catálogo da 0034; up de novo = mesmo catálogo', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0034' });
      const antes = await retratoDoCatalogo(c);
      await migrarUp(c, { ate: '0035' });
      const depois = await retratoDoCatalogo(c);
      expect(depois).toEqual(expect.arrayContaining([
        'fn plataforma.sa_provisionar_tenant(p_sid uuid, p jsonb)', 'fn plataforma.sa_auditar(p jsonb)',
        expect.stringMatching(/^rel plataforma\.auditoria_plataforma r rls=true force=true$/),
        'trg plataforma.auditoria_plataforma.auditoria_plataforma_append_only',
      ]));
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0035_plataforma_super_admin']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m35.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0035' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });

  // o banco deste bloco fica na 0035 (o caso acima termina com up até a 0035): lá o EXECUTE ainda é do macuxi_app
  it('dois primeiros acessos ao mesmo tempo: um cria, o outro recebe nulo (trava consultiva); 1 linha', async () => {
    await comAdmin(b.nome, async (c1) => {
      await comAdmin(b.nome, async (c2) => {
        await c1.query('begin');
        await c1.query('set local role macuxi_app');
        await c2.query('begin');
        await c2.query('set local role macuxi_app');
        const p1 = (await c1.query<{ r: string | null }>('select plataforma.sa_criar_primeiro($1, $2, $3) as r', [EMAIL, NOME, H1])).rows[0]!.r;
        const segunda = c2.query<{ r: string | null }>('select plataforma.sa_criar_primeiro($1, $2, $3) as r', ['outro.t87@macuxi.exemplo', 'Outro', H1]);
        await new Promise((ok) => setTimeout(ok, 300));
        await c1.query('commit');
        const p2 = (await segunda).rows[0]!.r;
        await c2.query('commit');
        expect(p1).toMatch(/^[0-9a-f-]{36}$/);
        expect(p2).toBeNull();
        expect((await c1.query('select count(*)::int as n from plataforma.super_admin')).rows[0].n).toBe(1);
      });
    });
  });
});
