import { beforeEach, describe, expect, it } from 'vitest';
import { CODIGO_DISPOSITIVO_BLOQUEADO, CODIGOS_AUTH, LoginSenhaRequestSchema, SessaoRespostaSchema } from '../contracts';
import { criarAutenticacao } from './autenticacao';
import { bancoDeTeste, contextoPublico, estadoInicial, fabricaEmMemoria, logSilencioso, SEGREDO, TENANT_A, type EstadoMemoria } from './apoio-teste';
import { ErroHttpModulo } from '@macuxi/platform-sdk';
import { lerRefresh, verificarJwtAcesso } from './seguranca';

let t0 = new Date('2026-10-31T12:00:00Z');
const relogio = () => t0;
const avancar = (min: number) => {
  t0 = new Date(t0.getTime() + min * 60_000);
};

let e: EstadoMemoria;
let auth: ReturnType<typeof criarAutenticacao>;
const { banco } = bancoDeTeste();

const login = (corpo: Partial<{ codigo_empresa: string; email: string; senha: string; dispositivo_id: string }> = {}) =>
  auth.login(contextoPublico(LoginSenhaRequestSchema.parse({ codigo_empresa: 'alfa', email: 'vendedor@exemplo.com.br', senha: 'Teste@1234', ...corpo }), banco, relogio));

async function falha(p: Promise<unknown>): Promise<ErroHttpModulo> {
  try {
    await p;
  } catch (x) {
    expect(x).toBeInstanceOf(ErroHttpModulo);
    return x as ErroHttpModulo;
  }
  throw new Error('deveria ter falhado');
}

beforeEach(async () => {
  t0 = new Date('2026-10-31T12:00:00Z');
  e = await estadoInicial();
  auth = criarAutenticacao({ segredo: () => SEGREDO, repos: fabricaEmMemoria(e) });
});

describe('RF-CORE-01: login com código da empresa + e-mail + senha', () => {
  it('RF-CORE-01: login certo devolve JWT de 15 min, refresh e, só então, o nome e o fuso da empresa', async () => {
    const r = SessaoRespostaSchema.parse(await login());
    expect(r.expires_in).toBe(900);
    expect(r.tenant).toMatchObject({ codigo: 'alfa', nome: 'Distribuidora Alfa', fuso: 'America/Manaus' });
    expect(r.usuario).toMatchObject({ perfil: 'vendedor', email: 'vendedor@exemplo.com.br' });
    const claims = verificarJwtAcesso(r.access_token, t0, SEGREDO)!;
    expect(claims).toMatchObject({ sub: r.usuario.id, tid: TENANT_A, perfil: 'vendedor' });
    expect(claims.exp - claims.iat).toBe(900);
    // licença não vai no token (RN-CORE-01)
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'perfil', 'sub', 'tid']);
    expect(lerRefresh(r.refresh_token)?.tenantId).toBe(TENANT_A);
  });

  it('RF-CORE-01: e-mail repetido em outro tenant (Q3) — o código da empresa decide quem entra', async () => {
    const a = await login();
    const b = await login({ codigo_empresa: 'BETA' });
    expect(a.usuario.id).not.toBe(b.usuario.id);
    expect(b.tenant.codigo).toBe('beta');
  });

  it('T-0002 §6 item 4: código, e-mail ou senha errados dão a MESMA resposta e o tenant não vaza antes da senha', async () => {
    const respostas = [
      await falha(login({ codigo_empresa: 'naoexiste' })),
      await falha(login({ email: 'ninguem@exemplo.com.br' })),
      await falha(login({ senha: 'errada' })),
    ];
    for (const r of respostas) {
      expect(r.status).toBe(401);
      expect(r.codigo).toBe(CODIGOS_AUTH.credenciais);
    }
    expect(new Set(respostas.map((r) => r.message)).size).toBe(1);
    expect(JSON.stringify(respostas.map((r) => ({ ...r, message: r.message })))).not.toMatch(/Alfa|Manaus/);
    // o nome/fuso do tenant nunca foi nem lido nas falhas
    expect(e.leituraDeExibicao).toEqual([]);
    await login();
    expect(e.leituraDeExibicao).toEqual(['alfa']);
  }, 30_000);

  it('RF-CORE-01: tenant suspenso responde como credencial inválida', async () => {
    e.tenants.get('alfa')!.status = 'suspenso';
    expect((await falha(login())).codigo).toBe(CODIGOS_AUTH.credenciais);
  });

  it('RF-CORE-01: sem segredo do JWT configurado o login responde 503 (falha fechada) e não toca o banco', async () => {
    const semSegredo = criarAutenticacao({ segredo: () => undefined, repos: fabricaEmMemoria(e) });
    const { banco: b2, tenantsUsados } = bancoDeTeste();
    const erro = await falha(semSegredo.login(contextoPublico(LoginSenhaRequestSchema.parse({ codigo_empresa: 'alfa', email: 'a@b.com', senha: 'x' }), b2, relogio)));
    expect(erro.status).toBe(503);
    expect(tenantsUsados).toEqual([]);
  });

  it('RF-CORE-01: log do login não traz e-mail, senha nem token', async () => {
    const r = await login();
    const log = logSilencioso.linhas.join('\n');
    expect(log).not.toContain('vendedor@exemplo.com.br');
    expect(log).not.toContain('Teste@1234');
    expect(log).not.toContain(r.access_token);
    expect(log).not.toContain(r.refresh_token);
  });
});

describe('RF-CORE-01: bloqueio por tentativas', () => {
  it('RF-CORE-01: 5 senhas erradas bloqueiam; com a senha certa a resposta é 423; após 15 min entra e zera a contagem', async () => {
    for (let i = 0; i < 5; i++) expect((await falha(login({ senha: 'errada' }))).status).toBe(401);
    expect(e.usuarios.get('u-vend')!.tentativas_falhas).toBe(5);
    const bloqueado = await falha(login());
    expect(bloqueado.status).toBe(423);
    expect(bloqueado.codigo).toBe(CODIGOS_AUTH.bloqueado);
    // bloqueado + senha errada: continua parecendo credencial errada (não revela o estado) e não estende o bloqueio
    const ate = e.usuarios.get('u-vend')!.bloqueio_ate;
    expect((await falha(login({ senha: 'errada' }))).codigo).toBe(CODIGOS_AUTH.credenciais);
    expect(e.usuarios.get('u-vend')!.bloqueio_ate).toEqual(ate);
    avancar(16);
    await expect(login()).resolves.toBeTruthy();
    expect(e.usuarios.get('u-vend')!.tentativas_falhas).toBe(0);
  }, 30_000);

  it('RF-CORE-01: a falha é gravada mesmo com o erro lançado (a contagem não desfaz com a transação)', async () => {
    await falha(login({ senha: 'errada' }));
    await falha(login({ senha: 'errada' }));
    expect(e.usuarios.get('u-vend')!.tentativas_falhas).toBe(2);
  });

  it('RF-CORE-01: bloqueio remoto do admin e usuário inativo: 423 só com a senha certa', async () => {
    e.usuarios.get('u-vend')!.bloqueado_em = t0;
    expect((await falha(login())).status).toBe(423);
    expect((await falha(login({ senha: 'errada' }))).status).toBe(401);
    e.usuarios.get('u-vend')!.bloqueado_em = null;
    e.usuarios.get('u-vend')!.ativo = false;
    expect((await falha(login())).status).toBe(423);
  });

  it('RF-CORE-01: aparelho bloqueado remotamente não entra, mesmo com a senha certa', async () => {
    const d = '5d000000-0000-4000-8000-000000000001';
    await login({ dispositivo_id: d });
    e.dispositivos.get(d)!.bloqueado = true;
    expect((await falha(login({ dispositivo_id: d }))).status).toBe(423);
  });
});

describe('RF-CORE-01: refresh rotativo', () => {
  const refresh = (token: string) => auth.refresh(contextoPublico({ refresh_token: token }, banco, relogio));

  it('RF-CORE-01: refresh troca o par; o antigo não vale mais', async () => {
    const s = await login();
    const novo = await refresh(s.refresh_token);
    expect(novo.refresh_token).not.toBe(s.refresh_token);
    expect(verificarJwtAcesso(novo.access_token, t0, SEGREDO)?.sub).toBe(s.usuario.id);
    expect((await falha(refresh(s.refresh_token))).codigo).toBe(CODIGOS_AUTH.sessao);
  });

  it('RF-CORE-01: reuso de refresh já trocado derruba a família inteira (inclusive o token novo)', async () => {
    const s = await login();
    const novo = await refresh(s.refresh_token);
    await falha(refresh(s.refresh_token)); // reuso
    expect((await falha(refresh(novo.refresh_token))).status).toBe(401);
    expect(e.sessoes.every((x) => x.revogado_em !== null)).toBe(true);
  });

  it('RF-CORE-01: refresh expira em 30 dias', async () => {
    const s = await login();
    avancar(30 * 24 * 60 + 1);
    expect((await falha(refresh(s.refresh_token))).codigo).toBe(CODIGOS_AUTH.sessao);
  });

  it('RF-CORE-01: refresh de usuário bloqueado depois do login é recusado e revoga a família', async () => {
    const s = await login();
    e.usuarios.get('u-vend')!.bloqueado_em = t0;
    expect((await falha(refresh(s.refresh_token))).codigo).toBe(CODIGOS_AUTH.sessao);
    expect(e.sessoes[0]!.revogado_em).not.toBeNull();
  });

  it('RN-CORE-05: refresh de um tenant não acha sessão de outro (token adulterado)', async () => {
    const s = await login();
    const segredo = s.refresh_token.slice(37);
    const trocado = `0a000000-0000-4000-8000-0000000000bb.${segredo}`;
    expect((await falha(refresh(trocado))).codigo).toBe(CODIGOS_AUTH.sessao);
    expect((await falha(refresh('lixo'))).codigo).toBe(CODIGOS_AUTH.sessao);
  });

  it('RF-CORE-01: logout revoga a família e responde igual para token desconhecido', async () => {
    const s = await login();
    await auth.logout(contextoPublico({ refresh_token: s.refresh_token }, banco, relogio));
    expect((await falha(refresh(s.refresh_token))).codigo).toBe(CODIGOS_AUTH.sessao);
    await expect(auth.logout(contextoPublico({ refresh_token: 'x'.repeat(40) }, banco, relogio))).resolves.toEqual({});
  });
});

describe('RF-CORE-01: autenticar (token → usuário, a cada requisição)', () => {
  const cab = (t: string) => ({ authorization: `Bearer ${t}` });

  it('RF-CORE-01: token válido autentica com o perfil ATUAL do banco; o tenant vem do token', async () => {
    const s = await login();
    const u = await auth.autenticar(cab(s.access_token), banco, t0);
    expect(u).toEqual({ id: s.usuario.id, tenant_id: TENANT_A, perfil: 'vendedor' });
    e.usuarios.get('u-vend')!.perfil = 'supervisor';
    expect((await auth.autenticar(cab(s.access_token), banco, t0))?.perfil).toBe('supervisor');
  });

  it('RF-CORE-01: sem token, token adulterado, expirado ou de assinatura alheia = null (401)', async () => {
    const s = await login();
    expect(await auth.autenticar({}, banco, t0)).toBeNull();
    expect(await auth.autenticar(cab('lixo'), banco, t0)).toBeNull();
    expect(await auth.autenticar(cab(s.access_token.slice(0, -2) + 'xx'), banco, t0)).toBeNull();
    expect(await auth.autenticar(cab(s.access_token), banco, new Date(t0.getTime() + 16 * 60_000))).toBeNull();
    const outro = criarAutenticacao({ segredo: () => 'outro-segredo-com-mais-de-32-caracteres!!', repos: fabricaEmMemoria(e) });
    expect(await outro.autenticar(cab(s.access_token), banco, t0)).toBeNull();
  });

  it('RF-CORE-01: bloqueio remoto vale na hora (usuário bloqueado ou inativo não autentica mais)', async () => {
    const s = await login();
    e.usuarios.get('u-vend')!.bloqueado_em = t0;
    expect(await auth.autenticar(cab(s.access_token), banco, t0)).toBeNull();
    e.usuarios.get('u-vend')!.bloqueado_em = null;
    e.usuarios.get('u-vend')!.ativo = false;
    expect(await auth.autenticar(cab(s.access_token), banco, t0)).toBeNull();
  });

  it('RF-CORE-01: sem MACUXI_JWT_SEGREDO ninguém autentica (falha fechada)', async () => {
    const s = await login();
    const sem = criarAutenticacao({ segredo: () => undefined, repos: fabricaEmMemoria(e) });
    expect(await sem.autenticar(cab(s.access_token), banco, t0)).toBeNull();
  });

  it('RF-CORE-01: alg=none não passa', async () => {
    const s = await login();
    const [, corpo] = s.access_token.split('.');
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${corpo}.`;
    expect(await auth.autenticar(cab(none), banco, t0)).toBeNull();
  });
});

describe('aparelho de outro tenant (23503)', () => {
  it('RF-CORE-01: FK/unicidade/RLS do aparelho vira 403 DISPOSITIVO_INVALIDO, não 500', async () => {
    const { repositorioTenantSql } = await import('./repositorio');
    for (const code of ['23503', '23505', '42501']) {
      const repo = repositorioTenantSql({ query: () => Promise.reject(Object.assign(new Error('pg'), { code })) });
      const s = { id: 'a', usuario_id: 'u', familia_id: 'f', token_hash: 'h', dispositivo_id: 'd', expira_em: new Date() };
      await expect(repo.criarSessao(s)).rejects.toMatchObject({ status: 403, codigo: 'DISPOSITIVO_INVALIDO' });
      await expect(repo.upsertDispositivo('u', 'd', null, new Date())).rejects.toMatchObject({ status: 403, codigo: 'DISPOSITIVO_INVALIDO' });
    }
    const outro = repositorioTenantSql({ query: () => Promise.reject(Object.assign(new Error('x'), { code: '57014' })) });
    await expect(outro.upsertDispositivo('u', 'd', null, new Date())).rejects.not.toMatchObject({ status: 403 });
  });
});

describe('RN-CORE-15: aparelho bloqueado vale para o tenant inteiro', () => {
  const d = '5d000000-0000-4000-8000-000000000015';
  const outroUsuario = (corpo: Partial<{ senha: string }> = {}) => login({ email: 'promotor@exemplo.com.br', dispositivo_id: d, ...corpo });

  it('RN-CORE-15: outro usuário do mesmo tenant também não entra no aparelho bloqueado (423 DISPOSITIVO_BLOQUEADO)', async () => {
    await login({ dispositivo_id: d }); // o aparelho nasce no login do vendedor
    e.dispositivos.get(d)!.bloqueado = true;
    const erro = await falha(outroUsuario());
    expect(erro.status).toBe(423);
    expect(erro.codigo).toBe(CODIGO_DISPOSITIVO_BLOQUEADO);
  });

  it('RN-CORE-15: o 423 só se revela a quem acertou a senha (senha errada continua 401, sem pista do bloqueio)', async () => {
    await login({ dispositivo_id: d });
    e.dispositivos.get(d)!.bloqueado = true;
    const erro = await falha(outroUsuario({ senha: 'errada' }));
    expect(erro.status).toBe(401);
    expect(erro.codigo).toBe(CODIGOS_AUTH.credenciais);
  });

  it('RN-CORE-15: desbloqueado, qualquer usuário volta a entrar', async () => {
    await login({ dispositivo_id: d });
    e.dispositivos.get(d)!.bloqueado = true;
    await falha(outroUsuario());
    e.dispositivos.get(d)!.bloqueado = false;
    expect((await outroUsuario()).usuario.perfil).toBe('promotor');
  });

  it('RN-CORE-15: refresh num aparelho bloqueado responde 423 DISPOSITIVO_BLOQUEADO (o app limpa os dados) e revoga a família', async () => {
    const sessao = await login({ dispositivo_id: d });
    e.dispositivos.get(d)!.bloqueado = true;
    const erro = await falha(auth.refresh(contextoPublico({ refresh_token: sessao.refresh_token }, banco, relogio)));
    expect(erro.status).toBe(423);
    expect(erro.codigo).toBe(CODIGO_DISPOSITIVO_BLOQUEADO);
    expect(e.sessoes.every((x) => x.revogado_em !== null)).toBe(true);
  });

  it('RN-CORE-15: refresh inválido num aparelho bloqueado segue 401 (não revela o bloqueio a quem não tem sessão)', async () => {
    await login({ dispositivo_id: d });
    e.dispositivos.get(d)!.bloqueado = true;
    const erro = await falha(auth.refresh(contextoPublico({ refresh_token: 'lixo-lixo-lixo-lixo', dispositivo_id: d }, banco, relogio)));
    expect(erro.status).toBe(401);
  });
});

describe('RF-CORE-01 (T-0026): limite de falhas de login por IP real', () => {
  const de = (ip: string, corpo: Partial<{ email: string; senha: string }> = {}) =>
    auth.login(contextoPublico(LoginSenhaRequestSchema.parse({ codigo_empresa: 'alfa', email: 'ninguem@exemplo.com.br', senha: 'Teste@1234', ...corpo }), banco, relogio, ip));

  it('RF-CORE-01: 10 logins certos seguidos do mesmo IP não dão 429', async () => {
    for (let i = 0; i < 10; i++) await expect(de('203.0.113.1', { email: 'vendedor@exemplo.com.br' })).resolves.toBeTruthy();
  });

  it('RF-CORE-01: falhas seguidas do mesmo IP + e-mail bloqueiam com 429 e a janela reabre em 5 min', async () => {
    for (let i = 0; i < 10; i++) expect((await falha(de('203.0.113.2'))).status).toBe(401);
    const bloqueado = await falha(de('203.0.113.2'));
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.codigo).toBe(CODIGOS_AUTH.muitasTentativas);
    avancar(5);
    expect((await falha(de('203.0.113.2'))).status).toBe(401);
  });

  it('RF-CORE-01: dois IPs diferentes atrás do mesmo proxy não se bloqueiam', async () => {
    for (let i = 0; i < 10; i++) await falha(de('203.0.113.3'));
    expect((await falha(de('203.0.113.3'))).status).toBe(429);
    expect((await falha(de('203.0.113.4'))).status).toBe(401);
    await expect(de('203.0.113.4', { email: 'vendedor@exemplo.com.br' })).resolves.toBeTruthy();
  });
});
