/**
 * 0040 — estado da senha, versão da sessão e outbox de e-mail (T-0094 fatia B, ADR 0032; desenho docs/desenho/T-0094.md §2,
 * §7, §8.1, §9.1, §10 e §13; pedido R-20261107-175952-engenheiro-software; RN-CORE-32, RN-CORE-33, RN-CORE-34, RN-AUD-01).
 * O que o BANCO garante:
 * - core.usuario: trocar_senha, senha_expira_em, senha_temporaria_* e sessao_versao com padrões que não reescrevem linha; CHECKs
 *   recusam validade sem "trocar", temporária pela metade, temporária fora do argon2id e versão negativa;
 * - plataforma.email_saida: carga (cifrada) só no pendente; enviado e falhou se excluem; chave única por tenant e sem '@';
 *   macuxi_app só select e insert no próprio tenant (sem update nem delete); macuxi_worker lê todos os tenants e marca só a
 *   linha pendente, só nas colunas do despacho, sem delete; o macuxi_worker só tem política nas duas outboxes; macuxi_portal
 *   sem privilégio nenhum; fora do sync;
 * - portal: sa_contas_para_login devolve trocar_senha, senha_expira_em e sessao_versao, nunca o hash temporário;
 *   sa_abrir_sessao_portal recusa conta com senha a trocar e versão diferente da informada e grava a versão;
 *   sa_escolher_empresa e sa_sessao_valida caem com versão nova e com trocar_senha;
 * - provisionar_tenant (CLI e portal): admin inicial com trocar_senha e sem validade; redefinir sobe a versão e revoga refresh;
 * - anonimizar_usuario: limpa a temporária, sobe a versão e tira a carga dos e-mails pendentes; outro tenant intacto;
 * - up/down: os convites pendentes saem revogados; o down volta exatamente ao catálogo e às ACLs da 0039.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero). Nada roda em base real.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS, EMAILS_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC, TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { FUNCOES_SA } from './funcoes-sa';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m40 = migracoes.find((m) => m.versao === '0040')!;
const m39 = migracoes.find((m) => m.versao === '0039')!;
const m36 = migracoes.find((m) => m.versao === '0036')!;
const m35 = migracoes.find((m) => m.versao === '0035')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
/** Bloco de uma função até o "$$;" que fecha o corpo (plpgsql "$$;" ou sql "  $$;"). */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^ {0,2}\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};
const SA_0040 = [
  'plataforma.sa_contas_para_login(text)',
  'plataforma.sa_abrir_sessao_portal(jsonb)',
  'plataforma.sa_escolher_empresa(uuid, uuid)',
  'plataforma.sa_sessao_valida(uuid)',
] as const;
const CABECALHO: Record<(typeof SA_0040)[number], string> = {
  'plataforma.sa_contas_para_login(text)': 'create function plataforma.sa_contas_para_login(p_email text)',
  'plataforma.sa_abrir_sessao_portal(jsonb)': 'create function plataforma.sa_abrir_sessao_portal(p jsonb)',
  'plataforma.sa_escolher_empresa(uuid, uuid)': 'create function plataforma.sa_escolher_empresa(p_sid uuid, p_tenant uuid)',
  'plataforma.sa_sessao_valida(uuid)': 'create function plataforma.sa_sessao_valida(p_sid uuid)',
};

/** Dados de mentira (nunca de uma pessoa real); hashes no formato PHC, sem senha nenhuma por trás. */
const H2 = '$argon2id$v=19$m=1,t=1,p=1$b3V0cm8$b3V0cm9oYXNo';
const HT = '$argon2id$v=19$m=1,t=1,p=1$dGVtcG9yYXJpYQ$dGVtcG9yYXJpYWhhc2g';
const EMAIL_CLI = 'cliente.t94@exemplo.com.br';
const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const TODOS = ['admin', 'analista', 'assistente', 'supervisor', 'gerente', 'vendedor', 'promotor'];
const entradaEmpresa = (codigo: string, extra: Record<string, unknown> = {}) => ({
  codigo, nome: 'Distribuidora T94', documento: '12345678000195', fuso: 'America/Manaus', plano: 'piloto',
  modulos: [{ modulo: 'core', licencas: null, perfis: TODOS }],
  ...extra,
});

describe('0040 estado da senha e outbox de e-mail (estático)', () => {
  const sql = semComentarios(m40.up);

  it('nome e posição: 0040_core_senha_email_saida logo depois da 0039', () => {
    expect(m40.nome).toBe('core_senha_email_saida');
    expect(migracoes[39]?.versao).toBe('0040');
  });

  it('core.usuario: 6 colunas com padrões que não reescrevem linha e os 4 CHECKs', () => {
    expect(sql).toContain('alter table core.usuario add column trocar_senha boolean not null default false;');
    expect(sql).toContain('alter table core.usuario add column sessao_versao integer not null default 0;');
    for (const c of ['senha_expira_em timestamptz', 'senha_temporaria_hash text', 'senha_temporaria_expira_em timestamptz', 'senha_temporaria_criada_em timestamptz']) {
      expect(sql).toContain(`alter table core.usuario add column ${c};`);
    }
    expect(sql).toContain('check (senha_expira_em is null or trocar_senha)');
    expect(sql).toContain("check (senha_temporaria_hash is null or senha_temporaria_hash like '$argon2id$%')");
    expect(sql).toContain('check (sessao_versao >= 0)');
    expect(sql).toMatch(/usuario_senha_temporaria_completa check \(\s+\(senha_temporaria_hash is null\) = \(senha_temporaria_expira_em is null\)\s+and \(senha_temporaria_hash is null\) = \(senha_temporaria_criada_em is null\)\)/);
  });

  it('email_saida: tenant, FK composta, carga só no pendente, RLS forçado, app só select/insert, worker só despacho, portal nada; fora do sync', () => {
    const corpo = /create table plataforma\.email_saida \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? '';
    expect(corpo).toMatch(/^\s+tenant_id\s+uuid not null references plataforma\.tenant \(id\)/m);
    expect(corpo).toMatch(/^\s+carga\s+bytea,$/m);
    expect(corpo).toContain('foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id)');
    expect(corpo).toContain("check (modelo in ('acesso_inicial', 'nova_senha'))");
    expect(corpo).toContain('check (enviado_em is null or falhou_em is null)');
    expect(corpo).toContain('check ((enviado_em is null and falhou_em is null) = (carga is not null))');
    expect(corpo).not.toMatch(/^\s+(email|para|senha|nome)\s/m);
    expect(sql).toContain('create unique index email_saida_chave_uk on plataforma.email_saida (tenant_id, chave_idempotencia);');
    expect(sql).toContain('create index email_saida_pendente_ix on plataforma.email_saida (proxima_tentativa_em) where enviado_em is null and falhou_em is null;');
    expect(sql).toContain('alter table plataforma.email_saida force row level security;');
    expect([...sql.matchAll(/create policy ([a-z_]+) on plataforma\.email_saida for ([a-z]+) to ([a-z_]+)/g)].map((x) => `${x[1]} ${x[2]} ${x[3]}`)).toEqual([
      'isolamento_tenant all macuxi_app', 'manutencao all macuxi_manutencao', 'despacho_email select macuxi_worker', 'despacho_email_marcar update macuxi_worker',
    ]);
    expect(sql).toMatch(/create policy despacho_email_marcar on plataforma\.email_saida for update to macuxi_worker\s+using \(enviado_em is null and falhou_em is null\) with check \(true\);/);
    const grants = [...sql.matchAll(/^grant ([^;]+) on plataforma\.email_saida to ([a-z_]+);/gm)].map((g) => `${g[2]}: ${g[1]}`);
    expect(grants).toEqual([
      'macuxi_app: select, insert',
      'macuxi_worker: select',
      'macuxi_worker: update (carga, tentativas, proxima_tentativa_em, enviado_em, falhou_em, ultimo_erro)',
    ]);
    expect(sql).not.toMatch(/on plataforma\.email_saida to macuxi_portal/);
    expect(TABELAS_FORA_DO_SYNC as readonly string[]).toContain('plataforma.email_saida');
    expect('plataforma.email_saida' in TABELAS_SEM_TENANT_ID).toBe(false);
    expect(TABELAS_SO_POR_FUNCAO as readonly string[]).not.toContain('plataforma.email_saida');
  });

  it('as 4 sa_* do portal: drop + create SECURITY DEFINER, search_path fixo, EXECUTE só ao portal; nenhuma sa_* nova; conferência das 12', () => {
    for (const f of SA_0040) {
      expect(sql).toContain(`drop function if exists ${f};`);
      const b = bloco(sql, CABECALHO[f]);
      expect(b, f).toMatch(/language (plpgsql|sql) volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(sql).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(sql).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    const criadas = [...sql.matchAll(/create (?:or replace )?function (plataforma\.sa_[a-z_]+)\(/g)].map((x) => x[1]);
    expect(criadas.sort()).toEqual(SA_0040.map((f) => f.slice(0, f.indexOf('('))).sort());
    expect(SA_0040.every((f) => (FUNCOES_SA as readonly string[]).includes(f))).toBe(true);
    expect(sql).toContain('if v_n <> 12 then');
    expect(sql).not.toMatch(/grant execute [^;]* to macuxi_(app|worker);/);
    expect(sql).not.toMatch(/alter role|create role|bypassrls|\bsuperuser\b/i);
  });

  it('sa_contas_para_login devolve trocar_senha, senha_expira_em e sessao_versao e NUNCA o hash temporário', () => {
    const b = bloco(m40.up, CABECALHO['plataforma.sa_contas_para_login(text)']);
    expect(b).toMatch(/returns table \(tipo text, conta_id uuid, tenant_id uuid, tenant_codigo text, tenant_nome text, senha_hash text,\s+trocar_senha boolean, senha_expira_em timestamptz, sessao_versao integer\)/);
    expect(b).not.toContain('senha_temporaria');
  });

  it('provisionar_tenant: admin inicial com trocar_senha (P5); redefinir sobe a versão e revoga os refresh', () => {
    const b = bloco(sql, 'create function plataforma.provisionar_tenant(p jsonb)');
    expect(b).toContain("values (v_tenant, v_admin_nome, v_email, 'admin', true, v_hash, true);");
    expect(b).toMatch(/set senha_hash = v_hash, trocar_senha = true, senha_expira_em = null, senha_temporaria_hash = null,\s+senha_temporaria_expira_em = null, senha_temporaria_criada_em = null, sessao_versao = u\.sessao_versao \+ 1/);
    expect(b).toContain('update core.sessao s set revogado_em = now()');
    expect(sql).toContain('revoke all on function plataforma.provisionar_tenant(jsonb) from public;');
  });

  it('anonimizar_usuario: temporária, versão e carga dos e-mails pendentes; item novo logo depois do convite', () => {
    const b = bloco(sql, 'create or replace function plataforma.anonimizar_usuario(p_tenant uuid, p_usuario uuid)');
    expect(b).toContain('senha_temporaria_hash = null');
    expect(b).toContain('sessao_versao = u.sessao_versao + 1');
    expect(b).toContain("update plataforma.email_saida e set carga = null, falhou_em = now(), ultimo_erro = 'anonimizado'");
    expect(b.indexOf("item := 'plataforma.email_saida'")).toBeGreaterThan(b.indexOf("item := 'core.usuario_convite'"));
    expect(b.indexOf("item := 'plataforma.email_saida'")).toBeLessThan(b.indexOf("item := 'core.visita'"));
  });

  it('convites pendentes revogados (a tabela fica)', () => {
    expect(sql).toMatch(/update core\.usuario_convite c set revogado_em = now\(\)\s+where c\.usado_em is null and c\.revogado_em is null and c\.deleted_at is null;/);
    expect(sql).not.toMatch(/drop table/);
  });

  it('down: as 4 sa_* com o texto EXATO da 0039, a provisionar_tenant da 0035 e a anonimizar_usuario da 0036; apaga tabela e colunas', () => {
    const down = m40.down;
    for (const f of SA_0040) {
      const b = bloco(m39.up, CABECALHO[f]);
      expect(b, f).not.toBe('');
      expect(down, f).toContain(b);
      expect(down).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    const prov = bloco(m35.up, 'create function plataforma.provisionar_tenant(p jsonb)');
    expect(prov).not.toBe('');
    expect(down).toContain(prov);
    const anon = bloco(m36.up, 'create or replace function plataforma.anonimizar_usuario(p_tenant uuid, p_usuario uuid)');
    expect(anon).not.toBe('');
    expect(down).toContain(anon);
    expect(down).toContain('drop table if exists plataforma.email_saida;');
    expect(down).toContain('alter table plataforma.portal_sessao_empresa drop column if exists sessao_versao;');
    for (const c of ['trocar_senha', 'senha_expira_em', 'senha_temporaria_hash', 'senha_temporaria_expira_em', 'senha_temporaria_criada_em', 'sessao_versao']) {
      expect(down).toContain(`alter table core.usuario drop column if exists ${c};`);
    }
    // as funções voltam antes de as colunas saírem
    expect(down.indexOf('create function plataforma.sa_sessao_valida')).toBeLessThan(down.indexOf('drop table if exists plataforma.email_saida;'));
    expect(down).not.toMatch(/to macuxi_(app|worker)\b/);
  });
});

describe.skipIf(semBanco())('0040 estado da senha e outbox de e-mail (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  /** Roda como o papel dado (e no contexto do tenant, se vier) dentro da transação aberta; um erro não aborta o caso. */
  async function como<T extends pg.QueryResultRow = Record<string, unknown>>(papel: string, sql: string, params: unknown[] = [], tenant: string | null = null) {
    await admin.query('savepoint como');
    try {
      await admin.query(`set local role ${papel}`);
      await admin.query("select set_config('app.tenant_id', $1, true)", [tenant ?? '']);
      const r = await admin.query<T>(sql, params);
      await admin.query('reset role');
      await admin.query('release savepoint como');
      return r;
    } catch (e) {
      await admin.query('rollback to savepoint como');
      throw e;
    }
  }
  /** macuxi_app no contexto do tenant (A por padrão; null = sem contexto) e macuxi_worker (sem contexto). */
  const app = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = [], tenant: string | null = A) => como<T>('macuxi_app', sql, params, tenant);
  const worker = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => como<T>('macuxi_worker', sql, params);
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  /** Erro de um comando do admin sem abortar a transação do caso. */
  async function erroAdmin(sql: string, params: unknown[] = []) {
    await admin.query('savepoint e');
    const erro = await erroDe(admin.query(sql, params));
    await admin.query(erro ? 'rollback to savepoint e' : 'release savepoint e');
    return erro;
  }
  const carga = Buffer.from('texto-cifrado-de-mentira');
  const pendente = (tenant: string, usuario: string, chave: string) =>
    q<{ id: string }>("insert into plataforma.email_saida (tenant_id, usuario_id, modelo, chave_idempotencia, carga) values ($1, $2, 'nova_senha', $3, $4) returning id", [tenant, usuario, chave, carga]);

  it('core.usuario: padrões nos usuários existentes; CHECKs recusam as combinações inválidas', async () => {
    await emTransacao(admin, null, async () => {
      expect(await q('select count(*)::int as n from core.usuario where trocar_senha or senha_expira_em is not null or senha_temporaria_hash is not null or sessao_versao <> 0'))
        .toEqual([{ n: 0 }]);
      const u = DOIS_TENANTS.A.usuarios.vendedor1;
      for (const [caso, set] of [
        ['validade sem trocar', "senha_expira_em = now() + interval '72 hours'"],
        ['temporária sem validade', `senha_temporaria_hash = '${HT}', senha_temporaria_criada_em = now()`],
        ['temporária sem criada_em', `senha_temporaria_hash = '${HT}', senha_temporaria_expira_em = now()`],
        ['validade da temporária sozinha', 'senha_temporaria_expira_em = now()'],
        ['temporária fora do argon2id', "senha_temporaria_hash = 'senha-em-claro', senha_temporaria_expira_em = now(), senha_temporaria_criada_em = now()"],
        ['versão negativa', 'sessao_versao = -1'],
        ['trocar nulo', 'trocar_senha = null'],
      ] as const) {
        expect((await erroAdmin(`update core.usuario set ${set} where id = $1`, [u]))?.code, caso).toMatch(/^(23514|23502)$/);
      }
      // válidas: temporária de 72 h com "trocar"; temporária paralela completa; versão alta
      expect(await erroAdmin("update core.usuario set trocar_senha = true, senha_expira_em = now() + interval '72 hours' where id = $1", [u])).toBeNull();
      expect(await erroAdmin("update core.usuario set trocar_senha = true, senha_expira_em = null where id = $1", [u])).toBeNull();
      expect(await erroAdmin(`update core.usuario set senha_temporaria_hash = '${HT}', senha_temporaria_expira_em = now() + interval '72 hours', senha_temporaria_criada_em = now(), sessao_versao = 7 where id = $1`, [u])).toBeNull();
    });
  });

  it('email_saida: CHECKs (carga só no pendente, enviado x falhou, modelo, chave sem @, código do erro) e FK do usuário do mesmo tenant', async () => {
    await emTransacao(admin, null, async () => {
      const uA = DOIS_TENANTS.A.usuarios.vendedor1;
      const ins = (campos: string, valores: string, params: unknown[]) =>
        erroAdmin(`insert into plataforma.email_saida (tenant_id, usuario_id, modelo, chave_idempotencia${campos}) values ($1, $2, $3, $4${valores})`, params);
      expect((await ins('', '', [A, uA, 'nova_senha', 'k1']))?.code, 'pendente sem carga').toBe('23514');
      expect((await ins(', carga, enviado_em', ', $5, now()', [A, uA, 'nova_senha', 'k2', carga]))?.code, 'enviado com carga').toBe('23514');
      expect((await ins(', enviado_em, falhou_em', ', now(), now()', [A, uA, 'nova_senha', 'k3']))?.code, 'enviado e falhou').toBe('23514');
      expect((await ins(', carga', ', $5', [A, uA, 'boas_vindas', 'k4', carga]))?.code, 'modelo').toBe('23514');
      expect((await ins(', carga', ', $5', [A, uA, 'nova_senha', 'pessoa@exemplo.com.br', carga]))?.code, 'chave com e-mail').toBe('23514');
      expect((await ins(', carga', ', $5', [A, uA, 'nova_senha', 'k5', Buffer.alloc(0)]))?.code, 'carga vazia').toBe('23514');
      expect((await ins(', falhou_em, ultimo_erro', ", now(), '550 caixa cheia de pessoa@exemplo.com.br'", [A, uA, 'nova_senha', 'k6']))?.code, 'texto no erro').toBe('23514');
      expect((await ins(', carga', ', $5', [B, uA, 'nova_senha', 'k7', carga]))?.code, 'usuário de A em B').toBe('23503');
      // válidos: pendente com carga e padrões (tentativas 0, próxima já, expira em 72 h); enviado e falhou sem carga
      const [p] = await pendente(A, uA, `${uA}:1`);
      expect(await q<{ ok: boolean }>("select tentativas = 0 and proxima_tentativa_em = now() and expira_em = now() + interval '72 hours' as ok from plataforma.email_saida where id = $1", [p!.id])).toEqual([{ ok: true }]);
      expect(await ins(', enviado_em', ', now()', [A, uA, 'acesso_inicial', 'k8'])).toBeNull();
      expect(await ins(", falhou_em, ultimo_erro", ", now(), 'smtp_550'", [A, uA, 'acesso_inicial', 'k9'])).toBeNull();
      // a mesma chave no mesmo tenant: único (a API usa on conflict do nothing); em B pode
      expect((await erroAdmin("insert into plataforma.email_saida (tenant_id, usuario_id, modelo, chave_idempotencia, carga) values ($1, $2, 'nova_senha', $3, $4)", [A, uA, `${uA}:1`, carga]))?.code).toBe('23505');
      expect(await erroAdmin("insert into plataforma.email_saida (tenant_id, usuario_id, modelo, chave_idempotencia, carga) values ($1, $2, 'nova_senha', $3, $4)", [B, DOIS_TENANTS.B.usuarios.vendedor, `${uA}:1`, carga])).toBeNull();
    });
  });

  it('macuxi_app: insere e lê só no próprio tenant (on conflict do nothing não duplica); update e delete = 42501; sem contexto 0 linhas', async () => {
    await emTransacao(admin, null, async () => {
      const uA = DOIS_TENANTS.A.usuarios.vendedor1;
      const inserir = (tenant: string, usuario: string, chave: string) =>
        app("insert into plataforma.email_saida (tenant_id, usuario_id, modelo, chave_idempotencia, carga) values ($1, $2, 'acesso_inicial', $3, $4) on conflict do nothing", [tenant, usuario, chave, carga], A);
      expect((await inserir(A, uA, `${uA}:app`)).rowCount).toBe(1);
      expect((await inserir(A, uA, `${uA}:app`)).rowCount).toBe(0);
      expect((await erroDe(inserir(B, DOIS_TENANTS.B.usuarios.vendedor, 'k-b')))?.code).toBe('42501');
      const vistos = (await app<{ tenant_id: string }>('select tenant_id from plataforma.email_saida', [], A)).rows;
      expect(vistos.length).toBeGreaterThanOrEqual(3);
      expect(new Set(vistos.map((x) => x.tenant_id))).toEqual(new Set([A]));
      expect((await app('select 1 from plataforma.email_saida where id = $1', [EMAILS_FIXTURE.B.enviado], A)).rowCount).toBe(0);
      expect((await app('select 1 from plataforma.email_saida', [], null)).rowCount).toBe(0);
      for (const sql of ['update plataforma.email_saida set tentativas = tentativas + 1', 'update plataforma.email_saida set carga = null', 'delete from plataforma.email_saida']) {
        expect((await erroDe(app(sql, [], A)))?.code, sql).toBe('42501');
      }
    });
  });

  it('macuxi_worker: lê A e B sem contexto; marca só a linha pendente e só as colunas do despacho; sem insert e sem delete', async () => {
    await emTransacao(admin, null, async () => {
      const [pA] = await pendente(A, DOIS_TENANTS.A.usuarios.vendedor1, 'w-a');
      const [pB] = await pendente(B, DOIS_TENANTS.B.usuarios.vendedor, 'w-b');
      const lote = (await worker<{ id: string }>(
        'select id from plataforma.email_saida where enviado_em is null and falhou_em is null order by proxima_tentativa_em for update skip locked')).rows.map((x) => x.id);
      expect(lote.sort()).toEqual([pA!.id, pB!.id].sort());
      expect((await worker('select id from plataforma.email_saida')).rowCount).toBeGreaterThanOrEqual(5);
      // envio: grava enviado_em e zera a carga; falha: tentativas e próxima tentativa
      expect((await worker('update plataforma.email_saida set enviado_em = now(), carga = null where id = $1', [pA!.id])).rowCount).toBe(1);
      expect((await worker("update plataforma.email_saida set tentativas = tentativas + 1, proxima_tentativa_em = now() + interval '1 minute', ultimo_erro = 'smtp_timeout' where id = $1", [pB!.id])).rowCount).toBe(1);
      // linha já despachada (da fixture e a que acabou de sair) não muda mais
      for (const id of [pA!.id, EMAILS_FIXTURE.A.falhou, EMAILS_FIXTURE.B.enviado]) {
        expect((await worker('update plataforma.email_saida set tentativas = tentativas + 1 where id = $1', [id])).rowCount, id).toBe(0);
      }
      for (const sql of [
        `update plataforma.email_saida set tenant_id = '${A}' where id = '${pB!.id}'`,
        `update plataforma.email_saida set usuario_id = usuario_id where id = '${pB!.id}'`,
        `update plataforma.email_saida set chave_idempotencia = 'x' where id = '${pB!.id}'`,
        'delete from plataforma.email_saida',
        `insert into plataforma.email_saida (tenant_id, usuario_id, modelo, chave_idempotencia, enviado_em) values ('${A}', '${DOIS_TENANTS.A.usuarios.vendedor1}', 'nova_senha', 'w-x', now())`,
      ]) {
        expect((await erroDe(worker(sql)))?.code, sql).toBe('42501');
      }
      // a carga zerou no envio
      expect(await q('select carga, enviado_em is not null as enviado from plataforma.email_saida where id = $1', [pA!.id])).toEqual([{ carga: null, enviado: true }]);
    });
  });

  it('macuxi_worker só tem política nas duas outboxes e no diagnóstico (alerta e expurgo, 0058/T-0158); macuxi_portal sem privilégio na outbox de e-mail', async () => {
    const r = await q<{ t: string }>(
      `select distinct n.nspname || '.' || c.relname as t
         from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
         join pg_roles r on r.oid = any (p.polroles)
        where r.rolname = 'macuxi_worker' order by 1`);
    // 0058 (T-0158): diagnostico_alerta/diagnostico_alerta_marcar dão ao worker a leitura por coluna (sem descricao/detalhe) e a marcação do alerta
    expect(r.map((x) => x.t)).toEqual(['plataforma.diagnostico', 'plataforma.email_saida', 'plataforma.evento']);
    await emTransacao(admin, null, async () => {
      for (const sql of ['select 1 from plataforma.email_saida', 'delete from plataforma.email_saida', `insert into plataforma.email_saida (tenant_id, usuario_id, modelo, chave_idempotencia, enviado_em) values ('${A}', '${DOIS_TENANTS.A.usuarios.vendedor1}', 'nova_senha', 'p-x', now())`]) {
        expect((await erroDe(como('macuxi_portal', sql)))?.code, sql).toBe('42501');
      }
    });
    const priv = await q<{ p: boolean }>("select has_table_privilege('macuxi_portal', 'plataforma.email_saida', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as p");
    expect(priv).toEqual([{ p: false }]);
  });

  describe('portal', () => {
    const portal = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => como<T>('macuxi_portal', sql, params).then((r) => r.rows);
    const usuario = async (tenant: string, email: string) =>
      (await q<{ id: string }>("insert into core.usuario (tenant_id, nome, email, perfil, ativo, senha_hash) values ($1, 'Admin T94', $2, 'admin', true, $3) returning id", [tenant, email, H2]))[0]!.id;
    const contas = (email: string) => portal<Record<string, unknown>>('select * from plataforma.sa_contas_para_login($1)', [email]);
    const abrir = async (p: unknown) => (await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)]))[0];
    const valida = (sid: string) => portal('select * from plataforma.sa_sessao_valida($1)', [sid]);
    const escolher = (sid: string, t: string) => portal('select * from plataforma.sa_escolher_empresa($1, $2)', [sid, t]);

    it('sa_contas_para_login: trocar_senha, senha_expira_em e sessao_versao; nunca o hash temporário', async () => {
      await emTransacao(admin, null, async () => {
        const uA = await usuario(A, EMAIL_CLI);
        await q(`update core.usuario set trocar_senha = true, senha_expira_em = now() + interval '72 hours', sessao_versao = 4,
                   senha_temporaria_hash = $2, senha_temporaria_expira_em = now() + interval '72 hours', senha_temporaria_criada_em = now() where id = $1`, [uA, HT]);
        const r = await contas(EMAIL_CLI);
        expect(r).toHaveLength(1);
        expect(Object.keys(r[0]!)).toEqual(['tipo', 'conta_id', 'tenant_id', 'tenant_codigo', 'tenant_nome', 'senha_hash', 'trocar_senha', 'senha_expira_em', 'sessao_versao']);
        expect(r[0]).toMatchObject({ conta_id: uA, senha_hash: H2, trocar_senha: true, sessao_versao: 4 });
        expect(r[0]!.senha_expira_em).toBeInstanceOf(Date);
        expect(JSON.stringify(r)).not.toContain(HT);
      });
    });

    it('sa_abrir_sessao_portal: conta com senha a trocar não entra; versão informada diferente = sem sessão; grava a versão de agora; sessao_versao inválida = 22023', async () => {
      await emTransacao(admin, null, async () => {
        const uA = await usuario(A, EMAIL_CLI);
        const uB = await usuario(B, EMAIL_CLI);
        await q('update core.usuario set sessao_versao = 3 where id = $1', [uA]);
        await q('update core.usuario set trocar_senha = true where id = $1', [uB]);
        expect(await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: B, usuario_id: uB }] })).toBeUndefined();
        expect(await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: uA }, { tenant_id: B, usuario_id: uB }] })).toBeUndefined();
        expect(await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: uA, sessao_versao: 2 }] })).toBeUndefined();
        const s = (await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: uA, sessao_versao: 3 }] }))!;
        expect(s.sessao_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(await q('select sessao_versao from plataforma.portal_sessao_empresa where sessao_id = $1', [s.sessao_id])).toEqual([{ sessao_versao: 3 }]);
        const s2 = (await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: uA }] }))!;
        expect(await q('select sessao_versao from plataforma.portal_sessao_empresa where sessao_id = $1', [s2.sessao_id])).toEqual([{ sessao_versao: 3 }]);
        for (const v of [-1, '3', 1.5, true]) {
          expect((await erroDe(abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: uA, sessao_versao: v }] })))?.code, String(v)).toBe('22023');
        }
      });
    });

    it('sessão do admin do cliente cai com a versão nova e com trocar_senha (de qualquer conta conferida); escolher também recusa', async () => {
      await emTransacao(admin, null, async () => {
        const uA = await usuario(A, EMAIL_CLI);
        const uB = await usuario(B, EMAIL_CLI);
        for (const [caso, sql] of [
          ['versão nova na empresa atual', 'update core.usuario set sessao_versao = sessao_versao + 1 where id = $1'],
          ['trocar_senha na empresa atual', 'update core.usuario set trocar_senha = true where id = $1'],
        ] as const) {
          await admin.query('savepoint caso');
          const s = (await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: uA }] }))!;
          expect(await valida(s.sessao_id), caso).toHaveLength(1);
          await q(sql, [uA]);
          expect(await valida(s.sessao_id), caso).toEqual([]);
          expect(await escolher(s.sessao_id, A), caso).toEqual([]);
          await admin.query('rollback to savepoint caso');
        }
        // duas empresas, nenhuma escolhida: a troca em B derruba a sessão inteira (e a escolha de A e de B)
        const s = (await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: uA }, { tenant_id: B, usuario_id: uB }] }))!;
        expect(await valida(s.sessao_id)).toHaveLength(1);
        await q('update core.usuario set sessao_versao = sessao_versao + 1 where id = $1', [uB]);
        expect(await valida(s.sessao_id)).toEqual([]);
        expect(await escolher(s.sessao_id, A)).toEqual([]);
        expect(await escolher(s.sessao_id, B)).toEqual([]);
        // a sessão do super-admin não depende de conta de tenant
        const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.t94@macuxi.exemplo', nome: 'Operador T94', senha_hash: H2 })]))[0]!.r;
        const ss = (await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }))!;
        expect(await valida(ss.sessao_id)).toHaveLength(1);
      });
    });

    it('sa_provisionar_tenant e provisionar_tenant: admin inicial com trocar_senha e sem validade; não entra no portal até trocar; redefinir sobe a versão e revoga refresh', async () => {
      await emTransacao(admin, null, async () => {
        const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.t94@macuxi.exemplo', nome: 'Operador T94', senha_hash: H2 })]))[0]!.r;
        const ss = (await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }))!;
        const adm = { email: EMAIL_CLI, nome: 'Admin Novo T94', senha_hash: H2 };
        const r1 = (await portal<{ r: { tenant_id: string; admin: string } }>('select plataforma.sa_provisionar_tenant($1, $2::jsonb) as r', [ss.sessao_id, JSON.stringify(entradaEmpresa('t94-portal', { admin: adm }))]))[0]!.r;
        expect(r1.admin).toBe('criado');
        expect(await q('select trocar_senha, senha_expira_em, sessao_versao from core.usuario where tenant_id = $1', [r1.tenant_id]))
          .toEqual([{ trocar_senha: true, senha_expira_em: null, sessao_versao: 0 }]);
        const [conta] = await contas(EMAIL_CLI);
        expect(conta).toMatchObject({ tenant_id: r1.tenant_id, trocar_senha: true, senha_expira_em: null });
        expect(await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: r1.tenant_id, usuario_id: conta!.conta_id }] })).toBeUndefined();

        // CLI (conexão de administração): criar e depois redefinir a senha
        const r2 = (await q<{ r: { tenant_id: string; admin: string } }>('select plataforma.provisionar_tenant($1::jsonb) as r', [JSON.stringify(entradaEmpresa('t94-cli', { admin: { ...adm, email: 'outro.t94@exemplo.com.br' } }))]))[0]!.r;
        expect(r2.admin).toBe('criado');
        const [u] = await q<{ id: string; trocar_senha: boolean; senha_expira_em: Date | null }>('select id, trocar_senha, senha_expira_em from core.usuario where tenant_id = $1', [r2.tenant_id]);
        expect(u).toMatchObject({ trocar_senha: true, senha_expira_em: null });
        // o admin trocou a senha (como faz o Core) e tem uma temporária paralela e um refresh vivo
        await q(`update core.usuario set trocar_senha = false, senha_temporaria_hash = $2, senha_temporaria_expira_em = now() + interval '72 hours',
                   senha_temporaria_criada_em = now(), sessao_versao = 1 where id = $1`, [u!.id, HT]);
        await q("insert into core.sessao (tenant_id, usuario_id, familia_id, token_hash, expira_em) values ($1, $2, gen_random_uuid(), repeat('c', 64), now() + interval '30 days')", [r2.tenant_id, u!.id]);
        const r3 = (await q<{ r: { admin: string } }>('select plataforma.provisionar_tenant($1::jsonb) as r', [JSON.stringify(entradaEmpresa('t94-cli', { admin: { ...adm, email: 'outro.t94@exemplo.com.br', senha_hash: HT }, redefinir_senha: true }))]))[0]!.r;
        expect(r3.admin).toBe('senha_redefinida');
        expect(await q('select senha_hash, trocar_senha, senha_expira_em, senha_temporaria_hash, sessao_versao from core.usuario where id = $1', [u!.id]))
          .toEqual([{ senha_hash: HT, trocar_senha: true, senha_expira_em: null, senha_temporaria_hash: null, sessao_versao: 2 }]);
        expect(await q('select count(*)::int as n from core.sessao where usuario_id = $1 and revogado_em is null', [u!.id])).toEqual([{ n: 0 }]);
      });
    });
  });

  it('anonimizar_usuario: limpa a temporária, sobe a versão e tira a carga dos pendentes do titular; enviados e o outro tenant intactos', async () => {
    await emTransacao(admin, null, async () => {
      const u = DOIS_TENANTS.A.usuarios.vendedor1;
      await q(`update core.usuario set trocar_senha = true, senha_expira_em = now() + interval '72 hours', senha_temporaria_hash = $2,
                 senha_temporaria_expira_em = now() + interval '72 hours', senha_temporaria_criada_em = now(), sessao_versao = 5 where id = $1`, [u, HT]);
      const [p] = await pendente(A, u, 'anon-1');
      const [outro] = await pendente(A, DOIS_TENANTS.A.usuarios.vendedor2, 'anon-2');
      const [deB] = await pendente(B, DOIS_TENANTS.B.usuarios.vendedor, 'anon-3');
      const r = await q<{ item: string; quantidade: string }>('select item, quantidade from plataforma.anonimizar_usuario($1, $2)', [A, u]);
      const itens = r.map((x) => x.item);
      expect(itens.indexOf('plataforma.email_saida')).toBe(itens.indexOf('core.usuario_convite') + 1);
      expect(Number(r.find((x) => x.item === 'plataforma.email_saida')!.quantidade)).toBe(1);
      expect(await q('select senha_hash, trocar_senha, senha_expira_em, senha_temporaria_hash, senha_temporaria_expira_em, senha_temporaria_criada_em, sessao_versao from core.usuario where id = $1', [u]))
        .toEqual([{ senha_hash: null, trocar_senha: false, senha_expira_em: null, senha_temporaria_hash: null, senha_temporaria_expira_em: null, senha_temporaria_criada_em: null, sessao_versao: 6 }]);
      const linha = (await q<{ carga: Buffer | null; falhou: boolean; ultimo_erro: string | null }>('select carga, falhou_em is not null as falhou, ultimo_erro from plataforma.email_saida where id = $1', [p!.id]))[0];
      expect(linha).toEqual({ carga: null, falhou: true, ultimo_erro: 'anonimizado' });
      // o já enviado do titular (fixture) não muda; o de outra pessoa e o de B seguem pendentes com a carga
      expect(await q('select enviado_em is not null as enviado, falhou_em, ultimo_erro from plataforma.email_saida where id = $1', [EMAILS_FIXTURE.A.enviado])).toEqual([{ enviado: true, falhou_em: null, ultimo_erro: null }]);
      for (const id of [outro!.id, deB!.id]) {
        expect(await q('select carga is not null as tem, falhou_em from plataforma.email_saida where id = $1', [id])).toEqual([{ tem: true, falhou_em: null }]);
      }
    });
  });
});

/** ACLs (fora o dono) das funções do schema plataforma. */
async function retratoAcl(c: pg.ClientBase): Promise<string[]> {
  const r = await c.query<{ l: string }>(
    `select 'fn ' || p.oid::regprocedure::text || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type as l
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname = 'plataforma' and a.grantee <> p.proowner
      order by 1`,
  );
  return r.rows.map((x) => x.l);
}

describe.skipIf(semBanco())('0040 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000040';
  const U = 'cccccccc-0040-4000-8000-000000000001';
  const V = 'cccccccc-0040-4000-8000-000000000002';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('usuário anterior com os padrões; convite pendente revogado (o usado fica); down volta exatamente ao catálogo e às ACLs da 0039; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0039' });
      const catalogo = await retratoDoCatalogo(c);
      const acl = await retratoAcl(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo40', 'Antigo')", [T]);
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash) values ($1, $2, 'Pessoa', 'pessoa@exemplo.com.br', 'vendedor', $3), ($4, $2, 'Outra', 'outra@exemplo.com.br', 'vendedor', $3)", [U, T, H2, V]);
      await c.query("insert into core.usuario_convite (tenant_id, usuario_id, token_hash, expira_em) values ($1, $2, repeat('a', 64), now() + interval '7 days')", [T, U]);
      await c.query("insert into core.usuario_convite (tenant_id, usuario_id, token_hash, expira_em, usado_em) values ($1, $2, repeat('b', 64), now() + interval '7 days', now())", [T, V]);
      const linha = () => c.query('select id, nome, email, perfil, senha_hash, updated_at from core.usuario where id = $1', [U]).then((r) => r.rows[0]);
      const linhaAntes = await linha();

      expect((await migrarUp(c, { ate: '0040' })).aplicadas).toEqual(['0040_core_senha_email_saida']);
      const depois = await retratoDoCatalogo(c);
      const aclDepois = await retratoAcl(c);
      expect(depois).toEqual(expect.arrayContaining([
        'col core.usuario.trocar_senha boolean nn=true', 'col core.usuario.sessao_versao integer nn=true',
        'col plataforma.email_saida.carga bytea nn=false', 'col plataforma.portal_sessao_empresa.sessao_versao integer nn=true',
        expect.stringMatching(/^rel plataforma\.email_saida r rls=true force=true$/),
      ]));
      expect(await linha()).toEqual(linhaAntes);
      expect((await c.query('select trocar_senha, senha_expira_em, sessao_versao from core.usuario where id = $1', [U])).rows).toEqual([{ trocar_senha: false, senha_expira_em: null, sessao_versao: 0 }]);
      const convites = (await c.query<{ usuario_id: string; revogado: boolean; usado: boolean }>('select usuario_id, revogado_em is not null as revogado, usado_em is not null as usado from core.usuario_convite where tenant_id = $1 order by usuario_id', [T])).rows;
      expect(convites).toEqual([{ usuario_id: U, revogado: true, usado: false }, { usuario_id: V, revogado: false, usado: true }]);
      expect(aclDepois.filter((l) => / macuxi_portal /.test(l))).toHaveLength(FUNCOES_SA.length);
      expect(aclDepois.filter((l) => / (macuxi_app|macuxi_worker|PUBLIC) /.test(l) && /^fn plataforma\.(sa_|criar_super_admin)/.test(l))).toEqual([]);
      // com dados na outbox e na sessão do portal: o down apaga e volta ao catálogo
      await c.query("insert into plataforma.email_saida (tenant_id, usuario_id, modelo, chave_idempotencia, carga) values ($1, $2, 'acesso_inicial', 'ud-1', '\\x01'::bytea)", [T, U]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0040_core_senha_email_saida']);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      expect(await retratoAcl(c)).toEqual(acl);
      expect(await linha()).toEqual(linhaAntes);
      await c.query(m40.down);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      expect(await retratoAcl(c)).toEqual(acl);

      await migrarUp(c, { ate: '0040' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect(await retratoAcl(c)).toEqual(aclDepois);
    });
  });
});
