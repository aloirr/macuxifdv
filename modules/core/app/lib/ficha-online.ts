/**
 * Consultas online da ficha (T-0186, P15 e P17): lista de notas, detalhe da NF e documentos vêm do servidor e NÃO ficam guardados no
 * aparelho (nem a NF, nem o arquivo). Só leitura (GET). A API revalida licença, perfil, carteira e permissão do documento.
 * Falha de rede ou de servidor vira mensagem em português com a ação seguinte ("Tentar de novo").
 */
import {
  DocumentoAbrirRespostaSchema,
  DocumentosRespostaSchema,
  HistoricoNfRespostaSchema,
  NotaDetalheSchema,
  ROTAS_CLIENTE360_V2,
  type DocumentoAbrirResposta,
  type DocumentosResposta,
  type HistoricoNfResposta,
  type NotaDetalhe,
} from '../../contracts';
import type { ClienteHttp } from './http';

const rota = (modelo: string, valores: Record<string, string>): string => `/core/${modelo.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(valores[k] ?? ''))}`;

export interface FalhaOnline {
  /** `true` = sem conexão ou servidor fora: "Sem internet". */
  semInternet: boolean;
  mensagem: string;
}

/** Sem conexão: texto da folha ("Sem internet" + "Tentar de novo"). Resposta recusada pela API: a mensagem dela, em português. */
export function falhaDaConsulta(e: unknown): FalhaOnline {
  const x = e as { status?: unknown; message?: unknown; code?: unknown } | null;
  const status = typeof x?.status === 'number' ? x.status : null;
  if (status === 403 || status === 404) {
    const msg = typeof x?.message === 'string' && x.message.trim() ? x.message : 'Sem permissão para ver este item.';
    return { semInternet: false, mensagem: msg };
  }
  return { semInternet: true, mensagem: 'Sem internet' };
}

export async function buscarNotas(http: ClienteHttp, clienteId: string, q: { de: string; ate: string; limite?: number }): Promise<HistoricoNfResposta> {
  const bruto = await http.get<unknown>(rota(ROTAS_CLIENTE360_V2.notas, { id: clienteId }), { de: q.de, ate: q.ate, limite: q.limite ?? 200 });
  return HistoricoNfRespostaSchema.parse(bruto);
}

/** P17: o toque na linha busca a NF. Nada é gravado. */
export async function buscarNota(http: ClienteHttp, clienteId: string, notaId: string): Promise<NotaDetalhe> {
  return NotaDetalheSchema.parse(await http.get<unknown>(rota(ROTAS_CLIENTE360_V2.nota, { id: clienteId, nota_id: notaId })));
}

export async function buscarDocumentos(http: ClienteHttp, clienteId: string): Promise<DocumentosResposta> {
  return DocumentosRespostaSchema.parse(await http.get<unknown>(rota(ROTAS_CLIENTE360_V2.documentos, { id: clienteId })));
}

/** P15: só visualizar. A API devolve o arquivo a abrir no visualizador do shell, sem salvar. */
export async function buscarDocumento(http: ClienteHttp, clienteId: string, documentoId: string): Promise<DocumentoAbrirResposta> {
  return DocumentoAbrirRespostaSchema.parse(await http.get<unknown>(rota(ROTAS_CLIENTE360_V2.documento, { id: clienteId, documento_id: documentoId })));
}

// ---------- visualizador (o shell registra; nada é baixado nem guardado) ----------

export interface PedidoAbrirDocumento {
  arquivo_id: string;
  titulo: string;
  formato: string | null;
}
export type AbrirDocumento = (p: PedidoAbrirDocumento) => void;

let abrirDocumento: AbrirDocumento | null = null;

/** O shell registra o visualizador de documentos e de PDF (só ver, sem "Baixar"). Sem ele, "Ver PDF" e a seta ficam desligados. */
export function definirAbrirDocumento(fn: AbrirDocumento | null): void {
  abrirDocumento = fn;
}

export function abrirDocumentoRegistrado(): AbrirDocumento | null {
  return abrirDocumento;
}
