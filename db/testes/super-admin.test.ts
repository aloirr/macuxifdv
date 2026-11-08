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
 * Desde a 0039 (T-0093, ADR 0031) o 1º acesso, o TOTP, o desafio e o bloqueio por conta SAEM: o que vale no banco migrado até
 * a última (tabelas só por função, auditoria append-only, provisionar_tenant, retenção) fica aqui, com o super-admin criado pela
 * criar_super_admin; as funções novas estão em portal-email-senha.test.ts. As 20 da 0035 continuam provadas no banco efêmero
 * parado na 0035 (abaixo) e, depois do down da 0039, em portal-email-senha.test.ts.
 * Banco: fixture dois-tenants (migrada até a última: as sa_* rodam como macuxi_portal), sempre com ROLLBACK (admin, com SET
 * ROLE para o papel testado); up/down e a corrida do primeiro acesso num banco efêmero parado na 0035 (lá, como macuxi_app).
 * Nada roda em base real.
 */
import { MODULOS } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { FUNCOES_SA_0035 } from './funcoes-sa';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m35 = migracoes.find((m) => m.versao === '0035')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
/** As 4 tabelas criadas pela 0035 (a 0039 acrescenta as do portal a TABELAS_SO_POR_FUNCAO). */
const TABELAS_0035 = ['plataforma.super_admin', 'plataforma.super_admin_desafio', 'plataforma.super_admin_sessao', 'plataforma.auditoria_plataforma'] as const;

/** Dados de mentira (nunca de uma pessoa real). */
const EMAIL = 'operador.t87@macuxi.exemplo';
const NOME = 'Operador T87';
const H1 = '$argon2id$v=19$m=1,t=1,p=1$c2FsdW0$aGFzaHVt';
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
    expect(definers.map((x) => x[1]).sort()).toEqual(FUNCOES_SA_0035.map((f) => f.slice(0, f.indexOf('('))).sort());
    for (const x of definers) expect(x[2], x[1]).toBe('pg_catalog, plataforma, pg_temp');
    for (const f of FUNCOES_SA_0035) {
      expect(sql).toContain(`revoke all on function ${f} from public;`);
      expect(sql).toContain(`grant execute on function ${f} to macuxi_app;`);
      expect(m35.down).toContain(`drop function if exists ${f};`);
    }
    expect([...sql.matchAll(/grant execute on function ([^;]+) to macuxi_app;/g)].map((x) => x[1]).sort()).toEqual([...FUNCOES_SA_0035].sort());
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
    for (const t of TABELAS_0035) {
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
    for (const t of TABELAS_0035) expect(m35.down).toContain(`drop table if exists ${t};`);
    expect(m35.down).toContain('drop function if exists plataforma.sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb);');
    expect(m35.down).toContain('drop function if exists plataforma.auditoria_plataforma_recusar();');
  });
});

describe.skipIf(semBanco())('0035 super-admin (banco, fixture dois-tenants, depois da 0039)', () => {
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
  /** Como o portal: desde a 0038 (T-0091) o único papel com EXECUTE nas sa_*. */
  const portal = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => como<T>('macuxi_portal', sql, params);
  const um = async <T>(sql: string, params: unknown[] = []): Promise<T> => ((await portal<{ r: T }>(`select ${sql} as r`, params))[0]!).r;

  /**
   * Super-admin criado como o deploy faz desde a 0039 (plataforma.criar_super_admin, conexão de administração) e uma sessão
   * aberta pelo portal (sa_abrir_sessao_portal). As funções do 1º acesso, do TOTP e do desafio saíram na 0039
   * (portal-email-senha.test.ts testa as novas; o down da 0039 as recria).
   */
  async function prontoComSessao(): Promise<{ id: string; sid: string }> {
    const r = (await admin.query<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [
      JSON.stringify({ acao: 'criar', email: EMAIL, nome: NOME, senha_hash: H1 }),
    ])).rows[0]!.r;
    const [s] = await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [
      JSON.stringify({ tipo: 'super_admin', super_admin_id: r.super_admin_id }),
    ]);
    return { id: r.super_admin_id, sid: s!.sessao_id };
  }
  const auditoria = async () =>
    (await admin.query<{ acao: string; super_admin_id: string | null; sessao_id: string | null; tenant_alvo_id: string | null; detalhes: unknown }>(
      'select acao, super_admin_id, sessao_id, tenant_alvo_id, detalhes from plataforma.auditoria_plataforma order by ocorrido_em, acao',
    )).rows;

  it('macuxi_app e macuxi_worker não leem nem gravam direto nas tabelas só por função (42501); com um grant indevido, a RLS dá 0 linhas', async () => {
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
      // append-only: o portal não tem grant; o dono esbarra no gatilho
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
      expect(acoes).toEqual(expect.arrayContaining(['sa.super_admin.criar', 'sa.sessao.aberta', 'sa.requisicao', 'sa.login.falha']));
      const texto = JSON.stringify(await auditoria());
      for (const segredo of [EMAIL, NOME, H1, 'Fulano']) expect(texto).not.toContain(segredo);
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
      // desde a 0039 o portal não aceita a chave sem_admin e empresa nova exige o admin inicial (RN-CORE-34)
      const entrada: Record<string, unknown> = { ...entradaPortal('t87-excluir'), admin: { email: 'admin.t87@exemplo.com.br', nome: 'Admin T87', senha_hash: H1 } };
      delete entrada.sem_admin;
      const r = await um<{ tenant_id: string }>('plataforma.sa_provisionar_tenant($1, $2::jsonb)', [sid, JSON.stringify(entrada)]);
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
