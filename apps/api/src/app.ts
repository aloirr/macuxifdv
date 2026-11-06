/**
 * `createApp` — bootstrap Fastify do monólito modular (desenho T-0004 §3; ADR 0006).
 *
 * Monta, para cada módulo instalado (`MODULOS_API`), as rotas declaradas em `definirModuloApi` sob
 * `/v1/<modulo>/<caminho>`; as rotas públicas do Core sob `/v1/<caminho>`; e as rotas da plataforma:
 * `GET /v1/saude`, `GET /v1/me/modulos`, `GET /v1/sync/novidades` (RN-CORE-23), `GET /v1/sync/pull`, `POST /v1/sync/push`, `PUT|GET /v1/arquivos/:id` (ADR 0010) e `GET /v1/auditoria` (RN-AUD-01).
 *
 * Toda rota autenticada passa por `prepararRequisicao` (401 → licença 403 MODULO_INATIVO → perfil/ação
 * 403 PERFIL_SEM_ACESSO → Zod 400 → carteira 403 FORA_DA_CARTEIRA). Os módulos efetivos são calculados
 * por requisição (RN-CORE-01/03, `modulosEfetivos` do SDK) a partir da fonte de licenças. Banco só por
 * `comTenant` com o tenant do token (papel macuxi_app). Corpo de erro: `ErroApiSchema` `{ codigo, mensagem, detalhes? }`;
 * o status do erro do módulo é o do `ErroHttpModulo` (401/403/404/409/410/422/423/503) e `ctx.dependencias` traz o
 * `depende` de todos os manifestos instalados (RN-CORE-03). `ctx.parametros()` = parâmetros do tenant do módulo da rota;
 * `tx.consultar` liga as consultas dos módulos instalados (ADR 0012; `{ licenca: 'tenant' }` só em GET/HEAD, ADR 0025) e
 * `tx.auditar` grava a auditoria (RN-AUD-01).
 *
 * Rotas de Conector (ADR 0013): `conector.ts` monta `/<modulo>/v1/*` do módulo com `conector` (chave de API, sem JWT).
 *
 * Proteção do Zod (GHSA-mrhx-c7xc-m3w5: o Zod acumula um problema por elemento inválido de array, sem teto): todo corpo
 * JSON com mais de `MAX_ELEMENTOS_CORPO` elementos de array (somados, em qualquer profundidade) é recusado com 413
 * ANTES de qualquer schema, e a resposta 400 lista no máximo `MAX_PROBLEMAS_RESPOSTA` problemas.
 *
 * Teto de BYTES do corpo: 1 MiB (`LIMITE_CORPO_ROTA_PADRAO`) ou o `limiteCorpoBytes` da rota de módulo (até
 * `LIMITE_CORPO_ROTA_MAX`, 32 MiB; ex.: CSV da carga por arquivo). Estourou: 413 `CORPO_GRANDE_DEMAIS` com a mensagem
 * "Arquivo grande demais: o limite é X MB." (rota com limite próprio) ou "Envio grande demais: o limite é X MB. …" (demais),
 * e `detalhes.limite_bytes`. Rota com limite acima do padrão exige `Authorization` antes de ler o corpo (401 sem buffer).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { erroModuloInativo, ROTA_ME_MODULOS } from '@macuxi/core/contracts';
import {
  consultasSemImplementacao,
  corpoDoErro,
  corpoDoErroModulo,
  retryAfterDoErroModulo,
  criarPermissoes,
  dependenciasDosManifestos,
  erroCorpoGrande,
  ErroHttpModulo,
  escopoDoPerfil,
  fusoDoTenantOuPadrao,
  LIMITE_CORPO_ROTA_PADRAO,
  modulosEfetivos,
  problemasApiConector,
  problemasConteudoRota,
  problemasLimiteCorpo,
  NOME_ARQUIVO_ROTA_RE,
  promotorBarradoNaRota,
  SaudeRespostaSchema,
  SERVICO_API_MACUXI,
  validarConjunto,
  verificarAcao,
  verificarAcesso,
  verificarCarteira,
  type AcessoBanco,
  type ContextoBase,
  type EntradaRota,
  type ErroApi,
  type Manifesto,
  type ModuloApi,
  type ModuloId,
  type RotaModulo,
  type RotaPublica,
  type ServicosCore,
  type SuperAdminAutenticado,
  CABECALHO_TENANT_PLATAFORMA,
  cabecalhosPublicos,
  type ModoSuperAdmin,
  type UsuarioAutenticado,
  type UsuarioDaRequisicao,
} from '@macuxi/platform-sdk';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { ZodError, type ZodTypeAny } from 'zod';
import type { BancoApp } from './banco';
import { excedeElementos, MAX_PROBLEMAS_RESPOSTA } from './corpo';
import { criarLimitador } from './limitador';
import { registrarConector, ehRotaConector } from './conector';
import { licencasDoBanco, licencasDoTenantNoBanco, type FonteLicencas, type FonteLicencasTenant } from './licencas';
import { MODULOS_API } from './modulos';
import { registroDeConsultas, transacaoTenant } from './outbox';
import { registrarArquivos, type ArmazenamentoArquivos } from './arquivos';
import { registrarAuditoria } from './auditoria';
import { registrarSync } from './sync';
import { MAX_TENTATIVAS_PADRAO, nomesConsumidos } from './despachante';
import { avaliarAlertas, comPrazo, criarMetricasApi, type EstadoBanco, type MetricasApi, type ResumoOutbox } from './observabilidade';
import { respostaMeusModulos } from './me-modulos';
import { fontePlataformaNoBanco, marcaSuperAdmin, marcarSuperAdmin, prefixoDoIp, registrarRotasPlataforma, type FontePlataforma } from './plataforma';
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
  /** Bytes dos arquivos (ADR 0010). `null`/ausente = upload/download respondem 503. */
  arquivos?: ArmazenamentoArquivos | null;
  relogio?: () => Date;
  logger?: FastifyServerOptions['logger'];
  /**
   * Proxy confiável na frente da API (`MACUXI_TRUST_PROXY`, `lerTrustProxy` em `config.ts`): com ele, `req.ip` vem do
   * `X-Forwarded-For` (ex.: túnel `cloudflared` da demo, T-0026) e os limites por IP contam cada aparelho. Padrão:
   * desligado (`req.ip` = quem abriu a conexão).
   * Sem CORS e sem cookie, de propósito (T-0038, desenho §3): o BKO (inclusive em `https://bko-demo.macuxifdv.com.br`)
   * chama a API pelo proxy same-origin do Next (`/api-proxy`, pelo loopback), que repassa o `X-Forwarded-For` do túnel;
   * o app usa `Authorization: Bearer`. Nenhum navegador fala direto com a API, então nenhuma origem é liberada.
   */
  trustProxy?: FastifyServerOptions['trustProxy'];
  /** Versão devolvida em `GET /v1/saude` (padrão: `MACUXI_VERSAO` ou a versão do package.json da API). */
  versao?: string;
  /** Licenças do tenant sem usuário, para as rotas de Conector (ADR 0013; padrão: tabelas `plataforma.*` via `comTenant`). */
  licencasTenant?: FonteLicencasTenant;
  /** Contagem de respostas (T-0078; padrão: uma nova por app). O servidor passa a mesma para o log periódico. */
  metricas?: MetricasApi;
  /** Super-admin de plataforma (ADR 0029; padrão: o do Core; sem ele, nenhuma rota aceita super-admin). */
  autenticarSuperAdmin?: ServicosCore['autenticarSuperAdmin'];
  /** Funções do super-admin no banco (0035; padrão: `fontePlataformaNoBanco`). Testes injetam a sua. */
  plataforma?: FontePlataforma;
}

/** Cache da sonda de dependências do `/v1/saude` (a rota é pública: não vira amplificador de consultas no banco). */
const CACHE_SAUDE_MS = 10_000;
/** Prazo de cada sonda do `/v1/saude`. */
const PRAZO_SONDA_SAUDE_MS = 2_000;

/** Versão do pacote da API (package.json), lida uma vez. */
export const VERSAO_API: string = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

export { excedeElementos, MAX_ELEMENTOS_CORPO, MAX_PROBLEMAS_RESPOSTA } from './corpo';

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
      problemas: r.error.issues.slice(0, MAX_PROBLEMAS_RESPOSTA).map((i) => ({ caminho: [onde, ...i.path].join('.'), mensagem: i.message })),
      ...(r.error.issues.length > MAX_PROBLEMAS_RESPOSTA ? { total_problemas: r.error.issues.length } : {}),
    });
  }
  return r.data;
}

export function createApp(op: OpcoesApp = {}): FastifyInstance {
  const modulos = op.modulos ?? MODULOS_API;
  const manifestos = modulos.map((m) => m.manifesto);
  // ADR 0012: na API real, toda consulta oferecida tem implementação (fixtures de teste podem trocar um módulo sem as dele)
  const problemas = [
    ...validarConjunto(manifestos),
    ...(op.modulos ? [] : consultasSemImplementacao(modulos)),
    // ADR 0013: fixture montada sem definirModuloApi também passa pela checagem das rotas de Conector
    ...modulos.flatMap((m) => problemasApiConector(m.manifesto, m.conector).map((x) => `${m.manifesto.id}: ${x}`)),
    // fixture sem definirModuloApi também passa pelo teto de corpo das rotas
    ...modulos.flatMap((m) => (m.rotas ?? []).flatMap((r) => problemasLimiteCorpo(`${r.metodo} /v1/${m.manifesto.id}/${r.caminho}`, r))),
    // T-0087: tipo de conteúdo e nome de arquivo das rotas de download (lista fechada; nada executável no navegador)
    ...modulos.flatMap((m) => (m.rotas ?? []).flatMap((r) => problemasConteudoRota(`${r.metodo} /v1/${m.manifesto.id}/${r.caminho}`, r))),
  ];
  if (problemas.length > 0) throw new Error(`Módulos instalados inconsistentes: ${problemas.join('; ')}`);
  const permissoes = criarPermissoes(manifestos);
  const dependencias = dependenciasDosManifestos(manifestos);
  const porId = new Map(modulos.map((m) => [m.manifesto.id, m] as const));
  const consultas = registroDeConsultas(modulos);
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
  // ADR 0029: super-admin de plataforma (falha fechada sem o serviço do Core) e as funções dele no banco
  const autenticarSA = op.autenticarSuperAdmin ?? core?.servicos?.autenticarSuperAdmin ?? (async () => null);
  const fontePlataforma = op.plataforma ?? fontePlataformaNoBanco;
  const licencasTenant = op.licencasTenant ?? licencasDoTenantNoBanco;

  const app = Fastify({
    logger: op.logger ?? false,
    trustProxy: op.trustProxy ?? false,
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && UUID.test(h) ? h : randomUUID();
    },
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // T-0078: contagem por status (5xx) na janela; o `/v1/saude` e o log periódico do servidor leem daqui
  const metricas = op.metricas ?? criarMetricasApi({ relogio });
  app.addHook('onResponse', async (req, reply) => {
    metricas.registrar(reply.statusCode);
    // ADR 0029 §6: toda requisição do super-admin vira uma linha de auditoria da plataforma (também as recusadas)
    const marca = marcaSuperAdmin(req);
    if (!marca) return;
    try {
      await fontePlataforma.auditar(
        {
          super_admin_id: marca.sa.id,
          sessao_id: marca.sa.sessao_id,
          tenant_id: marca.tenantId,
          acao: 'sa.requisicao',
          metodo: req.method,
          rota: req.routeOptions.url ?? '(sem rota)',
          status: reply.statusCode,
          request_id: req.id,
          ip_prefixo: prefixoDoIp(req.ip),
        },
        acesso,
      );
    } catch (erro) {
      req.log.error({ err: erro, request_id: req.id }, 'falha ao gravar a auditoria da plataforma');
    }
  });

  if (banco) app.addHook('onReady', () => banco.verificar());

  // antes de qualquer schema Zod (rotas de módulo, públicas e de sync): corpo com coleções gigantes é recusado.
  // As rotas de Conector (ADR 0013) têm teto próprio por rota e o 413 com o código do Hub (`conector.ts`).
  app.addHook('preValidation', async (req) => {
    if (!ehRotaConector(req) && excedeElementos(req.body)) throw new ErroHttp(413, 'CORPO_GRANDE_DEMAIS', 'Envio grande demais. Divida em partes menores.');
  });

  app.setErrorHandler((erro, req, reply) => {
    if (erro instanceof ErroHttp) return reply.code(erro.status).send(erro.corpo());
    // corpo acima do teto de bytes da rota (o parser do Fastify recusa antes de ler o JSON): 413 com o limite em MB
    if ((erro as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      const limite = req.routeOptions.bodyLimit ?? LIMITE_CORPO_ROTA_PADRAO;
      const arquivo = (req.routeOptions.config as ConfigRotaModulo | undefined)?.limiteCorpoProprio === true;
      return reply.code(413).send(erroCorpoGrande(limite, arquivo));
    }
    // erro do módulo (ErroHttpModulo e os casos ErroRegraNegocio 422 / ErroNaoEncontrado 404): status e código do módulo
    if (erro instanceof ErroHttpModulo) {
      const espera = retryAfterDoErroModulo(erro);
      if (espera !== null) reply.header('retry-after', String(espera));
      return reply.code(erro.status).send(corpoDoErroModulo(erro) satisfies ErroApi);
    }
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

  /**
   * ADR 0029 §5: só nas rotas com `superAdmin`, o token de plataforma vale, com o tenant do cabeçalho `x-macuxi-tenant`. O
   * usuário vira um `admin` sintético do tenant, com os módulos licenciados AO TENANT; carteira e equipe = `'tenant'`.
   */
  const superAdminDaRequisicao = async (req: FastifyRequest, modo: ModoSuperAdmin | undefined): Promise<{ sa: SuperAdminAutenticado; tenantId: string } | null> => {
    if (!modo) return null;
    const sa = await autenticarSA(cabecalhos(req), acesso);
    if (!sa) {
      if (modo === 'exige') {
        // usuário do tenant numa rota só do super-admin: 401 se nem login tiver, 403 se tiver
        if (await autenticar(cabecalhos(req), acesso)) throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Seu perfil não tem acesso a esta ação.');
        throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Faça login para continuar.');
      }
      return null;
    }
    const bruto = cabecalhos(req)[CABECALHO_TENANT_PLATAFORMA];
    marcarSuperAdmin(req, { sa, tenantId: null });
    if (!bruto || !UUID.test(bruto)) throw new ErroHttp(400, 'TENANT_OBRIGATORIO', 'Escolha a empresa (cabeçalho x-macuxi-tenant).');
    const tenantId = bruto.toLowerCase();
    if (!(await fontePlataforma.tenantAtivo(sa, tenantId, acesso))) throw new ErroHttp(404, 'TENANT_NAO_ENCONTRADO', 'Empresa não encontrada ou inativa.');
    marcarSuperAdmin(req, { sa, tenantId });
    return { sa, tenantId };
  };

  const preparar: Plataforma['preparar'] = async (req, modulo, modoSuperAdmin) => {
    const doSA = await superAdminDaRequisicao(req, modoSuperAdmin);
    const token: UsuarioAutenticado | null = doSA ? { id: doSA.sa.id, tenant_id: doSA.tenantId, perfil: 'admin' } : await autenticar(cabecalhos(req), acesso);
    if (!token) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Faça login para continuar.');
    if (!UUID.test(token.tenant_id)) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Sessão inválida. Faça login de novo.');
    // licença checada a cada requisição (RN-CORE-01/02; nunca congelada no token). Super-admin: a do tenant (todos os perfis)
    const licencas = doSA
      ? await licencasTenant(doSA.tenantId, acesso).then((t) => ({ ...t, doPerfil: t.ativosNoTenant, removidosDoUsuario: [] as ModuloId[] }))
      : await fonteLicencas(token, acesso);
    const efetivos = modulosEfetivos({ manifestos, ...licencas });
    const usuario: UsuarioDaRequisicao = { id: token.id, tenant_id: token.tenant_id, perfil: token.perfil, modulos: efetivos };
    // ADR 0025: `tx.consultar(..., { licenca: 'tenant' })` só em leitura (GET/HEAD; o pull do sync é GET, o push não):
    // efetivos do TENANT (todos os instalados no lugar do perfil), com as mesmas dependências (RN-CORE-03) e o core sempre ativo
    const leitura = req.method === 'GET' || req.method === 'HEAD';
    const modulosDoTenant = leitura ? modulosEfetivos({ manifestos, ativosNoTenant: licencas.ativosNoTenant, doPerfil: manifestos.map((x) => x.id) }) : undefined;
    let carteira: Promise<ReadonlySet<string> | 'tenant'> | null = null;
    let usuariosVisiveis: Promise<ReadonlySet<string> | 'tenant'> | null = null;
    // parâmetros do tenant (`plataforma.parametro`) lidos junto com as licenças, por requisição (T-0029 E3)
    const parametros = (m: ModuloId): Readonly<Record<string, unknown>> => licencas.parametros[m] ?? {};
    // fuso do tenant (RN-CORE-11; T-0035): lido com as licenças; ausente ou inválido = America/Manaus
    const fuso = fusoDoTenantOuPadrao(licencas.fuso);
    const contexto = (m: ModuloId | null): ContextoBase => ({
      usuario,
      dependencias,
      requestId: req.id,
      agora: relogio,
      comTenant: (fn) =>
        acesso.comTenant(usuario.tenant_id, (db) =>
          fn(
            db,
            transacaoTenant(db, {
              manifestos,
              modulo: m,
              tenantId: usuario.tenant_id,
              usuarioId: usuario.id,
              requestId: req.id,
              agora: relogio,
              usuario,
              ...(modulosDoTenant ? { modulosDoTenant } : {}),
              consultas,
              parametros,
              fuso: () => fuso,
              log: req.log.child({ tenant_id: usuario.tenant_id, request_id: req.id }),
            }),
          ),
        ),
      carteira: () => (carteira ??= doSA ? Promise.resolve('tenant' as const) : carteiraDe(token, acesso, { agora: relogio, fuso })),
      // o próprio usuário sempre está no conjunto, mesmo que o serviço o omita
      usuariosVisiveis: () => (usuariosVisiveis ??= doSA ? Promise.resolve('tenant' as const) : usuariosDe(token, acesso).then((v) => (v === 'tenant' || v.has(token.id) ? v : new Set([...v, token.id])))),
      parametros: () => (m ? parametros(m) : {}),
      fuso: () => fuso,
      log: req.log.child({ tenant_id: usuario.tenant_id, modulo: m ?? 'plataforma', request_id: req.id, ...(doSA ? { super_admin: true } : {}) }),
      ...(doSA ? { superAdmin: doSA.sa } : {}),
    });
    return { ctx: contexto(modulo), licencas, doModulo: contexto };
  };

  const plataforma: Plataforma = { manifestos, modulos, permissoes, preparar, relogio, banco };

  // ---------- plataforma ----------
  // identificação verificável (R-20261101-023742-alexandre): o app só salva o servidor e só envia o login se `servico` for macuxi-api
  const saude = SaudeRespostaSchema.parse({ ok: true, servico: SERVICO_API_MACUXI, versao: op.versao ?? (process.env.MACUXI_VERSAO || VERSAO_API), modulos: manifestos.map((m) => m.id) });
  // T-0078: dependências (banco e outbox, só contagens), métricas da janela e códigos de alerta; sempre 200 enquanto o processo
  // responde (o app identifica o servidor por aqui). Quem monitora olha `alertas` (scripts/deploy/demo/alerta-saude.sh).
  const eventosComConsumidor = nomesConsumidos(modulos);
  let sonda: { em: number; valor: Promise<{ banco: EstadoBanco; outbox: ResumoOutbox | null }> } | null = null;
  const sondar = async (): Promise<{ banco: EstadoBanco; outbox: ResumoOutbox | null }> => {
    if (!banco) return { banco: 'ausente', outbox: null };
    const estadoBanco: EstadoBanco = await comPrazo(banco.instanteSync(), PRAZO_SONDA_SAUDE_MS).then(
      () => 'ok' as const,
      () => 'falha' as const,
    );
    if (estadoBanco !== 'ok' || !banco.resumoOutbox) return { banco: estadoBanco, outbox: null };
    const outbox = await comPrazo(banco.resumoOutbox(eventosComConsumidor, MAX_TENTATIVAS_PADRAO), PRAZO_SONDA_SAUDE_MS).catch(() => undefined);
    return { banco: estadoBanco, outbox: outbox ?? null };
  };
  app.get('/v1/saude', async () => {
    const agora = relogio().getTime();
    if (!sonda || agora - sonda.em >= CACHE_SAUDE_MS) sonda = { em: agora, valor: sondar() };
    const dependencias = await sonda.valor;
    const janela = metricas.janela();
    return {
      ...saude,
      dependencias,
      metricas: janela,
      alertas: avaliarAlertas({ ...dependencias, erros_5xx: janela.erros_5xx }),
    };
  });

  app.get(ROTA_ME_MODULOS, async (req) => {
    const { ctx, licencas } = await preparar(req, 'core');
    return respostaMeusModulos(manifestos, ctx.usuario.modulos, licencas.parametros, relogio());
  });

  registrarSync(app, plataforma);
  registrarArquivos(app, plataforma, op.arquivos ?? null);
  registrarAuditoria(app, plataforma);
  // ADR 0029: rotas do portal sem tenant (empresas); a autenticação do super-admin é do Core (`plataforma/auth/*`)
  registrarRotasPlataforma(app, { manifestos, acesso, fonte: fontePlataforma, autenticar: (req) => autenticarSA(cabecalhos(req), acesso), validar });

  // ---------- rotas dos módulos ----------
  for (const m of modulos) {
    for (const rota of m.rotas ?? []) montarRota(app, plataforma, permissoes, m.manifesto, rota);
    for (const rota of m.rotasPublicas ?? []) montarRotaPublica(app, acesso, relogio, rota);
    // ADR 0013: rotas do Conector em /<modulo>/v1 (chave de API, licença do tenant da chave)
    if (m.conector) registrarConector(app, m, { manifestos, acesso, relogio, licencasTenant: op.licencasTenant ?? licencasDoTenantNoBanco });
  }

  return app;
}

/** `config` da rota Fastify de módulo: `limiteCorpoProprio` = a rota declarou `limiteCorpoBytes` (mensagem "Arquivo grande demais"). */
interface ConfigRotaModulo {
  limiteCorpoProprio?: boolean;
}

function montarRota(app: FastifyInstance, p: Plataforma, permissoes: ReturnType<typeof criarPermissoes>, manifesto: Manifesto, rota: RotaModulo): void {
  const modulo = manifesto.id;
  const url = `/v1/${modulo}${rota.caminho ? `/${rota.caminho}` : ''}`;
  const limite = rota.limiteCorpoBytes;
  app.route({
    method: rota.metodo,
    url,
    ...(limite !== undefined
      ? {
          bodyLimit: limite,
          config: { limiteCorpoProprio: true } satisfies ConfigRotaModulo,
          // corpo grande só é lido de quem diz estar autenticado: sem `Authorization`, 401 antes do parser (sem buffer de MBs);
          // o token em si é conferido no handler, como em toda rota
          ...(limite > LIMITE_CORPO_ROTA_PADRAO
            ? {
                onRequest: async (req: FastifyRequest) => {
                  if (!req.headers.authorization) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Faça login para continuar.');
                },
              }
            : {}),
        }
      : {}),
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { ctx } = await p.preparar(req, modulo, rota.superAdmin);
      const u = ctx.usuario;
      // 1) licença do módulo da rota (403 MODULO_INATIVO); para o super-admin, a licença do tenant
      const lic = verificarAcesso(u, { modulo, perfis: [u.perfil] });
      if (!lic.ok) negar(lic, modulo);
      // ADR 0029 §5: o super-admin numa rota com `superAdmin` não passa por ação/perfil (a opção da rota é a autorização) e
      // tem carteira 'tenant'; licença, Zod e RLS valem. Usuário do tenant em rota 'exige' já saiu com 403 no preparar.
      if (!ctx.superAdmin) {
      // 2) perfil: RN-PRO-01 (escrita de pedido sempre barrada; leitura GET pedido.ver segue o manifesto — O-3),
      //    depois ação do manifesto (ADR 0004) ou lista de perfis
      if (u.perfil === 'promotor' && promotorBarradoNaRota(rota)) throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Seu perfil não tem acesso a esta ação.');
      const perfil = rota.acao ? verificarAcao(u, permissoes, rota.acao) : verificarAcesso(u, { modulo, perfis: rota.perfis ?? manifesto.perfis });
      if (!perfil.ok) negar(perfil, rota.acao ? permissoes.regraDaAcao(rota.acao).modulo : modulo);
      }
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
      // T-0087: download (CSV, OpenAPI…) com tipo e nome declarados na rota
      // (tudo conferido antes do 1º cabeçalho: um erro de programação vira o 500 JSON sem cabeçalho de download)
      const nome = rota.nomeArquivo !== undefined ? nomeDoArquivo(rota, { corpo, query, params }) : null;
      const bruto = rota.tipoConteudo !== undefined && rota.tipoConteudo !== 'application/json';
      if (bruto && typeof resultado !== 'string' && !(resultado instanceof Uint8Array))
        throw new Error(`${rota.metodo} ${url}: tipoConteudo ${String(rota.tipoConteudo)} exige string ou Uint8Array no executar`);
      if (nome !== null) reply.header('content-disposition', `attachment; filename="${nome}"`);
      if (bruto) {
        reply.header('content-type', rota.tipoConteudo).header('x-content-type-options', 'nosniff');
        return reply.code(status).send(typeof resultado === 'string' ? resultado : Buffer.from(resultado as Uint8Array));
      }
      return reply.code(status).send(resultado ?? {});
    },
  });
}

/** Nome do arquivo do `Content-Disposition` (fixo ou calculado da entrada validada); fora do padrão = erro de programação (500). */
function nomeDoArquivo(rota: RotaModulo, entrada: EntradaRota): string {
  const nome = typeof rota.nomeArquivo === 'function' ? rota.nomeArquivo(entrada) : rota.nomeArquivo;
  if (typeof nome !== 'string' || !NOME_ARQUIVO_ROTA_RE.test(nome)) throw new Error(`${rota.metodo} ${rota.caminho}: nomeArquivo calculado fora do padrão`);
  return nome;
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
      // T-0087: só a lista fechada de cabeçalhos (hoje `authorization`), com valores censurados se serializados
      const resultado = await rota.executar({ corpo, query, params, requestId: req.id, ip: req.ip, agora: relogio, banco: acesso, log, cabecalhos: cabecalhosPublicos(req.headers) } as never);
      const status = rota.status ?? 200;
      if (status === 204) return reply.code(204).send();
      return reply.code(status).send(resultado ?? {});
    },
  });
}
