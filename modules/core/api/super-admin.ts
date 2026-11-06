/**
 * Identidade do super-admin de plataforma (T-0087; ADR 0029; RN-CORE-31; desenho docs/desenho/T-0087.md §2 e §4).
 * Rotas públicas `plataforma/auth/*`: primeiro acesso por convite, login em 2 etapas (senha -> desafio -> código TOTP ou de
 * recuperação), cadastro do TOTP, renovar, sair e regerar códigos; mais `autenticarSuperAdmin` (token + sessão viva no banco).
 * Segurança:
 * - e-mail inexistente e senha errada: MESMA resposta e o mesmo tempo (`gastarTempoDeSenha`);
 * - 5 falhas (senha ou código) = 423 por 15 min, contadas no banco; senha certa NÃO zera a contagem (só o 2º fator completo);
 * - desafio de uso único e 5 min; o mesmo passo do TOTP nunca vale duas vezes; código de recuperação é de uso único;
 * - sem os 3 segredos do portal a rota responde 503 (falha fechada);
 * - tudo auditado em `plataforma.auditoria_plataforma` (sa_auditar), sem e-mail, senha, código nem segredo; nada disso vai a log.
 */
import {
  type AcessoBanco,
  type ContextoPublico,
  type SuperAdminAutenticado,
} from '@macuxi/platform-sdk';
import {
  base32Codificar,
  estadoDoSuperAdmin,
  expiracaoDoTokenPlataforma,
  uriOtpauth,
} from '../domain/super-admin';
import {
  CODIGOS_PORTAL,
  type EtapaLogin,
  type LoginPlataforma,
  type PrimeiroAcesso,
  type RegerarRecuperacao,
  type SegundoFator,
  type SessaoPlataforma,
  type TotpConfirmado,
  type TotpConfirmar,
  type TotpInicio,
  type DesafioEntrada,
} from '../contracts/plataforma';
import { erroHttp } from './erros';
import { fabricaSuperAdminSql, type EtapaDesafio, type FabricaSuperAdmin, type LinhaAuditoriaAuth, type RepositorioSuperAdmin, type SuperAdminLinha } from './super-admin-repositorio';
import { gastarTempoDeSenha, hashSenha, tokenDoCabecalho, verificarSenha } from './seguranca';
import {
  ConfiguracaoPlataformaInvalida,
  assinarTokenPlataforma,
  cifrarSegredoTotp,
  conviteConfere,
  decifrarSegredoTotp,
  exigirSegredoPlataforma,
  gerarCodigosRecuperacao,
  hashCodigoRecuperacao,
  hashDoDesafio,
  novoDesafio,
  novoSegredoTotp,
  verificarTokenPlataforma,
  verificarTotp,
} from './seguranca-plataforma';

export interface DepsSuperAdmin {
  /** `MACUXI_JWT_SEGREDO_PLATAFORMA` (lido a cada uso). */
  segredo(): string | undefined;
  /** `MACUXI_CHAVE_TOTP` (32 bytes em base64). */
  chaveTotp(): string | undefined;
  /** `MACUXI_SUPERADMIN_CONVITE` (≥ 32 caracteres). */
  convite(): string | undefined;
  repo?: FabricaSuperAdmin;
}

const MENSAGEM_CREDENCIAIS = 'E-mail ou senha incorretos. Confira e tente de novo.';
const MENSAGEM_BLOQUEADO = 'Acesso bloqueado por tentativas erradas. Tente de novo em 15 minutos.';
const MENSAGEM_DESAFIO = 'Esta etapa expirou. Volte e entre de novo com e-mail e senha.';
const MENSAGEM_CODIGO = 'Código incorreto. Confira o aplicativo autenticador e tente de novo.';
const MENSAGEM_SESSAO = 'Sua sessão do portal expirou. Entre de novo.';

/** Prefixo do IP para a auditoria (LGPD): IPv4 /24, IPv6 /48. */
export function prefixoDoIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(':')) {
    const grupos = (ip.split('::')[0] ?? '').split(':').filter(Boolean).slice(0, 3);
    while (grupos.length < 3) grupos.push('0');
    return `${grupos.join(':').toLowerCase()}::/48`;
  }
  return null;
}

type Ctx<C> = ContextoPublico<C>;

export function criarSuperAdmin(deps: DepsSuperAdmin) {
  const fabrica = deps.repo ?? fabricaSuperAdminSql;

  /** Confere os 3 segredos; sem eles, 503 antes de qualquer consulta. */
  const config = (exigeConvite = false): { segredo: string; chave: string | undefined } => {
    try {
      const segredo = exigirSegredoPlataforma(deps.segredo());
      const chave = deps.chaveTotp();
      cifrarSegredoTotp(Buffer.alloc(1), chave, '0'); // valida a chave (32 bytes)
      if (exigeConvite && (deps.convite()?.length ?? 0) < 32) throw new ConfiguracaoPlataformaInvalida('MACUXI_SUPERADMIN_CONVITE');
      return { segredo, chave };
    } catch (e) {
      if (e instanceof ConfiguracaoPlataformaInvalida) throw erroHttp(503, CODIGOS_PORTAL.indisponivel, 'O acesso ao portal está indisponível no momento. Avise o suporte da Macuxi.');
      throw e;
    }
  };

  const auditar = async (repo: RepositorioSuperAdmin, ctx: Ctx<unknown>, acao: string, status: number, rota: string, quem: { superAdminId?: string | null; sessaoId?: string | null }, detalhes?: LinhaAuditoriaAuth['detalhes']): Promise<void> => {
    await repo.auditar({
      super_admin_id: quem.superAdminId ?? null,
      sessao_id: quem.sessaoId ?? null,
      acao,
      metodo: 'POST',
      rota,
      status,
      request_id: ctx.requestId,
      ip_prefixo: prefixoDoIp(ctx.ip),
      ...(detalhes ? { detalhes } : {}),
    });
  };

  /** A etapa e o prazo (5 min) vêm do banco; o desafio em claro só vai ao chamador. */
  async function abrirDesafio(repo: RepositorioSuperAdmin, id: string): Promise<EtapaLogin> {
    const { desafio, hash } = novoDesafio();
    const aberto = await repo.abrirDesafio(id, hash);
    if (!aberto) throw erroHttp(401, CODIGOS_PORTAL.credenciais, MENSAGEM_CREDENCIAIS);
    return { etapa: aberto.etapa, desafio, expira_em: aberto.expira_em.toISOString() };
  }

  /** CONSOME o desafio, abre a sessão (teto de 8 h, do banco) e emite o primeiro token de 15 min. */
  async function abrirSessao(repo: RepositorioSuperAdmin, id: string, hashDoDesafio: string, agora: Date, segredo: string, restantes: number): Promise<{ sessao: SessaoPlataforma; sid: string }> {
    const aberta = await repo.abrirSessao(hashDoDesafio);
    if (!aberta || aberta.super_admin_id !== id) throw erroHttp(401, CODIGOS_PORTAL.desafio, MENSAGEM_DESAFIO);
    const sid = aberta.sessao_id;
    const teto = aberta.expira_em;
    const expiraEm = expiracaoDoTokenPlataforma(agora, teto);
    return {
      sid,
      sessao: {
        token: assinarTokenPlataforma({ sub: id, sid }, agora, expiraEm, segredo),
        expira_em: expiraEm.toISOString(),
        sessao_expira_em: teto.toISOString(),
        recuperacao_restantes: restantes,
      },
    };
  }

  /** Desafio vivo da etapa pedida e o super-admin dele; qualquer problema = 401 DESAFIO_INVALIDO. */
  async function desafioDaEtapa(repo: RepositorioSuperAdmin, desafio: string, etapa: EtapaDesafio, agora: Date): Promise<{ sa: SuperAdminLinha; hash: string }> {
    const hash = hashDoDesafio(desafio);
    const d = await repo.lerDesafio(hash);
    const sa = d && d.etapa === etapa ? await repo.porId(d.super_admin_id) : null;
    if (!sa || !sa.ativo) throw erroHttp(401, CODIGOS_PORTAL.desafio, MENSAGEM_DESAFIO);
    if (estadoDoSuperAdmin({ ativo: sa.ativo, bloqueadoAte: sa.bloqueado_ate, agora }) === 'bloqueado') throw erroHttp(423, CODIGOS_PORTAL.bloqueado, MENSAGEM_BLOQUEADO);
    return { sa, hash };
  }

  /** Falha de código/senha: conta no banco, audita e responde 401 (ou 423 se esta foi a 5ª). */
  async function falharCodigo(repo: RepositorioSuperAdmin, ctx: Ctx<unknown>, rota: string, saId: string, motivo: string): Promise<never> {
    const r = await repo.registrarFalha(saId);
    const bloqueou = r.bloqueado_ate !== null && r.bloqueado_ate.getTime() > ctx.agora().getTime();
    await auditar(repo, ctx, 'sa.login.falha', bloqueou ? 423 : 401, rota, { superAdminId: saId }, { motivo, falhas: r.falhas });
    if (bloqueou) throw erroHttp(423, CODIGOS_PORTAL.bloqueado, MENSAGEM_BLOQUEADO);
    throw erroHttp(401, CODIGOS_PORTAL.codigoInvalido, MENSAGEM_CODIGO);
  }

  async function primeiroAcesso(ctx: Ctx<PrimeiroAcesso>): Promise<EtapaLogin> {
    config(true);
    const repo = fabrica(ctx.banco);
    const rota = '/v1/plataforma/auth/primeiro-acesso';
    if (await repo.existe()) throw erroHttp(410, CODIGOS_PORTAL.primeiroAcessoEncerrado, 'O primeiro acesso já foi feito. Entre com seu e-mail e senha.');
    if (!conviteConfere(deps.convite(), ctx.corpo.convite)) {
      await auditar(repo, ctx, 'sa.primeiro_acesso', 401, rota, {}, { motivo: 'convite' });
      throw erroHttp(401, CODIGOS_PORTAL.conviteInvalido, 'Código de convite incorreto. Confira o valor combinado com a Macuxi.');
    }
    const id = await repo.criarPrimeiro(ctx.corpo.email, ctx.corpo.nome, await hashSenha(ctx.corpo.senha));
    if (!id) throw erroHttp(410, CODIGOS_PORTAL.primeiroAcessoEncerrado, 'O primeiro acesso já foi feito. Entre com seu e-mail e senha.');
    await auditar(repo, ctx, 'sa.primeiro_acesso', 200, rota, { superAdminId: id });
    return abrirDesafio(repo, id);
  }

  async function login(ctx: Ctx<LoginPlataforma>): Promise<EtapaLogin> {
    config();
    const repo = fabrica(ctx.banco);
    const rota = '/v1/plataforma/auth/login';
    const agora = ctx.agora();
    const sa = await repo.paraLogin(ctx.corpo.email);
    if (!sa) {
      await gastarTempoDeSenha(ctx.corpo.senha);
      await auditar(repo, ctx, 'sa.login.falha', 401, rota, {}, { motivo: 'credenciais' });
      throw erroHttp(401, CODIGOS_PORTAL.credenciais, MENSAGEM_CREDENCIAIS);
    }
    const estado = estadoDoSuperAdmin({ ativo: sa.ativo, bloqueadoAte: sa.bloqueado_ate, agora });
    const certa = await verificarSenha(ctx.corpo.senha, sa.senha_hash);
    if (!certa || estado === 'inativo') {
      // só conta tentativa de quem pode tentar; bloqueado não estende o bloqueio nem revela o estado
      if (estado === 'ok') await repo.registrarFalha(sa.id);
      await auditar(repo, ctx, 'sa.login.falha', 401, rota, { superAdminId: sa.id }, { motivo: 'credenciais' });
      throw erroHttp(401, CODIGOS_PORTAL.credenciais, MENSAGEM_CREDENCIAIS);
    }
    if (estado === 'bloqueado') {
      await auditar(repo, ctx, 'sa.login.falha', 423, rota, { superAdminId: sa.id }, { motivo: 'bloqueado' });
      throw erroHttp(423, CODIGOS_PORTAL.bloqueado, MENSAGEM_BLOQUEADO);
    }
    return abrirDesafio(repo, sa.id);
  }

  async function totpIniciar(ctx: Ctx<DesafioEntrada>): Promise<TotpInicio> {
    const { chave } = config();
    const repo = fabrica(ctx.banco);
    const { sa } = await desafioDaEtapa(repo, ctx.corpo.desafio, 'cadastrar_totp', ctx.agora());
    if (sa.totp_confirmado) throw erroHttp(401, CODIGOS_PORTAL.desafio, MENSAGEM_DESAFIO);
    const segredo = novoSegredoTotp();
    await repo.gravarTotpPendente(sa.id, cifrarSegredoTotp(segredo, chave, sa.id));
    const base32 = base32Codificar(segredo);
    return { otpauth_uri: uriOtpauth(base32, sa.email), segredo_base32: base32 };
  }

  async function totpConfirmar(ctx: Ctx<TotpConfirmar>): Promise<TotpConfirmado> {
    const { segredo: segredoJwt, chave } = config();
    const repo = fabrica(ctx.banco);
    const rota = '/v1/plataforma/auth/totp/confirmar';
    const agora = ctx.agora();
    const { sa, hash } = await desafioDaEtapa(repo, ctx.corpo.desafio, 'cadastrar_totp', agora);
    const estado = await repo.totpEstado(sa.id);
    const segredo = estado.pendente_cifrado ? decifrarSegredoTotp(estado.pendente_cifrado, chave, sa.id) : null;
    if (!segredo || sa.totp_confirmado) throw erroHttp(409, CODIGOS_PORTAL.totpNaoIniciado, 'Escaneie o QR code no aplicativo autenticador antes de digitar o código.');
    const r = verificarTotp(segredo, ctx.corpo.codigo, agora, estado.ultimo_passo);
    if (!r.ok) return falharCodigo(repo, ctx, rota, sa.id, 'totp');
    const codigos = gerarCodigosRecuperacao(10);
    if (!(await repo.confirmarTotp(sa.id, r.passo, codigos.map(hashCodigoRecuperacao)))) throw erroHttp(409, CODIGOS_PORTAL.totpNaoIniciado, 'O segundo fator já foi cadastrado. Entre com e-mail, senha e código.');
    await repo.registrarSucesso(sa.id);
    const { sessao, sid } = await abrirSessao(repo, sa.id, hash, agora, segredoJwt, codigos.length);
    await auditar(repo, ctx, 'sa.totp.cadastrar', 200, rota, { superAdminId: sa.id, sessaoId: sid });
    await auditar(repo, ctx, 'sa.login.ok', 200, rota, { superAdminId: sa.id, sessaoId: sid }, { metodo_2fa: 'totp' });
    return { codigos_recuperacao: codigos, sessao };
  }

  async function segundoFator(ctx: Ctx<SegundoFator>): Promise<SessaoPlataforma> {
    const { segredo: segredoJwt, chave } = config();
    const repo = fabrica(ctx.banco);
    const rota = '/v1/plataforma/auth/segundo-fator';
    const agora = ctx.agora();
    const { sa, hash } = await desafioDaEtapa(repo, ctx.corpo.desafio, 'segundo_fator', agora);
    const estado = await repo.totpEstado(sa.id);
    let restantes = estado.recuperacao_restantes;
    let metodo: 'totp' | 'recuperacao';
    if ('codigo_recuperacao' in ctx.corpo) {
      const usado = await repo.usarRecuperacao(sa.id, hashCodigoRecuperacao(ctx.corpo.codigo_recuperacao));
      if (usado === null) return falharCodigo(repo, ctx, rota, sa.id, 'recuperacao');
      restantes = usado;
      metodo = 'recuperacao';
    } else {
      const segredo = estado.segredo_cifrado ? decifrarSegredoTotp(estado.segredo_cifrado, chave, sa.id) : null;
      const r = segredo ? verificarTotp(segredo, ctx.corpo.codigo, agora, estado.ultimo_passo) : ({ ok: false } as const);
      // o passo é gravado de forma atômica: dois pedidos com o mesmo código, só um passa
      if (!r.ok || !(await repo.marcarPasso(sa.id, r.passo))) return falharCodigo(repo, ctx, rota, sa.id, 'totp');
      metodo = 'totp';
    }
    await repo.registrarSucesso(sa.id);
    const { sessao, sid } = await abrirSessao(repo, sa.id, hash, agora, segredoJwt, restantes);
    if (metodo === 'recuperacao') await auditar(repo, ctx, 'sa.recuperacao.usar', 200, rota, { superAdminId: sa.id, sessaoId: sid }, { restantes });
    await auditar(repo, ctx, 'sa.login.ok', 200, rota, { superAdminId: sa.id, sessaoId: sid }, { metodo_2fa: metodo });
    return sessao;
  }

  /** Token do `Authorization` de uma rota pública (renovar, sair, regerar): assinatura, `aud`, prazo e sessão viva. */
  async function sessaoDoCabecalho(ctx: Ctx<unknown>, segredo: string): Promise<{ id: string; sid: string; tetoEm: Date }> {
    const token = tokenDoCabecalho(ctx.cabecalhos?.authorization);
    const claims = token ? verificarTokenPlataforma(token, ctx.agora(), segredo) : null;
    const viva = claims ? await fabrica(ctx.banco).sessaoValida(claims.sid) : null;
    if (!claims || !viva || viva.super_admin_id !== claims.sub) throw erroHttp(401, CODIGOS_PORTAL.sessao, MENSAGEM_SESSAO);
    return { id: claims.sub, sid: claims.sid, tetoEm: viva.expira_em };
  }

  async function renovar(ctx: Ctx<unknown>): Promise<SessaoPlataforma> {
    const { segredo } = config();
    const s = await sessaoDoCabecalho(ctx, segredo);
    const agora = ctx.agora();
    const expiraEm = expiracaoDoTokenPlataforma(agora, s.tetoEm);
    const estado = await fabrica(ctx.banco).totpEstado(s.id);
    return {
      token: assinarTokenPlataforma({ sub: s.id, sid: s.sid }, agora, expiraEm, segredo),
      expira_em: expiraEm.toISOString(),
      sessao_expira_em: s.tetoEm.toISOString(),
      recuperacao_restantes: estado.recuperacao_restantes,
    };
  }

  async function sair(ctx: Ctx<unknown>): Promise<void> {
    const { segredo } = config();
    const s = await sessaoDoCabecalho(ctx, segredo);
    const repo = fabrica(ctx.banco);
    await repo.revogarSessao(s.sid);
    await auditar(repo, ctx, 'sa.sair', 204, '/v1/plataforma/auth/sair', { superAdminId: s.id, sessaoId: s.sid });
  }

  async function regerarRecuperacao(ctx: Ctx<RegerarRecuperacao>): Promise<{ codigos_recuperacao: string[] }> {
    const { segredo, chave } = config();
    const s = await sessaoDoCabecalho(ctx, segredo);
    const repo = fabrica(ctx.banco);
    const rota = '/v1/plataforma/auth/recuperacao/regerar';
    const estado = await repo.totpEstado(s.id);
    const seg = estado.segredo_cifrado ? decifrarSegredoTotp(estado.segredo_cifrado, chave, s.id) : null;
    const r = seg ? verificarTotp(seg, ctx.corpo.codigo, ctx.agora(), estado.ultimo_passo) : ({ ok: false } as const);
    if (!r.ok || !(await repo.marcarPasso(s.id, r.passo))) return falharCodigo(repo, ctx, rota, s.id, 'totp');
    const codigos = gerarCodigosRecuperacao(10);
    await repo.regerarRecuperacao(s.id, codigos.map(hashCodigoRecuperacao));
    await auditar(repo, ctx, 'sa.recuperacao.regerar', 200, rota, { superAdminId: s.id, sessaoId: s.sid });
    return { codigos_recuperacao: codigos };
  }

  /**
   * `servicos.autenticarSuperAdmin`: assinatura (segredo próprio), `aud`, `exp` E sessão viva no banco, com o mesmo `sub`.
   * Qualquer outra coisa (inclusive token de tenant ou segredo ausente) = `null`.
   */
  async function autenticarSuperAdmin(cabecalhos: Readonly<Record<string, string | undefined>>, banco: AcessoBanco, agora: Date = new Date()): Promise<SuperAdminAutenticado | null> {
    const segredo = deps.segredo();
    if (!segredo || segredo.length < 32) return null;
    const token = tokenDoCabecalho(cabecalhos.authorization);
    const claims = token ? verificarTokenPlataforma(token, agora, segredo) : null;
    if (!claims) return null;
    const viva = await fabrica(banco).sessaoValida(claims.sid);
    return viva && viva.super_admin_id === claims.sub ? { id: claims.sub, sessao_id: claims.sid } : null;
  }

  return { primeiroAcesso, login, totpIniciar, totpConfirmar, segundoFator, renovar, sair, regerarRecuperacao, autenticarSuperAdmin };
}

export type SuperAdmin = ReturnType<typeof criarSuperAdmin>;
