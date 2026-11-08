/**
 * Login, troca de senha, "Esqueci a senha", refresh, logout e autenticação do token (RF-CORE-01; ADR 0006; T-0094, ADR 0032).
 * Orquestra o domínio (`domain/auth.ts`, `domain/acesso-senha.ts`), o repositório e as primitivas de segurança. Regras:
 * - código da empresa, e-mail ou senha errados: MESMA resposta e o mesmo tempo (`gastarTempoDeSenha`); sempre DUAS conferências
 *   argon2id (a senha atual e a temporária), para o tempo não revelar se há "Esqueci a senha" pendente nem se o e-mail existe;
 * - nome/fuso do tenant só depois da senha validada;
 * - falha de senha é gravada e SÓ DEPOIS o erro é lançado (lançar dentro da transação desfaria a contagem);
 * - bloqueio (admin, tentativas, inativo, aparelho), perfil fora do app (RN-CORE-33), senha vencida e senha a trocar só são
 *   revelados a quem acertou a senha; nenhum deles abre sessão nem grava `ultimo_login_em`;
 * - "Esqueci a senha" responde sempre 202 {} e grava uma senha temporária PARALELA (P6): a atual continua valendo;
 * - toda troca de senha sobe a `sessao_versao` (o token de acesso cai na próxima requisição) e revoga os refresh;
 * - refresh rotativo: reuso de refresh já trocado revoga a família inteira;
 * - nada de e-mail, senha ou token em log, auditoria ou evento.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  mensagemPerfilForaDoApp,
  type AcessoBanco,
  type ClienteBanco,
  type ContextoPublico,
  type Perfil,
  type UsuarioAutenticado,
} from '@macuxi/platform-sdk';
import {
  CODIGO_DISPOSITIVO_BLOQUEADO,
  CODIGOS_AUTH,
  MENSAGEM_APARELHO_BLOQUEADO,
  MENSAGEM_CREDENCIAIS,
  MENSAGEM_SENHA_A_TROCAR,
  MENSAGEM_SENHA_VENCIDA,
  type EsqueciSenhaRequest,
  type LoginSenhaRequest,
  type LogoutRequestSchema,
  type RefreshRequest,
  type RefreshResposta,
  type SessaoResposta,
  type TrocarSenhaRequest,
} from '../contracts';
import type { z } from 'zod';
import {
  SENHA_TEMPORARIA_HORAS,
  avaliarSenhaDoLogin,
  estadoDoLogin,
  estadoDoRefresh,
  expiracaoDoAcesso,
  expiracaoDoRefresh,
  gerarSenhaTemporaria,
  registrarFalhaDeLogin,
  validadeDaSenhaTemporaria,
  validarSenhaNova,
  SEGUNDOS_DO_ACESSO,
  type MotivoDaTroca,
  type RecusaSenhaNova,
  perfisDeFabrica,
  podeUsarApp,
} from '../domain';
import { auditar } from './auditoria';
import { appsDoPerfil, emailDisponivel, empresaDoTenant, enviarEmail } from './email';
import { erroHttp } from './erros';
import { chaveDeLogin, criarLimiteDeFalhas, type LimiteDeFalhas } from './limite-login';
import { fabricaSql, type FabricaRepositorios, type RepositorioTenant, type UsuarioLogin } from './repositorio';
import { assinarAcesso, exigirSegredo, gastarTempoDeSenha, hashSenha, lerRefresh, novoRefresh, SegredoInvalido, tokenDoCabecalho, verificarJwtAcesso, verificarSenha } from './seguranca';

/** Conferência e hash de senha (injetáveis nos testes para contar as conferências e baratear o argon2). */
export interface ServicoDeSenhas {
  verificar(senha: string, phc: string): Promise<boolean>;
  gastar(senha: string): Promise<void>;
  hash(senha: string): Promise<string>;
}

const senhasReais: ServicoDeSenhas = { verificar: verificarSenha, gastar: gastarTempoDeSenha, hash: (s) => hashSenha(s) };

export interface DepsAutenticacao {
  /** Segredo do JWT (lido a cada uso: `MACUXI_JWT_SEGREDO`). */
  segredo(): string | undefined;
  repos?: FabricaRepositorios;
  /** Limite de falhas de login (T-0026); padrão: 10 falhas / 5 min por IP + empresa + e-mail. Testes injetam o seu. */
  limiteLogin?: LimiteDeFalhas;
  /** "Esqueci a senha" (T-0094): pedidos por IP (padrão 5 / 15 min) e por código + e-mail (padrão 3 / 1 h). Cada pedido conta. */
  limiteEsqueciIp?: LimiteDeFalhas;
  limiteEsqueciChave?: LimiteDeFalhas;
  senhas?: ServicoDeSenhas;
  /** Bytes aleatórios seguros para a senha temporária (padrão `crypto.randomBytes`). */
  aleatorio?: (n: number) => Uint8Array;
}

const MENSAGEM_BLOQUEADO = 'Seu acesso está bloqueado. Fale com o administrador da sua empresa ou tente de novo mais tarde.';
const MENSAGEM_SESSAO = 'Sua sessão expirou. Entre de novo com o código da empresa, o e-mail e a senha.';
const MENSAGEM_MUITAS = 'Muitas tentativas de entrada. Aguarde alguns minutos e tente de novo.';
const MENSAGEM_MUITOS_PEDIDOS = 'Muitos pedidos de senha. Aguarde alguns minutos e tente de novo.';
/** Entre dois "Esqueci a senha" do mesmo usuário (no banco): não gera outra senha nem manda outro e-mail. */
const INTERVALO_ESQUECI_MS = 15 * 60_000;

type Sessao = Omit<SessaoResposta, 'tenant'>;
type SenhaLiberada = { tipo: 'ok' } | { tipo: 'trocar'; usada: 'atual' | 'temporaria'; motivo: MotivoDaTroca; expiraEm: Date | null };

type ResultadoLogin =
  | { tipo: 'ok'; sessao: Sessao; tenantId: string }
  | { tipo: 'credenciais' }
  | { tipo: 'bloqueado' }
  /** RN-CORE-15: aparelho bloqueado (vale para o tenant inteiro); só chega aqui quem acertou a senha. */
  | { tipo: 'aparelho' }
  /** RN-CORE-33: perfil não usa este app. */
  | { tipo: 'fora_do_app'; mensagem: string }
  | { tipo: 'vencida' }
  | { tipo: 'trocar'; motivo: MotivoDaTroca; expiraEm: Date | null }
  /** Só na troca: a senha nova não serve (RN-CORE-32/34). */
  | { tipo: 'senha_nova'; recusa: RecusaSenhaNova };

export function criarAutenticacao(deps: DepsAutenticacao) {
  const repos = deps.repos ?? fabricaSql;
  const limiteLogin = deps.limiteLogin ?? criarLimiteDeFalhas();
  const limiteEsqueciIp = deps.limiteEsqueciIp ?? criarLimiteDeFalhas(5, 15 * 60_000);
  const limiteEsqueciChave = deps.limiteEsqueciChave ?? criarLimiteDeFalhas(3, 60 * 60_000);
  const senhas = deps.senhas ?? senhasReais;
  const aleatorio = deps.aleatorio ?? ((n: number) => randomBytes(n));
  const segredo = (): string => {
    try {
      return exigirSegredo(deps.segredo());
    } catch (e) {
      if (e instanceof SegredoInvalido) throw erroHttp(503, 'AUTENTICACAO_INDISPONIVEL', 'O login está indisponível no momento. Avise o suporte.');
      throw e;
    }
  };

  const emitir = async (r: RepositorioTenant, tenantId: string, u: { id: string; perfil: Perfil }, familiaId: string, dispositivoId: string | null, agora: Date, sessaoVersao: number) => {
    const refresh = novoRefresh(tenantId);
    await r.criarSessao({ id: randomUUID(), usuario_id: u.id, familia_id: familiaId, token_hash: refresh.hash, dispositivo_id: dispositivoId, expira_em: expiracaoDoRefresh(agora) });
    const access = assinarAcesso({ sub: u.id, tid: tenantId, perfil: u.perfil, did: dispositivoId, sv: sessaoVersao }, agora, expiracaoDoAcesso(agora), segredo());
    return { access_token: access, token_type: 'Bearer' as const, expires_in: SEGUNDOS_DO_ACESSO, refresh_token: refresh.token };
  };

  /** Sempre uma conferência por senha possível (atual e temporária); a que não existe gasta o mesmo tempo. */
  const conferir = async (senha: string, phc: string | null): Promise<boolean> => {
    if (phc) return senhas.verificar(senha, phc);
    await senhas.gastar(senha);
    return false;
  };

  interface EntradaDeSenha {
    codigo: string;
    email: string;
    senha: string;
    app: LoginSenhaRequest['app'];
    dispositivo_id: string | undefined;
    dispositivo_nome: string | undefined;
  }

  /** Passos 1 a 8 do desenho §3, compartilhados por `login` e `senha/trocar`. `aoLiberar` roda dentro da transação, com a senha já aceita. */
  async function entrar(
    ctx: ContextoPublico<unknown>,
    e: EntradaDeSenha,
    aoLiberar: (r: RepositorioTenant, u: UsuarioLogin, senha: SenhaLiberada, db: ClienteBanco, tenantId: string, agora: Date) => Promise<ResultadoLogin>,
  ): Promise<{ resultado: ResultadoLogin; tenantId: string; codigo: string }> {
    segredo(); // sem segredo configurado: 503 antes de qualquer consulta
    const { banco, agora } = ctx;
    const codigo = e.codigo.toLowerCase();
    // T-0026: só FALHAS contam (entrada certa não consome); chave por IP real + empresa + e-mail
    const chave = chaveDeLogin(ctx.ip, codigo, e.email);
    const espera = limiteLogin.bloqueadoPor(chave, agora());
    if (espera > 0) throw erroHttp(429, CODIGOS_AUTH.muitasTentativas, MENSAGEM_MUITAS, { retry_after_s: espera });
    const publico = repos.publico(banco);
    const tenant = await publico.tenantPorCodigo(codigo);
    if (!tenant || tenant.status !== 'ativo') {
      await conferir(e.senha, null);
      await conferir(e.senha, null);
      limiteLogin.registrarFalha(chave, agora());
      throw erroHttp(401, CODIGOS_AUTH.credenciais, MENSAGEM_CREDENCIAIS);
    }
    const agoraData = agora();

    const resultado = await banco.comTenant<ResultadoLogin>(tenant.id, async (db) => {
      const r = repos.doTenant(db);
      const u = await r.usuarioPorEmail(e.email);
      // duas conferências SEMPRE, exista ou não o usuário/a temporária (o tempo não vira oráculo)
      const certaAtual = await conferir(e.senha, u?.senha_hash ?? null);
      const certaTemporaria = await conferir(e.senha, u?.senha_temporaria_hash ?? null);
      if (!u) return { tipo: 'credenciais' };
      const estado = estadoDoLogin({ ativo: u.ativo, bloqueadoEm: u.bloqueado_em, bloqueioAte: u.bloqueio_ate, agora: agoraData });
      const senha = avaliarSenhaDoLogin({
        certaAtual,
        certaTemporaria,
        trocarSenha: u.trocar_senha,
        senhaExpiraEm: u.senha_expira_em,
        temporariaExpiraEm: u.senha_temporaria_expira_em,
        ultimoLoginEm: u.ultimo_login_em,
        agora: agoraData,
      });
      if (senha.tipo === 'errada') {
        // só conta tentativa de quem pode tentar; bloqueado não estende o bloqueio nem revela o estado
        if (estado === 'ok') {
          const c = registrarFalhaDeLogin({ falhas: u.tentativas_falhas, bloqueioAte: u.bloqueio_ate }, agoraData);
          await r.gravarTentativas(u.id, c.falhas, c.bloqueioAte);
        }
        return { tipo: 'credenciais' };
      }
      // daqui em diante só quem acertou uma das senhas
      if (estado !== 'ok') return { tipo: 'bloqueado' };
      if (e.dispositivo_id && (await r.dispositivoBloqueado(e.dispositivo_id))) return { tipo: 'aparelho' };
      // RN-CORE-33: perfil que não usa o app; sem sessão
      if (e.app && !podeUsarApp(perfisDeFabrica(u.perfil), e.app)) return { tipo: 'fora_do_app', mensagem: mensagemPerfilForaDoApp(u.perfil, e.app) ?? 'Este perfil não usa este aplicativo.' };
      if (senha.tipo === 'vencida') return { tipo: 'vencida' };
      return aoLiberar(r, u, senha, db, tenant.id, agoraData);
    });

    if (resultado.tipo === 'credenciais') limiteLogin.registrarFalha(chave, agoraData);
    else limiteLogin.zerar(chave);
    return { resultado, tenantId: tenant.id, codigo };
  }

  /** Erros comuns do login e da troca (a ordem do desenho §3). Devolve a sessão se for `ok`. */
  function lancarOuSessao(resultado: ResultadoLogin): { sessao: Sessao; tenantId: string } {
    switch (resultado.tipo) {
      case 'ok':
        return { sessao: resultado.sessao, tenantId: resultado.tenantId };
      case 'credenciais':
        throw erroHttp(401, CODIGOS_AUTH.credenciais, MENSAGEM_CREDENCIAIS);
      case 'bloqueado':
        throw erroHttp(423, CODIGOS_AUTH.bloqueado, MENSAGEM_BLOQUEADO);
      case 'aparelho':
        throw erroHttp(423, CODIGO_DISPOSITIVO_BLOQUEADO, MENSAGEM_APARELHO_BLOQUEADO);
      case 'fora_do_app':
        throw erroHttp(403, CODIGOS_AUTH.perfilForaDoApp, resultado.mensagem);
      case 'vencida':
        throw erroHttp(410, CODIGOS_AUTH.senhaVencida, MENSAGEM_SENHA_VENCIDA);
      case 'trocar':
        throw erroHttp(403, CODIGOS_AUTH.senhaATrocar, MENSAGEM_SENHA_A_TROCAR, { motivo: resultado.motivo, expira_em: resultado.expiraEm ? resultado.expiraEm.toISOString() : null });
      case 'senha_nova':
        throw new Error('senha_nova é tratada pela troca antes deste ponto');
    }
  }

  async function comDadosDoTenant(ctx: ContextoPublico<unknown>, codigo: string, tenantId: string, sessao: Sessao): Promise<SessaoResposta> {
    // senha validada: agora sim os dados da empresa
    const exib = await repos.publico(ctx.banco).tenantParaExibicao(codigo);
    if (!exib) throw erroHttp(401, CODIGOS_AUTH.credenciais, MENSAGEM_CREDENCIAIS);
    ctx.log.info({ tenant_id: tenantId, usuario_id: sessao.usuario.id }, 'login');
    return { ...sessao, tenant: { id: exib.id, codigo: exib.codigo, nome: exib.nome, fuso: exib.fuso } };
  }

  async function login(ctx: ContextoPublico<LoginSenhaRequest>): Promise<SessaoResposta> {
    const { senha, email, app, dispositivo_id, dispositivo_nome } = ctx.corpo;
    const { resultado, tenantId, codigo } = await entrar(ctx, { codigo: ctx.corpo.codigo_empresa, email, senha, app, dispositivo_id, dispositivo_nome }, async (r, u, s, _db, tid, agoraData) => {
      // senha temporária a trocar: nenhuma sessão, nenhum `ultimo_login_em`; a tela "Crie sua senha" segue
      if (s.tipo === 'trocar') return { tipo: 'trocar', motivo: s.motivo, expiraEm: s.expiraEm };
      await r.registrarLoginOk(u.id, agoraData);
      // entrou com a senha atual: a temporária do "Esqueci" (se havia) deixa de existir
      if (u.senha_temporaria_hash) await r.descartarSenhaTemporaria(u.id);
      if (dispositivo_id) await r.upsertDispositivo(u.id, dispositivo_id, dispositivo_nome ?? null, agoraData);
      const tokens = await emitir(r, tid, u, randomUUID(), dispositivo_id ?? null, agoraData, u.sessao_versao);
      return { tipo: 'ok', tenantId: tid, sessao: { ...tokens, usuario: { id: u.id, nome: u.nome, nome_curto: u.nome_curto, email: u.email, perfil: u.perfil } } };
    });
    const { sessao } = lancarOuSessao(resultado);
    return comDadosDoTenant(ctx, codigo, tenantId, sessao);
  }

  /** `POST /v1/auth/senha/trocar` (desenho §4): "Crie sua senha". Devolve a sessão: a pessoa entra direto. */
  async function trocarSenha(ctx: ContextoPublico<TrocarSenhaRequest>): Promise<SessaoResposta> {
    const c = ctx.corpo;
    const { resultado, tenantId, codigo } = await entrar(
      ctx,
      { codigo: c.codigo_empresa, email: c.email, senha: c.senha_atual, app: c.app, dispositivo_id: c.dispositivo_id, dispositivo_nome: c.dispositivo_nome },
      async (r, u, s, db, tid, agoraData) => {
        const usada = s.tipo === 'ok' ? 'atual' : s.usada;
        const hashUsado = usada === 'atual' ? u.senha_hash : u.senha_temporaria_hash;
        const igual = hashUsado ? await senhas.verificar(c.senha_nova, hashUsado) : false;
        const recusa = validarSenhaNova(c.senha_nova, u.email, igual);
        if (recusa) return { tipo: 'senha_nova', recusa };
        const novoHash = await senhas.hash(c.senha_nova);
        const versao = await r.trocarSenha(u.id, novoHash, agoraData);
        await r.registrarLoginOk(u.id, agoraData);
        if (c.dispositivo_id) await r.upsertDispositivo(u.id, c.dispositivo_id, c.dispositivo_nome ?? null, agoraData);
        const tokens = await emitir(r, tid, u, randomUUID(), c.dispositivo_id ?? null, agoraData, versao);
        // RN-AUD-01: só ids e fatos — nunca a senha, o hash, o e-mail ou o nome
        await auditar(db, { usuario: { id: u.id }, requestId: ctx.requestId }, {
          acao: 'usuario.senha_trocar',
          entidade: 'usuario',
          entidadeId: u.id,
          antes: null,
          depois: { motivo: s.tipo === 'ok' ? 'voluntaria' : s.motivo, sessoes_revogadas: true },
        });
        return { tipo: 'ok', tenantId: tid, sessao: { ...tokens, usuario: { id: u.id, nome: u.nome, nome_curto: u.nome_curto, email: u.email, perfil: u.perfil } } };
      },
    );
    if (resultado.tipo === 'senha_nova') {
      const x = resultado.recusa;
      throw erroHttp(422, x.codigo, x.mensagem, x.codigo === 'RN-CORE-32' ? { faltas: x.faltas } : undefined);
    }
    const { sessao } = lancarOuSessao(resultado);
    return comDadosDoTenant(ctx, codigo, tenantId, sessao);
  }

  /**
   * `POST /v1/auth/senha/esqueci` (desenho §5): responde SEMPRE `{}` (202), exista ou não a empresa, o usuário, esteja ele ativo
   * ou bloqueado. O trabalho caro (gerar e hashear a temporária) acontece nos dois caminhos.
   */
  async function esqueciSenha(ctx: ContextoPublico<EsqueciSenhaRequest>): Promise<Record<string, never>> {
    const agoraData = ctx.agora();
    const codigo = ctx.corpo.codigo_empresa.toLowerCase();
    const email = ctx.corpo.email;
    const chave = `${codigo}|${email.toLowerCase()}`; // por empresa + e-mail (qualquer IP)
    // a recusa por limite é igual para e-mail que existe e que não existe (não vira oráculo)
    const espera = Math.max(limiteEsqueciIp.bloqueadoPor(ctx.ip, agoraData), limiteEsqueciChave.bloqueadoPor(chave, agoraData));
    if (espera > 0) throw erroHttp(429, CODIGOS_AUTH.muitasTentativas, MENSAGEM_MUITOS_PEDIDOS, { retry_after_s: espera });
    limiteEsqueciIp.registrarFalha(ctx.ip, agoraData);
    limiteEsqueciChave.registrarFalha(chave, agoraData);

    const temporaria = gerarSenhaTemporaria(aleatorio);
    const hash = await senhas.hash(temporaria); // sempre, mesmo sem usuário: mesmo custo nos dois caminhos
    const publico = repos.publico(ctx.banco);
    const tenant = await publico.tenantPorCodigo(codigo);
    if (!tenant || tenant.status !== 'ativo') return {};
    await ctx.banco.comTenant(tenant.id, async (db) => {
      const r = repos.doTenant(db);
      const u = await r.usuarioPorEmail(email);
      if (!u || !u.ativo || u.bloqueado_em) return;
      // menos de 15 min da última: não gera outra nem manda outro e-mail (mesma resposta)
      if (u.senha_temporaria_criada_em && agoraData.getTime() - u.senha_temporaria_criada_em.getTime() < INTERVALO_ESQUECI_MS) return;
      if (!emailDisponivel(ctx)) {
        ctx.log.warn({ tenant_id: tenant.id, usuario_id: u.id }, 'esqueci a senha: e-mail não configurado, nada enviado');
        return;
      }
      const empresa = await empresaDoTenant(db);
      const criadaEm = agoraData;
      await r.gravarSenhaTemporaria(u.id, hash, criadaEm, validadeDaSenhaTemporaria(agoraData));
      const envio = await enviarEmail(ctx, db, {
        modelo: 'nova_senha',
        usuario_id: u.id,
        para: u.email,
        dados: { nome: u.nome, empresa_nome: empresa.nome, codigo_empresa: empresa.codigo || codigo, login: u.email, senha: temporaria, validade_horas: SENHA_TEMPORARIA_HORAS, apps: appsDoPerfil(u.perfil), motivo: 'esqueci' },
        chave_idempotencia: `${u.id}:esqueci:${criadaEm.toISOString()}`,
      });
      await auditar(db, { usuario: { id: u.id }, requestId: ctx.requestId }, { acao: 'usuario.senha_esqueci', entidade: 'usuario', entidadeId: u.id, antes: null, depois: { email: envio } });
    });
    return {};
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
      const tokens = await emitir(r, lido.tenantId, u, s.familia_id, s.dispositivo_id, agoraData, u.sessao_versao);
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
        if (s) {
          await r.revogarFamilia(s.familia_id, ctx.agora());
          // RN-CORE-15/RF-CORE-09: o aparelho deixa de receber push do usuário que saiu
          if (s.dispositivo_id) await db.query('update core.dispositivo set push_token = null, push_plataforma = null where id = $1 and usuario_id = $2', [s.dispositivo_id, s.usuario_id]);
        }
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
    // T-0094: troca/redefinição/desativação sobe a sessao_versao — o token com versão antiga cai na próxima requisição (token antigo, sem `sv`, vale 0)
    if ((claims.sv ?? 0) !== u.sessao_versao) return null;
    if (aparelhoBloqueado) throw erroHttp(423, CODIGO_DISPOSITIVO_BLOQUEADO, MENSAGEM_APARELHO_BLOQUEADO);
    return { id: u.id, tenant_id: claims.tid, perfil: u.perfil };
  }

  return { login, trocarSenha, esqueciSenha, refresh, logout, autenticar };
}

export type Autenticacao = ReturnType<typeof criarAutenticacao>;
