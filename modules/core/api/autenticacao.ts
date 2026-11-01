/**
 * Login, refresh, logout e autenticação do token (RF-CORE-01; ADR 0006). Orquestra o domínio (`domain/auth.ts`),
 * o repositório e as primitivas de segurança. Regras de segurança:
 * - código da empresa, e-mail ou senha errados: MESMA resposta e o mesmo tempo (`gastarTempoDeSenha`);
 * - nome/fuso do tenant só depois da senha validada;
 * - falha de senha é gravada e SÓ DEPOIS o erro é lançado (lançar dentro da transação desfaria a contagem);
 * - bloqueio (admin, tentativas, inativo, aparelho) só é revelado a quem acertou a senha (423);
 * - refresh rotativo: reuso de refresh já trocado revoga a família inteira;
 * - nada de e-mail, senha ou token em log.
 */
import { randomUUID } from 'node:crypto';
import {
  type AcessoBanco,
  type ContextoPublico,
  type Perfil,
  type UsuarioAutenticado,
} from '@macuxi/platform-sdk';
import { CODIGO_DISPOSITIVO_BLOQUEADO, CODIGOS_AUTH, MENSAGEM_APARELHO_BLOQUEADO, MENSAGEM_CREDENCIAIS, type LoginSenhaRequest, type LogoutRequestSchema, type RefreshRequest, type RefreshResposta, type SessaoResposta } from '../contracts';
import type { z } from 'zod';
import {
  estadoDoLogin,
  estadoDoRefresh,
  expiracaoDoAcesso,
  expiracaoDoRefresh,
  registrarFalhaDeLogin,
  SEGUNDOS_DO_ACESSO,
} from '../domain';
import { erroHttp } from './erros';
import { fabricaSql, type FabricaRepositorios, type RepositorioTenant } from './repositorio';
import { assinarAcesso, exigirSegredo, gastarTempoDeSenha, lerRefresh, novoRefresh, SegredoInvalido, tokenDoCabecalho, verificarJwtAcesso, verificarSenha } from './seguranca';

export interface DepsAutenticacao {
  /** Segredo do JWT (lido a cada uso: `MACUXI_JWT_SEGREDO`). */
  segredo(): string | undefined;
  repos?: FabricaRepositorios;
}

const MENSAGEM_BLOQUEADO = 'Seu acesso está bloqueado. Fale com o administrador da sua empresa ou tente de novo mais tarde.';
const MENSAGEM_SESSAO = 'Sua sessão expirou. Entre de novo com o código da empresa, o e-mail e a senha.';

type ResultadoLogin =
  | { tipo: 'ok'; sessao: Omit<SessaoResposta, 'tenant'>; tenantId: string }
  | { tipo: 'credenciais' }
  | { tipo: 'bloqueado' }
  /** RN-CORE-15: aparelho bloqueado (vale para o tenant inteiro); só chega aqui quem acertou a senha. */
  | { tipo: 'aparelho' };

export function criarAutenticacao(deps: DepsAutenticacao) {
  const repos = deps.repos ?? fabricaSql;
  const segredo = (): string => {
    try {
      return exigirSegredo(deps.segredo());
    } catch (e) {
      if (e instanceof SegredoInvalido) throw erroHttp(503, 'AUTENTICACAO_INDISPONIVEL', 'O login está indisponível no momento. Avise o suporte.');
      throw e;
    }
  };

  const emitir = async (r: RepositorioTenant, tenantId: string, u: { id: string; perfil: Perfil }, familiaId: string, dispositivoId: string | null, agora: Date) => {
    const refresh = novoRefresh(tenantId);
    await r.criarSessao({ id: randomUUID(), usuario_id: u.id, familia_id: familiaId, token_hash: refresh.hash, dispositivo_id: dispositivoId, expira_em: expiracaoDoRefresh(agora) });
    const access = assinarAcesso({ sub: u.id, tid: tenantId, perfil: u.perfil, did: dispositivoId }, agora, expiracaoDoAcesso(agora), segredo());
    return { access_token: access, token_type: 'Bearer' as const, expires_in: SEGUNDOS_DO_ACESSO, refresh_token: refresh.token };
  };

  async function login(ctx: ContextoPublico<LoginSenhaRequest>): Promise<SessaoResposta> {
    segredo(); // sem segredo configurado: 503 antes de qualquer consulta
    const { banco, agora } = ctx;
    const { senha, email } = ctx.corpo;
    const codigo = ctx.corpo.codigo_empresa.toLowerCase();
    const publico = repos.publico(banco);
    const tenant = await publico.tenantPorCodigo(codigo);
    if (!tenant || tenant.status !== 'ativo') {
      await gastarTempoDeSenha(senha);
      throw erroHttp(401, CODIGOS_AUTH.credenciais, MENSAGEM_CREDENCIAIS);
    }
    const agoraData = agora();

    const resultado = await banco.comTenant<ResultadoLogin>(tenant.id, async (db) => {
      const r = repos.doTenant(db);
      const u = await r.usuarioPorEmail(email);
      if (!u || !u.senha_hash) {
        await gastarTempoDeSenha(senha);
        return { tipo: 'credenciais' };
      }
      const estado = estadoDoLogin({ ativo: u.ativo, bloqueadoEm: u.bloqueado_em, bloqueioAte: u.bloqueio_ate, agora: agoraData });
      const certa = await verificarSenha(senha, u.senha_hash);
      if (!certa) {
        // só conta tentativa de quem pode tentar; bloqueado não estende o bloqueio nem revela o estado
        if (estado === 'ok') {
          const c = registrarFalhaDeLogin({ falhas: u.tentativas_falhas, bloqueioAte: u.bloqueio_ate }, agoraData);
          await r.gravarTentativas(u.id, c.falhas, c.bloqueioAte);
        }
        return { tipo: 'credenciais' };
      }
      if (estado !== 'ok') return { tipo: 'bloqueado' };
      if (ctx.corpo.dispositivo_id && (await r.dispositivoBloqueado(ctx.corpo.dispositivo_id))) return { tipo: 'aparelho' };
      await r.registrarLoginOk(u.id, agoraData);
      if (ctx.corpo.dispositivo_id) await r.upsertDispositivo(u.id, ctx.corpo.dispositivo_id, ctx.corpo.dispositivo_nome ?? null, agoraData);
      const tokens = await emitir(r, tenant.id, u, randomUUID(), ctx.corpo.dispositivo_id ?? null, agoraData);
      return {
        tipo: 'ok',
        tenantId: tenant.id,
        sessao: { ...tokens, usuario: { id: u.id, nome: u.nome, nome_curto: u.nome_curto, email: u.email, perfil: u.perfil } },
      };
    });

    if (resultado.tipo === 'credenciais') throw erroHttp(401, CODIGOS_AUTH.credenciais, MENSAGEM_CREDENCIAIS);
    if (resultado.tipo === 'bloqueado') throw erroHttp(423, CODIGOS_AUTH.bloqueado, MENSAGEM_BLOQUEADO);
    if (resultado.tipo === 'aparelho') throw erroHttp(423, CODIGO_DISPOSITIVO_BLOQUEADO, MENSAGEM_APARELHO_BLOQUEADO);
    // senha validada: agora sim os dados da empresa
    const exib = await publico.tenantParaExibicao(codigo);
    if (!exib) throw erroHttp(401, CODIGOS_AUTH.credenciais, MENSAGEM_CREDENCIAIS);
    ctx.log.info({ tenant_id: resultado.tenantId, usuario_id: resultado.sessao.usuario.id }, 'login');
    return { ...resultado.sessao, tenant: { id: exib.id, codigo: exib.codigo, nome: exib.nome, fuso: exib.fuso } };
  }

  type ResultadoRefresh = { tipo: 'ok'; resposta: RefreshResposta } | { tipo: 'invalido' } | { tipo: 'aparelho' };

  async function refresh(ctx: ContextoPublico<RefreshRequest>): Promise<RefreshResposta> {
    segredo();
    const lido = lerRefresh(ctx.corpo.refresh_token);
    if (!lido) throw erroHttp(401, CODIGOS_AUTH.sessao, MENSAGEM_SESSAO);
    const agoraData = ctx.agora();
    const resultado = await ctx.banco.comTenant<ResultadoRefresh>(lido.tenantId, async (db) => {
      const r = repos.doTenant(db);
      const s = await r.sessaoPorHash(lido.hash);
      if (!s) return { tipo: 'invalido' };
      const estado = estadoDoRefresh({ expiraEm: s.expira_em, usadoEm: s.usado_em, revogadoEm: s.revogado_em, agora: agoraData });
      if (estado === 'reutilizado') {
        // refresh já trocado reapresentado = cópia/roubo: derruba a família (o erro sai DEPOIS do commit)
        await r.revogarFamilia(s.familia_id, agoraData);
        ctx.log.warn({ tenant_id: lido.tenantId, usuario_id: s.usuario_id }, 'refresh reutilizado: família revogada');
        return { tipo: 'invalido' };
      }
      if (estado !== 'valido') return { tipo: 'invalido' };
      const u = await r.usuarioAtual(s.usuario_id);
      if (!u || !u.ativo || u.bloqueado_em) {
        await r.revogarFamilia(s.familia_id, agoraData);
        return { tipo: 'invalido' };
      }
      const dispositivo = ctx.corpo.dispositivo_id ?? s.dispositivo_id;
      if (dispositivo && (await r.dispositivoBloqueado(dispositivo))) {
        // RN-CORE-15: quem tem um refresh válido já se autenticou neste aparelho; só a ele se revela o bloqueio (o app limpa os dados)
        await r.revogarFamilia(s.familia_id, agoraData);
        return { tipo: 'aparelho' };
      }
      await r.marcarSessaoUsada(s.id, agoraData);
      const tokens = await emitir(r, lido.tenantId, u, s.familia_id, s.dispositivo_id, agoraData);
      return { tipo: 'ok', resposta: tokens };
    });
    if (resultado.tipo === 'aparelho') throw erroHttp(423, CODIGO_DISPOSITIVO_BLOQUEADO, MENSAGEM_APARELHO_BLOQUEADO);
    if (resultado.tipo !== 'ok') throw erroHttp(401, CODIGOS_AUTH.sessao, MENSAGEM_SESSAO);
    return resultado.resposta;
  }

  async function logout(ctx: ContextoPublico<z.infer<typeof LogoutRequestSchema>>): Promise<Record<string, never>> {
    const lido = lerRefresh(ctx.corpo.refresh_token);
    if (lido) {
      await ctx.banco.comTenant(lido.tenantId, async (db) => {
        const r = repos.doTenant(db);
        const s = await r.sessaoPorHash(lido.hash);
        if (s) await r.revogarFamilia(s.familia_id, ctx.agora());
      });
    }
    return {}; // sempre igual: não revela se o refresh existia
  }

  /** `servicos.autenticar`: JWT válido E usuário ainda ativo, não bloqueado; o perfil vem do banco (vale na hora). */
  async function autenticar(cabecalhos: Readonly<Record<string, string | undefined>>, banco: AcessoBanco, agora: Date = new Date()): Promise<UsuarioAutenticado | null> {
    const s = deps.segredo();
    if (!s || s.length < 32) return null;
    const token = tokenDoCabecalho(cabecalhos.authorization);
    if (!token) return null;
    const claims = verificarJwtAcesso(token, agora, s);
    if (!claims) return null;
    const { u, aparelhoBloqueado } = await banco.comTenant(claims.tid, async (db) => {
      const r = repos.doTenant(db);
      const usuario = await r.usuarioAtual(claims.sub);
      // RN-CORE-15: corte imediato; consulta pela chave primária (sem cache, sem janela de acesso residual)
      return { u: usuario, aparelhoBloqueado: claims.did ? await r.dispositivoBloqueado(claims.did) : false };
    });
    if (!u || !u.ativo || u.bloqueado_em) return null;
    if (aparelhoBloqueado) throw erroHttp(423, CODIGO_DISPOSITIVO_BLOQUEADO, MENSAGEM_APARELHO_BLOQUEADO);
    return { id: u.id, tenant_id: claims.tid, perfil: u.perfil };
  }

  return { login, refresh, logout, autenticar };
}

export type Autenticacao = ReturnType<typeof criarAutenticacao>;
