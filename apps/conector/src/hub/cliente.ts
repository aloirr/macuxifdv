/**
 * Cliente HTTP do Hub `/integracao/v1` (ver docs/modulos/integracao/desenho.md §9 e conector.md §"O que o Hub precisa expor").
 * Conexão SEMPRE de saída (HTTPS). Autenticação: `Authorization: Bearer <token>` (chave de API rotacionável por Conector).
 * Falhas transitórias (rede, timeout, 408/425/429/5xx) fazem retry exponencial com jitter; recusas por regra (400/413/422)
 * viram `ErroHubRecusa` e NÃO são reenviadas; 401/403 viram `ErroHubAutenticacao`; 426 vira `ErroHubVersao` (pausa, T-0027).
 */
import {
  API_PREFIX_INTEGRACAO,
  CABECALHO_CONECTOR_ID,
  CABECALHO_CONECTOR_VERSAO,
  CursorEntidade,
  LIMITE_ERROS_RESPOSTA_MAX,
  LoteAceito,
  PedidosPendentes,
  RecusaEnvelope,
  RespostaSinal,
  RetornoAceito,
  type ReconciliacaoEnvio,
} from '@macuxi/integracao/contracts';
import { z } from 'zod';
import { comRetry, type OpcoesRetry } from '../util/retry';
import { VERSAO_CONECTOR } from '../versao';
import { ResultadoLote, type ResultadoLoteHub, type RetornoParaHub } from './tipos';

/**
 * `Retry-After` do Hub (RFC 9110): número de segundos OU data HTTP (`Wed, 21 Oct 2026 07:28:00 GMT`). Devolve a espera em ms,
 * ou `undefined` se ausente, inválido, zero ou data já passada (aí vale o backoff normal). O teto é aplicado pelo retry.
 */
export function esperaRetryAfter(valor: string | null | undefined, agoraMs: number = Date.now()): number | undefined {
  const v = valor?.trim();
  if (!v) return undefined;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const segundos = Number(v);
    return segundos > 0 ? Math.round(segundos * 1000) : undefined;
  }
  const data = Date.parse(v);
  if (Number.isNaN(data)) return undefined;
  const espera = data - agoraMs;
  return espera > 0 ? espera : undefined;
}

export class ErroHubTransitorio extends Error {
  constructor(message: string, readonly status: number | null = null, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'ErroHubTransitorio';
  }
}
export class ErroHubRecusa extends Error {
  constructor(message: string, readonly status: number, readonly corpo: unknown) {
    super(message);
    this.name = 'ErroHubRecusa';
  }
}
export class ErroHubAutenticacao extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ErroHubAutenticacao';
  }
}

/**
 * HTTP 426 `versao_conector_nao_suportada` (RN-INT-11, T-0027): o Hub recusa dados deste Conector por versão abaixo da mínima.
 * É PAUSA, nunca recusa definitiva: nada se perde, nenhuma entidade é bloqueada. Quando o Hub informa a mínima (`detalhes`), o
 * Conector a guarda como política e passa a se comportar como "abaixo da mínima" (só o sinal segue) até o Hub liberar.
 */
export class ErroHubVersao extends Error {
  constructor(message: string, readonly versaoMinima: string | null, readonly mensagemHub: string | null) {
    super(message);
    this.name = 'ErroHubVersao';
  }
}

/** Lê o corpo do 426 (`ErroHub`): `detalhes.versao_minima` (ou `minima`) e a mensagem, se vierem; nunca lança. */
export function lerRecusaVersao(json: unknown): { versaoMinima: string | null; mensagem: string | null } {
  const j = (json && typeof json === 'object' ? json : {}) as { mensagem?: unknown; detalhes?: Record<string, unknown> | null };
  const d = j.detalhes && typeof j.detalhes === 'object' ? j.detalhes : {};
  const min = [d.versao_minima, d.minima].find((v): v is string => typeof v === 'string' && v.trim() !== '');
  return { versaoMinima: min?.trim() ?? null, mensagem: typeof j.mensagem === 'string' ? j.mensagem.slice(0, 300) : null };
}

export type RespostaEnvioLote = { tipo: 'aceito'; aceito: LoteAceito } | { tipo: 'recusado'; status: number; recusa: RecusaEnvelope | null };
export type RespostaRetorno = { tipo: 'aceito'; aceito: RetornoAceito } | { tipo: 'recusado'; status: number; codigo: string; mensagem: string };

export interface OpcoesHub {
  url: string;
  /** Chave de API deste Conector (relida a cada chamada: rotacionar a chave vale sem reiniciar). */
  token: () => Promise<string>;
  /** Identificador do Conector (cabeçalho `X-Macuxi-Conector-Id`); a chave é única por Conector. */
  conectorId?: string;
  /** Versão informada ao Hub (padrão: `VERSAO_CONECTOR`). */
  versao?: string;
  timeoutMs?: number;
  retry?: Partial<Pick<OpcoesRetry, 'tentativas' | 'baseMs' | 'maxMs' | 'dormir' | 'aleatorio'>>;
  fetch?: typeof fetch;
  /** Relógio (ms) para interpretar `Retry-After` em data HTTP; padrão `Date.now`. */
  agora?: () => number;
  aoRetentar?: (info: { operacao: string; tentativa: number; esperaMs: number; motivo: string }) => void;
}

export class ClienteHub {
  private readonly base: string;
  private readonly http: typeof fetch;

  constructor(private readonly o: OpcoesHub) {
    this.base = o.url.replace(/\/+$/, '') + API_PREFIX_INTEGRACAO;
    this.http = o.fetch ?? fetch;
  }

  private async chamar(operacao: string, metodo: 'GET' | 'POST', caminho: string, corpo?: unknown, cabecalhos: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
    const r = this.o.retry ?? {};
    return comRetry(
      async () => {
        let res: Response;
        try {
          res = await this.http(this.base + caminho, {
            method: metodo,
            headers: {
              Authorization: `Bearer ${await this.o.token()}`,
              Accept: 'application/json',
              'User-Agent': `macuxi-conector/${this.o.versao ?? VERSAO_CONECTOR}`,
              [CABECALHO_CONECTOR_VERSAO]: this.o.versao ?? VERSAO_CONECTOR,
              ...(this.o.conectorId ? { [CABECALHO_CONECTOR_ID]: this.o.conectorId } : {}),
              ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
              ...cabecalhos,
            },
            body: corpo !== undefined ? (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) : undefined,
            signal: AbortSignal.timeout(this.o.timeoutMs ?? 30_000),
          });
        } catch (e) {
          const c = (e as { cause?: { code?: string; errors?: { code?: string }[]; name?: string; message?: string } }).cause;
          const causa = c?.code ?? c?.errors?.find((x) => x.code)?.code ?? c?.message?.slice(0, 80) ?? c?.name ?? (e as Error).name;
          throw new ErroHubTransitorio(`Sem conexão com o Hub (${causa}).`);
        }
        const texto = await res.text().catch(() => '');
        let json: unknown = null;
        if (texto) {
          try {
            json = JSON.parse(texto);
          } catch {
            json = null;
          }
        }
        if (res.status === 401 || res.status === 403) {
          throw new ErroHubAutenticacao('O Hub recusou a credencial do Conector (verifique o identificador e a chave de API; ela pode ter sido rotacionada ou revogada: conector trocar-chave).', res.status);
        }
        if (res.status === 426) {
          const r = lerRecusaVersao(json);
          throw new ErroHubVersao(
            `O Hub recusou dados desta versão do Conector (HTTP 426${r.versaoMinima ? `, mínima ${r.versaoMinima}` : ''}). Atualize o Conector; os dados ficam na fila local.`,
            r.versaoMinima,
            r.mensagem,
          );
        }
        if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) {
          throw new ErroHubTransitorio(`Hub indisponível (HTTP ${res.status}).`, res.status, esperaRetryAfter(res.headers.get('retry-after'), this.o.agora?.()));
        }
        return { status: res.status, json };
      },
      {
        tentativas: r.tentativas ?? 4,
        baseMs: r.baseMs ?? 500,
        maxMs: r.maxMs ?? 30_000,
        dormir: r.dormir,
        aleatorio: r.aleatorio,
        transitorio: (e) => e instanceof ErroHubTransitorio,
        esperaMinima: (e) => (e instanceof ErroHubTransitorio ? e.retryAfterMs : undefined),
        aoFalhar: (e, tentativa, esperaMs) => this.o.aoRetentar?.({ operacao, tentativa, esperaMs, motivo: (e as Error).message }),
      },
    );
  }

  private interpretar<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, json: unknown, operacao: string): T {
    const r = schema.safeParse(json);
    if (!r.success) throw new ErroHubTransitorio(`Resposta inesperada do Hub em ${operacao} (formato fora do contrato).`);
    return r.data;
  }

  /** `POST /lotes` — 202 aceito; 400/413/422 recusa o envelope inteiro (RN-INT-01), sem lote criado. */
  async enviarLote(corpo: string, chaveIdempotencia: string): Promise<RespostaEnvioLote> {
    const { status, json } = await this.chamar('enviar_lote', 'POST', '/lotes', corpo, { 'Idempotency-Key': chaveIdempotencia });
    if (status === 200 || status === 201 || status === 202) return { tipo: 'aceito', aceito: this.interpretar(LoteAceito, json, 'enviar_lote') };
    const recusa = RecusaEnvelope.safeParse(json);
    return { tipo: 'recusado', status, recusa: recusa.success ? recusa.data : null };
  }

  /**
   * `GET /lotes/{id}` — resultado por linha. `null` se o Hub não conhece o lote (404). Pede o máximo de erros do contrato
   * (`limite_erros`, 5.500 = 5.000 registros + 500 inválidas; D-5 da T-0027): o Hub devolve as `falha_processamento` primeiro e,
   * assim, nenhuma linha transitória a reenviar fica de fora da resposta.
   */
  async consultarLote(loteId: string): Promise<ResultadoLoteHub | null> {
    const { status, json } = await this.chamar('consultar_lote', 'GET', `/lotes/${encodeURIComponent(loteId)}?limite_erros=${LIMITE_ERROS_RESPOSTA_MAX}`);
    if (status === 404) return null;
    if (status !== 200) throw new ErroHubTransitorio(`Resposta inesperada do Hub (HTTP ${status}) ao consultar o lote.`, status);
    return this.interpretar(ResultadoLote, json, 'consultar_lote');
  }

  /** `GET /cursores/{entidade}` — de onde continuar o delta. */
  async consultarCursor(entidade: string): Promise<CursorEntidade> {
    const { status, json } = await this.chamar('consultar_cursor', 'GET', `/cursores/${encodeURIComponent(entidade)}`);
    if (status !== 200) throw new ErroHubTransitorio(`Resposta inesperada do Hub (HTTP ${status}) ao consultar o cursor.`, status);
    return this.interpretar(CursorEntidade, json, 'consultar_cursor');
  }

  /** `GET /pedidos/pendentes` — o Hub marca como `enviado` o que entrega (RN-INT-08). */
  async pedidosPendentes(): Promise<PedidosPendentes> {
    const { status, json } = await this.chamar('pedidos_pendentes', 'GET', '/pedidos/pendentes');
    if (status !== 200) throw new ErroHubTransitorio(`Resposta inesperada do Hub (HTTP ${status}) ao buscar pedidos.`, status);
    return this.interpretar(PedidosPendentes, json, 'pedidos_pendentes');
  }

  /** `POST /pedidos/{uuid}/retorno` — idempotente: repetir o mesmo retorno não é erro. */
  async enviarRetorno(uuid: string, corpo: RetornoParaHub): Promise<RespostaRetorno> {
    const { status, json } = await this.chamar('enviar_retorno', 'POST', `/pedidos/${encodeURIComponent(uuid)}/retorno`, corpo);
    if (status === 200 || status === 201 || status === 202) return { tipo: 'aceito', aceito: this.interpretar(RetornoAceito, json, 'enviar_retorno') };
    const j = (json ?? {}) as { codigo?: string; mensagem?: string; erros?: { codigo?: string; mensagem?: string }[] };
    const primeiro = j.erros?.[0];
    return { tipo: 'recusado', status, codigo: primeiro?.codigo ?? j.codigo ?? `http_${status}`, mensagem: primeiro?.mensagem ?? j.mensagem ?? 'retorno recusado pelo Hub' };
  }

  /**
   * `POST /sinal` — batimento de vida (1 min). A resposta traz a política de versão (mínima/recomendada); resposta fora do
   * formato é ignorada (devolve `null`): um Hub mais antigo ou com defeito nunca deve parar o Conector.
   */
  async enviarSinal(corpo: Record<string, unknown>): Promise<RespostaSinal | null> {
    const { status, json } = await this.chamar('sinal', 'POST', '/sinal', corpo);
    if (status >= 400) throw new ErroHubTransitorio(`O Hub recusou o sinal de vida (HTTP ${status}).`, status);
    const r = RespostaSinal.safeParse(json);
    return r.success ? r.data : null;
  }

  /** `POST /reconciliacoes` (RN-INT-07). */
  async enviarReconciliacao(corpo: ReconciliacaoEnvio): Promise<unknown> {
    const { status, json } = await this.chamar('reconciliacao', 'POST', '/reconciliacoes', corpo);
    if (status >= 400) throw new ErroHubRecusa(`O Hub recusou a reconciliação (HTTP ${status}).`, status, json);
    return json;
  }
}
