/**
 * Cliente HTTP do Hub `/integracao/v1` (ver docs/modulos/integracao/desenho.md §9 e conector.md §"O que o Hub precisa expor").
 * Conexão SEMPRE de saída (HTTPS). Autenticação: `Authorization: Bearer <token>` (chave de API rotacionável por Conector).
 * Falhas transitórias (rede, timeout, 408/425/429/5xx) fazem retry exponencial com jitter; recusas por regra (400/413/422)
 * viram `ErroHubRecusa` e NÃO são reenviadas; 401/403 viram `ErroHubAutenticacao`.
 */
import {
  API_PREFIX_INTEGRACAO,
  CursorEntidade,
  LoteAceito,
  PedidosPendentes,
  RecusaEnvelope,
  RetornoAceito,
  type ReconciliacaoEnvio,
} from '@macuxi/integracao/contracts';
import { z } from 'zod';
import { comRetry, type OpcoesRetry } from '../util/retry';
import { VERSAO_CONECTOR } from '../versao';
import { ResultadoLote, type ResultadoLoteHub, type RetornoParaHub } from './tipos';

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

export type RespostaEnvioLote = { tipo: 'aceito'; aceito: LoteAceito } | { tipo: 'recusado'; status: number; recusa: RecusaEnvelope | null };
export type RespostaRetorno = { tipo: 'aceito'; aceito: RetornoAceito } | { tipo: 'recusado'; status: number; codigo: string; mensagem: string };

export interface OpcoesHub {
  url: string;
  token: () => Promise<string>;
  timeoutMs?: number;
  retry?: Partial<Pick<OpcoesRetry, 'tentativas' | 'baseMs' | 'maxMs' | 'dormir' | 'aleatorio'>>;
  fetch?: typeof fetch;
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
              'User-Agent': `macuxi-conector/${VERSAO_CONECTOR}`,
              'X-Macuxi-Conector-Versao': VERSAO_CONECTOR,
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
          throw new ErroHubAutenticacao('O Hub recusou a credencial do Conector (verifique o token; ele pode ter sido rotacionado ou revogado).', res.status);
        }
        if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) {
          const ra = Number(res.headers.get('retry-after'));
          throw new ErroHubTransitorio(`Hub indisponível (HTTP ${res.status}).`, res.status, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
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

  /** `GET /lotes/{id}` — resultado por linha. `null` se o Hub não conhece o lote (404). */
  async consultarLote(loteId: string): Promise<ResultadoLoteHub | null> {
    const { status, json } = await this.chamar('consultar_lote', 'GET', `/lotes/${encodeURIComponent(loteId)}`);
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

  /** `POST /sinal` — batimento de vida (1 min). */
  async enviarSinal(corpo: Record<string, unknown>): Promise<void> {
    const { status } = await this.chamar('sinal', 'POST', '/sinal', corpo);
    if (status >= 400) throw new ErroHubTransitorio(`O Hub recusou o sinal de vida (HTTP ${status}).`, status);
  }

  /** `POST /reconciliacoes` (RN-INT-07). */
  async enviarReconciliacao(corpo: ReconciliacaoEnvio): Promise<unknown> {
    const { status, json } = await this.chamar('reconciliacao', 'POST', '/reconciliacoes', corpo);
    if (status >= 400) throw new ErroHubRecusa(`O Hub recusou a reconciliação (HTTP ${status}).`, status, json);
    return json;
  }
}
