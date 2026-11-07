/**
 * T-0002 — conformidade do banco que sustenta o isolamento (cenários S0-023 e S0-028 do plano).
 *
 * - Regra 5 do CLAUDE.md: toda tabela tem id uuid, tenant_id, created_at, updated_at, deleted_at,
 *   external_id e RLS ligado e FORÇADO, com política por tenant para o papel da aplicação; exceções só
 *   as declaradas pelo banco-dados (TABELAS_SEM_TENANT_ID). As de TABELAS_SO_POR_FUNCAO (super-admin, 0035,
 *   ADR 0029) não têm política nem grant para o app e o worker: só as SECURITY DEFINER plataforma.sa_* chegam a elas.
 * - S0-028: o papel da API (macuxi_app) não é superusuário, não ignora RLS, não é dono de nada, não
 *   herda papel privilegiado e não tem atalho que dispense a política (TRUNCATE, SET ROLE,
 *   row_security = off, ALTER TABLE, função SECURITY DEFINER fora da lista, view sem security_invoker).
 *   O worker (macuxi_worker) também só executa as SECURITY DEFINER revisadas para ele.
 * - T-0091 (0038, condição da ADR 0029): as plataforma.sa_* têm EXECUTE só para o dono e o macuxi_portal (conferido pelo
 *   catálogo, não por lista fixa); o macuxi_portal não tem grant de tabela, não herda papel, não é dono de nada e só tem
 *   USAGE no schema plataforma.
 * - Perfis: o CHECK do banco aceita exatamente os PERFIS do @macuxi/platform-sdk ("gerente", nunca
 *   "manager" da Fase M) — provado com INSERT real, não lendo o SQL.
 */
import { DOIS_TENANTS, PAPEL_PORTAL, TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '@macuxi/db/teste';
import { diagnosticarPapelApp } from '@macuxi/db';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { PERFIS } from '@macuxi/platform-sdk';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conectar, schemasDeDominio, tabelasDoCatalogo, tentar, type Tabela } from '../apoio/banco';

const A = DOIS_TENANTS.A.tenantId;
const PAPEL = 'macuxi_app';
const PAPEL_WORKER = 'macuxi_worker';
/** Função interna da 0035: só o dono executa (as sa_* públicas a chamam por dentro). */
const SA_INTERNAS: ReadonlySet<string> = new Set(['sa_registrar_auditoria']);
/** Tabelas sem política nem grant para o app e o worker (0035): exceção SÓ para estas, lida do @macuxi/db/teste. */
const SO_POR_FUNCAO: ReadonlySet<string> = new Set(TABELAS_SO_POR_FUNCAO);
const SA = 'super-admin de plataforma (ADR 0029): confere a sessão/desafio; tabelas só por função';

/**
 * Funções SECURITY DEFINER que o papel da aplicação pode chamar, revisadas pelo agente testes, pela
 * assinatura exata de pg_get_function_arguments. Revisão da 0010/0011: R-20261101-172531-engenheiro-software.
 */
const DEFINER_REVISADAS: Record<string, string> = {
  'plataforma.tenant_por_codigo(p_codigo text)': 'login: resolve o tenant pelo código antes do contexto; devolve só id, nome, fuso, status',
  'integracao.autenticar_chave(p_hash text)':
    'Hub: única leitura sem tenant (ADR 0013); resolve a credencial pelo HMAC da chave; no máximo 1 linha, sem o hash; apagados = 0 linhas',
  // T-0078 (0024; R-20261105-001055-banco-dados): /v1/saude
  'plataforma.resumo_outbox(p_nomes text[], p_max_tentativas integer)':
    'saúde: só agregados da outbox de todos os tenants (pendentes, parados, segundos do mais antigo); sem id, tenant, payload ou erro',
};

/**
 * Funções SECURITY DEFINER que o papel do portal (macuxi_portal, 0038, T-0091, condição da ADR 0029) pode chamar: as 20
 * plataforma.sa_* da 0035 (§10) e NADA mais. Saíram de DEFINER_REVISADAS na 0038 (R-20261106-234527-banco-dados): se o
 * macuxi_app ou o macuxi_worker voltar a executar alguma, o caso do papel deles reprova (igualdade exata).
 */
const DEFINER_REVISADAS_PORTAL: Record<string, string> = {
  'plataforma.sa_existe()': `${SA}; só diz se já houve super-admin`,
  'plataforma.sa_criar_primeiro(p_email text, p_nome text, p_senha_hash text)': `${SA}; cria só com zero linhas (trava consultiva)`,
  'plataforma.sa_para_login(p_email text)': `${SA}; linha viva para conferir senha/TOTP, sem hashes de recuperação`,
  'plataforma.sa_por_id(p_id uuid)': `${SA}; linha viva, sem hashes de recuperação`,
  'plataforma.sa_registrar_falha(p_id uuid)': `${SA}; 5 falhas = bloqueio de 15 min`,
  'plataforma.sa_registrar_sucesso(p_id uuid)': `${SA}; zera o contador de falhas`,
  'plataforma.sa_gravar_totp_pendente(p_id uuid, p_cifrado text)': `${SA}; só antes do TOTP confirmado`,
  'plataforma.sa_confirmar_totp(p_id uuid, p_passo bigint, p_recuperacao_hashes text[])': `${SA}; pendente vira segredo + hashes`,
  'plataforma.sa_marcar_passo(p_id uuid, p_passo bigint)': `${SA}; passo TOTP só avança (sem reuso)`,
  'plataforma.sa_usar_recuperacao(p_id uuid, p_hash text)': `${SA}; consome um código de recuperação`,
  'plataforma.sa_regerar_recuperacao(p_id uuid, p_hashes text[])': `${SA}; troca os códigos de recuperação`,
  'plataforma.sa_abrir_desafio(p_id uuid, p_desafio_hash text)': `${SA}; desafio da 2ª etapa, 5 min, só o SHA-256`,
  'plataforma.sa_ver_desafio(p_desafio_hash text)': `${SA}; etapa do desafio vivo`,
  'plataforma.sa_abrir_sessao(p_desafio_hash text)': `${SA}; consome o desafio; exige TOTP confirmado, ativo e sem bloqueio`,
  'plataforma.sa_sessao_valida(p_sid uuid)': `${SA}; sessão viva (não revogada, no prazo, ativo, TOTP confirmado)`,
  'plataforma.sa_revogar(p_sid uuid)': `${SA}; revoga a sessão`,
  'plataforma.sa_auditar(p jsonb)': `${SA}; 1 linha append-only na auditoria_plataforma`,
  'plataforma.sa_listar_tenants(p_sid uuid)': `${SA}; confere a sessão antes de listar`,
  'plataforma.sa_tenant_ativo(p_sid uuid, p_tenant uuid)': `${SA}; confere a sessão`,
  'plataforma.sa_provisionar_tenant(p_sid uuid, p jsonb)': `${SA}; confere a sessão; sem admin nem redefinir_senha`,
};

/**
 * Funções SECURITY DEFINER que o worker (macuxi_worker) pode chamar. Os expurgos NÃO entram em
 * DEFINER_REVISADAS: se o macuxi_app puder executá-los, é grant errado e o caso do papel reprova.
 * Revisão: R-20261101-172531-engenheiro-software (T-0032).
 */
const DEFINER_REVISADAS_WORKER: Record<string, string> = {
  'integracao.expurgar_retencao(p_agora timestamp with time zone DEFAULT now(), p_limite integer DEFAULT 5000)':
    'retenção do Hub entre tenants; lote cascateia em lote_staging/lote_linha_erro; o expurgo não aborta por FK',
  'plataforma.expurgar_outbox(p_agora timestamp with time zone DEFAULT now(), p_limite integer DEFAULT 10000)':
    'retenção da outbox; evento pendente nunca sai; consumo e evento apagados na mesma transação; parâmetro limitado a 7..365',
  // T-0039 §2.3 passo 3 (0027; ADR 0022; R-20261105-040202-banco-dados): NÃO entra em DEFINER_REVISADAS (o app não executa)
  'plataforma.tenants_ativos()':
    'agendador das tarefas periódicas (ADR 0022): só ids dos tenants ativos (status ativo, deleted_at nulo), ordenados; nenhuma outra coluna',
};

/**
 * Índices únicos SEM tenant_id em tabela de tenant, pelo nome (schema.indice), cada um com o motivo.
 * Exceção nominal, sem regex: índice novo sem tenant_id reprova até ser revisado e listado aqui.
 */
const INDICES_UNICOS_GLOBAIS: Record<string, string> = {
  // Global de propósito: autenticar_chave procura a chave ANTES de se saber o tenant (com
  // (tenant_id, hash_chave) seria seq scan entre tenants). O hash é HMAC-SHA256 com o pepper do
  // servidor sobre chave gerada pelo servidor: nenhum tenant escolhe o valor, colisão impraticável
  // e o 23505 nunca chega ao cliente. CONDIÇÃO: a exceção cai se o Hub aceitar chave escolhida pelo
  // cliente ("traga sua chave"). Revisão: R-20261101-172531-engenheiro-software (T-0032).
  'integracao.credencial_hash_uk':
    'HMAC-SHA256 (pepper do servidor) de chave gerada pelo servidor; cai se o Hub aceitar chave escolhida pelo cliente',
};

type Definer = { assinatura: string; config: string[] | null; publico: boolean };

/** Funções SECURITY DEFINER dos schemas de domínio que o papel executa (direto ou via PUBLIC). */
async function definerExecutaveis(admin: pg.Client, papel: string, schemas: string[]): Promise<Definer[]> {
  const r = await admin.query<Definer>(
    `select n.nspname || '.' || p.proname || '(' || pg_get_function_arguments(p.oid) || ')' as assinatura,
            p.proconfig as config,
            coalesce(exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'), false) as publico
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname = any($2) and has_function_privilege($1, p.oid, 'EXECUTE')`,
    [papel, schemas],
  );
  return r.rows;
}

/** Só as revisadas, todas com search_path fixo e nenhuma executável por PUBLIC. */
function conferirDefiner(funcoes: Definer[], revisadas: Record<string, string>): void {
  expect(funcoes.map((x) => x.assinatura).sort()).toEqual(Object.keys(revisadas).sort());
  for (const f of funcoes) {
    expect(f.config?.some((c) => c.startsWith('search_path=')), `${f.assinatura} sem search_path fixo`).toBe(true);
    expect(f.publico, `${f.assinatura} executável por PUBLIC`).toBe(false);
  }
}

const COLUNAS_COMUNS: Record<string, string> = {
  id: 'uuid',
  tenant_id: 'uuid',
  created_at: 'timestamp with time zone',
  updated_at: 'timestamp with time zone',
  deleted_at: 'timestamp with time zone',
  external_id: 'text',
};

describe.skipIf(semBanco())('S0-023/S0-028 conformidade do banco para o isolamento multi-tenant', () => {
  let admin: pg.Client;
  let app: pg.Client;
  let tabelas: Tabela[] = [];
  let schemas: string[] = [];

  beforeAll(async () => {
    admin = await conectar(banco().urlAdmin);
    app = await conectar(banco().urlApp);
    tabelas = await tabelasDoCatalogo(admin);
    schemas = await schemasDeDominio(admin);
  });
  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });

  describe('S0-023 regra 5: campos comuns, RLS forçado e política por tenant', () => {
    it('schemas plataforma e core existem', () => {
      expect(schemas).toEqual(expect.arrayContaining(['plataforma', 'core']));
    });

    it('tabela sem tenant_id só se declarada em TABELAS_SEM_TENANT_ID', () => {
      const sem = tabelas.filter((t) => !t.temTenant).map((t) => t.nome);
      expect(sem.filter((n) => !(n in TABELAS_SEM_TENANT_ID))).toEqual([]);
    });

    it('TABELAS_SO_POR_FUNCAO: só tabelas que existem, sem tenant_id e declaradas em TABELAS_SEM_TENANT_ID (tabela de tenant não se esconde na lista)', () => {
      const porNome = new Map(tabelas.map((t) => [t.nome, t]));
      const problemas: string[] = [];
      for (const n of SO_POR_FUNCAO) {
        const t = porNome.get(n);
        if (!t) problemas.push(`${n}: não existe (lista velha)`);
        else if (t.temTenant) problemas.push(`${n}: tem tenant_id, precisa de política por tenant`);
        if (!(n in TABELAS_SEM_TENANT_ID)) problemas.push(`${n}: fora de TABELAS_SEM_TENANT_ID`);
      }
      expect(problemas).toEqual([]);
    });

    it('TABELAS_SO_POR_FUNCAO: nenhuma política nem privilégio de tabela para o app, o worker ou PUBLIC', async () => {
      const problemas: string[] = [];
      for (const n of SO_POR_FUNCAO) {
        const pols = await admin.query<{ nome: string; roles: string[] }>(
          `select policyname as nome, roles::text[] as roles from pg_policies where schemaname || '.' || tablename = $1`,
          [n],
        );
        for (const p of pols.rows) {
          const abertos = p.roles.filter((r) => r === PAPEL || r === PAPEL_WORKER || r === 'public');
          if (abertos.length) problemas.push(`${n}: política ${p.nome} para ${abertos.join(', ')}`);
        }
        for (const papel of [PAPEL, PAPEL_WORKER]) {
          for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
            const r = await admin.query<{ tem: boolean }>('select has_table_privilege($1, $2::regclass, $3) as tem', [papel, n, priv]);
            if (r.rows[0]!.tem) problemas.push(`${n}: ${priv} para ${papel}`);
          }
        }
      }
      expect(problemas).toEqual([]);
      // e o app, de fato, não lê (42501 direto, sem grant)
      const ler = await tentar(app, A, () => app.query('select count(*) from plataforma.super_admin'));
      expect(ler.ok ? 'leu plataforma.super_admin!' : ler.codigo).toBe('42501');
    });

    it('toda tabela tem os campos comuns com o tipo certo (tenant_id e id NOT NULL)', async () => {
      const faltas: string[] = [];
      for (const t of tabelas) {
        const r = await admin.query<{ attname: string; tipo: string; nn: boolean }>(
          `select a.attname, format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull as nn
             from pg_attribute a where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped`,
          [t.sql],
        );
        const cols = new Map(r.rows.map((x) => [x.attname, x]));
        for (const [col, tipo] of Object.entries(COLUNAS_COMUNS)) {
          if (col === 'tenant_id' && !t.temTenant) continue;
          const c = cols.get(col);
          if (!c) faltas.push(`${t.nome}.${col} ausente`);
          else if (c.tipo !== tipo) faltas.push(`${t.nome}.${col} é ${c.tipo}, esperado ${tipo}`);
          else if ((col === 'id' || col === 'tenant_id') && !c.nn) faltas.push(`${t.nome}.${col} aceita NULL`);
        }
      }
      expect(faltas).toEqual([]);
    });

    it('toda tabela tem RLS ligado E forçado (o dono também obedece)', async () => {
      const r = await admin.query<{ nome: string; rls: boolean; force: boolean }>(
        `select n.nspname || '.' || c.relname as nome, c.relrowsecurity as rls, c.relforcerowsecurity as force
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r', 'p') and n.nspname = any($1)`,
        [schemas],
      );
      expect(r.rows.filter((x) => !x.rls || !x.force).map((x) => x.nome)).toEqual([]);
      expect(r.rows.length).toBe(tabelas.length);
    });

    it('toda tabela (exceto as de TABELAS_SO_POR_FUNCAO) tem política para o papel da aplicação, comparando tenant_id (ou id, no tenant) com plataforma.tenant_atual(), no USING e no WITH CHECK', async () => {
      const r = await admin.query<{ nome: string; roles: string[]; cmd: string; qual: string | null; wc: string | null; permissiva: string }>(
        `select schemaname || '.' || tablename as nome, roles::text[] as roles, cmd, qual, with_check as wc, permissive as permissiva
           from pg_policies where schemaname = any($1)`,
        [schemas],
      );
      const problemas: string[] = [];
      for (const t of tabelas) {
        // só as de TABELAS_SO_POR_FUNCAO ficam sem política para o app (provado no caso acima); nenhuma outra
        if (SO_POR_FUNCAO.has(t.nome) && !t.temTenant) continue;
        const pols = r.rows.filter((p) => p.nome === t.nome && (p.roles.includes(PAPEL) || p.roles.includes('public')));
        const coluna = t.temTenant ? 'tenant_id' : 'id';
        const boa = (txt: string | null) => !!txt && txt.includes(coluna) && txt.includes('tenant_atual()');
        if (pols.length === 0) problemas.push(`${t.nome}: sem política para ${PAPEL}`);
        for (const p of pols) {
          if (p.permissiva !== 'PERMISSIVE' && p.permissiva !== 'RESTRICTIVE') problemas.push(`${t.nome}: tipo de política ${p.permissiva}`);
          if (!boa(p.qual)) problemas.push(`${t.nome}: USING não filtra por ${coluna} = tenant_atual(): ${p.qual}`);
          if (p.cmd !== 'SELECT' && p.cmd !== 'DELETE' && !boa(p.wc ?? p.qual)) problemas.push(`${t.nome}: WITH CHECK sem tenant: ${p.wc}`);
          if (/\btrue\b|\bor\b/i.test(`${p.qual ?? ''} ${p.wc ?? ''}`)) problemas.push(`${t.nome}: política com "true"/"or" pode abrir a tabela: ${p.qual}`);
        }
      }
      expect(problemas).toEqual([]);
    });

    it('índices únicos das tabelas de tenant incluem tenant_id (exceto a chave primária id e os de INDICES_UNICOS_GLOBAIS)', async () => {
      const r = await admin.query<{ nome: string; indice: string; def: string; pk: boolean }>(
        `select n.nspname || '.' || c.relname as nome, n.nspname || '.' || i.relname as indice, pg_get_indexdef(x.indexrelid) as def, x.indisprimary as pk
           from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class c on c.oid = x.indrelid
           join pg_namespace n on n.oid = c.relnamespace
          where x.indisunique and n.nspname = any($1)`,
        [schemas],
      );
      const comTenant = new Set(tabelas.filter((t) => t.temTenant).map((t) => t.nome));
      const semTenant = r.rows.filter((x) => comTenant.has(x.nome) && !x.pk && !/\(tenant_id[,)]/.test(x.def));
      const globais = semTenant.filter((x) => !(x.indice in INDICES_UNICOS_GLOBAIS)).map((x) => x.def);
      // um único global entre tenants deixa A descobrir dado de B por colisão (e impede A de cadastrar)
      expect(globais).toEqual([]);
      // exceção que não casa mais com um único global é lista velha: sai da lista
      const usadas = new Set(semTenant.map((x) => x.indice));
      expect(Object.keys(INDICES_UNICOS_GLOBAIS).filter((n) => !usadas.has(n))).toEqual([]);
    });
  });

  describe('S0-028 o papel da aplicação não tem como contornar o RLS', () => {
    it('atributos: sem SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB, REPLICATION', async () => {
      const r = await admin.query('select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit from pg_roles where rolname = $1', [PAPEL]);
      expect(r.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false });
    });

    it('não herda papel privilegiado (pertença a papéis, recursiva)', async () => {
      const r = await admin.query<{ rolname: string }>(
        `with recursive acima(oid) as (
           select roleid from pg_auth_members where member = (select oid from pg_roles where rolname = $1)
           union select m.roleid from pg_auth_members m join acima on m.member = acima.oid)
         select r.rolname from acima join pg_roles r on r.oid = acima.oid
          where r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolname in ('pg_read_all_data', 'pg_write_all_data', 'pg_database_owner')`,
        [PAPEL],
      );
      expect(r.rows.map((x) => x.rolname)).toEqual([]);
    });

    it('não é dono de schema, tabela, view, sequência ou função dos schemas de domínio', async () => {
      const r = await admin.query<{ objeto: string }>(
        `select 'schema ' || nspname as objeto from pg_namespace where nspowner = (select oid from pg_roles where rolname = $1) and nspname = any($2)
         union all
         select 'rel ' || n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relowner = (select oid from pg_roles where rolname = $1) and n.nspname = any($2)
         union all
         select 'fn ' || n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where p.proowner = (select oid from pg_roles where rolname = $1) and n.nspname = any($2)`,
        [PAPEL, schemas],
      );
      expect(r.rows.map((x) => x.objeto)).toEqual([]);
    });

    it('sem TRUNCATE (ignora RLS), REFERENCES nem TRIGGER em nenhuma tabela; sem CREATE nos schemas', async () => {
      const problemas: string[] = [];
      for (const t of tabelas) {
        for (const priv of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          const r = await admin.query<{ tem: boolean }>('select has_table_privilege($1, $2, $3) as tem', [PAPEL, t.sql, priv]);
          if (r.rows[0]!.tem) problemas.push(`${priv} em ${t.nome}`);
        }
      }
      for (const s of [...schemas, 'public']) {
        const r = await admin.query<{ tem: boolean }>('select has_schema_privilege($1, $2, $3) as tem', [PAPEL, s, 'CREATE']);
        if (r.rows[0]!.tem) problemas.push(`CREATE no schema ${s}`);
      }
      expect(problemas).toEqual([]);
      const truncar = await tentar(app, A, () => app.query('truncate core.carteira'));
      expect(truncar.ok ? 'TRUNCATE passou!' : truncar.codigo).toBe('42501');
    });

    it.each([
      ['SET ROLE para o admin', 'set local role postgres'],
      ['SET SESSION AUTHORIZATION', 'set session authorization postgres'],
      ['desligar RLS da tabela', 'alter table core.usuario disable row level security'],
      ['tirar o FORCE', 'alter table core.usuario no force row level security'],
      ['trocar a política', 'alter policy isolamento_tenant on core.usuario using (true)'],
      ['criar política aberta', 'create policy aberta on core.usuario for select to macuxi_app using (true)'],
      ['redefinir tenant_atual()', "create or replace function plataforma.tenant_atual() returns uuid language sql as $$ select null::uuid $$"],
      ['criar view no schema', 'create view core.todos as select * from core.usuario'],
    ])('atalho negado: %s', async (_r, sql) => {
      const r = await tentar(app, A, () => app.query(sql));
      expect(r.ok ? `passou: ${sql}` : r.codigo).toBe('42501');
    });

    it('row_security = off não devolve tudo: a consulta afetada por política dá erro', async () => {
      const r = await tentar(app, A, async () => {
        await app.query('set local row_security = off');
        return (await app.query<{ n: number }>('select count(*)::int as n from core.usuario')).rows[0]!.n;
      });
      expect(r.ok ? `devolveu ${r.valor} linhas` : r.codigo).toBe('42501');
    });

    it('funções SECURITY DEFINER executáveis pelo papel: só as revisadas, com search_path fixo e sem EXECUTE para PUBLIC', async () => {
      conferirDefiner(await definerExecutaveis(admin, PAPEL, schemas), DEFINER_REVISADAS);
    });

    it('funções SECURITY DEFINER executáveis pelo worker (macuxi_worker): só as revisadas, com search_path fixo e sem EXECUTE para PUBLIC', async () => {
      conferirDefiner(await definerExecutaveis(admin, PAPEL_WORKER, schemas), DEFINER_REVISADAS_WORKER);
    });

    it('T-0091 funções SECURITY DEFINER executáveis pelo portal (macuxi_portal): só as sa_* revisadas, com search_path fixo e sem EXECUTE para PUBLIC', async () => {
      conferirDefiner(await definerExecutaveis(admin, PAPEL_PORTAL, schemas), DEFINER_REVISADAS_PORTAL);
    });

    it('T-0091 pelo catálogo: toda plataforma.sa_* tem EXECUTE só para o dono e o macuxi_portal (nem PUBLIC, nem app, nem worker); a interna, só o dono', async () => {
      const r = await admin.query<{ nome: string; assinatura: string; dono: string; grantees: string[] }>(
        `select p.proname as nome, p.oid::regprocedure::text as assinatura, pg_get_userbyid(p.proowner) as dono,
                coalesce((select array_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)
                            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE'), '{}')::text[] as grantees
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'plataforma' and starts_with(p.proname, 'sa_')
          order by 2`,
      );
      // o catálogo e a lista revisada têm o mesmo tamanho (sa_* nova sem revisão reprova aqui e no caso acima)
      expect(r.rows.filter((f) => !SA_INTERNAS.has(f.nome)).length).toBe(Object.keys(DEFINER_REVISADAS_PORTAL).length);
      const problemas: string[] = [];
      for (const f of r.rows) {
        const interna = SA_INTERNAS.has(f.nome);
        const esperados = interna ? [f.dono] : [f.dono, PAPEL_PORTAL].sort();
        if (JSON.stringify([...f.grantees].sort()) !== JSON.stringify(esperados)) problemas.push(`${f.assinatura}: EXECUTE para ${f.grantees.join(', ')}`);
        for (const papel of [PAPEL, PAPEL_WORKER, PAPEL_PORTAL]) {
          const t = await admin.query<{ tem: boolean }>(`select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as tem`, [papel, f.assinatura]);
          const deve = papel === PAPEL_PORTAL && !interna;
          if (t.rows[0]!.tem !== deve) problemas.push(`${f.assinatura}: ${papel} ${deve ? 'não executa' : 'executa'}`);
        }
      }
      expect(problemas).toEqual([]);
    });

    it('views legíveis pelo papel usam security_invoker (senão rodam como o dono e ignoram RLS); matviews não são legíveis', async () => {
      const r = await admin.query<{ nome: string; tipo: string; opcoes: string[] | null }>(
        `select n.nspname || '.' || c.relname as nome, c.relkind::text as tipo, c.reloptions as opcoes
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('v', 'm') and n.nspname = any($2) and has_table_privilege($1, c.oid, 'SELECT')`,
        [PAPEL, schemas],
      );
      const inseguras = r.rows.filter((v) => v.tipo === 'm' || !(v.opcoes ?? []).some((o) => /^security_invoker=(true|on|1)$/i.test(o)));
      expect(inseguras.map((v) => v.nome)).toEqual([]);
    });
  });

  describe('T-0091 o papel do portal (macuxi_portal) só chega às sa_*', () => {
    it('atributos: sem SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB, REPLICATION', async () => {
      const r = await admin.query('select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication from pg_roles where rolname = $1', [PAPEL_PORTAL]);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false });
    });

    it('não é membro de papel nenhum (nem do macuxi_manutencao, nem do macuxi_app)', async () => {
      const r = await admin.query<{ rolname: string }>(
        `select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid where m.member = (select oid from pg_roles where rolname = $1)`,
        [PAPEL_PORTAL],
      );
      expect(r.rows.map((x) => x.rolname)).toEqual([]);
    });

    it('não é dono de schema, tabela, view, sequência, função ou tipo', async () => {
      const r = await admin.query<{ objeto: string }>(
        `select 'schema ' || nspname as objeto from pg_namespace where nspowner = (select oid from pg_roles where rolname = $1)
         union all select 'rel ' || c.oid::regclass::text from pg_class c where c.relowner = (select oid from pg_roles where rolname = $1)
         union all select 'fn ' || p.oid::regprocedure::text from pg_proc p where p.proowner = (select oid from pg_roles where rolname = $1)
         union all select 'tipo ' || t.oid::regtype::text from pg_type t where t.typowner = (select oid from pg_roles where rolname = $1)`,
        [PAPEL_PORTAL],
      );
      expect(r.rows.map((x) => x.objeto)).toEqual([]);
    });

    it('nenhum grant de tabela, view, sequência ou coluna (catálogo e information_schema); nenhum privilégio efetivo em tabela', async () => {
      const acl = await admin.query<{ objeto: string }>(
        `select c.oid::regclass::text || ' ' || a.privilege_type as objeto
           from pg_class c cross join lateral aclexplode(c.relacl) a
          where a.grantee = (select oid from pg_roles where rolname = $1)
         union all
         select c.oid::regclass::text || '.' || t.attname || ' ' || a.privilege_type
           from pg_attribute t join pg_class c on c.oid = t.attrelid cross join lateral aclexplode(t.attacl) a
          where a.grantee = (select oid from pg_roles where rolname = $1)`,
        [PAPEL_PORTAL],
      );
      expect(acl.rows.map((x) => x.objeto)).toEqual([]);
      const rtg = await admin.query<{ n: number }>('select count(*)::int as n from information_schema.role_table_grants where grantee = $1', [PAPEL_PORTAL]);
      expect(rtg.rows[0]!.n).toBe(0);
      const efetivos: string[] = [];
      for (const t of tabelas) {
        const r = await admin.query<{ tem: boolean }>(
          `select has_table_privilege($1, $2, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as tem`,
          [PAPEL_PORTAL, t.sql],
        );
        if (r.rows[0]!.tem) efetivos.push(t.nome);
      }
      expect(efetivos).toEqual([]);
    });

    it('schemas: só USAGE no plataforma; nenhum CREATE (nem no public)', async () => {
      const problemas: string[] = [];
      for (const s of [...schemas, 'public']) {
        const r = await admin.query<{ uso: boolean; criar: boolean }>(
          `select has_schema_privilege($1, $2, 'USAGE') as uso, has_schema_privilege($1, $2, 'CREATE') as criar`,
          [PAPEL_PORTAL, s],
        );
        if (r.rows[0]!.criar) problemas.push(`CREATE no schema ${s}`);
        if (s !== 'public' && r.rows[0]!.uso !== (s === 'plataforma')) problemas.push(`USAGE no schema ${s}: ${r.rows[0]!.uso}`);
      }
      expect(problemas).toEqual([]);
    });

    it('diagnóstico S0-028 do @macuxi/db também aprova o papel (sem superusuário, sem ignorar RLS, sem tabela própria)', async () => {
      expect(await diagnosticarPapelApp(admin, PAPEL_PORTAL)).toEqual({ superusuario: false, ignoraRls: false, tabelasDeQueEDono: [] });
    });
  });

  describe('perfis do banco = PERFIS do @macuxi/platform-sdk', () => {
    it('platform-sdk tem os 7 perfis do doc 03 e não tem os nomes da Fase M', () => {
      expect([...PERFIS].sort()).toEqual(['admin', 'analista', 'assistente', 'gerente', 'promotor', 'supervisor', 'vendedor']);
      for (const faseM of ['manager', 'seller', 'analyst', 'bko_assistant']) expect(PERFIS as readonly string[]).not.toContain(faseM);
    });

    it.each([
      ['core.usuario', (perfil: string, i: number) => [`insert into core.usuario (tenant_id, nome, email, perfil) values ($1, 'Perfil', $2, $3)`, [A, `perfil-${i}@exemplo.com.br`, perfil]] as const],
      ['plataforma.perfil_modulo', (perfil: string, i: number) => [`insert into plataforma.perfil_modulo (tenant_id, perfil, modulo) values ($1, $2, $3)`, [A, perfil, `modulo-perfil-${i}`]] as const],
    ])('%s aceita cada perfil do platform-sdk e recusa os da Fase M (23514)', async (_t, montar) => {
      for (const [i, perfil] of PERFIS.entries()) {
        const [sql, params] = montar(perfil, i);
        const r = await tentar(app, A, () => app.query(sql, [...params]));
        expect(r.ok, `${perfil}: ${r.ok ? '' : r.mensagem}`).toBe(true);
      }
      for (const [i, perfil] of ['manager', 'seller', 'analyst', 'bko_assistant', 'Gerente', ''].entries()) {
        const [sql, params] = montar(perfil, 100 + i);
        const r = await tentar(app, A, () => app.query(sql, [...params]));
        expect(r.ok ? `aceitou ${perfil}` : r.codigo, perfil).toBe('23514');
      }
    });
  });
});
