import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErroHttpModulo, type ContextoPublico } from '@macuxi/platform-sdk';
import { CODIGOS_PORTAL, LoginPlataformaSchema, PrimeiroAcessoSchema, SegundoFatorSchema, SessaoPlataformaSchema, TotpConfirmadoSchema, TotpConfirmarSchema, TotpInicioSchema } from '../contracts';
import { decidirFalhaSuperAdmin, passoTotp } from '../domain/super-admin';
import { bancoDeTeste, contextoPublico, estadoInicial, fabricaEmMemoria, logSilencioso, SEGREDO } from './apoio-teste';
import { criarAutenticacao } from './autenticacao';
import { assinarAcesso } from './seguranca';
import { cifrarSegredoTotp, codigoTotp, decifrarSegredoTotp, hashCodigoRecuperacao, hashDoDesafio, verificarTokenPlataforma } from './seguranca-plataforma';
import { criarSuperAdmin } from './super-admin';
import type { EtapaDesafio, LinhaAuditoriaAuth, RepositorioSuperAdmin, SuperAdminLinha, TotpEstado } from './super-admin-repositorio';

const SEGREDO_PLAT = 'segredo-da-plataforma-diferente-do-tenant-0123456789';
const CHAVE_TOTP = Buffer.alloc(32, 7).toString('base64');
const CONVITE = 'convite-de-teste-com-mais-de-32-caracteres-ok';
const EMAIL = 'alexandre@macuxi.com.br';
const SENHA = 'Senha-Forte-12345';

let t0 = new Date('2026-11-06T12:00:00Z');
const relogio = () => t0;
const avancar = (s: number) => {
  t0 = new Date(t0.getTime() + s * 1000);
};

/** Banco em memória com a mesma semântica atômica das funções `sa_*` (0035). */
function repositorioEmMemoria() {
  const sas = new Map<string, SuperAdminLinha & { senha_hash: string; totp: TotpEstado; confirmado: boolean }>();
  const desafios = new Map<string, { sa: string; etapa: EtapaDesafio; expira: Date; usado: boolean }>();
  const sessoes = new Map<string, { sa: string; teto: Date; revogada: boolean }>();
  const auditoria: LinhaAuditoriaAuth[] = [];
  const hashes = new Map<string, Set<string>>();
  const repo: RepositorioSuperAdmin = {
    existe: async () => sas.size > 0,
    async criarPrimeiro(email, nome, senhaHash) {
      if (sas.size > 0) return null;
      const id = randomUUID();
      sas.set(id, { id, email, nome, senha_hash: senhaHash, ativo: true, bloqueado_ate: null, falhas: 0, totp_confirmado: false, confirmado: false, totp: { segredo_cifrado: null, pendente_cifrado: null, ultimo_passo: 0, recuperacao_restantes: 0 } });
      return id;
    },
    paraLogin: async (email) => [...sas.values()].find((s) => s.email === email) ?? null,
    porId: async (id) => sas.get(id) ?? null,
    async registrarFalha(id) {
      const s = sas.get(id)!;
      const c = decidirFalhaSuperAdmin({ falhas: s.falhas, bloqueadoAte: s.bloqueado_ate }, relogio());
      s.falhas = c.falhas;
      s.bloqueado_ate = c.bloqueadoAte;
      return { falhas: c.falhas, bloqueado_ate: c.bloqueadoAte };
    },
    async registrarSucesso(id) {
      const s = sas.get(id)!;
      s.falhas = 0;
      s.bloqueado_ate = null;
    },
    totpEstado: async (id) => ({ ...sas.get(id)!.totp }),
    async gravarTotpPendente(id, c) {
      sas.get(id)!.totp.pendente_cifrado = c;
    },
    async confirmarTotp(id, passo, hs) {
      const s = sas.get(id)!;
      if (!s.totp.pendente_cifrado || s.totp_confirmado) return false;
      s.totp = { segredo_cifrado: s.totp.pendente_cifrado, pendente_cifrado: null, ultimo_passo: passo, recuperacao_restantes: hs.length };
      s.totp_confirmado = true;
      hashes.set(id, new Set(hs));
      return true;
    },
    async marcarPasso(id, passo) {
      const s = sas.get(id)!;
      if (s.totp.ultimo_passo >= passo) return false;
      s.totp.ultimo_passo = passo;
      return true;
    },
    async usarRecuperacao(id, hash) {
      const h = hashes.get(id);
      if (!h?.delete(hash)) return null;
      sas.get(id)!.totp.recuperacao_restantes = h.size;
      return h.size;
    },
    async regerarRecuperacao(id, hs) {
      hashes.set(id, new Set(hs));
      sas.get(id)!.totp.recuperacao_restantes = hs.length;
    },
    async abrirDesafio(id, hash) {
      const s = sas.get(id)!;
      if (!s.ativo || (s.bloqueado_ate && s.bloqueado_ate.getTime() > relogio().getTime())) return null;
      for (const d of desafios.values()) if (d.sa === id) d.usado = true; // um desafio aberto por vez
      const etapa: EtapaDesafio = s.totp_confirmado ? 'segundo_fator' : 'cadastrar_totp';
      const expira = new Date(relogio().getTime() + 5 * 60_000);
      desafios.set(hash, { sa: id, etapa, expira, usado: false });
      return { etapa, expira_em: expira };
    },
    async lerDesafio(hash) {
      const d = desafios.get(hash);
      const s = d && sas.get(d.sa);
      const livre = !!s && s.ativo && !(s.bloqueado_ate && s.bloqueado_ate.getTime() > relogio().getTime());
      return d && livre && !d.usado && d.expira.getTime() > relogio().getTime() ? { super_admin_id: d.sa, etapa: d.etapa } : null;
    },
    async abrirSessao(hash) {
      const d = desafios.get(hash);
      if (!d || d.usado || d.expira.getTime() <= relogio().getTime()) return null;
      d.usado = true; // uso único
      if (!sas.get(d.sa)!.totp_confirmado) return null;
      const sessao_id = randomUUID();
      const expira_em = new Date(relogio().getTime() + 8 * 3600_000);
      sessoes.set(sessao_id, { sa: d.sa, teto: expira_em, revogada: false });
      return { sessao_id, super_admin_id: d.sa, expira_em };
    },
    async sessaoValida(sid) {
      const s = sessoes.get(sid);
      return s && !s.revogada && s.teto.getTime() > relogio().getTime() ? { super_admin_id: s.sa, expira_em: s.teto } : null;
    },
    async revogarSessao(sid) {
      sessoes.get(sid)!.revogada = true;
    },
    async auditar(l) {
      auditoria.push(l);
    },
  };
  return { repo, sas, auditoria, hashes };
}

let mem: ReturnType<typeof repositorioEmMemoria>;
let sa: ReturnType<typeof criarSuperAdmin>;
let convite: string | undefined;
const { banco } = bancoDeTeste();

const ctx = <C>(corpo: C, cabecalhos: Record<string, string> = {}): ContextoPublico<C> =>
  ({ ...contextoPublico(corpo, banco, relogio, '203.0.113.77'), cabecalhos }) as ContextoPublico<C>;

async function falha(p: Promise<unknown>): Promise<ErroHttpModulo> {
  try {
    await p;
  } catch (x) {
    expect(x).toBeInstanceOf(ErroHttpModulo);
    return x as ErroHttpModulo;
  }
  throw new Error('deveria ter falhado');
}

const primeiroAcesso = (c = CONVITE) => sa.primeiroAcesso(ctx(PrimeiroAcessoSchema.parse({ email: EMAIL, nome: 'Alexandre', senha: SENHA, convite: c })));
const login = (senha = SENHA, email = EMAIL) => sa.login(ctx(LoginPlataformaSchema.parse({ email, senha })));

/** Cadastra o TOTP e devolve o segredo (para calcular códigos) e a sessão. */
async function cadastrar() {
  const etapa = await primeiroAcesso();
  const ini = TotpInicioSchema.parse(await sa.totpIniciar(ctx({ desafio: etapa.desafio })));
  const segredo = Buffer.from(decodeBase32(ini.segredo_base32));
  const codigo = codigoTotp(segredo, passoTotp(t0));
  const conf = TotpConfirmadoSchema.parse(await sa.totpConfirmar(ctx(TotpConfirmarSchema.parse({ desafio: etapa.desafio, codigo }))));
  return { segredo, conf, ini };
}

function decodeBase32(s: string): number[] {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let v = 0;
  const out: number[] = [];
  for (const ch of s) {
    v = (v << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
      v &= (1 << bits) - 1;
    }
  }
  return out;
}

beforeEach(() => {
  t0 = new Date('2026-11-06T12:00:00Z');
  convite = CONVITE;
  mem = repositorioEmMemoria();
  sa = criarSuperAdmin({ segredo: () => SEGREDO_PLAT, chaveTotp: () => CHAVE_TOTP, convite: () => convite, repo: () => mem.repo });
});

describe('RN-CORE-31/ADR 0029: primeiro acesso por convite', () => {
  it('RN-CORE-31: sem MACUXI_SUPERADMIN_CONVITE a rota responde 503 e nada é criado', async () => {
    convite = undefined;
    expect((await falha(primeiroAcesso())).status).toBe(503);
    convite = 'curto';
    expect((await falha(sa.primeiroAcesso(ctx({ email: EMAIL, nome: 'Admin', senha: SENHA, convite: 'curto' })))).status).toBe(503);
    expect(mem.sas.size).toBe(0);
  });

  it('RN-CORE-31: convite errado = 401 e auditado; certo cria o super-admin e pede o cadastro do TOTP', async () => {
    const erro = await falha(primeiroAcesso('x'.repeat(40)));
    expect([erro.status, erro.codigo]).toEqual([401, CODIGOS_PORTAL.conviteInvalido]);
    expect(mem.sas.size).toBe(0);
    const etapa = await primeiroAcesso();
    expect(etapa.etapa).toBe('cadastrar_totp');
    expect(mem.sas.size).toBe(1);
    expect([...mem.sas.values()][0]!.senha_hash).toMatch(/^\$argon2id\$/);
    expect(mem.auditoria.map((a) => a.acao)).toEqual(['sa.primeiro_acesso', 'sa.primeiro_acesso']);
  });

  it('RN-CORE-31: depois do primeiro super-admin, 410 PRIMEIRO_ACESSO_ENCERRADO para sempre', async () => {
    await primeiroAcesso();
    const erro = await falha(primeiroAcesso());
    expect([erro.status, erro.codigo]).toEqual([410, CODIGOS_PORTAL.primeiroAcessoEncerrado]);
    expect(mem.sas.size).toBe(1);
  });

  it('RN-CORE-31: sem os segredos de TOTP ou JWT da plataforma, 503 (falha fechada)', async () => {
    const semChave = criarSuperAdmin({ segredo: () => SEGREDO_PLAT, chaveTotp: () => undefined, convite: () => CONVITE, repo: () => mem.repo });
    expect((await falha(semChave.login(ctx({ email: EMAIL, senha: SENHA })))).status).toBe(503);
    const semSegredo = criarSuperAdmin({ segredo: () => undefined, chaveTotp: () => CHAVE_TOTP, convite: () => CONVITE, repo: () => mem.repo });
    expect((await falha(semSegredo.login(ctx({ email: EMAIL, senha: SENHA })))).status).toBe(503);
  });
});

describe('RN-CORE-31/ADR 0029: cadastro do TOTP e sessão', () => {
  it('RN-CORE-31: confirmar o TOTP devolve 10 códigos de recuperação (uma vez) e a sessão; o banco guarda só hash e segredo cifrado', async () => {
    const { conf, ini } = await cadastrar();
    expect(conf.codigos_recuperacao).toHaveLength(10);
    const s = [...mem.sas.values()][0]!;
    const guardado = JSON.stringify([s.totp, [...mem.hashes.get(s.id)!]]);
    for (const c of conf.codigos_recuperacao) expect(guardado).not.toContain(c.replace('-', ''));
    expect(guardado).not.toContain(ini.segredo_base32);
    expect(s.totp.segredo_cifrado).toMatch(/^v1\./);
    const claims = verificarTokenPlataforma(conf.sessao.token, t0, SEGREDO_PLAT)!;
    expect(claims).toMatchObject({ sub: s.id, aud: 'macuxi-plataforma', amr: ['pwd', 'otp'] });
    expect(claims.exp - claims.iat).toBe(900);
    expect(SessaoPlataformaSchema.parse(conf.sessao).sessao_expira_em).toBe('2026-11-06T20:00:00.000Z');
    expect(mem.auditoria.map((a) => a.acao)).toEqual(expect.arrayContaining(['sa.totp.cadastrar', 'sa.login.ok']));
  });

  it('RN-CORE-31: código errado no cadastro não cria o TOTP e conta falha', async () => {
    const etapa = await primeiroAcesso();
    await sa.totpIniciar(ctx({ desafio: etapa.desafio }));
    const erro = await falha(sa.totpConfirmar(ctx({ desafio: etapa.desafio, codigo: '000000' })));
    expect([erro.status, erro.codigo]).toEqual([401, CODIGOS_PORTAL.codigoInvalido]);
    expect([...mem.sas.values()][0]!.totp_confirmado).toBe(false);
    expect([...mem.sas.values()][0]!.falhas).toBe(1);
  });

  it('RN-CORE-31: confirmar sem ter iniciado o cadastro = 409', async () => {
    const etapa = await primeiroAcesso();
    expect((await falha(sa.totpConfirmar(ctx({ desafio: etapa.desafio, codigo: '123456' })))).status).toBe(409);
  });

  it('RN-CORE-31: o desafio de cadastro é de uso único', async () => {
    const etapa = await primeiroAcesso();
    const ini = TotpInicioSchema.parse(await sa.totpIniciar(ctx({ desafio: etapa.desafio })));
    const codigo = codigoTotp(Buffer.from(decodeBase32(ini.segredo_base32)), passoTotp(t0));
    await sa.totpConfirmar(ctx({ desafio: etapa.desafio, codigo }));
    expect((await falha(sa.totpConfirmar(ctx({ desafio: etapa.desafio, codigo })))).codigo).toBe(CODIGOS_PORTAL.desafio);
  });
});

describe('RN-CORE-31/ADR 0029: login em 2 etapas', () => {
  it('RN-CORE-31: e-mail inexistente e senha errada dão a MESMA resposta', async () => {
    await cadastrar();
    const a = await falha(login('senha-errada-qualquer', EMAIL));
    const b = await falha(login(SENHA, 'ninguem@macuxi.com.br'));
    expect([a.status, a.codigo, a.message]).toEqual([b.status, b.codigo, b.message]);
    expect(a.status).toBe(401);
    expect(a.codigo).toBe(CODIGOS_PORTAL.credenciais);
  });

  it('RN-CORE-31: senha certa abre o desafio de 5 min; código TOTP abre a sessão', async () => {
    const { segredo } = await cadastrar();
    avancar(31);
    const etapa = await login();
    expect(etapa.etapa).toBe('segundo_fator');
    expect(new Date(etapa.expira_em).getTime() - t0.getTime()).toBe(5 * 60_000);
    const codigo = codigoTotp(segredo, passoTotp(t0));
    const sessao = SessaoPlataformaSchema.parse(await sa.segundoFator(ctx(SegundoFatorSchema.parse({ desafio: etapa.desafio, codigo }))));
    expect(sessao.recuperacao_restantes).toBe(10);
    expect(await sa.autenticarSuperAdmin({ authorization: `Bearer ${sessao.token}` }, banco, t0)).toMatchObject({ id: expect.any(String), sessao_id: expect.any(String) });
  });

  it('RN-CORE-31: o mesmo código TOTP (mesmo passo) não vale duas vezes', async () => {
    const { segredo } = await cadastrar();
    avancar(31); // o passo do cadastro já foi usado; o login usa o passo seguinte
    const codigo = codigoTotp(segredo, passoTotp(t0));
    const e1 = await login();
    await sa.segundoFator(ctx({ desafio: e1.desafio, codigo }));
    const e2 = await login();
    const erro = await falha(sa.segundoFator(ctx({ desafio: e2.desafio, codigo })));
    expect([erro.status, erro.codigo]).toEqual([401, CODIGOS_PORTAL.codigoInvalido]);
  });

  it('RN-CORE-31: código de recuperação vale uma vez só e baixa o contador', async () => {
    const { conf } = await cadastrar();
    const codigo = conf.codigos_recuperacao[3]!;
    const e1 = await login();
    const s = SessaoPlataformaSchema.parse(await sa.segundoFator(ctx({ desafio: e1.desafio, codigo_recuperacao: codigo.toLowerCase() })));
    expect(s.recuperacao_restantes).toBe(9);
    const e2 = await login();
    expect((await falha(sa.segundoFator(ctx({ desafio: e2.desafio, codigo_recuperacao: codigo })))).status).toBe(401);
    expect(mem.auditoria.map((a) => a.acao)).toContain('sa.recuperacao.usar');
  });

  it('RN-CORE-31: o desafio é de uso único e vence em 5 min', async () => {
    const { segredo } = await cadastrar();
    avancar(31);
    const e1 = await login();
    avancar(5 * 60 + 1);
    expect((await falha(sa.segundoFator(ctx({ desafio: e1.desafio, codigo: codigoTotp(segredo, passoTotp(t0)) })))).codigo).toBe(CODIGOS_PORTAL.desafio);
    const e2 = await login();
    const codigo = codigoTotp(segredo, passoTotp(t0));
    await sa.segundoFator(ctx({ desafio: e2.desafio, codigo }));
    avancar(31);
    expect((await falha(sa.segundoFator(ctx({ desafio: e2.desafio, codigo: codigoTotp(segredo, passoTotp(t0)) })))).codigo).toBe(CODIGOS_PORTAL.desafio);
  });

  it('RN-CORE-31: 5 falhas (senha ou código) bloqueiam por 15 min com 423, mesmo com a senha certa', async () => {
    await cadastrar();
    for (let i = 0; i < 4; i++) expect((await falha(login('errada-errada-1'))).status).toBe(401);
    const quinta = await falha(login('errada-errada-1'));
    expect(quinta.status).toBe(401); // a senha errada nunca revela o bloqueio
    const bloqueado = await falha(login());
    expect([bloqueado.status, bloqueado.codigo]).toEqual([423, CODIGOS_PORTAL.bloqueado]);
    avancar(16 * 60);
    expect((await login()).etapa).toBe('segundo_fator');
  });

  it('RN-CORE-31: a 5ª falha de código também bloqueia (423) e senha certa não zera a contagem', async () => {
    await cadastrar();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const e = await login(); // senha certa a cada tentativa
      statuses.push((await falha(sa.segundoFator(ctx({ desafio: e.desafio, codigo: '000000' })))).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 423]);
    expect((await falha(login())).status).toBe(423);
  });

  it('RN-CORE-31: AAD trocada ou chave errada não decifra o segredo do TOTP', () => {
    const id = randomUUID();
    const cifrado = cifrarSegredoTotp(Buffer.from('12345678901234567890'), CHAVE_TOTP, id);
    expect(cifrado).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(decifrarSegredoTotp(cifrado, CHAVE_TOTP, id)?.toString()).toBe('12345678901234567890');
    expect(decifrarSegredoTotp(cifrado, CHAVE_TOTP, randomUUID())).toBeNull();
    expect(decifrarSegredoTotp(cifrado, Buffer.alloc(32, 9).toString('base64'), id)).toBeNull();
    expect(decifrarSegredoTotp(cifrado.slice(0, -2) + 'AA', CHAVE_TOTP, id)).toBeNull();
    expect(decifrarSegredoTotp('lixo', CHAVE_TOTP, id)).toBeNull();
  });
});

describe('RN-CORE-31/ADR 0029: sessão, renovar, sair e separação do token de tenant', () => {
  it('RN-CORE-31: renovar emite novo token dentro do teto; sair revoga na hora', async () => {
    const { conf } = await cadastrar();
    const h = { authorization: `Bearer ${conf.sessao.token}` };
    avancar(600);
    const novo = SessaoPlataformaSchema.parse(await sa.renovar(ctx(undefined, h)));
    expect(novo.sessao_expira_em).toBe(conf.sessao.sessao_expira_em);
    expect(await sa.autenticarSuperAdmin({ authorization: `Bearer ${novo.token}` }, banco, t0)).not.toBeNull();
    await sa.sair(ctx(undefined, { authorization: `Bearer ${novo.token}` }));
    expect(await sa.autenticarSuperAdmin({ authorization: `Bearer ${novo.token}` }, banco, t0)).toBeNull();
    expect((await falha(sa.renovar(ctx(undefined, h)))).status).toBe(401);
    expect(mem.auditoria.map((a) => a.acao)).toContain('sa.sair');
  });

  it('RN-CORE-31: token vencido ou depois do teto de 8 h é recusado', async () => {
    const { conf } = await cadastrar();
    avancar(16 * 60);
    expect(await sa.autenticarSuperAdmin({ authorization: `Bearer ${conf.sessao.token}` }, banco, t0)).toBeNull();
  });

  it('RN-CORE-31: regerar os códigos exige o TOTP do momento e invalida os antigos', async () => {
    const { conf, segredo } = await cadastrar();
    const h = { authorization: `Bearer ${conf.sessao.token}` };
    expect((await falha(sa.regerarRecuperacao(ctx({ codigo: '000000' }, h)))).status).toBe(401);
    avancar(31);
    const novos = await sa.regerarRecuperacao(ctx({ codigo: codigoTotp(segredo, passoTotp(t0)) }, h));
    expect(novos.codigos_recuperacao).toHaveLength(10);
    const s = [...mem.sas.values()][0]!;
    expect(mem.hashes.get(s.id)!.has(hashCodigoRecuperacao(conf.codigos_recuperacao[0]!))).toBe(false);
    expect(mem.hashes.get(s.id)!.has(hashCodigoRecuperacao(novos.codigos_recuperacao[0]!))).toBe(true);
  });

  it('RN-CORE-31: token de tenant não vale em autenticarSuperAdmin e o de plataforma não vale em autenticar', async () => {
    const { conf } = await cadastrar();
    const tenantToken = assinarAcesso({ sub: randomUUID(), tid: randomUUID(), perfil: 'admin' }, t0, new Date(t0.getTime() + 900_000), SEGREDO_PLAT);
    expect(await sa.autenticarSuperAdmin({ authorization: `Bearer ${tenantToken}` }, banco, t0)).toBeNull();
    // mesmo assinado com o segredo da plataforma, sem aud/sid não passa; e o contrário:
    const e = await estadoInicial();
    const auth = criarAutenticacao({ segredo: () => SEGREDO, repos: fabricaEmMemoria(e) });
    expect(await auth.autenticar({ authorization: `Bearer ${conf.sessao.token}` }, banco, t0)).toBeNull();
    // inclusive se o segredo do tenant fosse igual ao da plataforma: o token de plataforma não tem tid/perfil
    const igual = criarAutenticacao({ segredo: () => SEGREDO_PLAT, repos: fabricaEmMemoria(e) });
    expect(await igual.autenticar({ authorization: `Bearer ${conf.sessao.token}` }, banco, t0)).toBeNull();
    expect(await sa.autenticarSuperAdmin({}, banco, t0)).toBeNull();
    expect(await sa.autenticarSuperAdmin({ authorization: 'Bearer lixo.lixo.lixo' }, banco, t0)).toBeNull();
  });
});

describe('ADR 0029 / regra 8: auditoria e log sem dado pessoal, senha, código ou segredo', () => {
  it('RN-CORE-31: nada sensível na auditoria nem no log, em todo o fluxo', async () => {
    const { conf, segredo, ini } = await cadastrar();
    avancar(31);
    const e = await login();
    const codigo = codigoTotp(segredo, passoTotp(t0));
    await sa.segundoFator(ctx({ desafio: e.desafio, codigo }));
    await falha(login('errada-errada-1'));
    await falha(login(SENHA, 'ninguem@macuxi.com.br'));
    await falha(sa.segundoFator(ctx({ desafio: (await login()).desafio, codigo: '111111' })));
    const alvo = JSON.stringify({ auditoria: mem.auditoria, log: logSilencioso.linhas });
    const sensiveis = [EMAIL, 'ninguem@macuxi', SENHA, 'errada-errada', CONVITE, codigo, '111111', ini.segredo_base32, ini.otpauth_uri, e.desafio, hashDoDesafio(e.desafio), conf.sessao.token, ...conf.codigos_recuperacao, ...conf.codigos_recuperacao.map((c) => c.replace('-', ''))];
    for (const s of sensiveis) expect(alvo, s).not.toContain(s);
    expect(mem.auditoria.every((a) => a.ip_prefixo === '203.0.113.0/24')).toBe(true);
    expect(new Set(mem.auditoria.map((a) => a.acao))).toEqual(new Set(['sa.primeiro_acesso', 'sa.totp.cadastrar', 'sa.login.ok', 'sa.login.falha']));
  });
});
