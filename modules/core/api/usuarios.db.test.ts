/**
 * T-0067 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): usuários no BKO. Prova com os índices únicos reais
 * (`usuario_email_uk`, `usuario_external_uk`), o RLS, o escopo de leitura do supervisor, a auditoria gravada, a revogação
 * de sessões e que o usuário desativado perde o acesso na PRÓXIMA requisição do mesmo token. Pula sem Docker/Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { AcessoBanco, ClienteBanco, ContextoBase, RotaModulo, UsuarioAutenticado } from '@macuxi/platform-sdk';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UsuarioItemSchema } from '../contracts';
import { criarAutenticacao } from './autenticacao';
import { carteiraDoUsuario } from './carteira';
import { assinarAcesso } from './seguranca';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';
import { rotasDeUsuarios } from './usuarios';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const U = A.usuarios;
const SENHA = 'Senha@Forte123';
// sessao_token_hash_sha256 exige sha256 hex (64 caracteres minúsculos).
const TOKEN_HASH_SESSAO = createHash('sha256').update('t0067-sessao').digest('hex');

describe.skipIf(semBanco())('Core T-0067 × Postgres: usuários no BKO', () => {
  let pool: pg.Pool;
  let acesso: AcessoBanco;
  const usuario = (id: string, perfil: UsuarioAutenticado['perfil'], tenant = A.tenantId): UsuarioAutenticado => ({ id, tenant_id: tenant, perfil });
  const admin = usuario(U.admin, 'admin');
  const supervisor = usuario(U.supervisor, 'supervisor');
  const adminB = usuario(B.usuarios.admin, 'admin', B.tenantId);

  function ctx(u: UsuarioAutenticado): ContextoBase {
    return {
      usuario: u,
      requestId: 'req-teste-usuarios',
      agora: () => new Date(),
      fuso: () => 'America/Manaus',
      comTenant: (fn: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) => comTenant(pool, u.tenant_id, (c) => fn(c, { publicar: async () => ({}) })),
      carteira: () => carteiraDoUsuario(u, acesso),
      usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
    } as unknown as ContextoBase;
  }
  const rota = (metodo: string, caminho: string): RotaModulo => rotasDeUsuarios.find((r) => r.metodo === metodo && r.caminho === caminho)!;
  const chamar = (metodo: string, caminho: string, u: UsuarioAutenticado, extra: { corpo?: unknown; query?: unknown; params?: unknown } = {}) => {
    const r = rota(metodo, caminho);
    return r.executar({ ...ctx(u), corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: r.query ? r.query.parse(extra.query ?? {}) : {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const novo = (sufixo: string, extra: Record<string, unknown> = {}) => ({ nome: `Teste ${sufixo}`, email: `teste.${sufixo}@exemplo.com.br`, perfil: 'vendedor', external_id: `T0067-${sufixo}`, senha: SENHA, ...extra });
  const auditorias = (acao: string, id: string) =>
    comTenant(pool, A.tenantId, async (c) => (await c.query<{ antes: unknown; depois: unknown }>("select antes, depois from plataforma.auditoria where acao = $1 and entidade_id = $2 and modulo = 'core'", [acao, id])).rows);

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    acesso = {
      comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c as unknown as ClienteBanco)),
      semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco),
    };
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('RN-CORE-05: o admin de cada tenant lista só os usuários do seu tenant', async () => {
    const a = (await chamar('GET', 'usuarios', admin)).itens.map((i: { id: string }) => i.id);
    const b = (await chamar('GET', 'usuarios', adminB)).itens.map((i: { id: string }) => i.id);
    expect(a).toContain(U.vendedor1);
    expect(a).not.toContain(B.usuarios.vendedor);
    expect(b.sort()).toEqual([B.usuarios.admin, B.usuarios.vendedor].sort());
  });

  it('RN-CORE-04: o supervisor lista só a própria equipe e não vê o superior (gerente) que está fora do escopo', async () => {
    const r = (await chamar('GET', 'usuarios', supervisor)).itens as Array<{ id: string; superior_id: string | null }>;
    expect(r.map((i) => i.id).sort()).toEqual([U.supervisor, U.vendedor1, U.promotor].sort());
    expect(r.find((i) => i.id === U.supervisor)?.superior_id).toBeNull();
    expect(r.find((i) => i.id === U.vendedor1)?.superior_id).toBe(U.supervisor);
  });

  it('RF-CORE-02: o admin vê o superior derivado da equipe e filtra por perfil e busca', async () => {
    const r = (await chamar('GET', 'usuarios', admin, { query: { perfil: 'supervisor' } })).itens as Array<{ id: string; superior_id: string | null }>;
    expect(r.map((i) => i.id)).toContain(U.supervisor);
    expect(r.find((i) => i.id === U.supervisor)?.superior_id).toBe(U.gerente);
    const busca = (await chamar('GET', 'usuarios', admin, { query: { q: '%%%nao-existe' } })).itens;
    expect(busca).toEqual([]);
  });

  it('RF-CORE-02: criar, 409 em e-mail e external_id duplicados (índices reais) e auditoria sem dado sensível', async () => {
    const criado = UsuarioItemSchema.parse(await chamar('POST', 'usuarios', admin, { corpo: novo('a1') }));
    expect(criado).toMatchObject({ email: 'teste.a1@exemplo.com.br', ativo: true, external_id: 'T0067-a1' });
    await expect(chamar('POST', 'usuarios', admin, { corpo: novo('a1', { external_id: 'T0067-outro' }) })).rejects.toMatchObject({ status: 409, codigo: 'USUARIO_EMAIL_DUPLICADO' });
    await expect(chamar('POST', 'usuarios', admin, { corpo: novo('a2', { external_id: 'T0067-a1' }) })).rejects.toMatchObject({ status: 409, codigo: 'USUARIO_EXTERNAL_ID_DUPLICADO' });
    const [a] = await auditorias('usuario.criar', criado.id);
    expect(a).toBeDefined();
    expect(JSON.stringify(a)).not.toContain(SENHA);
    expect(JSON.stringify(a)).not.toContain('argon2');
    const h = await comTenant(pool, A.tenantId, async (c) => (await c.query<{ senha_hash: string }>('select senha_hash from core.usuario where id = $1', [criado.id])).rows[0]!.senha_hash);
    expect(h).toMatch(/^\$argon2id\$/);
  });

  it('RN-CORE-05: o tenant B pode ter o mesmo e-mail (único por tenant)', async () => {
    const r = await chamar('POST', 'usuarios', adminB, { corpo: novo('a1') });
    expect(r.email).toBe('teste.a1@exemplo.com.br');
  });

  it('RF-CORE-01: desativar corta a PRÓXIMA requisição do mesmo token, revoga a sessão e audita; reativar devolve o acesso', async () => {
    const criado = await chamar('POST', 'usuarios', admin, { corpo: novo('b1') });
    const segredo = 'segredo-de-teste-com-mais-de-32-caracteres!!';
    const auth = criarAutenticacao({ segredo: () => segredo });
    const agora = new Date();
    const token = assinarAcesso({ sub: criado.id, tid: A.tenantId, perfil: 'vendedor' }, agora, new Date(agora.getTime() + 15 * 60_000), segredo);
    const entrar = () => auth.autenticar({ authorization: `Bearer ${token}` }, acesso, agora);
    await comTenant(pool, A.tenantId, (c) =>
      c.query("insert into core.sessao (tenant_id, usuario_id, familia_id, token_hash, expira_em) values ($1, $2, gen_random_uuid(), $3, now() + interval '1 day')", [A.tenantId, criado.id, TOKEN_HASH_SESSAO]),
    );
    expect((await entrar())?.id).toBe(criado.id);

    await chamar('PUT', 'usuarios/:id/ativo', admin, { params: { id: criado.id }, corpo: { ativo: false } });
    expect(await entrar()).toBeNull();
    const revogada = await comTenant(pool, A.tenantId, async (c) => (await c.query<{ revogado_em: Date | null }>("select revogado_em from core.sessao where token_hash = $1", [TOKEN_HASH_SESSAO])).rows[0]!.revogado_em);
    expect(revogada).not.toBeNull();
    expect(await auditorias('usuario.desativar', criado.id)).toHaveLength(1);
    const apagado = await comTenant(pool, A.tenantId, async (c) => (await c.query<{ deleted_at: Date | null }>('select deleted_at from core.usuario where id = $1', [criado.id])).rows[0]!.deleted_at);
    expect(apagado).toBeNull(); // nunca apaga

    await chamar('PUT', 'usuarios/:id/ativo', admin, { params: { id: criado.id }, corpo: { ativo: true } });
    expect((await entrar())?.id).toBe(criado.id);
  });

  it('RF-CORE-01: redefinir senha troca o hash, marca trocar_senha e audita sem senha', async () => {
    const criado = await chamar('POST', 'usuarios', admin, { corpo: novo('c1') });
    const hash = (id: string) => comTenant(pool, A.tenantId, async (c) => (await c.query<{ senha_hash: string }>('select senha_hash from core.usuario where id = $1', [id])).rows[0]!.senha_hash);
    const antes = await hash(criado.id);
    await chamar('PUT', 'usuarios/:id/senha', admin, { params: { id: criado.id }, corpo: { senha: 'Outra@Senha456' } });
    expect(await hash(criado.id)).not.toBe(antes);
    const [a] = await auditorias('usuario.senha_redefinir', criado.id);
    expect(JSON.stringify(a)).toContain('trocar_senha');
    expect(JSON.stringify(a)).not.toContain('argon2');
  });

  it('RF-CORE-02: o admin não desativa a si mesmo (nos dois tenants)', async () => {
    await expect(chamar('PUT', 'usuarios/:id/ativo', admin, { params: { id: U.admin }, corpo: { ativo: false } })).rejects.toMatchObject({ codigo: 'USUARIO_AUTODESATIVACAO' });
    await expect(chamar('PUT', 'usuarios/:id/ativo', adminB, { params: { id: B.usuarios.admin }, corpo: { ativo: false } })).rejects.toMatchObject({ codigo: 'USUARIO_AUTODESATIVACAO' });
  });

  it('RN-CORE-05: o admin do tenant A não enxerga nem altera usuário do tenant B (404 pelo RLS)', async () => {
    await expect(chamar('PUT', 'usuarios/:id', admin, { params: { id: B.usuarios.vendedor }, corpo: { nome: 'Invasor' } })).rejects.toMatchObject({ status: 404 });
  });
});
