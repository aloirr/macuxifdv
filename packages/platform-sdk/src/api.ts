/**
 * Contrato das rotas de módulo na API (desenho T-0004 §3; ADR 0006).
 *
 * Cada módulo exporta de `modules/<m>/api/index.ts` um `definirModuloApi({ manifesto, rotas, sync })`.
 * As rotas são DECLARATIVAS e não conhecem o Fastify: o `apps/api` (createApp) monta cada rota em
 * `/v1/<modulo>/<caminho>` e aplica, nesta ordem, em TODA rota (CLAUDE.md regra 6):
 *   1. autenticação (401 NAO_AUTENTICADO);
 *   2. licença do módulo da rota, calculada por requisição (403 MODULO_INATIVO, RN-CORE-02);
 *   3. perfil — pela ação do manifesto (ADR 0004) ou pela lista `perfis` (403 PERFIL_SEM_ACESSO);
 *      RN-PRO-01: promotor nunca passa em rota de pedido, mesmo que a rota se declare errada;
 *   4. validação Zod de params, query e corpo (400 VALIDACAO);
 *   5. escopo de carteira quando a rota diz qual cliente toca (403 FORA_DA_CARTEIRA, RN-CORE-04);
 *   6. `executar`, com o banco só por `ctx.comTenant` (tenant do token, papel macuxi_app, RLS).
 * Erros do módulo (corpo sempre `{ codigo, mensagem, detalhes? }`, ErroApiSchema):
 *   - regra de negócio: `throw new ErroRegraNegocio('RN-VEN-03', 'mensagem')` → 422;
 *   - não encontrado/fora do escopo: `throw new ErroNaoEncontrado('PEDIDO_NAO_ENCONTRADO', '...')` → 404;
 *   - outro status de negócio (401 login, 423 bloqueado, 409 conflito, 503 indisponível…):
 *     `throw new ErroHttpModulo(423, 'USUARIO_BLOQUEADO', 'mensagem')`.
 */
import type { z } from 'zod';
import type { MetodoHttp } from './ambiente';
import type { DefinicaoEvento, EnvelopeEvento } from './eventos';
import type { Manifesto } from './manifesto';
import { ehAcaoDePedido, type ModuloId, type Perfil } from './nomes';
import type { CursorSync, DefinicaoEntidadeSync, ItemPush, LinhaSync, ResultadoItemPush } from './sync';


/** Usuário do token (o `tenant_id` vem SÓ do token; nunca do corpo ou da query). */
export interface UsuarioAutenticado {
  id: string;
  tenant_id: string;
  perfil: Perfil;
}

/** Usuário da requisição: o do token mais os módulos efetivos calculados AGORA (RN-CORE-01/03). */
export interface UsuarioDaRequisicao extends UsuarioAutenticado {
  modulos: readonly ModuloId[];
}

/**
 * Cliente de banco dentro da transação do tenant (subconjunto estrutural do `PoolClient` do `pg`).
 * O SDK não depende de `pg`; o adaptador fica em `apps/api`.
 */
export interface ClienteBanco {
  query<R = Record<string, unknown>>(sql: string, valores?: readonly unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface LogRota {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** Operações da plataforma dentro da transação do tenant. */
export interface TransacaoTenant {
  /**
   * Grava o evento na outbox (`plataforma.evento`) NA MESMA transação do fato (doc 04): se a transação
   * desfaz, o evento some junto. Só eventos em `publica` do manifesto do módulo da rota; payload validado pelo schema.
   */
  publicar<S extends z.ZodTypeAny>(def: DefinicaoEvento<S>, payload: z.input<S>, agregadoId?: string | null): Promise<EnvelopeEvento<z.output<S>>>;
}

/** O que toda rota (e todo provedor de sync) recebe. */
/** Módulo → módulos de que ele depende (`depende` do manifesto), de TODOS os módulos instalados (RN-CORE-03). */
export type DependenciasModulos = Readonly<Partial<Record<ModuloId, readonly ModuloId[]>>>;

export interface ContextoBase {
  usuario: UsuarioDaRequisicao;
  /**
   * Dependências entre os módulos instalados (RN-CORE-03), para quem precisa explicar o efeito de desligar um
   * módulo (ex.: tela de licenças do BKO: "desligar o Catálogo também desliga o Vendedor") sem importar o
   * manifesto de outro módulo (fronteiras). Só leitura; igual para todos os usuários do processo.
   */
  dependencias: DependenciasModulos;
  requestId: string;
  /** Relógio injetável (testes). Datas sempre em UTC. */
  agora(): Date;
  /**
   * Única via de tocar dado de tenant: abre transação com `app.tenant_id` = tenant do token
   * (papel macuxi_app, RLS). Sem banco configurado = erro 503 (falha fechada).
   */
  comTenant<T>(fn: (db: ClienteBanco, tx: TransacaoTenant) => Promise<T>): Promise<T>;
  /** Clientes visíveis ao usuário (RN-CORE-04): conjunto de ids ou `'tenant'` (tudo). */
  carteira(): Promise<ReadonlySet<string> | 'tenant'>;
  /** Logger da requisição (já leva tenant_id, modulo e request_id; nunca registre dado pessoal). */
  log: LogRota;
}

export interface ContextoRota<C = unknown, Q = unknown, P = unknown> extends ContextoBase {
  corpo: C;
  query: Q;
  params: P;
}

/** Entrada já validada, usada para extrair o cliente da rota (escopo de carteira). */
export interface EntradaRota {
  corpo: unknown;
  query: unknown;
  params: unknown;
}

/**
 * Escopo de carteira da rota (obrigatório — força quem escreve a rota a pensar no RN-CORE-04):
 * - função que devolve o `cliente_id` tocado (a API confere com a carteira antes de executar);
 * - `'filtrar_no_dominio'`: listas/consultas que filtram por `ctx.carteira()` no próprio módulo;
 * - `'nao_se_aplica'`: rota sem dado de cliente (ex.: catálogo de produtos, trilhas de treinamento).
 */
export type EscopoCarteiraRota = ((e: EntradaRota) => string | null | undefined) | 'filtrar_no_dominio' | 'nao_se_aplica';

export interface RotaModulo<C extends z.ZodTypeAny = z.ZodTypeAny, Q extends z.ZodTypeAny = z.ZodTypeAny, P extends z.ZodTypeAny = z.ZodTypeAny> {
  metodo: MetodoHttp;
  /** Relativo a `/v1/<modulo>`, sem barra inicial; parâmetros no formato `:id`. `''` = a raiz do módulo. */
  caminho: string;
  /** Ação do manifesto (ADR 0004), ex.: 'pedido.criar'. Obrigatória em rota de escrita. */
  acao?: string;
  /** Perfis aceitos quando a rota não tem `acao` (só leitura). Padrão: `manifesto.perfis`. */
  perfis?: readonly Perfil[];
  carteira: EscopoCarteiraRota;
  corpo?: C;
  query?: Q;
  params?: P;
  /** Status de sucesso (padrão 200; 201/204 em criação/remoção). */
  status?: number;
  executar(ctx: ContextoRota<z.output<C>, z.output<Q>, z.output<P>>): Promise<unknown>;
}

/** Página do pull pedida ao módulo: linhas com `(updated_at, id)` > `desde` e `updated_at` < `ate`. */
export interface PedidoPull {
  desde: CursorSync | null;
  /** Horizonte seguro (ISO UTC): nenhuma transação ainda aberta pode gravar `updated_at` abaixo dele. */
  ate: string;
  limite: number;
}

/** Quem serve uma entidade de sync na API (pull e/ou push). Definição igual à do app (mesmo schema). */
export interface ProvedorSync {
  entidade: DefinicaoEntidadeSync;
  /** Pull: linhas em ordem `(updated_at, id)`, incluindo removidas, no escopo da carteira. */
  puxar?(ctx: ContextoBase, pedido: PedidoPull): Promise<LinhaSync[]>;
  /** Push: itens já validados pelo schema; idempotente pelo `id` (UUID do aparelho). */
  receber?(ctx: ContextoBase, itens: readonly ItemPush[]): Promise<ResultadoItemPush[]>;
}

/** Acesso ao banco fora de uma requisição autenticada (login, autenticação do token). */
export interface AcessoBanco {
  /** Transação com o tenant informado (RLS). Use só depois de resolver o tenant por um meio confiável. */
  comTenant<T>(tenantId: string, fn: (db: ClienteBanco) => Promise<T>): Promise<T>;
  /** Transação SEM tenant: RLS devolve 0 linhas; serve só para funções SECURITY DEFINER (ex.: tenant_por_codigo). */
  semTenant<T>(fn: (db: ClienteBanco) => Promise<T>): Promise<T>;
}

export interface ContextoPublico<C = unknown, Q = unknown, P = unknown> {
  corpo: C;
  query: Q;
  params: P;
  requestId: string;
  ip: string;
  agora(): Date;
  banco: AcessoBanco;
  log: LogRota;
}

/**
 * Rota SEM token (login, refresh) — só o Core declara (RN da T-0002 §6 item 4):
 * limite de tentativas por IP + chave (ex.: código da empresa) obrigatório; 429 `MUITAS_TENTATIVAS`.
 * Nunca devolva dado do tenant (nome, fuso) antes de validar a senha.
 */
export interface RotaPublica<C extends z.ZodTypeAny = z.ZodTypeAny, Q extends z.ZodTypeAny = z.ZodTypeAny, P extends z.ZodTypeAny = z.ZodTypeAny> {
  metodo: MetodoHttp;
  /** Montada em `/v1/<caminho>` (ex.: `auth/login`). */
  caminho: string;
  limite: { max: number; janelaMs: number; chave?: (e: EntradaRota) => string | null | undefined };
  corpo?: C;
  query?: Q;
  params?: P;
  status?: number;
  executar(ctx: ContextoPublico<z.output<C>, z.output<Q>, z.output<P>>): Promise<unknown>;
}

/** Serviços de plataforma que só o Core fornece (T-0003 Fase 2). Sem eles a API falha fechada (401 / carteira vazia). */
export interface ServicosCore {
  /** Token → usuário (JWT do Core). `null` = não autenticado. Os cabeçalhos chegam em minúsculas. */
  autenticar?(cabecalhos: Readonly<Record<string, string | undefined>>, banco: AcessoBanco): Promise<UsuarioAutenticado | null>;
  /** Clientes visíveis (RN-CORE-04) para o usuário: carteira, equipe, equipes abaixo ou `'tenant'`. */
  carteira?(usuario: UsuarioAutenticado, banco: AcessoBanco): Promise<ReadonlySet<string> | 'tenant'>;
}

export interface ModuloApi {
  manifesto: Manifesto;
  rotas?: readonly RotaModulo[];
  sync?: readonly ProvedorSync[];
  /** Só core: rotas sem token, montadas em `/v1/<caminho>`. */
  rotasPublicas?: readonly RotaPublica[];
  /** Só core: autenticação e escopo de carteira. */
  servicos?: ServicosCore;
}

/**
 * Status que um módulo pode devolver por erro próprio. Ficam de fora os da plataforma: 400 (Zod, o createApp
 * valida), 429 (limite das rotas públicas) e 5xx além de 503 (erro inesperado vira 500 sem detalhes).
 */
export const STATUS_ERRO_MODULO = [401, 403, 404, 409, 410, 422, 423, 503] as const;
export type StatusErroModulo = (typeof STATUS_ERRO_MODULO)[number];

/**
 * Erro HTTP de módulo (rota autenticada ou pública): a API responde `status` com `{ codigo, mensagem, detalhes? }`.
 * Ex.: login — `throw new ErroHttpModulo(401, 'CREDENCIAIS_INVALIDAS', '...')`; `(423, 'USUARIO_BLOQUEADO', ...)`;
 * `(503, 'AUTENTICACAO_INDISPONIVEL', ...)`. `detalhes` vai ao cliente: nunca coloque dado pessoal nem segredo.
 */
export class ErroHttpModulo extends Error {
  constructor(
    readonly status: StatusErroModulo,
    readonly codigo: string,
    mensagem: string,
    readonly detalhes?: Record<string, unknown>,
  ) {
    super(mensagem);
    this.name = 'ErroHttpModulo';
    if (!(STATUS_ERRO_MODULO as readonly number[]).includes(status)) throw new Error(`ErroHttpModulo: status ${String(status)} não é de módulo (${STATUS_ERRO_MODULO.join(', ')})`);
  }
}

/** Erro de regra de negócio: a API responde 422 `{ codigo, mensagem, detalhes? }` (codigo = id da RN). */
export class ErroRegraNegocio extends ErroHttpModulo {
  declare readonly status: 422;
  constructor(codigo: string, mensagem: string, detalhes?: Record<string, unknown>) {
    super(422, codigo, mensagem, detalhes);
    this.name = 'ErroRegraNegocio';
  }
}

/**
 * Recurso inexistente OU fora do escopo do usuário: a API responde 404 `{ codigo, mensagem }` e não revela se existe
 * (RN-CORE-04). Ex.: `throw new ErroNaoEncontrado('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado na sua carteira.')`.
 */
export class ErroNaoEncontrado extends ErroHttpModulo {
  declare readonly status: 404;
  constructor(codigo: string, mensagem: string) {
    super(404, codigo, mensagem);
    this.name = 'ErroNaoEncontrado';
  }
}

/** Corpo `ErroApiSchema` do erro do módulo (o mesmo que a API envia). */
export function corpoDoErroModulo(e: ErroHttpModulo): { codigo: string; mensagem: string; detalhes?: Record<string, unknown> } {
  return { codigo: e.codigo, mensagem: e.message, ...(e.detalhes ? { detalhes: e.detalhes } : {}) };
}

/** Módulo → `depende` do manifesto, para `ctx.dependencias` (RN-CORE-03). */
export function dependenciasDosManifestos(manifestos: readonly Pick<Manifesto, 'id' | 'depende'>[]): DependenciasModulos {
  const d: Partial<Record<ModuloId, readonly ModuloId[]>> = {};
  for (const m of manifestos) d[m.id] = Object.freeze([...m.depende]);
  return Object.freeze(d);
}

const CAMINHO_RE = /^(?:[a-z0-9_-]+|:[a-z][a-zA-Z0-9_]*)(?:\/(?:[a-z0-9_-]+|:[a-z][a-zA-Z0-9_]*))*$/;

/** Rota que toca pedido (`pedido`, `pedidos`, `pedido_item`, `pedidos-sugeridos`… em algum segmento do caminho). */
export function ehCaminhoDePedido(caminho: string): boolean {
  return caminho.split('/').some((s) => /^pedidos?([_-][a-z0-9_-]+)?$/.test(s));
}

/**
 * Valida e devolve a definição da API do módulo. Falha cedo (no import) se:
 * caminho fora do padrão ou repetido; rota de escrita sem `acao`; ação não declarada no manifesto do
 * próprio módulo; `perfis` fora dos perfis do módulo; rota de pedido aceitando promotor (RN-PRO-01);
 * entidade de sync fora do `sync` do manifesto ou de outro módulo.
 */
export function definirModuloApi(m: ModuloApi): ModuloApi {
  const id = m.manifesto.id;
  const problemas: string[] = [];
  const vistas = new Set<string>();
  for (const r of m.rotas ?? []) {
    const rotulo = `${r.metodo} /v1/${id}${r.caminho ? `/${r.caminho}` : ''}`;
    if (r.caminho !== '' && !CAMINHO_RE.test(r.caminho)) problemas.push(`${rotulo}: caminho inválido (sem barra inicial, minúsculas, parâmetros :nome)`);
    const chave = `${r.metodo} ${r.caminho.replace(/:[^/]+/g, ':')}`;
    if (vistas.has(chave)) problemas.push(`${rotulo}: rota repetida`);
    vistas.add(chave);
    if (r.metodo !== 'GET' && !r.acao) problemas.push(`${rotulo}: rota de escrita precisa de "acao" do manifesto (ADR 0004)`);
    if (r.acao && !Object.hasOwn(m.manifesto.acoes, r.acao)) problemas.push(`${rotulo}: ação ${r.acao} não está em "acoes" do manifesto de ${id}`);
    if (r.acao && r.perfis) problemas.push(`${rotulo}: use "acao" ou "perfis", não os dois`);
    for (const p of r.perfis ?? []) if (!m.manifesto.perfis.includes(p)) problemas.push(`${rotulo}: perfil ${p} fora dos perfis do módulo`);
    if ((ehCaminhoDePedido(r.caminho) || (r.acao && ehAcaoDePedido(r.acao))) && r.perfis?.includes('promotor')) {
      problemas.push(`${rotulo}: RN-PRO-01 — promotor nunca acessa rota de pedido`);
    }
    if (r.carteira === undefined) problemas.push(`${rotulo}: declare o escopo de carteira (RN-CORE-04)`);
  }
  const entidades = new Set<string>();
  for (const p of m.sync ?? []) {
    const e = p.entidade;
    if (e.modulo !== id) problemas.push(`sync ${e.nome}: entidade de ${e.modulo} servida por ${id}`);
    if (!m.manifesto.sync.includes(e.nome)) problemas.push(`sync ${e.nome}: não está em "sync" do manifesto de ${id}`);
    if (entidades.has(e.nome)) problemas.push(`sync ${e.nome}: provedor repetido`);
    entidades.add(e.nome);
    if (!p.puxar && !p.receber) problemas.push(`sync ${e.nome}: informe puxar e/ou receber`);
    if (p.receber && e.direcao === 'pull') problemas.push(`sync ${e.nome}: direção pull não recebe push`);
    if (p.puxar && e.direcao === 'push') problemas.push(`sync ${e.nome}: direção push não serve pull`);
  }
  if (id !== 'core' && (m.rotasPublicas?.length || m.servicos)) problemas.push('só o core declara rotas públicas e serviços de plataforma');
  for (const r of m.rotasPublicas ?? []) {
    if (!CAMINHO_RE.test(r.caminho)) problemas.push(`${r.metodo} /v1/${r.caminho}: caminho inválido`);
    if (/^(sync|saude|me)(\/|$)/.test(r.caminho)) problemas.push(`${r.metodo} /v1/${r.caminho}: prefixo reservado à plataforma`);
    if (!(r.limite?.max > 0) || !(r.limite?.janelaMs > 0)) problemas.push(`${r.metodo} /v1/${r.caminho}: rota pública exige limite de tentativas`);
  }
  if (problemas.length > 0) throw new Error(`API do módulo ${id} inválida: ${problemas.join('; ')}`);
  return m;
}
