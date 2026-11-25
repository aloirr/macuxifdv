/**
 * 0107 — troca da senha do admin do cliente pela sessão do portal (v1.0.35, item 3). Dicionário: docs/banco/plataforma.md,
 * "Senha do admin do cliente no portal (0107)". O que o BANCO garante:
 * - as 3 funções exigem sessão viva de admin do cliente COM empresa escolhida (inválida 28000; super-admin ou sem empresa 42501)
 *   e agem só na conta da empresa atual da sessão (isolamento entre tenants);
 * - sa_reautenticar_admin: hash e estado do bloqueio da conta (core.usuario), auditada 'sa.reautenticar' quando acha a conta;
 * - sa_falha_senha_admin: o contador do login (RN-CORE-01): 5 falhas = 15 min; bloqueio vivo não conta nem estende; vencido
 *   recomeça; 'sa.bloqueio' ao bloquear;
 * - sa_gravar_senha_admin: argon2id; hash atual divergente ou bloqueio vivo = false sem mudar nada; sucesso zera falhas e
 *   bloqueio, sessao_versao + 1, derruba as core.sessao e as portal_sessao da conta (inclusive a atual); auditoria no tenant e na plataforma sem hash;
 * - EXECUTE só ao macuxi_portal; up/down volta exatamente ao catálogo anterior.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero).
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { FUNCOES_SA_0107, FUNCOES_SA_ATUAIS } from './funcoes-sa';
import { comoPapel, emTransacao, erroDe, HASH_TESTE, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0107';
const m107 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m107) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m107.up);
const down = semComentarios(m107.down);
const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const ADMIN_A = DOIS_TENANTS.A.usuarios.admin;
const ADMIN_B = DOIS_TENANTS.B.usuarios.admin;
const SEM_SESSAO = '00000000-0000-4000-8000-000000000107';
const HASH_NOVO = '$argon2id$v=19$m=1,t=1,p=1$bm92bw$bm92b2hhc2g';

describe('0107 senha do admin do cliente no portal (estático)', () => {
  it('nome; só as 3 funções: SECURITY DEFINER, search_path fixo, EXECUTE só ao portal; o down apaga as 3', () => {
    expect(m107.nome).toBe('plataforma_senha_admin_portal');
    for (const f of FUNCOES_SA_0107) {
      const nome = f.slice(0, f.indexOf('('));
      const i = up.indexOf(`create function ${nome}(`);
      expect(i, f).toBeGreaterThanOrEqual(0);
      const b = up.slice(i, up.indexOf('$$;', up.indexOf('$$', i) + 2) + 3);
      expect(b, f).toMatch(/language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp\s/);
      expect(b, f).toContain('plataforma.sa_sessao_valida(p_sid)');
      expect(up).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_portal;`);
      expect(down).toContain(`drop function if exists ${f};`);
    }
    expect(up.match(/\bgrant execute\b/g)).toHaveLength(3);
    expect(up.match(/\bcreate function\b/g)).toHaveLength(3);
    expect(down.match(/\bdrop function\b/g)).toHaveLength(3);
    expect(up).not.toMatch(/create (unique )?index|create policy|alter policy|create table|alter table|create or replace/);
    expect(FUNCOES_SA_ATUAIS).toEqual(expect.arrayContaining([...FUNCOES_SA_0107]));
  });
});

describe.skipIf(semBanco())('0107 senha do admin do cliente no portal (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  type Conta = { tenant_id: string; usuario_id: string; email: string; senha_hash: string; falhas: number; bloqueado_ate: Date | null };
  type Estado = { falhas: number; bloqueado_ate: Date | null };
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const portal = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => comoPapel<T>(admin, 'macuxi_portal', sql, params).then((r) => r.rows);
  const abrir = async (p: unknown) => (await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)]))[0]!.sessao_id;
  const adminDe = (t: string, u: string) => abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: t, usuario_id: u }] });
  async function superAdmin() {
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.0107@macuxi.exemplo', nome: 'Operador 0107', senha_hash: HASH_TESTE })]))[0]!.r;
    return abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id });
  }
  const semEmpresa = () => abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }, { tenant_id: B, usuario_id: ADMIN_B }] });
  // exatamente as chamadas da rota (parâmetros sem tipo, como o node-postgres manda)
  const reautenticar = (sid: string) => portal<Conta>('select * from plataforma.sa_reautenticar_admin($1)', [sid]);
  const falha = async (sid: string) => (await portal<Estado>('select * from plataforma.sa_falha_senha_admin($1)', [sid]))[0]!;
  const gravar = async (sid: string, atual: string | null, novo: string | null) => (await portal<{ r: boolean }>('select plataforma.sa_gravar_senha_admin($1, $2, $3) as r', [sid, atual, novo]))[0]!.r;
  const conta = async (t: string, u: string) =>
    (await q<{ senha_hash: string; tentativas_falhas: number; bloqueio_ate: Date | null; sessao_versao: number; trocar_senha: boolean }>(
      'select senha_hash, tentativas_falhas, bloqueio_ate, sessao_versao, trocar_senha from core.usuario where tenant_id = $1 and id = $2',
      [t, u],
    ))[0]!;
  const agoraMais = async (min: number) => (await q<{ t: Date }>(`select now() + make_interval(mins => $1) as t`, [min]))[0]!.t;
  const sessaoApp = async (t: string, u: string) =>
    (await q<{ id: string }>(
      "insert into core.sessao (tenant_id, usuario_id, familia_id, token_hash, expira_em) values ($1, $2, gen_random_uuid(), $3, now() + interval '1 day') returning id",
      [t, u, crypto.randomBytes(32).toString('hex')],
    ))[0]!.id;
  const auditorias = (acao: string) =>
    q<{ detalhes: Record<string, unknown>; ator_tipo: string; usuario_id: string | null; tenant_alvo_id: string | null }>(
      'select detalhes, ator_tipo, usuario_id, tenant_alvo_id from plataforma.auditoria_plataforma where acao = $1 order by ocorrido_em, id',
      [acao],
    );
  const vivas = async (ids: string[]) =>
    (await q<{ id: string }>('select id from plataforma.portal_sessao where id = any($1::uuid[]) and revogada_em is null', [ids])).map((x) => x.id).sort();

  it('quem chama: inválida 28000; super-admin e admin sem empresa escolhida 42501 nas 3', async () => {
    await emTransacao(admin, null, async () => {
      const sa = await superAdmin();
      const sem = await semEmpresa();
      const hash = (await conta(A, ADMIN_A)).senha_hash;
      for (const [rotulo, chamar] of [
        ['reautenticar', (s: string) => reautenticar(s)],
        ['falha', (s: string) => falha(s)],
        ['gravar', (s: string) => gravar(s, hash, HASH_NOVO)],
      ] as const) {
        expect((await erroDe(chamar(SEM_SESSAO)))?.code, rotulo).toBe('28000');
        expect((await erroDe(chamar(sa)))?.code, rotulo).toBe('42501');
        expect((await erroDe(chamar(sem)))?.code, rotulo).toBe('42501');
      }
      expect(await conta(A, ADMIN_A)).toMatchObject({ senha_hash: hash, tentativas_falhas: 0 });
    });
  });

  it('reautenticar: a conta da empresa da sessão (hash e estado do bloqueio), auditada sem dado pessoal', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await adminDe(A, ADMIN_A);
      const [u] = await q<{ email: string; senha_hash: string }>('select email, senha_hash from core.usuario where tenant_id = $1 and id = $2', [A, ADMIN_A]);
      expect(await reautenticar(sid)).toEqual([{ tenant_id: A, usuario_id: ADMIN_A, email: u!.email, senha_hash: u!.senha_hash, falhas: 0, bloqueado_ate: null }]);
      // bloqueio vivo aparece; vencido = falhas 0 e sem bloqueio (a contagem recomeça)
      const ate = await agoraMais(10);
      await q('update core.usuario set tentativas_falhas = 5, bloqueio_ate = $3 where tenant_id = $1 and id = $2', [A, ADMIN_A, ate]);
      expect((await reautenticar(sid))[0]).toMatchObject({ falhas: 5, bloqueado_ate: ate });
      await q("update core.usuario set bloqueio_ate = now() - interval '1 minute' where tenant_id = $1 and id = $2", [A, ADMIN_A]);
      expect((await reautenticar(sid))[0]).toMatchObject({ falhas: 0, bloqueado_ate: null });
      const aud = (await auditorias('sa.reautenticar')).filter((x) => x.ator_tipo === 'admin_cliente');
      expect(aud).toHaveLength(3);
      expect(aud[0]).toEqual({ ator_tipo: 'admin_cliente', usuario_id: ADMIN_A, tenant_alvo_id: A, detalhes: { origem: 'banco' } });
      expect(JSON.stringify(aud)).not.toMatch(/argon2|@/);
      // conta apagada: a sessão cai (28000) e nada é auditado
      await q('update core.usuario set deleted_at = now() where tenant_id = $1 and id = $2', [A, ADMIN_A]);
      expect((await erroDe(reautenticar(sid)))?.code).toBe('28000');
      expect((await auditorias('sa.reautenticar')).filter((x) => x.ator_tipo === 'admin_cliente')).toHaveLength(3);
    });
  });

  it('falhas: 5 seguidas = 15 min; bloqueio vivo não conta nem estende; vencido recomeça; só a conta da sessão (isolamento)', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await adminDe(A, ADMIN_A);
      const sidB = await adminDe(B, ADMIN_B);
      for (let n = 1; n <= 4; n++) expect(await falha(sid)).toEqual({ falhas: n, bloqueado_ate: null });
      expect(await auditorias('sa.bloqueio')).toEqual([]);
      const ate = await agoraMais(15);
      expect(await falha(sid)).toEqual({ falhas: 5, bloqueado_ate: ate });
      expect(await conta(A, ADMIN_A)).toMatchObject({ tentativas_falhas: 5, bloqueio_ate: ate });
      expect(await falha(sid)).toEqual({ falhas: 5, bloqueado_ate: ate });
      expect((await reautenticar(sid))[0]).toMatchObject({ falhas: 5, bloqueado_ate: ate });
      expect(await auditorias('sa.bloqueio')).toEqual([{ ator_tipo: 'admin_cliente', usuario_id: ADMIN_A, tenant_alvo_id: A, detalhes: { minutos: 15, origem: 'banco' } }]);
      // o outro tenant fica intacto
      expect(await conta(B, ADMIN_B)).toMatchObject({ tentativas_falhas: 0, bloqueio_ate: null });
      expect((await reautenticar(sidB))[0]).toMatchObject({ tenant_id: B, usuario_id: ADMIN_B, falhas: 0, bloqueado_ate: null });
      expect(await falha(sidB)).toEqual({ falhas: 1, bloqueado_ate: null });
      expect(await conta(A, ADMIN_A)).toMatchObject({ tentativas_falhas: 5, bloqueio_ate: ate });
      // bloqueio vencido: a contagem recomeça
      await q("update core.usuario set bloqueio_ate = now() - interval '1 second' where tenant_id = $1 and id = $2", [A, ADMIN_A]);
      expect(await falha(sid)).toEqual({ falhas: 1, bloqueado_ate: null });
      expect(await conta(A, ADMIN_A)).toMatchObject({ tentativas_falhas: 1, bloqueio_ate: null });
    });
  });

  it('gravar: argon2id; hash atual divergente = false sem mudar nada', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await adminDe(A, ADMIN_A);
      const antes = await conta(A, ADMIN_A);
      for (const novo of [null, 'texto', '$argon2i$v=19$m=1,t=1,p=1$bm92bw$bm92b2hhc2g', `${HASH_NOVO} `]) {
        expect((await erroDe(gravar(sid, antes.senha_hash, novo)))?.code, String(novo)).toBe('22023');
      }
      expect((await erroDe(gravar(sid, null, HASH_NOVO)))?.code).toBe('22023');
      await q('update core.usuario set tentativas_falhas = 2 where tenant_id = $1 and id = $2', [A, ADMIN_A]);
      const app = await sessaoApp(A, ADMIN_A);
      expect(await gravar(sid, HASH_NOVO, HASH_NOVO)).toBe(false);
      expect(await conta(A, ADMIN_A)).toEqual({ ...antes, tentativas_falhas: 2 });
      expect(await vivas([sid])).toEqual([sid]);
      expect(await q('select revogado_em from core.sessao where id = $1', [app])).toEqual([{ revogado_em: null }]);
      expect(await auditorias('sa.senha.trocada')).toEqual([]);
      expect(await q("select count(*)::int as n from plataforma.auditoria where acao = 'usuario.senha_trocar' and tenant_id = $1", [A])).toEqual([{ n: 0 }]);
    });
  });

  it('gravar: conta bloqueada + hash certo = false sem mudar nada (pedidos paralelos que passaram juntos pelo 423 da rota)', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await adminDe(A, ADMIN_A);
      const ate = await agoraMais(10);
      await q('update core.usuario set tentativas_falhas = 5, bloqueio_ate = $3 where tenant_id = $1 and id = $2', [A, ADMIN_A, ate]);
      const antes = await conta(A, ADMIN_A);
      const app = await sessaoApp(A, ADMIN_A);
      expect(await gravar(sid, antes.senha_hash, HASH_NOVO)).toBe(false);
      expect(await conta(A, ADMIN_A)).toEqual(antes);
      expect(await vivas([sid])).toEqual([sid]);
      expect(await q('select revogado_em from core.sessao where id = $1', [app])).toEqual([{ revogado_em: null }]);
      expect(await auditorias('sa.senha.trocada')).toEqual([]);
      expect(await q("select count(*)::int as n from plataforma.auditoria where acao = 'usuario.senha_trocar' and tenant_id = $1", [A])).toEqual([{ n: 0 }]);
    });
  });

  it('gravar: sucesso zera falhas e bloqueio, versão + 1, derruba as sessões da conta (app e portal, inclusive a atual); o tenant B fica', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await adminDe(A, ADMIN_A);
      const outra = await adminDe(A, ADMIN_A);
      const multi = await semEmpresa(); // nasceu da senha das contas de A e de B
      const sidB = await adminDe(B, ADMIN_B);
      const appA = await sessaoApp(A, ADMIN_A);
      const appB = await sessaoApp(B, ADMIN_B);
      await q("update core.usuario set tentativas_falhas = 3, bloqueio_ate = now() - interval '1 minute' where tenant_id = $1 and id = $2", [A, ADMIN_A]);
      const antes = await conta(A, ADMIN_A);
      const antesB = await conta(B, ADMIN_B);
      expect(await gravar(sid, antes.senha_hash, HASH_NOVO)).toBe(true);
      expect(await conta(A, ADMIN_A)).toEqual({ senha_hash: HASH_NOVO, tentativas_falhas: 0, bloqueio_ate: null, sessao_versao: antes.sessao_versao + 1, trocar_senha: false });
      expect(await conta(B, ADMIN_B)).toEqual(antesB);
      expect(await vivas([sid, outra, multi, sidB])).toEqual([sidB]);
      expect((await erroDe(reautenticar(sid)))?.code).toBe('28000');
      expect((await reautenticar(sidB))[0]).toMatchObject({ tenant_id: B, usuario_id: ADMIN_B });
      expect(await q('select id, revogado_em is not null as revogada from core.sessao where id = any($1::uuid[]) order by id', [[appA, appB]])).toEqual(
        [{ id: appA, revogada: true }, { id: appB, revogada: false }].sort((x, y) => x.id.localeCompare(y.id)),
      );
      // a senha antiga não grava de novo (o hash mudou)
      const nova = await adminDe(A, ADMIN_A);
      expect(await gravar(nova, antes.senha_hash, HASH_NOVO)).toBe(false);
      const aud = await auditorias('sa.senha.trocada');
      expect(aud).toEqual([{ ator_tipo: 'admin_cliente', usuario_id: ADMIN_A, tenant_alvo_id: A, detalhes: { sessoes_revogadas: 3, sessoes_app_revogadas: 1, origem: 'banco' } }]);
      const audTenant = await q<{ usuario_id: string; entidade_id: string; depois: unknown }>(
        "select usuario_id, entidade_id, depois from plataforma.auditoria where acao = 'usuario.senha_trocar' and tenant_id = $1",
        [A],
      );
      expect(audTenant).toEqual([{ usuario_id: ADMIN_A, entidade_id: ADMIN_A, depois: { motivo: 'voluntaria', sessoes_revogadas: true, origem: 'portal' } }]);
      expect(JSON.stringify([aud, audTenant])).not.toMatch(/argon2|@/);
    });
  });

  it('grants: EXECUTE só ao macuxi_portal; app e worker 42501; o portal não lê core.usuario', async () => {
    await emTransacao(admin, null, async () => {
      for (const f of FUNCOES_SA_0107) {
        expect(await q(`select has_function_privilege('macuxi_portal', $1, 'EXECUTE') as p, has_function_privilege('macuxi_app', $1, 'EXECUTE') as a, has_function_privilege('macuxi_worker', $1, 'EXECUTE') as w, has_function_privilege('public', $1, 'EXECUTE') as pub`, [f]), f).toEqual([{ p: true, a: false, w: false, pub: false }]);
      }
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        expect((await erroDe(comoPapel(admin, papel, 'select * from plataforma.sa_reautenticar_admin(null)', [], A)))?.code, papel).toBe('42501');
      }
      expect((await erroDe(portal('select senha_hash from core.usuario')))?.code).toBe('42501');
    });
  });
});

describe.skipIf(semBanco())('0107 senha do admin do cliente no portal (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up só acrescenta as 3 funções; down volta exatamente ao catálogo anterior; up de novo = igual', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual(['0107_plataforma_senha_admin_portal']);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((x) => !depois.includes(x))).toEqual([]);
      expect(depois.filter((x) => !antes.includes(x))).toEqual([
        'fn plataforma.sa_falha_senha_admin(p_sid uuid)',
        'fn plataforma.sa_gravar_senha_admin(p_sid uuid, p_hash_atual text, p_hash_novo text)',
        'fn plataforma.sa_reautenticar_admin(p_sid uuid)',
      ]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0107_plataforma_senha_admin_portal']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
