/**
 * Ambiente do aparelho/navegador que o SHELL entrega aos módulos (T-0001 A3; desenho T-0001 §16):
 * cliente HTTP com a sessão, estado de sinal, gerador de UUID e o usuário logado.
 *
 * Chega aos módulos por dois caminhos, sem import de `apps/*` (fronteira):
 * - etapas de sync: `executar(ctx)` → `ctx.http`, `ctx.online()`, `ctx.novoId()`, `ctx.usuario()`;
 * - telas: `useAmbiente()` / `useHttp()` de `@macuxi/platform-sdk/react` (e `motor.ambiente`/`motor.http`).
 *
 * Regras:
 * - Modo sem sinal (`online() === false`) → nada sai do aparelho: `http` lança `ErroSemConexao` sem tocar a rede.
 * - Falha de rede/timeout → `ErroSemConexao`; resposta de erro da API → `ErroHttp` (`status`, `codigo`, `detalhes`).
 * - `novoId()` = UUID v4 gerado no aparelho (idempotência, RN-VEN-33).
 * - Escritas de negócio vão pela fila do motor (`enfileirar`); `requisitar` com POST/PUT é só para o que exige
 *   resposta na hora (ex.: editar/cancelar pedido já enviado) e o módulo trata `ErroSemConexao`.
 */
import type { z } from 'zod';
import type { DefinicaoConsulta } from './consultas-tipos';
import type { ModuloId, Perfil } from './nomes';

export type MetodoHttp = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ConsultaHttp = Record<string, string | number | boolean | undefined | null>;

export interface OpcoesHttp {
  query?: ConsultaHttp;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ClienteHttp {
  /** GET com query; devolve o corpo JSON. */
  get<T>(caminho: string, query?: ConsultaHttp): Promise<T>;
  /** Qualquer método; devolve o corpo JSON. */
  requisitar<T>(metodo: MetodoHttp, caminho: string, opcoes?: OpcoesHttp): Promise<T>;
}

/** Sem rede, timeout, modo sem sinal ou shell sem servidor configurado. Justifica guardar e tentar depois. */
export class ErroSemConexao extends Error {
  constructor(mensagem = 'Sem conexão com o servidor.') {
    super(mensagem);
    this.name = 'ErroSemConexao';
  }
}

/** Resposta de erro da API (`{ codigo, mensagem, detalhes }` na v1; `{ code, message, details }` na Fase M). */
export class ErroHttp extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
    readonly detalhes?: Record<string, unknown>,
  ) {
    super(mensagem);
    this.name = 'ErroHttp';
  }
}

export function ehSemConexao(e: unknown): e is ErroSemConexao {
  return e instanceof ErroSemConexao || (e instanceof Error && e.name === 'ErroSemConexao');
}

/** 4xx da API (ex.: sem rota hoje, sem metas): a carga pode seguir com "vazio". */
export function ehErroDeCliente(e: unknown): boolean {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' && s >= 400 && s < 500;
}

export interface UsuarioAmbiente {
  id: string;
  nome: string;
  perfil: Perfil | null;
  /**
   * Fuso IANA do tenant (`plataforma.tenant.fuso`, vem no login): virada do dia e exibição de horários (RN-CORE-11).
   * Ausente na demonstração (mock-api) — o módulo usa o padrão dele.
   */
  fuso?: string;
}

/** Consulta entre módulos no aparelho (ADR 0012): mesmo contrato e mesmo resultado que `tx.consultar` na API. */
export type FuncaoConsultar = <E extends z.ZodTypeAny, S extends z.ZodTypeAny>(def: DefinicaoConsulta<E, S>, entrada: z.input<E>) => Promise<z.output<S>>;

/** O que o SHELL monta (HTTP, sinal, UUID, usuário). `consultar` e `parametros` quem completa é o motor (`completarAmbiente`, em `consultas.ts`). */
export interface AmbienteAparelho {
  http: ClienteHttp;
  /** `false` = modo sem sinal ligado (nada sai do aparelho) ou sem sessão. */
  online(): boolean;
  /** UUID v4 gerado no aparelho. */
  novoId(): string;
  /** Usuário logado (ou null antes do login). */
  usuario(): UsuarioAmbiente | null;
  consultar?: FuncaoConsultar;
  parametros?: (modulo: ModuloId) => Readonly<Record<string, unknown>>;
}

/**
 * O que os MÓDULOS recebem (`useAmbiente()`, `ctx` das etapas, `motor.ambiente`): o ambiente do shell mais
 * - `consultar(def, entrada)`: consulta a outro módulo sobre as linhas locais do dono (offline; ADR 0012). Dono sem
 *   implementação no aparelho, inativo ou fora do app → `ConsultaIndisponivel`;
 * - `parametros(modulo)`: parâmetros do tenant guardados do último `GET /v1/me/modulos` (valem offline; somem com o
 *   módulo, RN-CORE-02). Sem nada guardado = `{}`.
 */
export interface AmbienteModulo extends AmbienteAparelho {
  consultar: FuncaoConsultar;
  parametros(modulo: ModuloId): Readonly<Record<string, unknown>>;
}

export type FuncaoRequisitar = <T>(metodo: MetodoHttp, caminho: string, opcoes: OpcoesHttp) => Promise<T>;

export const MENSAGEM_SEM_SINAL = 'Modo sem sinal ligado: nada sai do aparelho até a conexão voltar.';

/** Monta o `ClienteHttp` sobre a função de transporte do shell, respeitando o modo sem sinal. */
export function criarClienteHttp(requisitar: FuncaoRequisitar, opcoes: { online?: () => boolean } = {}): ClienteHttp {
  const online = opcoes.online ?? (() => true);
  const cliente: ClienteHttp = {
    async requisitar<T>(metodo: MetodoHttp, caminho: string, op: OpcoesHttp = {}): Promise<T> {
      if (!caminho.startsWith('/')) throw new Error(`Caminho HTTP precisa começar com "/": ${caminho}`);
      if (!online()) throw new ErroSemConexao(MENSAGEM_SEM_SINAL);
      return requisitar<T>(metodo, caminho, op);
    },
    get<T>(caminho: string, query?: ConsultaHttp): Promise<T> {
      return cliente.requisitar<T>('GET', caminho, query ? { query } : {});
    },
  };
  return cliente;
}

/** UUID v4 pelo `crypto` da plataforma (Node 20+, navegador seguro, Hermes com polyfill do shell). */
export function uuidPadrao(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  throw new Error('Este ambiente não gera UUID: o shell precisa fornecer novoId().');
}

/**
 * Ambiente "ainda sem servidor" (antes do login, testes, shell que não forneceu): offline, `http` sempre
 * lança `ErroSemConexao` com a mensagem dada. Telas e etapas tratam como "sem sinal".
 */
export function ambienteIndisponivel(mensagem = 'O aplicativo ainda não está conectado ao servidor. Entre de novo e tente outra vez.'): AmbienteAparelho {
  return {
    http: criarClienteHttp(async () => {
      throw new ErroSemConexao(mensagem);
    }),
    online: () => false,
    novoId: uuidPadrao,
    usuario: () => null,
  };
}
