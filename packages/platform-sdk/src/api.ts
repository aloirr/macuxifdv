/**
 * Contrato das rotas de módulo na API (desenho T-0004 §3; ADR 0006).
 *
 * Cada módulo exporta de `modules/<m>/api/index.ts` um `definirModuloApi({ manifesto, rotas, sync })`.
 * As rotas são DECLARATIVAS e não conhecem o Fastify: o `apps/api` (createApp) monta cada rota em
 * `/v1/<modulo>/<caminho>` e aplica, nesta ordem, em TODA rota (CLAUDE.md regra 6):
 *   1. autenticação (401 NAO_AUTENTICADO);
 *   2. licença do módulo da rota, calculada por requisição (403 MODULO_INATIVO, RN-CORE-02);
 *   3. perfil — pela ação do manifesto (ADR 0004) ou pela lista `perfis` (403 PERFIL_SEM_ACESSO);
 *      RN-PRO-01: promotor nunca passa em rota de pedido de escrita, mesmo que a rota se declare errada; na
 *      leitura (GET com ação `pedido.ver`), quem decide é o `perfis` da ação no manifesto (O-3, `promotorBarradoNaRota`);
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
import type { ErroApi } from './acesso';
import type { MetodoHttp } from './ambiente';
import type { NovoArquivo } from './arquivos';
import { problemasApiConector, type ApiConector } from './conector';
import type { DefinicaoConsulta } from './consultas-tipos';
import type { DefinicaoEvento, EnvelopeEvento } from './eventos';
import type { Manifesto } from './manifesto';
import {
  ehAcaoDeEscritaDePedido,
  ehAcaoDeLeituraDePedido,
  ehAcaoDePedido,
  type ModuloId,
  type Perfil,
} from './nomes';
import {
  ESCOPOS_SYNC,
  type CursorSync,
  type DefinicaoEntidadeSync,
  type EscopoSync,
  type ItemPush,
  type LinhaSync,
  type ResultadoItemPush,
} from './sync';

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
  query<R = Record<string, unknown>>(
    sql: string,
    valores?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
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
  publicar<S extends z.ZodTypeAny>(
    def: DefinicaoEvento<S>,
    payload: z.input<S>,
    agregadoId?: string | null,
  ): Promise<EnvelopeEvento<z.output<S>>>;
  /**
   * ADR 0010: o comando que referencia uma foto (ex.: checkout com `foto_fachada_id`) cria, NA MESMA transação, a linha
   * `aguardando` em `plataforma.arquivo` (módulo = o da rota, `enviado_por` = usuário da sessão). O upload
   * (`PUT /v1/arquivos/:id`) só completa essa linha. Idempotente pelo `id`: repetir com a mesma entidade devolve
   * `{ criado: false }`; o mesmo `id` em outra entidade, outro módulo ou outro usuário → `ErroHttpModulo` 409
   * `ARQUIVO_JA_REFERENCIADO`. Dados inválidos (`validarNovoArquivo`) = erro de programação (exceção).
   */
  registrarArquivo(arquivo: NovoArquivo): Promise<{ criado: boolean }>;
  /**
   * ADR 0012: consulta a outro módulo NA MESMA transação (mesmo tenant, RLS, papel macuxi_app). Só consultas em
   * `usaConsultas` ou `usaConsultasOpcionais` (ADR 0019) do manifesto do módulo da rota (fora disso = erro de programação). Entrada e saída validadas pelo
   * contrato. Dono inativo para o usuário ou não instalado → `ConsultaIndisponivel` (503 se não tratada).
   */
  consultar<E extends z.ZodTypeAny, S extends z.ZodTypeAny>(def: DefinicaoConsulta<E, S>, entrada: z.input<E>): Promise<z.output<S>>;
  /**
   * RN-AUD-01: grava em `plataforma.auditoria` NA MESMA transação do fato, com o módulo da rota, o usuário e o
   * `request_id`. `antes`/`depois` só com ids, códigos, status e valores — nunca nome, documento, e-mail ou telefone.
   */
  auditar(registro: RegistroAuditoria): Promise<void>;
}

/** Linha de auditoria (RN-AUD-01). `entidade_id` = UUID da entidade (ou `null`). */
export interface RegistroAuditoria {
  /** O que foi feito, ex.: `pedido.aprovar`. */
  acao: string;
  /** Entidade tocada, ex.: `pedido`. */
  entidade: string;
  entidade_id: string | null;
  antes?: unknown;
  depois?: unknown;
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
   * `tx` vem SEMPRE, também no provedor de sync (`puxar`/`receber`, inclusive nas novidades): `tx.consultar` roda no
   * tenant e no usuário da requisição de sync, com o módulo da entidade como consumidor (R-20261103-020048; teste em
   * apps/api/test/consultas.test.ts). Contexto falso de teste do módulo precisa entregar `tx` também.
   */
  comTenant<T>(fn: (db: ClienteBanco, tx: TransacaoTenant) => Promise<T>): Promise<T>;
  /** Clientes visíveis ao usuário (RN-CORE-04): conjunto de ids ou `'tenant'` (tudo). */
  carteira(): Promise<ReadonlySet<string> | 'tenant'>;
  /**
   * Usuários cujos dados (visitas, rotas, metas, pedidos) o usuário vê (RN-CORE-04; ADR 0009 §6): ele mesmo;
   * supervisor + a equipe; gerente + as equipes abaixo; analista/assistente/admin `'tenant'`. Sempre contém o próprio
   * id quando é conjunto. Calculado uma vez por requisição.
   */
  usuariosVisiveis(): Promise<ReadonlySet<string> | 'tenant'>;
  /**
   * Parâmetros do tenant para o módulo da rota/provedor (`plataforma.parametro`, lidos a cada requisição junto com as
   * licenças; doc 03 "Parâmetros do tenant"). Ex.: alçadas do Vendedor. Rota da plataforma = `{}`.
   */
  parametros(): Readonly<Record<string, unknown>>;
  /**
   * Fuso IANA do tenant (`plataforma.tenant.fuso`, lido pela API junto com as licenças, por requisição; RN-CORE-11).
   * Use para a virada do dia e para datas civis (ex.: `localIsoDate(ctx.agora(), ctx.fuso())` de `@macuxi/comum/fuso`).
   * Nunca lança: fuso ausente ou inválido = `America/Manaus` (`FUSO_PADRAO_TENANT`). O módulo não lê `plataforma.*`.
   */
  fuso(): string;
  /** Logger da requisição (já leva tenant_id, modulo e request_id; nunca registre dado pessoal). */
  log: LogRota;
}

/**
 * O que a implementação de uma consulta (ADR 0012) recebe na API: o MESMO `ClienteBanco` de quem consulta (mesma
 * transação, tenant e RLS), o usuário e o relógio da requisição, os parâmetros do tenant para o módulo DONO e um log
 * com `modulo` (dono), `consulta` e `request_id`. Faça SQL só no schema do próprio módulo; sem escrita e sem evento.
 */
export interface ContextoConsulta {
  db: ClienteBanco;
  usuario: UsuarioDaRequisicao;
  requestId: string;
  agora(): Date;
  parametros(): Readonly<Record<string, unknown>>;
  /**
   * Fuso IANA do tenant de quem consulta (RN-CORE-11; T-0080/R-20261105-015806): o MESMO valor de `ctx.fuso()` da rota,
   * do consumidor de evento ou da rota do Conector que chamou `tx.consultar`. Use para virar dia/semana/mês na consulta
   * (ex.: frequência de pesquisa). Nunca lança: fuso ausente ou inválido = `America/Manaus` (`FUSO_PADRAO_TENANT`).
   */
  fuso(): string;
  log: LogRota;
}

export interface ImplementacaoConsulta<E extends z.ZodTypeAny = z.ZodTypeAny, S extends z.ZodTypeAny = z.ZodTypeAny> {
  consulta: DefinicaoConsulta<E, S>;
  executar(entrada: z.output<E>, ctx: ContextoConsulta): Promise<z.input<S>>;
}

/** Implementação na API (`ModuloApi.consultas` do dono): `implementarConsulta(def, async (entrada, ctx) => saida)`. */
export function implementarConsulta<E extends z.ZodTypeAny, S extends z.ZodTypeAny>(
  consulta: DefinicaoConsulta<E, S>,
  executar: (entrada: z.output<E>, ctx: ContextoConsulta) => Promise<z.input<S>>,
): ImplementacaoConsulta {
  return { consulta, executar } as unknown as ImplementacaoConsulta;
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
export type EscopoCarteiraRota =
  ((e: EntradaRota) => string | null | undefined) | 'filtrar_no_dominio' | 'nao_se_aplica';

export interface RotaModulo<
  C extends z.ZodTypeAny = z.ZodTypeAny,
  Q extends z.ZodTypeAny = z.ZodTypeAny,
  P extends z.ZodTypeAny = z.ZodTypeAny,
> {
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
  /**
   * Teto de bytes do corpo desta rota (só em rota com corpo, ou seja, não GET). Padrão `LIMITE_CORPO_ROTA_PADRAO` (1 MiB);
   * máximo `LIMITE_CORPO_ROTA_MAX` (32 MiB). Use em rota que recebe arquivo no JSON (ex.: CSV da carga por arquivo,
   * RF-INT-03). Acima do teto a API responde 413 `CORPO_GRANDE_DEMAIS` "Arquivo grande demais: o limite é X MB."
   * (`detalhes.limite_bytes`) antes de ler o JSON e antes do `executar`. Corpo acima do padrão só é lido com o cabeçalho
   * `Authorization` presente (sem ele: 401 sem ler o corpo).
   */
  limiteCorpoBytes?: number;
  executar(ctx: ContextoRota<z.output<C>, z.output<Q>, z.output<P>>): Promise<unknown>;
}

/** Teto de bytes do corpo das rotas sem `limiteCorpoBytes` (o padrão do Fastify: 1 MiB). */
export const LIMITE_CORPO_ROTA_PADRAO = 1024 * 1024;
/** Teto global de `limiteCorpoBytes` numa rota de módulo (32 MiB, o mesmo do lote do Conector, ADR 0013). */
export const LIMITE_CORPO_ROTA_MAX = 32 * 1024 * 1024;
/** Código do 413 de corpo acima do limite (bytes ou elementos de array). */
export const CODIGO_CORPO_GRANDE = 'CORPO_GRANDE_DEMAIS';

/** Bytes em MB para mensagem (base 1024, pt-BR): 1048576 → "1", 1572864 → "1,5", 500 KiB → "0,49". */
export function megabytesParaMensagem(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const casas = Number.isInteger(mb) ? 0 : mb >= 1 ? 1 : 2;
  // sem Intl (o SDK também roda no Hermes): arredonda, tira zeros à direita e usa vírgula decimal
  return String(Number(mb.toFixed(casas))).replace('.', ',');
}

/**
 * Corpo do 413 de corpo acima do limite em bytes (padrão de erro da API: `{ codigo, mensagem, detalhes }`).
 * `arquivo: true` (rota com `limiteCorpoBytes`, que recebe arquivo) → "Arquivo grande demais: o limite é X MB.";
 * senão → "Envio grande demais: o limite é X MB. Divida em partes menores.".
 */
export function erroCorpoGrande(limiteBytes: number, arquivo: boolean): ErroApi {
  const mb = megabytesParaMensagem(limiteBytes);
  return {
    codigo: CODIGO_CORPO_GRANDE,
    mensagem: arquivo ? `Arquivo grande demais: o limite é ${mb} MB.` : `Envio grande demais: o limite é ${mb} MB. Divida em partes menores.`,
    detalhes: { limite_bytes: limiteBytes },
  };
}

/** Problemas do `limiteCorpoBytes` de uma rota de módulo (vazio = ok). Usado por `definirModuloApi` e pela montagem da API. */
export function problemasLimiteCorpo(rotulo: string, r: Pick<RotaModulo, 'metodo' | 'limiteCorpoBytes'>): string[] {
  if (r.limiteCorpoBytes === undefined) return [];
  const p: string[] = [];
  if (!(Number.isInteger(r.limiteCorpoBytes) && r.limiteCorpoBytes > 0 && r.limiteCorpoBytes <= LIMITE_CORPO_ROTA_MAX))
    p.push(`${rotulo}: limiteCorpoBytes entre 1 e ${LIMITE_CORPO_ROTA_MAX}`);
  if (r.metodo === 'GET') p.push(`${rotulo}: limiteCorpoBytes só vale em rota com corpo (não GET)`);
  return p;
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
  /**
   * Conjunto que filtra o pull (ADR 0009 §4): a API devolve `versao_escopo` (hash desse conjunto) em toda página e o
   * aparelho ressincroniza a entidade quando ela muda (cliente que entra na carteira traz o histórico; o que sai some).
   * Declare em todo provedor com `puxar`; a validação passa a exigir quando os provedores atuais declararem (T-0017).
   * Lista = o filtro depende de mais de um conjunto (ex.: `pedido`: `['usuarios', 'carteira']` — o vendedor vê os
   * próprios, o promotor lê os da carteira, O-3); a versão combina os conjuntos.
   */
  escopo?: EscopoSync | readonly EscopoSync[];
  /** Pull: linhas em ordem `(updated_at, id)`, incluindo removidas, filtradas pelo `escopo` (RN-CORE-04). */
  puxar?(ctx: ContextoBase, pedido: PedidoPull): Promise<LinhaSync[]>;
  /** Push: itens já validados pelo schema; idempotente pelo `id` (UUID do aparelho). */
  receber?(ctx: ContextoBase, itens: readonly ItemPush[]): Promise<ResultadoItemPush[]>;
}

/**
 * Contexto do consumidor de evento (ADR 0007; T-0022). O despachante da outbox abre `comTenant` com o tenant do
 * ENVELOPE (papel macuxi_app, RLS) e, na MESMA transação, grava `plataforma.evento_consumo` (consumidor, evento_id):
 * efeito e registro confirmam juntos; se o handler lançar, os dois desfazem e o evento volta com espera crescente.
 * Efeito fora do banco (HTTP, push) é "no mínimo uma vez": marque no banco o que já foi feito (ex.: `push_enviado_em`).
 */
export interface ContextoConsumo {
  /** Envelope do evento (tenant, autor, `request_id` do rastreio); o payload validado vem no 1º argumento. */
  envelope: EnvelopeEvento;
  /** Transação do tenant do evento (macuxi_app, RLS). Nunca há acesso a outro tenant. */
  db: ClienteBanco;
  /** Publica evento do módulo consumidor (`publica` do manifesto) na mesma transação, com o `request_id` do original. */
  publicar: TransacaoTenant['publicar'];
  /**
   * ADR 0012 (T-0060, RN-INT-14): consulta a outro módulo NA MESMA transação do consumo (tenant do envelope, RLS,
   * macuxi_app). Mesma semântica de `tx.consultar`: só consultas em `usaConsultas`/`usaConsultasOpcionais` do manifesto do módulo CONSUMIDOR
   * (fora disso = erro de programação); entrada e saída validadas pelo contrato; dono não instalado ou inativo no
   * tenant → `ConsultaIndisponivel` (se não tratada, o consumo falha e o evento volta com espera crescente).
   * Não há pessoa: a implementação recebe o usuário de sistema (`USUARIO_SISTEMA_ID`, perfil `admin`, módulos efetivos
   * do tenant), os parâmetros do tenant para o módulo DONO e o `request_id` do evento original.
   */
  consultar: TransacaoTenant['consultar'];
  /** Parâmetros do tenant para o módulo consumidor (`plataforma.parametro`, lidos com as licenças do tenant). */
  parametros(): Readonly<Record<string, unknown>>;
  /** Fuso IANA do tenant (RN-CORE-11); ausente ou inválido = `America/Manaus`. Nunca lança. */
  fuso(): string;
  agora(): Date;
  /** Logger com tenant_id, modulo, evento e evento_id (nunca registre dado pessoal nem o payload). */
  log: LogRota;
}

/**
 * Id do usuário de sistema que a implementação de uma consulta (`ContextoConsulta.usuario.id`) recebe quando quem
 * consulta é um consumidor de evento (não há pessoa). Nunca existe em `core.usuario`; não grave como autor.
 */
export const USUARIO_SISTEMA_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Assinatura de evento na API (`ModuloApi.consumidores`; ADR 0007). Só eventos em `consome` do manifesto; um consumidor
 * por evento e módulo. Só recebe quem tem o módulo ativo no tenant (licença, RN-CORE-02/03). A ordem entre eventos não
 * é garantida (a retentativa de um não segura os outros): use `envelope.ocorrido_em` quando "o mais novo vence".
 */
export interface ConsumidorEvento<S extends z.ZodTypeAny = z.ZodTypeAny> {
  evento: DefinicaoEvento<S>;
  executar(payload: z.output<S>, ctx: ContextoConsumo): Promise<void>;
}

/** Ajuda de tipo: o payload do `executar` sai do schema do evento. */
export function definirConsumidor<S extends z.ZodTypeAny>(c: ConsumidorEvento<S>): ConsumidorEvento {
  return c as unknown as ConsumidorEvento;
}

/**
 * Tarefas periódicas do módulo (ADR 0022): rodam no worker (`apps/api/src/agendador.ts`), POR TENANT ativo com o módulo
 * efetivo (licença, RN-CORE-02/03), cada uma na sua transação `comTenant` (macuxi_app, RLS). O agendador acorda a cada
 * `INTERVALO_MINIMO_TAREFA_MIN` e nenhum período é menor que isso (RN-CORE-23: nenhum timer abaixo de 15 min).
 * Dois processos não rodam a mesma tarefa no mesmo tenant ao mesmo tempo (trava consultiva), mas a tarefa TEM de ser
 * idempotente: reinício do worker roda de novo, e uma falha só volta no período seguinte.
 */
export const INTERVALO_MINIMO_TAREFA_MIN = 15;

export interface ContextoTarefa {
  /** Tenant da execução (já é o da transação; nunca há acesso a outro). */
  tenantId: string;
  /** Transação do tenant (macuxi_app, RLS). Tudo o que a tarefa faz num tenant é atômico. */
  db: ClienteBanco;
  /** Publica evento do módulo (`publica` do manifesto) na mesma transação; sem autor (sistema). */
  publicar: TransacaoTenant['publicar'];
  /** Mesma semântica de `ContextoConsumo.consultar` (usuário de sistema, ADR 0012). */
  consultar: TransacaoTenant['consultar'];
  /** Parâmetros do tenant para o módulo da tarefa. */
  parametros(): Readonly<Record<string, unknown>>;
  /** Fuso IANA do tenant (RN-CORE-11); ausente ou inválido = `America/Manaus`. */
  fuso(): string;
  agora(): Date;
  /** Logger com tenant_id, modulo, tarefa e request_id (nunca registre dado pessoal). */
  log: LogRota;
}

/**
 * Contagens devolvidas pela tarefa (ex.: `{ alertadas: 2 }`): só os campos numéricos vão ao log do worker, e só quando
 * algum é > 0. `object` (e não `Record`) para aceitar a interface de resultado do módulo sem cópia. Nada de dado pessoal.
 */
export type ResultadoTarefa = void | object;

export interface TarefaPeriodica {
  /** Nome único no módulo (`[a-z][a-z0-9_]*`), ex.: `alerta_pendencia_checkout`. */
  nome: string;
  /** Período em minutos: múltiplo de `INTERVALO_MINIMO_TAREFA_MIN` (15, 30, 60, 1440…). */
  cadaMin: number;
  executar(ctx: ContextoTarefa): Promise<ResultadoTarefa>;
}

const NOME_TAREFA_RE = /^[a-z][a-z0-9_]*$/;

/** Problemas de uma tarefa periódica (vazio = válida). Usado por `definirTarefa` e `definirModuloApi`. */
export function problemasTarefa(t: Pick<TarefaPeriodica, 'nome' | 'cadaMin'>): string[] {
  const p: string[] = [];
  if (!NOME_TAREFA_RE.test(t.nome)) p.push(`tarefa ${t.nome}: nome inválido (minúsculas, dígitos e _)`);
  if (!Number.isInteger(t.cadaMin) || t.cadaMin < INTERVALO_MINIMO_TAREFA_MIN || t.cadaMin % INTERVALO_MINIMO_TAREFA_MIN !== 0)
    p.push(`tarefa ${t.nome}: cadaMin ${t.cadaMin} precisa ser múltiplo de ${INTERVALO_MINIMO_TAREFA_MIN} min (RN-CORE-23)`);
  return p;
}

/** Declara uma tarefa periódica (falha na subida se o nome ou o período forem inválidos). */
export function definirTarefa(t: TarefaPeriodica): TarefaPeriodica {
  const p = problemasTarefa(t);
  if (p.length > 0) throw new Error(p.join('; '));
  return t;
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
export interface RotaPublica<
  C extends z.ZodTypeAny = z.ZodTypeAny,
  Q extends z.ZodTypeAny = z.ZodTypeAny,
  P extends z.ZodTypeAny = z.ZodTypeAny,
> {
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
/** Relógio e fuso da requisição entregues ao serviço de carteira do Core (T-0042). */
export interface OpcoesServicoCarteira {
  agora: () => Date;
  /** Fuso IANA do tenant (já validado; padrão America/Manaus). */
  fuso: string;
}

export interface ServicosCore {
  /** Token → usuário (JWT do Core). `null` = não autenticado. Os cabeçalhos chegam em minúsculas. */
  autenticar?(
    cabecalhos: Readonly<Record<string, string | undefined>>,
    banco: AcessoBanco,
  ): Promise<UsuarioAutenticado | null>;
  /**
   * Clientes visíveis (RN-CORE-04) para o usuário: carteira, equipe, equipes abaixo ou `'tenant'`. A vigência do vínculo é
   * o "hoje" no fuso do tenant (T-0042): a API passa o relógio e o fuso da requisição (`opcoes`), o mesmo de `ctx.agora`/`ctx.fuso`.
   */
  carteira?(usuario: UsuarioAutenticado, banco: AcessoBanco, opcoes?: OpcoesServicoCarteira): Promise<ReadonlySet<string> | 'tenant'>;
  /**
   * Usuários visíveis (RN-CORE-04; ADR 0009 §6): o próprio; supervisor + equipe; gerente + equipes abaixo; `'tenant'`
   * para analista/assistente/admin. Sem o serviço a API falha fechada: só o próprio (ou `'tenant'` nos perfis de escopo tenant).
   */
  usuariosVisiveis?(usuario: UsuarioAutenticado, banco: AcessoBanco): Promise<ReadonlySet<string> | 'tenant'>;
}

export interface ModuloApi {
  manifesto: Manifesto;
  rotas?: readonly RotaModulo[];
  sync?: readonly ProvedorSync[];
  /** Só core: rotas sem token, montadas em `/v1/<caminho>`. */
  rotasPublicas?: readonly RotaPublica[];
  /** Só core: autenticação e escopo de carteira. */
  servicos?: ServicosCore;
  /** Eventos que o módulo consome, entregues pelo despachante da outbox (ADR 0007; `apps/api/src/despachante.ts`). */
  consumidores?: readonly ConsumidorEvento[];
  /** Consultas que o módulo oferece (ADR 0012): uma por nome de `ofereceConsultas`, todas implementadas. */
  consultas?: readonly ImplementacaoConsulta[];
  /** Tarefas periódicas por tenant, rodadas pelo agendador do worker (ADR 0022; `apps/api/src/agendador.ts`). */
  tarefas?: readonly TarefaPeriodica[];
  /**
   * Rotas chamadas pelo Conector (ADR 0013; `conector.ts`), montadas em `/<modulo>/v1/<caminho>` com chave de API, sem JWT.
   * Só módulo com `apps.conector` no manifesto (hoje a Integração).
   */
  conector?: ApiConector;
}

/**
 * Status que um módulo pode devolver por erro próprio. Ficam de fora os da plataforma: 400 (Zod, o createApp
 * valida) e 5xx além de 503 (erro inesperado vira 500 sem detalhes). 429 é dos dois: a plataforma limita as rotas
 * públicas contra abuso e o módulo pode ter limite próprio (ex.: tentativas de login erradas no Core, T-0026); com
 * `detalhes.retry_after_s` (inteiro > 0) a API manda também o cabeçalho `retry-after`.
 */
export const STATUS_ERRO_MODULO = [401, 403, 404, 409, 410, 422, 423, 429, 503] as const;
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
    if (!(STATUS_ERRO_MODULO as readonly number[]).includes(status))
      throw new Error(
        `ErroHttpModulo: status ${String(status)} não é de módulo (${STATUS_ERRO_MODULO.join(', ')})`,
      );
  }
}

/** Erro de regra de negócio: a API responde 422 `{ codigo, mensagem, detalhes? }` (codigo = id da RN). */
export class ErroRegraNegocio extends ErroHttpModulo {
  // Sem `declare` em campo de classe: o Babel do Metro o rejeita e o build EAS cai (T-0004 §7; regra no eslint).
  override readonly status = 422 as const;
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
  override readonly status = 404 as const;
  constructor(codigo: string, mensagem: string) {
    super(404, codigo, mensagem);
    this.name = 'ErroNaoEncontrado';
  }
}

/** Corpo `ErroApiSchema` do erro do módulo (o mesmo que a API envia). */
export function corpoDoErroModulo(e: ErroHttpModulo): {
  codigo: string;
  mensagem: string;
  detalhes?: Record<string, unknown>;
} {
  return { codigo: e.codigo, mensagem: e.message, ...(e.detalhes ? { detalhes: e.detalhes } : {}) };
}

/** Segundos do cabeçalho `retry-after` de um `ErroHttpModulo` 429 (`detalhes.retry_after_s` inteiro > 0), ou `null`. */
export function retryAfterDoErroModulo(e: ErroHttpModulo): number | null {
  if (e.status !== 429) return null;
  const s = e.detalhes?.retry_after_s;
  return typeof s === 'number' && Number.isInteger(s) && s > 0 ? s : null;
}

/**
 * ADR 0012: consultas em `ofereceConsultas` sem implementação em `ModuloApi.consultas`, no conjunto instalado. A API real
 * (`createApp` com os módulos do produto) não sobe com alguma; com módulos de fixture, a consulta faltante só fica
 * `ConsultaIndisponivel` em tempo de execução.
 */
export function consultasSemImplementacao(modulos: readonly Pick<ModuloApi, 'manifesto' | 'consultas'>[]): string[] {
  return modulos.flatMap((m) => {
    const feitas = new Set((m.consultas ?? []).map((c) => c.consulta.nome));
    return m.manifesto.ofereceConsultas.filter((n) => !feitas.has(n)).map((n) => `${m.manifesto.id}: consulta ${n} oferecida no manifesto sem implementação em "consultas"`);
  });
}

/** Módulo → `depende` do manifesto, para `ctx.dependencias` (RN-CORE-03). */
export function dependenciasDosManifestos(
  manifestos: readonly Pick<Manifesto, 'id' | 'depende'>[],
): DependenciasModulos {
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
 * RN-PRO-01 na API, valendo mesmo que a rota se declare errada: o promotor é barrado em toda ação de escrita de
 * pedido e em todo caminho de pedido, EXCETO `GET` com ação de leitura de pedido (`pedido.ver`). Nesse caso a
 * leitura não é liberada aqui: segue para a permissão por ação do manifesto (ADR 0004) e o escopo de carteira
 * (RN-CORE-04) — doc 03 §2 "Ver pedidos" e esclarecimento O-3.
 */
export function promotorBarradoNaRota(rota: Pick<RotaModulo, 'metodo' | 'caminho' | 'acao'>): boolean {
  if (rota.acao && ehAcaoDeEscritaDePedido(rota.acao)) return true;
  const leitura = rota.metodo === 'GET' && !!rota.acao && ehAcaoDeLeituraDePedido(rota.acao);
  return ehCaminhoDePedido(rota.caminho) && !leitura;
}

/**
 * Valida e devolve a definição da API do módulo. Falha cedo (no import) se:
 * caminho fora do padrão ou repetido; rota de escrita sem `acao`; ação não declarada no manifesto do
 * próprio módulo; `perfis` fora dos perfis do módulo; rota de pedido aceitando promotor por `perfis` (RN-PRO-01;
 * a leitura do promotor só vem por `acao` de leitura); ação de leitura de pedido em método que não é GET;
 * entidade de sync fora do `sync` do manifesto ou de outro módulo; consumidor de evento fora de `consome` ou repetido;
 * consulta implementada fora de `ofereceConsultas`, de outro módulo ou repetida (ADR 0012); rotas de Conector em módulo sem
 * `apps.conector`, com id ou método+caminho repetido (ADR 0013). Consulta oferecida sem
 * implementação é checada na montagem da API real (`consultasSemImplementacao`), não aqui: teste que troca um módulo por
 * uma fixture com rotas de exemplo não precisa reimplementar as consultas dele.
 */
export function definirModuloApi(m: ModuloApi): ModuloApi {
  const id = m.manifesto.id;
  const problemas: string[] = [];
  const vistas = new Set<string>();
  for (const r of m.rotas ?? []) {
    const rotulo = `${r.metodo} /v1/${id}${r.caminho ? `/${r.caminho}` : ''}`;
    if (r.caminho !== '' && !CAMINHO_RE.test(r.caminho))
      problemas.push(`${rotulo}: caminho inválido (sem barra inicial, minúsculas, parâmetros :nome)`);
    const chave = `${r.metodo} ${r.caminho.replace(/:[^/]+/g, ':')}`;
    if (vistas.has(chave)) problemas.push(`${rotulo}: rota repetida`);
    vistas.add(chave);
    if (r.metodo !== 'GET' && !r.acao)
      problemas.push(`${rotulo}: rota de escrita precisa de "acao" do manifesto (ADR 0004)`);
    if (r.acao && !Object.hasOwn(m.manifesto.acoes, r.acao))
      problemas.push(`${rotulo}: ação ${r.acao} não está em "acoes" do manifesto de ${id}`);
    if (r.acao && r.perfis) problemas.push(`${rotulo}: use "acao" ou "perfis", não os dois`);
    for (const p of r.perfis ?? [])
      if (!m.manifesto.perfis.includes(p)) problemas.push(`${rotulo}: perfil ${p} fora dos perfis do módulo`);
    if (
      (ehCaminhoDePedido(r.caminho) || (r.acao && ehAcaoDePedido(r.acao))) &&
      r.perfis?.includes('promotor')
    ) {
      problemas.push(
        `${rotulo}: RN-PRO-01 — promotor nunca acessa rota de pedido por "perfis" (leitura só por "acao" pedido.ver)`,
      );
    }
    if (r.acao && ehAcaoDeLeituraDePedido(r.acao) && r.metodo !== 'GET')
      problemas.push(`${rotulo}: ação de leitura ${r.acao} só em GET (RN-PRO-01)`);
    if (r.carteira === undefined) problemas.push(`${rotulo}: declare o escopo de carteira (RN-CORE-04)`);
    problemas.push(...problemasLimiteCorpo(rotulo, r));
  }
  const entidades = new Set<string>();
  for (const p of m.sync ?? []) {
    const e = p.entidade;
    if (e.modulo !== id) problemas.push(`sync ${e.nome}: entidade de ${e.modulo} servida por ${id}`);
    if (!m.manifesto.sync.includes(e.nome))
      problemas.push(`sync ${e.nome}: não está em "sync" do manifesto de ${id}`);
    if (entidades.has(e.nome)) problemas.push(`sync ${e.nome}: provedor repetido`);
    entidades.add(e.nome);
    if (!p.puxar && !p.receber) problemas.push(`sync ${e.nome}: informe puxar e/ou receber`);
    if (p.receber && e.direcao === 'pull') problemas.push(`sync ${e.nome}: direção pull não recebe push`);
    if (p.puxar && e.direcao === 'push') problemas.push(`sync ${e.nome}: direção push não serve pull`);
    const escopos: readonly unknown[] =
      p.escopo === undefined ? [] : typeof p.escopo === 'string' ? [p.escopo] : p.escopo;
    for (const x of escopos)
      if (!(ESCOPOS_SYNC as readonly unknown[]).includes(x))
        problemas.push(`sync ${e.nome}: escopo ${String(x)} inválido (${ESCOPOS_SYNC.join(', ')})`);
    if (p.escopo !== undefined && escopos.length === 0)
      problemas.push(`sync ${e.nome}: lista de escopo vazia`);
    if (p.escopo !== undefined && !p.puxar)
      problemas.push(`sync ${e.nome}: escopo só vale para provedor com puxar`);
    if (e.schemaLinha && e.direcao === 'push')
      problemas.push(`sync ${e.nome}: schemaLinha só vale para entidade com pull`);
  }
  const assinados = new Set<string>();
  for (const c of m.consumidores ?? []) {
    const nome = c.evento.nome;
    if (!m.manifesto.consome.includes(nome)) problemas.push(`consumidor ${nome}: não está em "consome" do manifesto de ${id}`);
    if (assinados.has(nome)) problemas.push(`consumidor ${nome}: repetido (um por evento e módulo)`);
    assinados.add(nome);
  }
  const implementadas = new Set<string>();
  for (const c of m.consultas ?? []) {
    const nome = c.consulta.nome;
    if (c.consulta.modulo !== id) problemas.push(`consulta ${nome}: é de ${c.consulta.modulo}, implementada por ${id}`);
    else if (!m.manifesto.ofereceConsultas.includes(nome)) problemas.push(`consulta ${nome}: não está em "ofereceConsultas" do manifesto de ${id}`);
    if (implementadas.has(nome)) problemas.push(`consulta ${nome}: implementação repetida`);
    implementadas.add(nome);
  }
  const tarefas = new Set<string>();
  for (const t of m.tarefas ?? []) {
    problemas.push(...problemasTarefa(t));
    if (tarefas.has(t.nome)) problemas.push(`tarefa ${t.nome}: repetida`);
    tarefas.add(t.nome);
  }
  if (id !== 'core' && (m.rotasPublicas?.length || m.servicos))
    problemas.push('só o core declara rotas públicas e serviços de plataforma');
  for (const r of m.rotasPublicas ?? []) {
    if (!CAMINHO_RE.test(r.caminho)) problemas.push(`${r.metodo} /v1/${r.caminho}: caminho inválido`);
    if (/^(sync|saude|me|arquivos)(\/|$)/.test(r.caminho))
      problemas.push(`${r.metodo} /v1/${r.caminho}: prefixo reservado à plataforma`);
    if (!(r.limite?.max > 0) || !(r.limite?.janelaMs > 0))
      problemas.push(`${r.metodo} /v1/${r.caminho}: rota pública exige limite de tentativas`);
  }
  problemas.push(...problemasApiConector(m.manifesto, m.conector));
  if (problemas.length > 0) throw new Error(`API do módulo ${id} inválida: ${problemas.join('; ')}`);
  return m;
}
