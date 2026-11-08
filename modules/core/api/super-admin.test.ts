import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErroHttpModulo, type AcessoBanco, type ContextoPublico } from '@macuxi/platform-sdk';
import { CODIGOS_PORTAL, EscolherEmpresaPortalSchema, LoginPortalSchema, SessaoPortalSchema } from '../contracts';
import { decidirFalhaSuperAdmin } from '../domain/super-admin';
import { bancoDeTeste, contextoPublico, logSilencioso } from './apoio-teste';
import { assinarTokenPlataforma, chaveDeTentativa, verificarTokenPlataforma } from './seguranca-plataforma';
import { criarSuperAdmin } from './super-admin';
import type { ContaParaLogin, EmpresaDaSessao, EntradaAbrirSessao, LinhaAuditoriaAuth, RepositorioSuperAdmin, SessaoViva } from './super-admin-repositorio';

const SEGREDO = 'segredo-da-plataforma-diferente-do-tenant-0123456789';
const EMAIL = 'ana@cliente.com.br';
const SENHA = 'Senha-Forte-1';

let t0 = new Date('2026-11-07T12:00:00Z');
const relogio = () => t0;
const avancar = (s: number) => {
  t0 = new Date(t0.getTime() + s * 1000);
};

/** Banco em memória com a mesma semântica das funções `sa_*` da 0039. */
function repositorioEmMemoria() {
  const contas: (ContaParaLogin & { email: string })[] = [];
  const tentativas = new Map<string, { falhas: number; bloqueadoAte: Date | null }>();
  const sessoes = new Map<string, { tipo: 'super_admin' | 'admin_cliente'; sa: string | null; empresas: { tenant_id: string; usuario_id: string }[]; atual: string | null; teto: Date; revogada: boolean; ativo: boolean }>();
  const auditoria: LinhaAuditoriaAuth[] = [];
  const consultas: string[] = [];
  const empresasDe = (sid: string): EmpresaDaSessao[] => {
    const s = sessoes.get(sid);
    if (!s) return [];
    if (s.tipo === 'super_admin') return [{ id: 'todas', codigo: 'todas', nome: 'Todas' }];
    return s.empresas.map((e) => {
      const c = contas.find((x) => x.tenant_id === e.tenant_id)!;
      return { id: e.tenant_id, codigo: c.tenant_codigo!, nome: c.tenant_nome! };
    });
  };
  const repo: RepositorioSuperAdmin = {
    async tentativaEstado(chave) {
      const t = tentativas.get(chave);
      return { falhas: t?.falhas ?? 0, bloqueado_ate: t?.bloqueadoAte ?? null };
    },
    async tentativaFalha(chave) {
      const r = decidirFalhaSuperAdmin(tentativas.get(chave) ?? { falhas: 0, bloqueadoAte: null }, relogio());
      tentativas.set(chave, r);
      return { falhas: r.falhas, bloqueado_ate: r.bloqueadoAte };
    },
    async tentativaSucesso(chave) {
      tentativas.delete(chave);
    },
    async contasParaLogin(email) {
      consultas.push('consulta');
      return contas.filter((c) => c.email === email.toLowerCase());
    },
    async abrirSessao(entrada: EntradaAbrirSessao) {
      const sid = randomUUID();
      const teto = new Date(relogio().getTime() + 8 * 3600_000);
      if (entrada.tipo === 'super_admin') sessoes.set(sid, { tipo: 'super_admin', sa: entrada.super_admin_id, empresas: [], atual: null, teto, revogada: false, ativo: true });
      else sessoes.set(sid, { tipo: 'admin_cliente', sa: null, empresas: entrada.empresas, atual: entrada.empresas.length === 1 ? entrada.empresas[0]!.tenant_id : null, teto, revogada: false, ativo: true });
      return { sessao_id: sid, expira_em: teto };
    },
    async escolherEmpresa(sid, tenantId) {
      const s = sessoes.get(sid);
      const e = s?.empresas.find((x) => x.tenant_id === tenantId);
      if (!s || s.tipo !== 'admin_cliente' || !e) return null;
      s.atual = tenantId;
      const c = contas.find((x) => x.tenant_id === tenantId)!;
      return { tenant_id: tenantId, usuario_id: e.usuario_id, codigo: c.tenant_codigo!, nome: c.tenant_nome! };
    },
    async sessaoValida(sid): Promise<SessaoViva | null> {
      const s = sessoes.get(sid);
      if (!s || s.revogada || !s.ativo || s.teto.getTime() <= relogio().getTime()) return null;
      const usuario = s.atual ? (s.empresas.find((e) => e.tenant_id === s.atual)?.usuario_id ?? null) : null;
      return { tipo: s.tipo, super_admin_id: s.sa, tenant_id: s.atual, usuario_id: usuario, expira_em: s.teto };
    },
    async listarEmpresas(sid) {
      return empresasDe(sid);
    },
    async revogarSessao(sid) {
      const s = sessoes.get(sid);
      if (s) s.revogada = true;
    },
    async auditar(l) {
      auditoria.push(l);
    },
  };
  return { repo, contas, tentativas, sessoes, auditoria, consultas };
}

let mem: ReturnType<typeof repositorioEmMemoria>;
let conferencias = 0;
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SA_ID = randomUUID();
const USU_A = randomUUID();
const USU_B = randomUUID();

const senhaFalsa = {
  verificar: async (senha: string, hash: string) => {
    conferencias++;
    return hash === `h:${senha}`;
  },
  gastar: async () => {
    conferencias++;
  },
};
const sa = () => criarSuperAdmin({ segredo: () => SEGREDO, repo: () => mem.repo, senha: senhaFalsa });

const { banco } = bancoDeTeste();
const ctx = <C>(corpo: C, cabecalhos: Record<string, string> = {}): ContextoPublico<C> =>
  ({ ...contextoPublico(corpo, banco as AcessoBanco, relogio, '203.0.113.77'), cabecalhos }) as ContextoPublico<C>;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function falha(p: Promise<unknown>): Promise<ErroHttpModulo> {
  try {
    await p;
  } catch (x) {
    expect(x).toBeInstanceOf(ErroHttpModulo);
    return x as ErroHttpModulo;
  }
  throw new Error('esperava falha');
}

const contaAdmin = (tenant_id: string, conta_id: string, nome: string, senha = SENHA, email = EMAIL) => ({
  email,
  tipo: 'admin_cliente' as const,
  conta_id,
  tenant_id,
  tenant_codigo: nome.toLowerCase(),
  tenant_nome: nome,
  senha_hash: `h:${senha}`,
});

beforeEach(() => {
  t0 = new Date('2026-11-07T12:00:00Z');
  conferencias = 0;
  mem = repositorioEmMemoria();
  logSilencioso.linhas.length = 0;
});

describe('ADR 0031: login do portal só com e-mail e senha', () => {
  it('RN-CORE-32: o contrato do login aceita qualquer senha já gravada (a regra vale só na criação e na troca)', () => {
    expect(LoginPortalSchema.safeParse({ email: 'A@b.co', senha: 'fraca' }).success).toBe(true);
    expect(LoginPortalSchema.safeParse({ email: 'a@b.co', senha: 'x', totp: '123456' }).success).toBe(false);
  });

  it('ADR 0031: admin do cliente com 1 empresa entra direto, com a empresa já escolhida e token cli com tid', async () => {
    mem.contas.push(contaAdmin(TENANT_A, USU_A, 'Alfa'));
    const r = await sa().login(ctx({ email: EMAIL, senha: SENHA }));
    expect(SessaoPortalSchema.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ tipo: 'admin_cliente', empresa: { id: TENANT_A, nome: 'Alfa' } });
    const claims = verificarTokenPlataforma(r.token, t0, SEGREDO);
    expect(claims).toMatchObject({ typ: 'cli', tid: TENANT_A, sub: USU_A, amr: ['pwd'] });
    expect(Date.parse(r.expira_em) - t0.getTime()).toBe(15 * 60_000);
  });

  it('ADR 0031: admin com 2 empresas recebe token sem empresa (sub = sid) e a lista; escolher devolve token novo', async () => {
    mem.contas.push(contaAdmin(TENANT_A, USU_A, 'Alfa'), contaAdmin(TENANT_B, USU_B, 'Beta'));
    const r = await sa().login(ctx({ email: EMAIL, senha: SENHA }));
    expect(SessaoPortalSchema.safeParse(r).success).toBe(true);
    expect(r.empresa).toBeNull();
    expect(r.empresas.map((e) => e.nome)).toEqual(['Alfa', 'Beta']);
    const claims = verificarTokenPlataforma(r.token, t0, SEGREDO)!;
    expect(claims.tid).toBeUndefined();
    expect(claims.sub).toBe(claims.sid);
    // sem empresa: autenticarPortal devolve empresa nula
    expect(await sa().autenticarPortal(bearer(r.token), banco, t0)).toEqual({ tipo: 'admin_cliente', sessao_id: claims.sid, empresa: null });

    const e = await sa().escolherEmpresa(ctx({ tenant_id: TENANT_B }, bearer(r.token)));
    expect(e.empresa).toMatchObject({ id: TENANT_B, nome: 'Beta' });
    expect(verificarTokenPlataforma(e.token, t0, SEGREDO)).toMatchObject({ typ: 'cli', tid: TENANT_B, sub: USU_B });
    expect(await sa().autenticarPortal(bearer(e.token), banco, t0)).toEqual({ tipo: 'admin_cliente', sessao_id: claims.sid, empresa: { tenant_id: TENANT_B, usuario_id: USU_B } });
  });

  it('ADR 0031: admin com senhas diferentes em duas empresas só recebe a que conferiu', async () => {
    mem.contas.push(contaAdmin(TENANT_A, USU_A, 'Alfa', SENHA), contaAdmin(TENANT_B, USU_B, 'Beta', 'Outra-Senha-9!'));
    const r = await sa().login(ctx({ email: EMAIL, senha: SENHA }));
    expect(r.empresas.map((e) => e.nome)).toEqual(['Alfa']);
    expect(r.empresa?.nome).toBe('Alfa');
    // a escolha da outra empresa é recusada
    const erro = await falha(sa().escolherEmpresa(ctx({ tenant_id: TENANT_B }, bearer(r.token))));
    expect(erro.status).toBe(403);
    expect(erro.codigo).toBe(CODIGOS_PORTAL.empresaNaoPermitida);
  });

  it('RN-CORE-34 (T-0094 §8.1): admin com senha temporária não entra no portal — 403 SENHA_A_TROCAR, só para quem acertou a senha', async () => {
    mem.contas.push({ ...contaAdmin(TENANT_A, USU_A, 'Alfa'), trocar_senha: true });
    const erro = await falha(sa().login(ctx({ email: EMAIL, senha: SENHA })));
    expect(erro.status).toBe(403);
    expect(erro.codigo).toBe(CODIGOS_PORTAL.senhaATrocar);
    expect(erro.message).toBe('Antes de entrar no portal, crie a sua senha no backoffice com o código da empresa.');
    // senha errada continua sendo credencial inválida (não revela o estado da conta)
    expect((await falha(sa().login(ctx({ email: EMAIL, senha: 'errada' })))).status).toBe(401);
  });

  it('RN-CORE-34 (T-0094 §8.1): com uma empresa pendente e outra definitiva, só a definitiva entra e a versão da sessão vai ao banco', async () => {
    mem.contas.push({ ...contaAdmin(TENANT_A, USU_A, 'Alfa'), trocar_senha: true }, { ...contaAdmin(TENANT_B, USU_B, 'Beta'), sessao_versao: 4 });
    const r = await sa().login(ctx({ email: EMAIL, senha: SENHA }));
    expect(r.empresas.map((e) => e.nome)).toEqual(['Beta']);
  });

  it('ADR 0031: super-admin com a senha certa tem precedência e a sessão não tem empresa', async () => {
    mem.contas.push(
      contaAdmin(TENANT_A, USU_A, 'Alfa'),
      { email: EMAIL, tipo: 'super_admin', conta_id: SA_ID, tenant_id: null, tenant_codigo: null, tenant_nome: null, senha_hash: `h:${SENHA}` },
    );
    const r = await sa().login(ctx({ email: EMAIL, senha: SENHA }));
    expect(r).toMatchObject({ tipo: 'super_admin', empresa: null, empresas: [] });
    expect(verificarTokenPlataforma(r.token, t0, SEGREDO)).toMatchObject({ typ: 'sa', sub: SA_ID });
    expect(await sa().autenticarPortal(bearer(r.token), banco, t0)).toMatchObject({ tipo: 'super_admin', id: SA_ID });
    // super-admin não escolhe empresa pela rota do cliente
    expect((await falha(sa().escolherEmpresa(ctx({ tenant_id: TENANT_A }, bearer(r.token))))).status).toBe(403);
  });

  it('ADR 0031: super-admin com a senha errada, mas senha certa no admin do cliente, entra como admin do cliente', async () => {
    mem.contas.push(
      contaAdmin(TENANT_A, USU_A, 'Alfa'),
      { email: EMAIL, tipo: 'super_admin', conta_id: SA_ID, tenant_id: null, tenant_codigo: null, tenant_nome: null, senha_hash: 'h:Outra-Senha-9!' },
    );
    const r = await sa().login(ctx({ email: EMAIL, senha: SENHA }));
    expect(r.tipo).toBe('admin_cliente');
  });

  it('RN-CORE-31: e-mail inexistente e senha errada = mesma resposta e o mesmo número de conferências', async () => {
    mem.contas.push(contaAdmin(TENANT_A, USU_A, 'Alfa'));
    const errada = await falha(sa().login(ctx({ email: EMAIL, senha: 'errada' })));
    const conferenciasErrada = conferencias;
    conferencias = 0;
    const inexistente = await falha(sa().login(ctx({ email: 'ninguem@x.com', senha: 'errada' })));
    expect(conferencias).toBe(conferenciasErrada);
    expect(conferencias).toBe(1);
    expect([errada.status, errada.codigo, errada.message]).toEqual([inexistente.status, inexistente.codigo, inexistente.message]);
    expect(errada.status).toBe(401);
    expect(errada.codigo).toBe(CODIGOS_PORTAL.credenciais);
  });

  it('RN-CORE-31: a 5ª falha bloqueia (423) e a 6ª tentativa também dá 423 para e-mail inexistente, sem conferir senha real', async () => {
    for (let i = 1; i <= 4; i++) expect((await falha(sa().login(ctx({ email: 'fantasma@x.com', senha: 'x' })))).status).toBe(401);
    expect((await falha(sa().login(ctx({ email: 'fantasma@x.com', senha: 'x' })))).status).toBe(423);
    const sexta = await falha(sa().login(ctx({ email: 'fantasma@x.com', senha: 'x' })));
    expect(sexta.status).toBe(423);
    expect(sexta.codigo).toBe(CODIGOS_PORTAL.bloqueado);
    expect(mem.consultas.length).toBe(5); // a 6ª nem chegou a consultar contas
  });

  it('RN-CORE-31: bloqueado, a senha certa também recebe 423; passados 15 min volta a entrar', async () => {
    mem.contas.push(contaAdmin(TENANT_A, USU_A, 'Alfa'));
    for (let i = 0; i < 5; i++) await falha(sa().login(ctx({ email: EMAIL, senha: 'errada' })));
    expect((await falha(sa().login(ctx({ email: EMAIL, senha: SENHA })))).status).toBe(423);
    avancar(16 * 60);
    expect((await sa().login(ctx({ email: EMAIL, senha: SENHA }))).tipo).toBe('admin_cliente');
  });

  it('RN-CORE-31: a chave de tentativas é o HMAC do e-mail e o e-mail não vai à tabela', async () => {
    await falha(sa().login(ctx({ email: EMAIL, senha: 'x' })));
    const chaves = [...mem.tentativas.keys()];
    expect(chaves).toEqual([chaveDeTentativa(SEGREDO, EMAIL)]);
    expect(chaves[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(chaves[0]).not.toContain('ana');
  });

  it('ADR 0031: sem o segredo da plataforma o login responde 503 antes de consultar', async () => {
    const semSegredo = criarSuperAdmin({ segredo: () => undefined, repo: () => mem.repo, senha: senhaFalsa });
    const e = await falha(semSegredo.login(ctx({ email: EMAIL, senha: SENHA })));
    expect([e.status, e.codigo]).toEqual([503, CODIGOS_PORTAL.indisponivel]);
    expect(mem.consultas.length).toBe(0);
  });

  it('ADR 0031: auditoria sa.login.ok e sa.login.falha sem e-mail, senha nem token; log vazio de dado pessoal', async () => {
    mem.contas.push(contaAdmin(TENANT_A, USU_A, 'Alfa'));
    await falha(sa().login(ctx({ email: EMAIL, senha: 'Errada-1!' })));
    const ok = await sa().login(ctx({ email: EMAIL, senha: SENHA }));
    expect(mem.auditoria.map((a) => a.acao)).toEqual(['sa.login.falha', 'sa.login.ok']);
    expect(mem.auditoria[0]).toMatchObject({ status: 401, ator_tipo: null, usuario_id: null, ip_prefixo: '203.0.113.0/24', detalhes: { motivo: 'credenciais', falhas: 1 } });
    expect(mem.auditoria[1]).toMatchObject({ status: 200, ator_tipo: 'admin_cliente', usuario_id: USU_A, detalhes: { empresas: 1 } });
    const tudo = JSON.stringify(mem.auditoria) + logSilencioso.linhas.join('');
    for (const proibido of [EMAIL, SENHA, 'Errada-1!', ok.token, 'cliente.com.br']) expect(tudo).not.toContain(proibido);
  });
});

describe('ADR 0031: sessão, renovar, sair e autenticarPortal', () => {
  async function entrarComDuasEmpresas() {
    mem.contas.push(contaAdmin(TENANT_A, USU_A, 'Alfa'), contaAdmin(TENANT_B, USU_B, 'Beta'));
    return sa().login(ctx({ email: EMAIL, senha: SENHA }));
  }

  it('ADR 0031: trocar de empresa mata o token da empresa anterior na hora', async () => {
    const r = await entrarComDuasEmpresas();
    const emA = await sa().escolherEmpresa(ctx({ tenant_id: TENANT_A }, bearer(r.token)));
    expect(await sa().autenticarPortal(bearer(emA.token), banco, t0)).not.toBeNull();
    const emB = await sa().escolherEmpresa(ctx({ tenant_id: TENANT_B }, bearer(emA.token)));
    expect(await sa().autenticarPortal(bearer(emA.token), banco, t0)).toBeNull();
    expect(await sa().autenticarPortal(bearer(r.token), banco, t0)).toBeNull(); // o sem empresa também morre
    expect(await sa().autenticarPortal(bearer(emB.token), banco, t0)).toMatchObject({ empresa: { tenant_id: TENANT_B } });
    expect((await falha(sa().renovar(ctx({}, bearer(emA.token))))).status).toBe(401);
  });

  it('ADR 0031: token sem typ (o da ADR 0029) é recusado', async () => {
    const r = await entrarComDuasEmpresas();
    const claims = verificarTokenPlataforma(r.token, t0, SEGREDO)!;
    const cab = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const corpo = Buffer.from(JSON.stringify({ sub: claims.sub, sid: claims.sid, aud: 'macuxi-plataforma', amr: ['pwd', 'otp'], iat: 1, exp: Math.floor(t0.getTime() / 1000) + 600 })).toString('base64url');
    const { createHmac } = await import('node:crypto');
    const antigo = `${cab}.${corpo}.${createHmac('sha256', SEGREDO).update(`${cab}.${corpo}`).digest('base64url')}`;
    expect(verificarTokenPlataforma(antigo, t0, SEGREDO)).toBeNull();
    expect(await sa().autenticarPortal(bearer(antigo), banco, t0)).toBeNull();
  });

  it('ADR 0031: token com tipo trocado (typ sa para sub de admin) não passa da sessão', async () => {
    const r = await entrarComDuasEmpresas();
    const claims = verificarTokenPlataforma(r.token, t0, SEGREDO)!;
    const falso = assinarTokenPlataforma({ sub: claims.sub, sid: claims.sid, typ: 'sa' }, t0, new Date(t0.getTime() + 600_000), SEGREDO);
    expect(await sa().autenticarPortal(bearer(falso), banco, t0)).toBeNull();
  });

  it('ADR 0031: token de tenant, vencido, de segredo errado ou ausente = null', async () => {
    const r = await entrarComDuasEmpresas();
    expect(await sa().autenticarPortal({}, banco, t0)).toBeNull();
    expect(await sa().autenticarPortal(bearer('x.y.z'), banco, t0)).toBeNull();
    expect(await sa().autenticarPortal(bearer(r.token), banco, new Date(t0.getTime() + 16 * 60_000))).toBeNull();
    const claims = verificarTokenPlataforma(r.token, t0, SEGREDO)!;
    const outroSegredo = assinarTokenPlataforma({ sub: claims.sub, sid: claims.sid, typ: 'cli' }, t0, new Date(t0.getTime() + 600_000), 'outro-segredo-com-mais-de-32-caracteres-xx');
    expect(await sa().autenticarPortal(bearer(outroSegredo), banco, t0)).toBeNull();
    const semSegredo = criarSuperAdmin({ segredo: () => undefined, repo: () => mem.repo, senha: senhaFalsa });
    expect(await semSegredo.autenticarPortal(bearer(r.token), banco, t0)).toBeNull();
  });

  it('ADR 0031: sessão revogada ou admin desativado na empresa derruba o token na hora', async () => {
    const r = await entrarComDuasEmpresas();
    const emA = await sa().escolherEmpresa(ctx({ tenant_id: TENANT_A }, bearer(r.token)));
    const sid = verificarTokenPlataforma(emA.token, t0, SEGREDO)!.sid;
    mem.sessoes.get(sid)!.ativo = false;
    expect(await sa().autenticarPortal(bearer(emA.token), banco, t0)).toBeNull();
  });

  it('ADR 0031: renovar mantém a empresa, o teto de 8 h e dá token novo; o token novo vale', async () => {
    mem.contas.push(contaAdmin(TENANT_A, USU_A, 'Alfa'));
    const r = await sa().login(ctx({ email: EMAIL, senha: SENHA }));
    avancar(10 * 60);
    const n = await sa().renovar(ctx({}, bearer(r.token)));
    expect(n.empresa?.id).toBe(TENANT_A);
    expect(n.sessao_expira_em).toBe(r.sessao_expira_em);
    expect(await sa().autenticarPortal(bearer(n.token), banco, t0)).not.toBeNull();
    avancar(8 * 3600);
    expect((await falha(sa().renovar(ctx({}, bearer(n.token))))).status).toBe(401);
  });

  it('ADR 0031: renovar do super-admin devolve tipo super_admin sem empresa', async () => {
    mem.contas.push({ email: EMAIL, tipo: 'super_admin', conta_id: SA_ID, tenant_id: null, tenant_codigo: null, tenant_nome: null, senha_hash: `h:${SENHA}` });
    const r = await sa().login(ctx({ email: EMAIL, senha: SENHA }));
    const n = await sa().renovar(ctx({}, bearer(r.token)));
    expect(n).toMatchObject({ tipo: 'super_admin', empresa: null, empresas: [] });
  });

  it('ADR 0031: sair revoga a sessão, audita sem dado pessoal e o token deixa de valer', async () => {
    mem.contas.push(contaAdmin(TENANT_A, USU_A, 'Alfa'));
    const r = await sa().login(ctx({ email: EMAIL, senha: SENHA }));
    await sa().sair(ctx({}, bearer(r.token)));
    expect(await sa().autenticarPortal(bearer(r.token), banco, t0)).toBeNull();
    expect((await falha(sa().sair(ctx({}, bearer(r.token))))).status).toBe(401);
    const saida = mem.auditoria.find((a) => a.acao === 'sa.sair');
    expect(saida).toMatchObject({ status: 204, ator_tipo: 'admin_cliente', usuario_id: USU_A });
  });

  it('ADR 0031: escolher empresa fora da lista é 403 EMPRESA_NAO_PERMITIDA e fica auditado; sem token é 401', async () => {
    const r = await entrarComDuasEmpresas();
    const e = await falha(sa().escolherEmpresa(ctx({ tenant_id: randomUUID() }, bearer(r.token))));
    expect([e.status, e.codigo]).toEqual([403, CODIGOS_PORTAL.empresaNaoPermitida]);
    expect(mem.auditoria.at(-1)).toMatchObject({ acao: 'sa.empresa.escolher', status: 403 });
    expect((await falha(sa().escolherEmpresa(ctx({ tenant_id: TENANT_A })))).status).toBe(401);
  });

  it('ADR 0031: o corpo de escolher empresa é estrito (só tenant_id uuid)', () => {
    expect(EscolherEmpresaPortalSchema.safeParse({ tenant_id: TENANT_A }).success).toBe(true);
    expect(EscolherEmpresaPortalSchema.safeParse({ tenant_id: 'alfa' }).success).toBe(false);
    expect(EscolherEmpresaPortalSchema.safeParse({ tenant_id: TENANT_A, extra: 1 }).success).toBe(false);
  });

  it('ADR 0031: códigos do portal sem os de TOTP e de convite e com os da escolha de empresa', () => {
    expect(Object.keys(CODIGOS_PORTAL).sort()).toEqual(['bloqueado', 'credenciais', 'empresaNaoEscolhida', 'empresaNaoPermitida', 'indisponivel', 'senhaATrocar', 'sessao']);
    expect(CODIGOS_PORTAL.empresaNaoPermitida).toBe('EMPRESA_NAO_PERMITIDA');
    expect(CODIGOS_PORTAL.empresaNaoEscolhida).toBe('EMPRESA_NAO_ESCOLHIDA');
  });
});
