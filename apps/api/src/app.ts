/**
 * `createApp` — bootstrap Fastify do monólito modular (desenho T-0004 §3; ADR 0006).
 *
 * Monta, para cada módulo instalado (`MODULOS_API`), as rotas declaradas em `definirModuloApi` sob
 * `/v1/<modulo>/<caminho>`; as rotas públicas do Core sob `/v1/<caminho>`; e as rotas da plataforma:
 * `GET /v1/saude`, `GET /v1/me/modulos`, `GET /v1/sync/pull`, `POST /v1/sync/push`.
 *
 * Toda rota autenticada passa por `prepararRequisicao` (401 → licença 403 MODULO_INATIVO → perfil/ação
 * 403 PERFIL_SEM_ACESSO → Zod 400 → carteira 403 FORA_DA_CARTEIRA). Os módulos efetivos são calculados
 * por requisição (RN-CORE-01/03, `modulosEfetivos` do SDK) a partir da fonte de licenças. Banco só por
 * `comTenant` com o tenant do token (papel macuxi_app). Corpo de erro: `ErroApiSchema` `{ codigo, mensagem, detalhes? }`;
 * o status do erro do módulo é o do `ErroHttpModulo` (401/403/404/409/410/422/423/503) e `ctx.dependencias` traz o
 * `depende` de todos os manifestos instalados (RN-CORE-03).
 */
import { createHash, randomUUID } from 'node:crypto';
import { erroModuloInativo, MeusModulosRespostaSchema, ROTA_ME_MODULOS, type MeusModulosResposta } from '@macuxi/core/contracts';
import {
  corpoDoErro,
  corpoDoErroModulo,
  criarPermissoes,
  dependenciasDosManifestos,
  ErroHttpModulo,
  escopoDoPerfil,
  modulosEfetivos,
  promotorBarradoNaRota,
  validarConjunto,
  verificarAcao,
  verificarAcesso,
  verificarCarteira,
  type AcessoBanco,
  type ContextoBase,
  type ErroApi,
  type Manifesto,
  type ModuloApi,
  type ModuloId,
  type RotaModulo,
  type RotaPublica,
  type ServicosCore,
  type UsuarioAutenticado,
  type UsuarioDaRequisicao,
} from '@macuxi/platform-sdk';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { ZodError, type ZodTypeAny } from 'zod';
import type { BancoApp } from './banco';
import { criarLimitador } from './limitador';
import { licencasDoBanco, type FonteLicencas } from './licencas';
import { MODULOS_API } from './modulos';
import { transacaoTenant } from './outbox';
import { registrarSync } from './sync';
import type { Plataforma } from './tipos';
import { ErroHttp } from './erros';

export { ErroHttp } from './erros';

export interface OpcoesApp {
  /** Módulos instalados (padrão: os 8 do produto). Testes passam módulos de fixture. */
  modulos?: readonly ModuloApi[];
  /** Banco com o papel macuxi_app (`criarBancoApp`). `null`/ausente = rotas que tocam dado respondem 503. */
  banco?: BancoApp | null;
  /** Fonte das licenças (padrão: tabelas `plataforma.*` via `comTenant`). */
  licencas?: FonteLicencas;
  /** Autenticação (padrão: a do Core; sem Core Fase 2 = ninguém autentica — falha fechada). */
  autenticar?: ServicosCore['autenticar'];
  /** Escopo de carteira (padrão: o do Core; sem ele, só perfis de escopo `tenant` veem clientes). */
  carteira?: ServicosCore['carteira'];
  /** Usuários visíveis (padrão: o do Core; sem ele, só o próprio — ou `'tenant'` nos perfis de escopo tenant). */
  usuariosVisiveis?: ServicosCore['usuariosVisiveis'];
  relogio?: () => Date;
  logger?: FastifyServerOptions['logger'];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function semBanco(): never {
  throw new ErroHttp(503, 'BANCO_INDISPONIVEL', 'Banco de dados indisponível. Tente de novo em instantes.');
}

const acessoIndisponivel: AcessoBanco = { comTenant: async () => semBanco(), semTenant: async () => semBanco() };

function negar(r: { ok: false; status: 401 | 403; codigo: string; mensagem: string }, modulo: ModuloId): never {
  if (r.codigo === 'MODULO_INATIVO') {
    const c = erroModuloInativo(modulo);
    throw new ErroHttp(403, c.codigo, c.mensagem, c.detalhes);
  }
  const corpo = corpoDoErro(r as never);
  throw new ErroHttp(r.status, corpo.codigo, corpo.mensagem);
}

function validar<S extends ZodTypeAny>(schema: S | undefined, valor: unknown, onde: string): unknown {
  if (!schema) return valor ?? {};
  const r = schema.safeParse(valor ?? (onde === 'corpo' ? undefined : {}));
  if (!r.success) {
    throw new ErroHttp(400, 'VALIDACAO', `Dados inválidos em ${onde}.`, {
      problemas: r.error.issues.map((i) => ({ caminho: [onde, ...i.path].join('.'), mensagem: i.message })),
    });
  }
  return r.data;
}

/** `versao_licencas`: muda quando a lista efetiva, as versões ou os parâmetros mudam (RN-CORE-02 no app). */
function versaoLicencas(r: Pick<MeusModulosResposta, 'modulos'>): string {
  return createHash('sha256').update(JSON.stringify(r.modulos)).digest('hex').slice(0, 16);
}

export function createApp(op: OpcoesApp = {}): FastifyInstance {
  const modulos = op.modulos ?? MODULOS_API;
  const manifestos = modulos.map((m) => m.manifesto);
  const problemas = validarConjunto(manifestos);
  if (problemas.length > 0) throw new Error(`Módulos instalados inconsistentes: ${problemas.join('; ')}`);
  const permissoes = criarPermissoes(manifestos);
  const dependencias = dependenciasDosManifestos(manifestos);
  const porId = new Map(modulos.map((m) => [m.manifesto.id, m] as const));
  const core = porId.get('core');
  const banco = op.banco ?? null;
  const acesso: AcessoBanco = banco ?? acessoIndisponivel;
  const relogio = op.relogio ?? (() => new Date());
  const fonteLicencas = op.licencas ?? licencasDoBanco;
  const autenticar = op.autenticar ?? core?.servicos?.autenticar ?? (async () => null);
  const carteiraDe =
    op.carteira ?? core?.servicos?.carteira ?? (async (u: UsuarioAutenticado) => (escopoDoPerfil(u.perfil) === 'tenant' ? ('tenant' as const) : new Set<string>()));
  // falha fechada (ADR 0009 §6): sem o serviço do Core, supervisor e gerente veem só os próprios dados
  const usuariosDe =
    op.usuariosVisiveis ??
    core?.servicos?.usuariosVisiveis ??
    (async (u: UsuarioAutenticado) => (escopoDoPerfil(u.perfil) === 'tenant' ? ('tenant' as const) : new Set<string>([u.id])));

  const app = Fastify({
    logger: op.logger ?? false,
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && UUID.test(h) ? h : randomUUID();
    },
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  if (banco) app.addHook('onReady', () => banco.verificar());

  app.setErrorHandler((erro, req, reply) => {
    if (erro instanceof ErroHttp) return reply.code(erro.status).send(erro.corpo());
    // erro do módulo (ErroHttpModulo e os casos ErroRegraNegocio 422 / ErroNaoEncontrado 404): status e código do módulo
    if (erro instanceof ErroHttpModulo) return reply.code(erro.status).send(corpoDoErroModulo(erro) satisfies ErroApi);
    if (erro instanceof ZodError) return reply.code(400).send({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos.' } satisfies ErroApi);
    const status = (erro as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ codigo: 'REQUISICAO_INVALIDA', mensagem: 'Requisição inválida.' } satisfies ErroApi);
    }
    req.log.error({ err: erro }, 'erro não tratado');
    return reply.code(500).send({ codigo: 'ERRO_INTERNO', mensagem: 'Erro interno. Tente de novo; se continuar, avise o suporte.' } satisfies ErroApi);
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' } satisfies ErroApi));

  const cabecalhos = (req: FastifyRequest): Record<string, string | undefined> =>
    Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));

  const preparar: Plataforma['preparar'] = async (req, modulo) => {
    const token = await autenticar(cabecalhos(req), acesso);
    if (!token) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Faça login para continuar.');
    if (!UUID.test(token.tenant_id)) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Sessão inválida. Faça login de novo.');
    // licença checada a cada requisição (RN-CORE-01/02; nunca congelada no token)
    const licencas = await fonteLicencas(token, acesso);
    const efetivos = modulosEfetivos({ manifestos, ...licencas });
    const usuario: UsuarioDaRequisicao = { id: token.id, tenant_id: token.tenant_id, perfil: token.perfil, modulos: efetivos };
    let carteira: Promise<ReadonlySet<string> | 'tenant'> | null = null;
    let usuariosVisiveis: Promise<ReadonlySet<string> | 'tenant'> | null = null;
    const contexto = (m: ModuloId | null): ContextoBase => ({
      usuario,
      dependencias,
      requestId: req.id,
      agora: relogio,
      comTenant: (fn) =>
        acesso.comTenant(usuario.tenant_id, (db) =>
          fn(db, transacaoTenant(db, { manifestos, modulo: m, tenantId: usuario.tenant_id, usuarioId: usuario.id, requestId: req.id, agora: relogio })),
        ),
      carteira: () => (carteira ??= carteiraDe(token, acesso)),
      // o próprio usuário sempre está no conjunto, mesmo que o serviço o omita
      usuariosVisiveis: () => (usuariosVisiveis ??= usuariosDe(token, acesso).then((v) => (v === 'tenant' || v.has(token.id) ? v : new Set([...v, token.id])))),
      log: req.log.child({ tenant_id: usuario.tenant_id, modulo: m ?? 'plataforma', request_id: req.id }),
    });
    return { ctx: contexto(modulo), licencas, doModulo: contexto };
  };

  const plataforma: Plataforma = { manifestos, modulos, permissoes, preparar, relogio, banco };

  // ---------- plataforma ----------
  app.get('/v1/saude', async () => ({ ok: true, modulos: manifestos.map((m) => m.id) }));

  app.get(ROTA_ME_MODULOS, async (req) => {
    const { ctx, licencas } = await preparar(req, 'core');
    const porManifesto = new Map(manifestos.map((m) => [m.id, m] as const));
    const lista = ctx.usuario.modulos.map((id) => ({ id, versao: porManifesto.get(id)!.versao, parametros: licencas.parametros[id] ?? {} }));
    return MeusModulosRespostaSchema.parse({ modulos: lista, versao_licencas: versaoLicencas({ modulos: lista }), calculado_em: relogio().toISOString() });
  });

  registrarSync(app, plataforma);

  // ---------- rotas dos módulos ----------
  for (const m of modulos) {
    for (const rota of m.rotas ?? []) montarRota(app, plataforma, permissoes, m.manifesto, rota);
    for (const rota of m.rotasPublicas ?? []) montarRotaPublica(app, acesso, relogio, rota);
  }

  return app;
}

function montarRota(app: FastifyInstance, p: Plataforma, permissoes: ReturnType<typeof criarPermissoes>, manifesto: Manifesto, rota: RotaModulo): void {
  const modulo = manifesto.id;
  const url = `/v1/${modulo}${rota.caminho ? `/${rota.caminho}` : ''}`;
  app.route({
    method: rota.metodo,
    url,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { ctx } = await p.preparar(req, modulo);
      const u = ctx.usuario;
      // 1) licença do módulo da rota (403 MODULO_INATIVO)
      const lic = verificarAcesso(u, { modulo, perfis: [u.perfil] });
      if (!lic.ok) negar(lic, modulo);
      // 2) perfil: RN-PRO-01 (escrita de pedido sempre barrada; leitura GET pedido.ver segue o manifesto — O-3),
      //    depois ação do manifesto (ADR 0004) ou lista de perfis
      if (u.perfil === 'promotor' && promotorBarradoNaRota(rota)) throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Seu perfil não tem acesso a esta ação.');
      const perfil = rota.acao ? verificarAcao(u, permissoes, rota.acao) : verificarAcesso(u, { modulo, perfis: rota.perfis ?? manifesto.perfis });
      if (!perfil.ok) negar(perfil, rota.acao ? permissoes.regraDaAcao(rota.acao).modulo : modulo);
      // 3) entrada validada por Zod
      const params = validar(rota.params, req.params, 'params');
      const query = validar(rota.query, req.query, 'query');
      const corpo = validar(rota.corpo, req.body, 'corpo');
      // 4) escopo de carteira (RN-CORE-04)
      if (typeof rota.carteira === 'function') {
        const clienteId = rota.carteira({ corpo, query, params });
        if (!clienteId) throw new ErroHttp(400, 'VALIDACAO', 'Informe o cliente.');
        const r = verificarCarteira(clienteId, await ctx.carteira());
        if (!r.ok) negar(r, modulo);
      }
      const resultado = await rota.executar({ ...ctx, corpo, query, params } as never);
      const status = rota.status ?? 200;
      if (status === 204) return reply.code(204).send();
      return reply.code(status).send(resultado ?? {});
    },
  });
}

function montarRotaPublica(app: FastifyInstance, acesso: AcessoBanco, relogio: () => Date, rota: RotaPublica): void {
  const limitador = criarLimitador(rota.limite.max, rota.limite.janelaMs, () => relogio().getTime());
  app.route({
    method: rota.metodo,
    url: `/v1/${rota.caminho}`,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const params = validar(rota.params, req.params, 'params');
      const query = validar(rota.query, req.query, 'query');
      const corpo = validar(rota.corpo, req.body, 'corpo');
      const extra = rota.limite.chave?.({ corpo, query, params }) ?? '';
      const chave = `${req.ip}|${String(extra).toLowerCase()}`;
      if (!limitador.tentar(chave)) {
        reply.header('retry-after', String(limitador.esperaSegundos(chave)));
        throw new ErroHttp(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um pouco e tente de novo.');
      }
      const log = req.log.child({ modulo: 'core', request_id: req.id });
      const resultado = await rota.executar({ corpo, query, params, requestId: req.id, ip: req.ip, agora: relogio, banco: acesso, log } as never);
      const status = rota.status ?? 200;
      if (status === 204) return reply.code(204).send();
      return reply.code(status).send(resultado ?? {});
    },
  });
}
