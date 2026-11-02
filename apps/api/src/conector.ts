/**
 * Rotas de Conector (ADR 0013; desenho T-0032 §3): plugin Fastify encapsulado em `/<modulo>/v1` (hoje `/integracao/v1`), com
 * tratador de erro, 404 e parser de JSON próprios. Pipeline, nesta ordem:
 *   1. `onRequest`: falhas de autenticação por IP (20/min) → 429 `limite_de_taxa` + `Retry-After` (antes de ler o corpo);
 *   2. parser: `bodyLimit` da rota (1 MiB padrão; 8 MiB no lote) e `preValidation`: `maxElementosCorpo` → 413 `corpo_grande`;
 *   3. `autenticar` do módulo (só `semTenant`) → 400/401/403/503; 401 e 403 contam no item 1; motivo só no log;
 *   4. licença do módulo no tenant DA CHAVE (+ parâmetros e fuso, uma transação) → 403 `modulo_inativo`;
 *   5. Zod de cabeçalhos/params/query/corpo declarados → 400 `requisicao_invalida`;
 *   6. `antes` e `executar` do módulo, com `comTenant` no tenant da chave e `usuario_id = null`.
 * Corpo de erro: `{ codigo, mensagem, detalhes?, ...extras, requisicao_id }` com os códigos do Hub em minúsculas. Erro inesperado
 * = 500 sem detalhe; banco fora = 503 `servico_indisponivel` + `Retry-After`. Logs: nunca cabeçalhos, chave, linhas nem payload.
 */
import {
  caminhoConectorParaRoteador,
  ErroConector,
  ErroHttpModulo,
  fusoDoTenantOuPadrao,
  LIMITE_CORPO_CONECTOR_PADRAO,
  MAX_ELEMENTOS_CONECTOR_PADRAO,
  modulosEfetivos,
  RespostaConector,
  type AcessoBanco,
  type ContextoConector,
  type Manifesto,
  type ModuloApi,
  type RecusaConector,
  type RotaConector,
} from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeAny } from 'zod';
import { excedeElementos, MAX_PROBLEMAS_RESPOSTA } from './corpo';
import { ErroHttp } from './erros';
import type { FonteLicencasTenant } from './licencas';
import { criarContadorFalhas } from './limitador';
import { transacaoTenant } from './outbox';

/** Falhas de autenticação aceitas por IP na janela (ADR 0013 §3 item 1). */
export const FALHAS_AUTENTICACAO_CONECTOR = Object.freeze({ max: 20, janelaMs: 60_000 });
/** `Retry-After` (s) quando o banco ou o serviço está fora. */
export const RETRY_AFTER_INDISPONIVEL_S = 30;

/** Marca da rota de Conector em `routeOptions.config` (o teto global de elementos das rotas de usuário não vale aqui). */
export interface ConfigRotaConector {
  macuxiConector: true;
  maxElementosCorpo: number;
}

export function ehRotaConector(req: FastifyRequest): boolean {
  return (req.routeOptions?.config as Partial<ConfigRotaConector> | undefined)?.macuxiConector === true;
}

export interface DependenciasConector {
  manifestos: readonly Manifesto[];
  acesso: AcessoBanco;
  relogio: () => Date;
  licencasTenant: FonteLicencasTenant;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Erros de conexão/disponibilidade do Postgres e do pool (o resto é 500). */
function bancoFora(e: unknown): boolean {
  const codigo = String((e as { code?: unknown })?.code ?? '');
  if (/^08/.test(codigo) || ['57P01', '57P02', '57P03', '53300', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(codigo)) return true;
  const msg = e instanceof Error ? e.message : '';
  return /timeout exceeded when trying to connect|Connection terminated/i.test(msg);
}

function indisponivel(): ErroConector {
  return new ErroConector(
    503,
    { codigo: 'servico_indisponivel', mensagem: 'O Hub está indisponível no momento. O Conector tenta de novo sozinho.' },
    { 'retry-after': String(RETRY_AFTER_INDISPONIVEL_S) },
  );
}

function recusa(r: RecusaConector): ErroConector {
  if (r.status === 503) return new ErroConector(503, { codigo: r.codigo, mensagem: r.mensagem }, { 'retry-after': String(RETRY_AFTER_INDISPONIVEL_S) });
  return new ErroConector(r.status, { codigo: r.codigo, mensagem: r.mensagem });
}

function validar(schema: ZodTypeAny | undefined, valor: unknown, onde: string): unknown {
  if (!schema) return valor ?? (onde === 'corpo' ? undefined : {});
  const r = schema.safeParse(valor ?? (onde === 'corpo' ? undefined : {}));
  if (r.success) return r.data;
  throw new ErroConector(400, {
    codigo: 'requisicao_invalida',
    mensagem: `Dados inválidos em ${onde}.`,
    detalhes: {
      problemas: r.error.issues.slice(0, MAX_PROBLEMAS_RESPOSTA).map((i) => ({ caminho: [onde, ...i.path].join('.'), mensagem: i.message })),
      ...(r.error.issues.length > MAX_PROBLEMAS_RESPOSTA ? { total_problemas: r.error.issues.length } : {}),
    },
  });
}

const cabecalhosDe = (req: FastifyRequest): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));

/** Monta `/<modulo>/v1/*` do módulo (só chamado para módulos com `conector`, já validados por `problemasApiConector`). */
export function registrarConector(app: FastifyInstance, modulo: ModuloApi, dep: DependenciasConector): void {
  const api = modulo.conector;
  if (!api) return;
  const id = modulo.manifesto.id;
  const falhas = criarContadorFalhas(FALHAS_AUTENTICACAO_CONECTOR.max, FALHAS_AUTENTICACAO_CONECTOR.janelaMs, () => dep.relogio().getTime());
  const bytes = new WeakMap<object, number>();

  void app.register(
    async (inst) => {
      // só JSON; guarda os bytes recebidos para `ctx.bytesCorpo` (o `bodyLimit` da rota já barrou o excesso com 413)
      const jsonPadrao = inst.getDefaultJsonParser('error', 'remove');
      inst.removeAllContentTypeParsers();
      inst.addContentTypeParser('application/json', { parseAs: 'string' }, (req, corpo, done) => {
        bytes.set(req, Buffer.byteLength(corpo as string, 'utf8'));
        jsonPadrao(req, corpo as string, done);
      });

      inst.addHook('onRequest', async (req) => {
        const espera = falhas.bloqueado(req.ip);
        if (espera !== null)
          throw new ErroConector(429, { codigo: 'limite_de_taxa', mensagem: 'Muitas falhas de autenticação deste endereço. Aguarde e confira a chave do Conector.' }, { 'retry-after': String(espera) });
      });

      inst.addHook('preValidation', async (req) => {
        const max = (req.routeOptions.config as Partial<ConfigRotaConector>).maxElementosCorpo ?? MAX_ELEMENTOS_CONECTOR_PADRAO;
        if (excedeElementos(req.body, max))
          throw new ErroConector(413, { codigo: 'corpo_grande', mensagem: 'O corpo da requisição tem itens demais. Divida em partes menores.' });
      });

      inst.setErrorHandler((erro, req, reply) => {
        let e: ErroConector;
        if (erro instanceof ErroConector) e = erro;
        else if ((erro instanceof ErroHttp && erro.status === 503) || bancoFora(erro)) {
          req.log.error({ err: erro, modulo: id }, 'banco indisponível em rota de Conector');
          e = indisponivel();
        } else {
          const status = (erro as { statusCode?: number }).statusCode;
          if (status === 413) e = new ErroConector(413, { codigo: 'corpo_grande', mensagem: 'O corpo da requisição passa do limite desta rota.' });
          else if (!(erro instanceof ErroHttpModulo) && status && status >= 400 && status < 500)
            e = new ErroConector(400, { codigo: 'requisicao_invalida', mensagem: 'Requisição inválida (envie JSON válido com Content-Type application/json).' });
          else {
            const dica = erro instanceof ErroHttpModulo ? ' (rota de Conector usa ErroConector, não ErroHttpModulo — ADR 0013 §5)' : '';
            req.log.error({ err: erro, modulo: id }, `erro não tratado em rota de Conector${dica}`);
            return reply.code(500).send({ codigo: 'erro_interno', mensagem: 'Erro interno no Hub. O Conector tenta de novo; se continuar, avise o suporte.', requisicao_id: req.id });
          }
        }
        for (const [k, v] of Object.entries(e.cabecalhos)) reply.header(k, v);
        return reply.code(e.status).send({ ...e.corpo, requisicao_id: req.id });
      });

      inst.setNotFoundHandler((req, reply) =>
        reply.code(404).send({ codigo: 'nao_encontrado', mensagem: 'Rota do Hub não encontrada.', requisicao_id: req.id }),
      );

      for (const rota of api.rotas) montar(inst, rota);
    },
    { prefix: `/${id}/v1` },
  );

  function montar(inst: FastifyInstance, rota: RotaConector): void {
    const config: ConfigRotaConector = { macuxiConector: true, maxElementosCorpo: rota.maxElementosCorpo ?? MAX_ELEMENTOS_CONECTOR_PADRAO };
    inst.route({
      method: rota.metodo,
      url: caminhoConectorParaRoteador(rota.caminho),
      bodyLimit: rota.limiteCorpoBytes ?? LIMITE_CORPO_CONECTOR_PADRAO,
      config,
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        const cabecalhos = cabecalhosDe(req);
        const logBase = req.log.child({ modulo: id, request_id: req.id, rota: rota.id });

        // 3) chave do Conector (o módulo resolve; a plataforma só conta as falhas e nunca loga o motivo para o cliente)
        const aut = await api!.autenticar({ cabecalhos, ip: req.ip, rota: rota.id, agora: dep.relogio, log: logBase, semTenant: dep.acesso.semTenant });
        if (!aut.ok) {
          if (aut.status === 401 || aut.status === 403) falhas.registrarFalha(req.ip);
          logBase.warn({ status: aut.status, codigo: aut.codigo, motivo: aut.motivo ?? null }, 'chamada de Conector recusada');
          throw recusa(aut);
        }
        if (!UUID.test(aut.tenantId)) throw new Error('autenticar do Conector devolveu tenant que não é UUID');
        const tenantId = aut.tenantId.toLowerCase();
        const log = req.log.child({ tenant_id: tenantId, modulo: id, request_id: req.id, conector: aut.conector.identificador, rota: rota.id });

        // 4) licença do módulo no tenant da chave (RN-CORE-02/03: dependências ativas também), parâmetros e fuso
        const lic = await dep.licencasTenant(tenantId, dep.acesso);
        const efetivos = modulosEfetivos({ manifestos: dep.manifestos, ativosNoTenant: lic.ativosNoTenant, doPerfil: lic.ativosNoTenant, removidosDoUsuario: [] });
        if (!efetivos.includes(id)) {
          log.warn({ codigo: 'modulo_inativo' }, 'chamada de Conector com o módulo inativo no tenant');
          throw new ErroConector(403, { codigo: 'modulo_inativo', mensagem: `O módulo ${id} não está ativo para esta empresa. Fale com o administrador do Macuxi.` });
        }

        // 5) entrada declarada
        validar(rota.cabecalhos, cabecalhos, 'cabecalhos');
        const params = validar(rota.params, req.params, 'params');
        const query = validar(rota.query, req.query, 'query');
        const corpo = validar(rota.corpo, req.body, 'corpo');

        const { authorization: _omitida, ...semChave } = cabecalhos;
        const parametros = Object.freeze({ ...(lic.parametros[id] ?? {}) });
        const fuso = fusoDoTenantOuPadrao(lic.fuso);
        const ctx: ContextoConector = {
          tenantId,
          conector: aut.conector,
          rota: rota.id,
          cabecalhos: Object.freeze(semChave),
          corpo,
          query,
          params,
          bytesCorpo: bytes.get(req) ?? 0,
          ip: req.ip,
          requestId: req.id,
          agora: dep.relogio,
          fuso: () => fuso,
          parametros: () => parametros,
          log,
          comTenant: (fn) =>
            dep.acesso.comTenant(tenantId, (db) =>
              fn(db, transacaoTenant(db, { manifestos: dep.manifestos, modulo: id, tenantId, usuarioId: null, requestId: req.id, agora: dep.relogio, log })),
            ),
        };

        // 6) conferências do módulo (taxa, tamanho pelo parâmetro do tenant, versão → 426) e a rota
        if (api!.antes) await api!.antes(ctx, rota);
        const r = await rota.executar(ctx);
        const resposta = r instanceof RespostaConector ? r : new RespostaConector(r);
        for (const [k, v] of Object.entries(resposta.opcoes.cabecalhos ?? {})) reply.header(k, v);
        const status = resposta.opcoes.status ?? rota.status ?? 200;
        if (status === 204) return reply.code(204).send();
        return reply.code(status).send(resposta.corpo ?? {});
      },
    });
  }
}
