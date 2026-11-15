/**
 * Dados legais do rodapé (docs/design/telas/rodape-legal.md §3.4): razão social, CNPJ e site da Macuxi, dado da plataforma
 * (pessoa jurídica, sem tenant), só pelas funções `SECURITY DEFINER` do banco-dados:
 *   GET /v1/publico/dados-legais     sem login e sem tenant (a tela Entrar vem antes do login); não lê cabeçalho nenhum;
 *                                    `plataforma.dados_legais_publicos()` na conexão do `macuxi_app`; limite por IP; cache de
 *                                    60 s em memória; `Cache-Control` público SEM ETag. Banco fora (ou a função ainda não
 *                                    existe) = 503 `no-store`, e o cliente usa o próprio cache.
 *   GET|PUT /v1/plataforma/dados-legais  só o super-admin (admin do cliente = 403), na conexão do portal (`macuxi_portal`);
 *                                    `sa_dados_legais` / `sa_gravar_dados_legais` conferem a sessão; a gravação é idempotente
 *                                    e auditada no banco; a API audita a requisição (`marcarPortal`). O PUT limpa o cache da
 *                                    rota pública.
 * Sem flag: antes da migração a rota pública responde 503 e as do portal 503 `DADOS_LEGAIS_INDISPONIVEIS`.
 */
import {
  DadosLegaisSchema,
  GravarDadosLegaisSchema,
  ROTA_DADOS_LEGAIS_PUBLICOS,
  ROTA_PORTAL_DADOS_LEGAIS,
  type AcessoBanco,
  type AcessoPortalAutenticado,
  type DadosLegais,
  type GravarDadosLegais,
} from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ErroHttp } from './erros';
import { criarLimitador } from './limitador';
import { marcarPortal } from './plataforma';

/** Acesso às funções do banco (testes injetam a sua). Devolvem o jsonb cru `{ razao_social, cnpj, site }`; a rota confere pelo contrato. */
export interface FonteDadosLegais {
  publicos(banco: AcessoBanco): Promise<unknown>;
  ler(sid: string, banco: AcessoBanco): Promise<unknown>;
  gravar(sid: string, dados: GravarDadosLegais, banco: AcessoBanco): Promise<unknown>;
}

const primeira = async (banco: AcessoBanco, sql: string, params: unknown[] = []): Promise<unknown> =>
  banco.semTenant(async (db) => (await db.query<{ r: unknown }>(sql, params)).rows[0]?.r);

export const fonteDadosLegaisNoBanco: FonteDadosLegais = {
  publicos: (banco) => primeira(banco, 'select plataforma.dados_legais_publicos() as r'),
  ler: (sid, banco) => primeira(banco, 'select plataforma.sa_dados_legais($1) as r', [sid]),
  gravar: (sid, dados, banco) => primeira(banco, 'select plataforma.sa_gravar_dados_legais($1, $2::jsonb) as r', [sid, JSON.stringify(dados)]),
};

/** Cache em memória da rota pública (a tela Entrar de todo aparelho chama: não vira amplificador de consultas). */
export const CACHE_DADOS_LEGAIS_MS = 60_000;
/** Limite por IP da rota pública (por minuto). */
export const LIMITE_DADOS_LEGAIS_POR_MIN = 120;
export const CACHE_CONTROL_DADOS_LEGAIS = 'public, max-age=300, stale-while-revalidate=86400';

export interface DepsDadosLegais {
  /** Conexão do `macuxi_app` (rota pública); `null` = 503. */
  banco: AcessoBanco | null;
  /** Conexão do portal (`macuxi_portal`). */
  acessoPortal: AcessoBanco;
  fonte?: FonteDadosLegais;
  /** Quem entrou pelo portal; `null` = 401 (sem o banco do portal, lança 503 `PORTAL_INDISPONIVEL`). */
  autenticar(req: FastifyRequest): Promise<AcessoPortalAutenticado | null>;
  validar(schema: z.ZodTypeAny, valor: unknown, onde: string): unknown;
  relogio: () => Date;
}

const indisponivel = () => new ErroHttp(503, 'DADOS_LEGAIS_INDISPONIVEIS', 'Dados legais indisponíveis no momento. Tente de novo em instantes.');

/** Falha do banco na rota pública (vira 503); formato errado continua `Error` (500). */
class BancoDadosLegaisFora extends Error {
  constructor(readonly codigoBanco: string | null) {
    super('dados legais: banco indisponível');
  }
}

const codigoSql = (e: unknown): string | null => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : null;
};

function conferir(bruto: unknown, funcao: string): DadosLegais {
  const r = DadosLegaisSchema.safeParse(bruto);
  if (!r.success) throw new Error(`${funcao} devolveu formato diferente do combinado (rodape-legal.md §3.3; DadosLegaisSchema)`);
  return r.data;
}

/** SQLSTATE das `sa_*` → HTTP (sessão vencida = 401; não é super-admin = 403; dado recusado = 400; função ausente = 503). */
function traduzir(e: unknown): never {
  const c = codigoSql(e);
  if (c === '28000') throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Sua sessão do portal expirou. Entre de novo.');
  if (c === '42501') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi edita os dados legais.');
  if (c === '22023' || c === '23514') throw new ErroHttp(400, 'VALIDACAO', 'Dados legais inválidos.');
  if (c === '42883') throw indisponivel();
  throw e;
}

export function registrarRotasDadosLegais(app: FastifyInstance, dep: DepsDadosLegais): void {
  const fonte = dep.fonte ?? fonteDadosLegaisNoBanco;
  const agora = () => dep.relogio().getTime();
  const limitador = criarLimitador(LIMITE_DADOS_LEGAIS_POR_MIN, 60_000, agora);

  let cache: { em: number; valor: Promise<DadosLegais> } | null = null;
  const carregar = async (banco: AcessoBanco): Promise<DadosLegais> => {
    let bruto: unknown;
    try {
      bruto = await fonte.publicos(banco);
    } catch (e) {
      throw new BancoDadosLegaisFora(codigoSql(e));
    }
    return conferir(bruto, 'dados_legais_publicos');
  };
  const publicos = (banco: AcessoBanco): Promise<DadosLegais> => {
    const t = agora();
    if (cache && t - cache.em < CACHE_DADOS_LEGAIS_MS) return cache.valor;
    const entrada = { em: t, valor: carregar(banco) };
    cache = entrada;
    // falha não fica no cache (a próxima chamada tenta de novo)
    entrada.valor.catch(() => {
      if (cache === entrada) cache = null;
    });
    return entrada.valor;
  };

  app.get(ROTA_DADOS_LEGAIS_PUBLICOS, async (req, reply) => {
    if (!limitador.tentar(req.ip)) {
      reply.header('retry-after', String(limitador.esperaSegundos(req.ip)));
      throw new ErroHttp(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um pouco e tente de novo.');
    }
    try {
      if (!dep.banco) throw new BancoDadosLegaisFora(null);
      const dados = await publicos(dep.banco);
      return reply.header('cache-control', CACHE_CONTROL_DADOS_LEGAIS).send(dados);
    } catch (e) {
      if (!(e instanceof BancoDadosLegaisFora)) throw e;
      req.log.warn({ codigo: 'DADOS_LEGAIS_INDISPONIVEIS', sqlstate: e.codigoBanco, sem_banco: dep.banco === null }, 'dados legais: banco indisponível');
      reply.header('cache-control', 'no-store');
      throw indisponivel();
    }
  });

  const exigirSuperAdmin = async (req: FastifyRequest): Promise<AcessoPortalAutenticado & { tipo: 'super_admin' }> => {
    const quem = await dep.autenticar(req);
    if (!quem) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Entre no portal para continuar.');
    marcarPortal(req, { quem, tenantId: null });
    if (quem.tipo !== 'super_admin') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi edita os dados legais.');
    return quem;
  };

  app.get(ROTA_PORTAL_DADOS_LEGAIS, async (req, reply) => {
    const quem = await exigirSuperAdmin(req);
    let bruto: unknown;
    try {
      bruto = await fonte.ler(quem.sessao_id, dep.acessoPortal);
    } catch (e) {
      traduzir(e);
    }
    return reply.header('cache-control', 'private, no-store').send(conferir(bruto, 'sa_dados_legais'));
  });

  app.put(ROTA_PORTAL_DADOS_LEGAIS, async (req, reply) => {
    const quem = await exigirSuperAdmin(req);
    const dados = dep.validar(GravarDadosLegaisSchema, req.body, 'corpo') as GravarDadosLegais;
    let bruto: unknown;
    try {
      bruto = await fonte.gravar(quem.sessao_id, dados, dep.acessoPortal);
    } catch (e) {
      traduzir(e);
    } finally {
      // mesmo com erro (a gravação pode ter acontecido): a próxima leitura pública vai ao banco
      cache = null;
    }
    return reply.header('cache-control', 'private, no-store').send(conferir(bruto, 'sa_gravar_dados_legais'));
  });
}
