/**
 * T-0087 fatia E × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): Equipe por CSV com convite de 1º acesso
 * (RN-CORE-31). Prova a gravação em ordem (gerente → supervisor → vendedor), a árvore pelo `email_superior`, a idempotência
 * pelo e-mail, o convite só com hash no banco, o aceite de uso único (410 no segundo uso) e o isolamento entre tenants.
 * Pula sem Docker/Postgres (roda no CI).
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ErroHttpModulo, type AcessoBanco, type ClienteBanco, type ContextoBase, type RotaModulo, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AceitarConviteRequestSchema } from '../contracts';
import { aceitarConvite } from './convite-aceite';
import { rotasDeEquipeCsv } from './equipe-csv';
import { lerConvite } from './seguranca-convite';
import { rotasDeUsuarios } from './usuarios';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const SENHA = 'Senha@Forte123';
const CSV = [
  'nome,email,telefone,perfil,email_superior,codigo_erp,modulos',
  'Vera Campo,vera.csv@exemplo.com.br,,vendedor,sandra.csv@exemplo.com.br,CSV-V1,',
  'Sandra Sup,sandra.csv@exemplo.com.br,95991112222,supervisor,gil.csv@exemplo.com.br,,',
  'Gil Gerente,gil.csv@exemplo.com.br,,gerente,,,',
].join('\n');

describe.skipIf(semBanco())('Core T-0087 E × Postgres: Equipe por CSV e convite de 1º acesso', () => {
  let pool: pg.Pool;
  let acesso: AcessoBanco;
  const admin: UsuarioAutenticado = { id: A.usuarios.admin, tenant_id: A.tenantId, perfil: 'admin' };
  const adminB: UsuarioAutenticado = { id: B.usuarios.admin, tenant_id: B.tenantId, perfil: 'admin' };

  const ctx = (u: UsuarioAutenticado): ContextoBase =>
    ({
      usuario: u,
      requestId: 'req-teste-equipe-csv',
      agora: () => new Date(),
      fuso: () => 'America/Manaus',
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      comTenant: (fn: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) =>
        comTenant(pool, u.tenant_id, (c) => fn(c, { publicar: async () => ({}), auditar: async () => undefined })),
    }) as unknown as ContextoBase;
  const rota = (metodo: string, caminho: string): RotaModulo => rotasDeEquipeCsv.find((r) => r.metodo === metodo && r.caminho === caminho)!;
  const chamar = (metodo: string, caminho: string, u: UsuarioAutenticado, extra: { corpo?: unknown; params?: unknown } = {}) => {
    const r = rota(metodo, caminho);
    return r.executar({ ...ctx(u), corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const aceitar = (token: string, senha: string, agora: () => Date = () => new Date()) =>
    aceitarConvite({
      corpo: AceitarConviteRequestSchema.parse({ token, senha }),
      query: {},
      params: {},
      requestId: 'req-aceite',
      ip: '127.0.0.1',
      agora,
      banco: acesso,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
  const linhas = <R,>(tenant: string, sql: string, v: unknown[] = []) => comTenant(pool, tenant, async (c) => (await c.query<R & object>(sql, v)).rows);

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

  it('RN-CORE-31: conferir não grava nada e devolve o plano em ordem gerente → supervisor → campo', async () => {
    const r = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv: CSV, modo: 'conferir' } });
    expect(r.erros).toEqual([]);
    expect(r.gravado).toBe(false);
    expect(r.plano.map((p: { email: string }) => p.email)).toEqual(['gil.csv@exemplo.com.br', 'sandra.csv@exemplo.com.br', 'vera.csv@exemplo.com.br']);
    expect(await linhas(A.tenantId, "select 1 from core.usuario where email like '%.csv@exemplo.com.br'")).toHaveLength(0);
  });

  it('RN-CORE-31: gravar cria os 3 sem senha, monta a árvore, guarda só o hash do convite e é idempotente', async () => {
    const r = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv: CSV, modo: 'gravar', origem: 'https://bko.exemplo.com.br/x' } });
    expect(r.erros).toEqual([]);
    expect(r.gravado).toBe(true);
    expect(r.convites).toHaveLength(3);
    expect(r.convites[0].link).toMatch(/^https:\/\/bko\.exemplo\.com\.br\/convite#/);
    const us = await linhas<{ email: string; senha_hash: string | null; equipe_id: string | null; external_id: string | null; telefone: string | null }>(
      A.tenantId,
      "select email, senha_hash, equipe_id, external_id, telefone from core.usuario where email like '%.csv@exemplo.com.br' order by email",
    );
    expect(us.every((u) => u.senha_hash === null)).toBe(true);
    expect(us.find((u) => u.email.startsWith('vera'))).toMatchObject({ external_id: 'CSV-V1' });
    expect(us.find((u) => u.email.startsWith('sandra'))?.telefone).toBe('95991112222');
    // árvore: vera -> sandra -> gil (pela equipe que o superior responde)
    const arv = await linhas<{ filho: string; superior: string }>(
      A.tenantId,
      `select f.email as filho, s.email as superior from core.usuario f join core.equipe e on e.id = f.equipe_id join core.usuario s on s.id = e.responsavel_id
        where f.email like '%.csv@exemplo.com.br'`,
    );
    expect(arv.map((a) => `${a.filho}>${a.superior}`).sort()).toEqual(['sandra.csv@exemplo.com.br>gil.csv@exemplo.com.br', 'vera.csv@exemplo.com.br>sandra.csv@exemplo.com.br']);
    // no banco só o hash: o token em claro não aparece em lugar nenhum
    const token = r.convites[0].caminho.replace('/convite#', '') as string;
    const seg = token.slice(37);
    const conv = await linhas<{ token_hash: string }>(A.tenantId, 'select token_hash from core.usuario_convite');
    expect(conv.some((c) => c.token_hash === lerConvite(token)!.hash)).toBe(true);
    expect(conv.some((c) => c.token_hash.includes(seg))).toBe(false);
    // idempotente: rodar de novo não cria nem convida de novo
    const de_novo = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv: CSV, modo: 'gravar' } });
    expect(de_novo.resumo).toMatchObject({ novos: 0, atualizados: 0, sem_mudanca: 3 });
    expect(de_novo.convites).toHaveLength(0);
  });

  it('RN-CORE-31: arquivo com erro não grava nada (superior inexistente) e o erro não repete o dado da célula', async () => {
    const csv = 'nome,email,perfil,email_superior\nZed,zed.csv@exemplo.com.br,vendedor,ninguem@exemplo.com.br';
    const r = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv, modo: 'gravar' } });
    expect(r.gravado).toBe(false);
    expect(r.erros[0]).toMatchObject({ linha: 2, coluna: 'email_superior' });
    expect(JSON.stringify(r.erros)).not.toContain('ninguem@');
    expect(await linhas(A.tenantId, "select 1 from core.usuario where email = 'zed.csv@exemplo.com.br'")).toHaveLength(0);
  });

  it('RN-CORE-05: o outro tenant não vê usuários nem convites desta importação', async () => {
    const b = await linhas(B.tenantId, "select 1 from core.usuario where email like '%.csv@exemplo.com.br'");
    expect(b).toHaveLength(0);
    const lista = await chamar('GET', 'equipe/convites', adminB);
    expect(lista.itens).toHaveLength(0);
  });

  it('RN-CORE-31: renovar revoga o link anterior; aceitar define a senha, é de uso único e o antigo dá 410', async () => {
    const lista = await chamar('GET', 'equipe/convites', admin);
    const vera = lista.itens.find((i: { email: string }) => i.email.startsWith('vera'));
    expect(vera).toBeTruthy();
    expect(JSON.stringify(lista)).not.toContain('/convite#');
    const novo = await chamar('POST', 'equipe/convites/:usuario_id/renovar', admin, { params: { usuario_id: vera.usuario_id }, corpo: {} });
    const token = novo.caminho.replace('/convite#', '') as string;
    // o convite anterior (da importação) já não vale: só o novo está pendente
    expect(await linhas(A.tenantId, 'select 1 from core.usuario_convite where usuario_id = $1 and usado_em is null and revogado_em is null', [vera.usuario_id])).toHaveLength(1);
    await expect(aceitar(token, 'curta')).rejects.toMatchObject({ status: 422 });
    const ok = await aceitar(token, SENHA);
    expect(ok).toMatchObject({ email: 'vera.csv@exemplo.com.br' });
    expect(ok.codigo_empresa).toBeTruthy();
    const u = await linhas<{ senha_hash: string }>(A.tenantId, 'select senha_hash from core.usuario where id = $1', [vera.usuario_id]);
    expect(u[0]!.senha_hash).toMatch(/^\$argon2id\$/);
    const segundo = await aceitar(token, SENHA).catch((e: unknown) => e);
    expect(segundo).toBeInstanceOf(ErroHttpModulo);
    expect((segundo as ErroHttpModulo).status).toBe(410);
    // quem já tem senha não renova convite
    await expect(chamar('POST', 'equipe/convites/:usuario_id/renovar', admin, { params: { usuario_id: vera.usuario_id }, corpo: {} })).rejects.toBeTruthy();
  });

  const importar = async (nome: string, email: string) => {
    const csv = `nome,email,telefone,perfil,email_superior,codigo_erp,modulos\n${nome},${email},,vendedor,,,`;
    const r = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv, modo: 'gravar' } });
    return { id: r.convites[0].usuario_id as string, token: (r.convites[0].caminho as string).replace('/convite#', '') };
  };
  const usuariosRota = (metodo: string, caminho: string, u: UsuarioAutenticado, extra: { corpo?: unknown; params?: unknown }) => {
    const r = rotasDeUsuarios.find((x) => x.metodo === metodo && x.caminho === caminho)!;
    return r.executar({ ...ctx(u), corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never) as Promise<unknown>;
  };
  const em410 = async (p: Promise<unknown>) => {
    const e = await p.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroHttpModulo);
    expect((e as ErroHttpModulo).status).toBe(410);
  };
  const pendentes = (id: string) => linhas(A.tenantId, 'select 1 from core.usuario_convite where usuario_id = $1 and usado_em is null and revogado_em is null', [id]);

  it('RN-CORE-31: ataque do link antigo — depois de "Redefinir senha" o convite dá 410 e a senha do admin fica intacta', async () => {
    const { id, token } = await importar('Rita Ataque', 'rita.csv@exemplo.com.br');
    await usuariosRota('PUT', 'usuarios/:id/senha', admin, { params: { id }, corpo: { senha: 'SenhaDoAdmin@123' } });
    expect(await pendentes(id)).toHaveLength(0);
    const antes = await linhas<{ senha_hash: string }>(A.tenantId, 'select senha_hash from core.usuario where id = $1', [id]);
    await em410(aceitar(token, SENHA));
    const depois = await linhas<{ senha_hash: string }>(A.tenantId, 'select senha_hash from core.usuario where id = $1', [id]);
    expect(depois[0]!.senha_hash).toBe(antes[0]!.senha_hash);
  });

  it('RN-CORE-31: convite pendente (sem revogação) de quem já tem senha também dá 410', async () => {
    const { id, token } = await importar('Caio Senha', 'caio.csv@exemplo.com.br');
    await linhas(A.tenantId, "update core.usuario set senha_hash = '$argon2id$v=19$m=1,t=1,p=1$YQ$YQ' where id = $1 returning id", [id]);
    await em410(aceitar(token, SENHA));
  });

  it('RN-CORE-31: desativar o usuário revoga o convite pendente, o aceite dá 410 e a renovação é recusada', async () => {
    const { id, token } = await importar('Davi Inativo', 'davi.csv@exemplo.com.br');
    await usuariosRota('PUT', 'usuarios/:id/ativo', admin, { params: { id }, corpo: { ativo: false } });
    expect(await pendentes(id)).toHaveLength(0);
    await em410(aceitar(token, SENHA));
    await expect(chamar('POST', 'equipe/convites/:usuario_id/renovar', admin, { params: { usuario_id: id }, corpo: {} })).rejects.toBeTruthy();
  });

  it('RN-CORE-31: convite vencido (8 dias depois) dá 410', async () => {
    const { token } = await importar('Eva Vencida', 'eva.csv@exemplo.com.br');
    await em410(aceitar(token, SENHA, () => new Date(Date.now() + 8 * 86_400_000)));
  });

  it('RN-CORE-31: super-admin importa e renova; o convite guarda o autor como super_admin e o aceite funciona', async () => {
    const idSa = '00000000-0000-4000-8000-0000000000aa';
    const sa = { ...ctx(admin), superAdmin: { id: idSa } } as unknown as ContextoBase;
    const r = rota('POST', 'equipe/importacoes');
    const csv = 'nome,email,telefone,perfil,email_superior,codigo_erp,modulos\nSol Super,sol.csv@exemplo.com.br,,vendedor,,,';
    const out = (await r.executar({ ...sa, corpo: r.corpo!.parse({ csv, modo: 'gravar' }), query: {}, params: {} } as never)) as { convites: { usuario_id: string }[] };
    const uid = out.convites[0]!.usuario_id;
    const c = await linhas<{ criado_por_tipo: string; criado_por_id: string }>(A.tenantId, 'select criado_por_tipo, criado_por_id from core.usuario_convite where usuario_id = $1', [uid]);
    expect(c[0]).toMatchObject({ criado_por_tipo: 'super_admin', criado_por_id: idSa });
    const rr = rota('POST', 'equipe/convites/:usuario_id/renovar');
    const novo = (await rr.executar({ ...sa, corpo: rr.corpo!.parse({}), query: {}, params: rr.params!.parse({ usuario_id: uid }) } as never)) as { caminho: string };
    await expect(aceitar(novo.caminho.replace('/convite#', ''), SENHA)).resolves.toMatchObject({ email: 'sol.csv@exemplo.com.br' });
  });

  it('RN-CORE-31: só o telefone mudou no arquivo — é gravado', async () => {
    const csv = 'nome,email,telefone,perfil,email_superior,codigo_erp,modulos\nSandra Sup,sandra.csv@exemplo.com.br,95993334444,supervisor,gil.csv@exemplo.com.br,,';
    const r = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv, modo: 'gravar' } });
    expect(r.resumo).toMatchObject({ atualizados: 1 });
    expect((await linhas<{ telefone: string }>(A.tenantId, "select telefone from core.usuario where email = 'sandra.csv@exemplo.com.br'"))[0]!.telefone).toBe('95993334444');
  });

  it('RN-CORE-04: supervisor que troca de gerente leva a equipe dele junto (equipe_pai_id acompanha)', async () => {
    const csv = ['nome,email,telefone,perfil,email_superior,codigo_erp,modulos', 'Sandra Sup,sandra.csv@exemplo.com.br,,supervisor,gina.csv@exemplo.com.br,,', 'Gina Gerente,gina.csv@exemplo.com.br,,gerente,,,'].join('\n');
    const r = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv, modo: 'gravar' } });
    expect(r.erros).toEqual([]);
    const l = await linhas<{ pai: string }>(
      A.tenantId,
      `select g.email as pai from core.equipe e join core.usuario s on s.id = e.responsavel_id
         join core.equipe ep on ep.id = e.equipe_pai_id join core.usuario g on g.id = ep.responsavel_id
        where s.email = 'sandra.csv@exemplo.com.br'`,
    );
    expect(l).toEqual([{ pai: 'gina.csv@exemplo.com.br' }]);
  });
});
