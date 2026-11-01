/**
 * Montagem dos lotes no envelope do contrato (`LoteEnvelope`) e chave de idempotência estável.
 * T-0027: lote só de linhas inválidas (`registros: []`) é válido (exceção da RN-INT-01) — a página sem registro bom também viaja.
 *
 * - Um lote = uma entidade; no máximo `maxLinhas` registros e `maxBytes` de JSON (o que estourar primeiro divide o lote).
 * - A chave de idempotência é o SHA-256 do conteúdo canônico (entidade, modo, geração, sessão/parte e registros):
 *   o mesmo conteúdo gera a mesma chave, em qualquer reenvio ou reinício. O Hub deve devolver o mesmo `lote_id`
 *   quando receber a mesma chave (cabeçalho `Idempotency-Key`).
 */
import { createHash } from 'node:crypto';
import { VERSAO_CONTRATO, type Cursor, type LinhaInvalidaConector, type LoteEnvelope } from '@macuxi/integracao/contracts';
import { jsonCanonico } from './util/json';

export interface SessaoEnvio {
  id: string;
  /** Número da primeira parte que sairá desta página (base 1). */
  primeiraParte: number;
  /** A página é a última da carga completa? Então a última parte do lote sai com `ultimo: true`. */
  ultimaPagina: boolean;
}

export interface EntradaLotes {
  entidade: string;
  modo: 'completo' | 'delta';
  geracao: number;
  registros: Record<string, unknown>[];
  /** Maior cursor da página (informativo para o Hub). */
  cursorDeclarado: Cursor | null;
  /** Par da última linha lida: de onde a leitura segue e o que se confirma quando o lote termina. */
  cursorLeitura: Cursor | null;
  maxLinhas: number;
  maxBytes: number;
  sessao?: SessaoEnvio;
  enviadoEm: string;
  /** Identificador e versão deste Conector, informados em todo lote (T-0023). */
  conectorId?: string;
  versaoConector?: string;
  /**
   * Linhas recusadas localmente (sem valores) e quantas passaram do limite (só a contagem, no primeiro lote da página).
   * Sem `maxLinhasInvalidasPorLote`, todas vão no primeiro lote da página (delta). Com ele (carga completa), são divididas em
   * fatias desse tamanho, uma por lote; se sobrarem fatias, viram lotes SÓ de linhas inválidas (`registros: []`, exceção da
   * RN-INT-01, T-0027). Página sem registro válido e com linhas inválidas também gera um lote só com elas.
   */
  linhasInvalidas?: LinhaInvalidaConector[];
  linhasInvalidasOmitidas?: number;
  maxLinhasInvalidasPorLote?: number;
}

export interface LoteMontado {
  envelope: LoteEnvelope;
  corpo: string;
  chave: string;
  linhas: number;
  bytes: number;
  parte: number | null;
  ultimo: boolean;
  /** Cursor a confirmar: só o último lote da página carrega o cursor de leitura. */
  cursorConfirmar: Cursor | null;
}

const tamanho = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');

/** Divide os registros em fatias respeitando linhas e bytes. Um registro maior que `maxBytes` vai sozinho (o Hub decide). */
export function dividirRegistros(registros: Record<string, unknown>[], maxLinhas: number, maxBytes: number): Record<string, unknown>[][] {
  const fatias: Record<string, unknown>[][] = [];
  let atual: Record<string, unknown>[] = [];
  let bytes = 512; // envelope sem registros
  for (const r of registros) {
    const t = tamanho(r) + 1;
    if (atual.length > 0 && (atual.length >= maxLinhas || bytes + t > maxBytes)) {
      fatias.push(atual);
      atual = [];
      bytes = 512;
    }
    atual.push(r);
    bytes += t;
  }
  if (atual.length > 0) fatias.push(atual);
  return fatias;
}

export function chaveDoLote(e: {
  entidade: string;
  modo: string;
  geracao: number;
  sessaoId?: string | null;
  parte?: number | null;
  registros: unknown[];
  linhasInvalidas?: unknown[];
  linhasInvalidasOmitidas?: number;
}): string {
  // as linhas inválidas só entram na chave quando existem: lotes sem elas mantêm a chave de antes (idempotência estável)
  const extras = e.linhasInvalidas?.length || e.linhasInvalidasOmitidas ? { invalidas: e.linhasInvalidas ?? [], omitidas: e.linhasInvalidasOmitidas ?? 0 } : {};
  return createHash('sha256')
    .update(jsonCanonico({ entidade: e.entidade, modo: e.modo, geracao: e.geracao, sessao: e.sessaoId ?? null, parte: e.parte ?? null, registros: e.registros, ...extras }))
    .digest('hex');
}

/** Fatias das linhas inválidas: uma só (tudo no primeiro lote) ou de `porLote` em `porLote`. */
function fatiarInvalidas(linhas: LinhaInvalidaConector[], porLote: number | undefined): LinhaInvalidaConector[][] {
  if (linhas.length === 0) return [];
  if (!porLote || porLote <= 0) return [linhas];
  const fatias: LinhaInvalidaConector[][] = [];
  for (let i = 0; i < linhas.length; i += porLote) fatias.push(linhas.slice(i, i + porLote));
  return fatias;
}

export function montarLotes(e: EntradaLotes): LoteMontado[] {
  const invalidas = fatiarInvalidas(e.linhasInvalidas ?? [], e.maxLinhasInvalidasPorLote);
  const omitidasPagina = e.linhasInvalidasOmitidas && e.linhasInvalidasOmitidas > 0 ? e.linhasInvalidasOmitidas : 0;
  // as linhas inválidas também ocupam o corpo: reserva o espaço da maior fatia para o lote não passar de maxBytes
  const reserva = invalidas.reduce((m, f) => Math.max(m, tamanho(f)), 0);
  const fatias = dividirRegistros(e.registros, e.maxLinhas, Math.max(Math.floor(e.maxBytes / 2), e.maxBytes - reserva));
  // lotes só de linhas inválidas (exceção da RN-INT-01): quando sobram fatias, ou a página não tem registro válido
  while (fatias.length < invalidas.length || (fatias.length === 0 && omitidasPagina > 0)) fatias.push([]);
  return fatias.map((registros, i) => {
    const ehUltimaFatia = i === fatias.length - 1;
    const parte = e.sessao ? e.sessao.primeiraParte + i : null;
    const ultimo = Boolean(e.sessao && e.sessao.ultimaPagina && ehUltimaFatia);
    const doLote = invalidas[i];
    const invalidasLote = doLote && doLote.length > 0 ? doLote : undefined;
    const omitidas = i === 0 && omitidasPagina > 0 ? omitidasPagina : undefined;
    const envelope: LoteEnvelope = {
      versao_contrato: VERSAO_CONTRATO,
      entidade: e.entidade,
      modo: e.modo,
      sessao: e.sessao && parte !== null ? { id: e.sessao.id, parte, ultimo } : undefined,
      cursor: e.cursorDeclarado ?? undefined,
      enviado_em: e.enviadoEm,
      ...(e.conectorId ? { conector_id: e.conectorId } : {}),
      ...(e.versaoConector ? { versao_conector: e.versaoConector } : {}),
      ...(invalidasLote ? { linhas_invalidas: invalidasLote } : {}),
      ...(omitidas ? { linhas_invalidas_omitidas: omitidas } : {}),
      registros,
    };
    const corpo = JSON.stringify(envelope);
    return {
      envelope,
      corpo,
      chave: chaveDoLote({ entidade: e.entidade, modo: e.modo, geracao: e.geracao, sessaoId: e.sessao?.id, parte, registros, linhasInvalidas: invalidasLote, linhasInvalidasOmitidas: omitidas }),
      linhas: registros.length,
      bytes: Buffer.byteLength(corpo, 'utf8'),
      parte,
      ultimo,
      cursorConfirmar: ehUltimaFatia ? e.cursorLeitura : null,
    };
  });
}
