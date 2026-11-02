/**
 * Rotas de Conector (ADR 0013; desenho T-0032 §3): chamadas por uma MÁQUINA (o Conector instalado no servidor do cliente), não
 * por um usuário. O módulo declara em `ModuloApi.conector` e o `apps/api` monta tudo em `/<modulo>/v1/<caminho>` (hoje só
 * `/integracao/v1`), com este pipeline, nesta ordem:
 *   1. limite de falhas de autenticação por IP (429 `limite_de_taxa` + `Retry-After`);
 *   2. teto de corpo da rota (`limiteCorpoBytes`) e de elementos de array (`maxElementosCorpo`) → 413 `corpo_grande`;
 *   3. `autenticar` do módulo → 400/401/403/503 (o motivo exato só vai para o log; a falha conta no item 1);
 *   4. licença do módulo NO TENANT da chave (sem perfil: quem chama não é usuário) → 403 `modulo_inativo`; na mesma transação
 *      a plataforma lê os parâmetros do módulo e o fuso do tenant;
 *   5. Zod de cabeçalhos, params, query e corpo declarados → 400 `requisicao_invalida`;
 *   6. `antes` do módulo (taxa, tamanho pelo parâmetro do tenant, versão) e `executar`.
 * Recusa = `throw new ErroConector(status, { codigo, mensagem, detalhes?, ...extras })`. A plataforma acrescenta `requisicao_id`.
 * `ErroHttpModulo` NÃO vale aqui (vira 500 com log de erro): os códigos do Hub são os que o Conector já lê, em minúsculas.
 * Sem `acao`, `perfis` nem `carteira`: o escopo é a chave do Conector (RN-INT-10).
 */
import type { z } from 'zod';
import type { AcessoBanco, ClienteBanco, LogRota, TransacaoTenant } from './api';
import type { Manifesto } from './manifesto';

/** O que o `autenticar` do módulo recebe: cabeçalhos em minúsculas, IP, relógio, log e SÓ a leitura sem tenant. */
export interface EntradaAutenticacaoConector {
  cabecalhos: Readonly<Record<string, string | undefined>>;
  /** IP de quem chamou (com `trustProxy`, o do `X-Forwarded-For`). */
  ip: string;
  /** Id da rota pedida (ex.: `enviar_lote`). */
  rota: string;
  agora(): Date;
  /** Log com `modulo`, `request_id` e `rota` (ainda sem tenant). Nunca registre a chave nem os cabeçalhos. */
  log: LogRota;
  /** Transação SEM tenant: o RLS devolve 0 linhas; serve só para a função SECURITY DEFINER que resolve a chave. */
  semTenant: AcessoBanco['semTenant'];
}

/** Conector dono da chave: `id` (uuid) e `identificador` (o `X-Macuxi-Conector-Id`), mais o que o módulo quiser guardar. */
export interface ConectorDaChave {
  id: string;
  identificador: string;
  [extra: string]: unknown;
}

export interface ConectorAutenticado<K extends ConectorDaChave = ConectorDaChave> {
  ok: true;
  /** Tenant DA CHAVE (nunca do corpo, da query ou de cabeçalho). */
  tenantId: string;
  conector: K;
}

/** Status que o `autenticar` pode devolver: 400 cabeçalho malformado, 401 genérico, 403 negado, 503 falha fechada (sem pepper). */
export const STATUS_RECUSA_CONECTOR = [400, 401, 403, 503] as const;
export type StatusRecusaConector = (typeof STATUS_RECUSA_CONECTOR)[number];

export interface RecusaConector {
  ok: false;
  status: StatusRecusaConector;
  /** Código do Hub (`credencial_invalida`, `acesso_negado`, `requisicao_invalida`, `servico_indisponivel`). */
  codigo: string;
  /** Mensagem pública. No 401 é sempre genérica (não revela se a chave existe, foi revogada ou é de outro Conector). */
  mensagem: string;
  /** Motivo exato, SÓ para o log (ex.: `revogada`, `ip_nao_permitido`). */
  motivo?: string;
}

/** Contexto das rotas de Conector (ADR 0013 §4). */
export interface ContextoConector<K extends ConectorDaChave = ConectorDaChave, C = unknown, Q = unknown, P = unknown> {
  tenantId: string;
  conector: K;
  /** Id da rota (`RotaConector.id`). */
  rota: string;
  /** Cabeçalhos em minúsculas, SEM `authorization`. */
  cabecalhos: Readonly<Record<string, string | undefined>>;
  corpo: C;
  query: Q;
  params: P;
  /** Bytes do corpo recebido (0 sem corpo), para `verificarTamanhoCorpo` com o parâmetro do tenant. */
  bytesCorpo: number;
  ip: string;
  requestId: string;
  agora(): Date;
  /** Fuso IANA do tenant da chave (ausente/inválido = America/Manaus). */
  fuso(): string;
  /** Parâmetros do tenant para o módulo (`plataforma.parametro`), lidos com a licença. */
  parametros(): Readonly<Record<string, unknown>>;
  /** Log com `tenant_id`, `modulo`, `request_id`, `conector` (identificador) e `rota`. Nunca linhas, payload nem a chave. */
  log: LogRota;
  /**
   * Transação com o tenant DA CHAVE (papel macuxi_app, RLS). `tx.publicar` e `tx.auditar` gravam com `usuario_id = null`;
   * `tx.consultar` (ADR 0012) lança `ConsultaIndisponivel` (não há usuário); `tx.registrarArquivo` não vale aqui.
   */
  comTenant<T>(fn: (db: ClienteBanco, tx: TransacaoTenant) => Promise<T>): Promise<T>;
}

/** Status de sucesso de uma rota de Conector. */
export const STATUS_SUCESSO_CONECTOR = [200, 201, 202, 204] as const;
export type StatusSucessoConector = (typeof STATUS_SUCESSO_CONECTOR)[number];

/**
 * Resposta com status ou cabeçalhos diferentes dos declarados na rota, ex.: a repetição do lote (RN-INT-12):
 * `return new RespostaConector(lote, { status: 202, cabecalhos: { 'idempotent-replay': 'true' } })`.
 */
export class RespostaConector {
  constructor(
    readonly corpo: unknown,
    readonly opcoes: { status?: StatusSucessoConector; cabecalhos?: Readonly<Record<string, string>> } = {},
  ) {
    if (opcoes.status !== undefined && !(STATUS_SUCESSO_CONECTOR as readonly number[]).includes(opcoes.status))
      throw new Error(`RespostaConector: status ${String(opcoes.status)} não é de sucesso (${STATUS_SUCESSO_CONECTOR.join(', ')})`);
  }
}

export interface RotaConector<
  K extends ConectorDaChave = ConectorDaChave,
  C extends z.ZodTypeAny = z.ZodTypeAny,
  Q extends z.ZodTypeAny = z.ZodTypeAny,
  P extends z.ZodTypeAny = z.ZodTypeAny,
> {
  /** Id estável da rota (ex.: `enviar_lote`); vai para o log e para `antes`. */
  id: string;
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Relativo a `/<modulo>/v1`, COM barra inicial e parâmetros `{nome}` (formato do `ROTAS_HUB`/OpenAPI): `/lotes/{id}`. */
  caminho: string;
  /** Zod dos cabeçalhos (em minúsculas). Recusa = 400 `requisicao_invalida`. */
  cabecalhos?: z.ZodTypeAny;
  params?: P;
  query?: Q;
  /** Rota que precisa de erro próprio para o corpo (ex.: `envelope_invalido`) não declara e valida no módulo. */
  corpo?: C;
  /** Status de sucesso (padrão 200). */
  status?: StatusSucessoConector;
  /** Teto de bytes do corpo (padrão 1 MiB; máximo 32 MiB). Acima: 413 `corpo_grande` antes de ler o JSON. */
  limiteCorpoBytes?: number;
  /** Teto de elementos de array somados no corpo (padrão 50.000; máximo 2.000.000). Acima: 413 antes de qualquer Zod. */
  maxElementosCorpo?: number;
  executar(ctx: ContextoConector<K, z.output<C>, z.output<Q>, z.output<P>>): Promise<unknown>;
}

export interface ApiConector<K extends ConectorDaChave = ConectorDaChave> {
  /** Resolve a chave (ADR 0013 §1). Lançar = 500 (ou 503 se o banco estiver fora); recusar = devolver `RecusaConector`. */
  autenticar(e: EntradaAutenticacaoConector): Promise<ConectorAutenticado<K> | RecusaConector>;
  /** Conferências de toda rota já autenticada (taxa, tamanho pelo parâmetro do tenant, versão → 426). Recusa = `ErroConector`. */
  antes?(ctx: ContextoConector<K>, rota: RotaConector<K>): Promise<void>;
  rotas: readonly RotaConector<K>[];
}

/** Ajuda de tipo: `definirApiConector<MeuConector>({ autenticar, antes, rotas })` tipa `ctx.conector` nas rotas. */
export function definirApiConector<K extends ConectorDaChave>(api: ApiConector<K>): ApiConector {
  return api as unknown as ApiConector;
}

/** Status que uma rota de Conector pode devolver por erro próprio (ADR 0013 §5). */
export const STATUS_ERRO_CONECTOR = [400, 401, 403, 404, 409, 413, 422, 426, 429, 503] as const;
export type StatusErroConector = (typeof STATUS_ERRO_CONECTOR)[number];

/** Corpo do erro do Hub: `ErroApiSchema` (`codigo`, `mensagem`, `detalhes?`) mais campos extras (ex.: `erros[]` de `RecusaLote`). */
export interface CorpoErroConector {
  codigo: string;
  mensagem: string;
  detalhes?: Record<string, unknown>;
  [extra: string]: unknown;
}

/**
 * Erro de rota de Conector: a API responde `status` com o `corpo` e `requisicao_id`. 429 e 503 exigem `retry-after` (segundos
 * inteiros) em `cabecalhos`. `corpo` vai ao Conector: nunca coloque dado pessoal, valor de linha nem segredo.
 */
export class ErroConector extends Error {
  readonly cabecalhos: Readonly<Record<string, string>>;
  constructor(
    readonly status: StatusErroConector,
    readonly corpo: CorpoErroConector,
    cabecalhos: Readonly<Record<string, string>> = {},
  ) {
    super(typeof corpo?.mensagem === 'string' ? corpo.mensagem : 'erro do Conector');
    this.name = 'ErroConector';
    if (!(STATUS_ERRO_CONECTOR as readonly number[]).includes(status))
      throw new Error(`ErroConector: status ${String(status)} não é de rota de Conector (${STATUS_ERRO_CONECTOR.join(', ')})`);
    if (typeof corpo?.codigo !== 'string' || !corpo.codigo || typeof corpo.mensagem !== 'string' || !corpo.mensagem)
      throw new Error('ErroConector: o corpo precisa de "codigo" e "mensagem" preenchidos (ErroApiSchema)');
    if (corpo.detalhes !== undefined && (corpo.detalhes === null || typeof corpo.detalhes !== 'object' || Array.isArray(corpo.detalhes)))
      throw new Error('ErroConector: "detalhes" precisa ser um objeto');
    if ('requisicao_id' in corpo) throw new Error('ErroConector: "requisicao_id" é da plataforma');
    this.cabecalhos = Object.fromEntries(Object.entries(cabecalhos).map(([k, v]) => [k.toLowerCase(), v]));
    if ((status === 429 || status === 503) && !/^[1-9]\d*$/.test(this.cabecalhos['retry-after'] ?? ''))
      throw new Error(`ErroConector ${status}: informe "retry-after" em segundos inteiros (> 0)`);
  }
}

/** Formato do caminho de rota de Conector: `/seg/{param}` (minúsculas, números, `_` e `-`). */
const CAMINHO_CONECTOR_RE = /^(?:\/(?:[a-z0-9_-]+|\{[a-z][a-z0-9_]*\}))+$/;
export const LIMITE_CORPO_CONECTOR_PADRAO = 1024 * 1024;
export const LIMITE_CORPO_CONECTOR_MAX = 32 * 1024 * 1024;
export const MAX_ELEMENTOS_CONECTOR_PADRAO = 50_000;
export const MAX_ELEMENTOS_CONECTOR_MAX = 2_000_000;

/** `/lotes/{id}` → `/lotes/:id` (formato do roteador). */
export function caminhoConectorParaRoteador(caminho: string): string {
  return caminho.replace(/\{([a-z][a-z0-9_]*)\}/g, ':$1');
}

/** Problemas da declaração `conector` de um módulo (usado por `definirModuloApi`). Vazio = válida. */
export function problemasApiConector(manifesto: Pick<Manifesto, 'id' | 'apps'>, api: ApiConector | undefined): string[] {
  if (!api) return [];
  const id = manifesto.id;
  const problemas: string[] = [];
  if (!manifesto.apps.conector) problemas.push(`conector: só módulo com apps.conector no manifesto declara rotas de Conector (${id} não tem)`);
  if (typeof api.autenticar !== 'function') problemas.push('conector: informe "autenticar"');
  if (!Array.isArray(api.rotas) || api.rotas.length === 0) problemas.push('conector: declare ao menos uma rota');
  const ids = new Set<string>();
  const caminhos = new Set<string>();
  for (const r of api.rotas ?? []) {
    const rotulo = `${r.metodo} /${id}/v1${r.caminho}`;
    if (!/^[a-z][a-z0-9_]*$/.test(r.id ?? '')) problemas.push(`${rotulo}: id da rota inválido (minúsculas, números e _)`);
    if (ids.has(r.id)) problemas.push(`${rotulo}: id ${r.id} repetido`);
    ids.add(r.id);
    if (!CAMINHO_CONECTOR_RE.test(r.caminho ?? '')) problemas.push(`${rotulo}: caminho inválido (barra inicial, minúsculas, parâmetros {nome})`);
    const chave = `${r.metodo} ${(r.caminho ?? '').replace(/\{[^}]+\}/g, '{}')}`;
    if (caminhos.has(chave)) problemas.push(`${rotulo}: método e caminho repetidos`);
    caminhos.add(chave);
    if (r.status !== undefined && !(STATUS_SUCESSO_CONECTOR as readonly number[]).includes(r.status))
      problemas.push(`${rotulo}: status ${String(r.status)} não é de sucesso`);
    if (r.limiteCorpoBytes !== undefined && !(Number.isInteger(r.limiteCorpoBytes) && r.limiteCorpoBytes > 0 && r.limiteCorpoBytes <= LIMITE_CORPO_CONECTOR_MAX))
      problemas.push(`${rotulo}: limiteCorpoBytes entre 1 e ${LIMITE_CORPO_CONECTOR_MAX}`);
    if (r.maxElementosCorpo !== undefined && !(Number.isInteger(r.maxElementosCorpo) && r.maxElementosCorpo > 0 && r.maxElementosCorpo <= MAX_ELEMENTOS_CONECTOR_MAX))
      problemas.push(`${rotulo}: maxElementosCorpo entre 1 e ${MAX_ELEMENTOS_CONECTOR_MAX}`);
    if (typeof r.executar !== 'function') problemas.push(`${rotulo}: informe "executar"`);
  }
  return problemas;
}
