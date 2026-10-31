/**
 * Montagem dos lotes no envelope do contrato (`LoteEnvelope`) e chave de idempotência estável.
 *
 * - Um lote = uma entidade; no máximo `maxLinhas` registros e `maxBytes` de JSON (o que estourar primeiro divide o lote).
 * - A chave de idempotência é o SHA-256 do conteúdo canônico (entidade, modo, geração, sessão/parte e registros):
 *   o mesmo conteúdo gera a mesma chave, em qualquer reenvio ou reinício. O Hub deve devolver o mesmo `lote_id`
 *   quando receber a mesma chave (cabeçalho `Idempotency-Key`).
 */
import { createHash } from 'node:crypto';
import { VERSAO_CONTRATO, type Cursor, type LoteEnvelope } from '@macuxi/integracao/contracts';
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

export function chaveDoLote(e: { entidade: string; modo: string; geracao: number; sessaoId?: string | null; parte?: number | null; registros: unknown[] }): string {
  return createHash('sha256')
    .update(jsonCanonico({ entidade: e.entidade, modo: e.modo, geracao: e.geracao, sessao: e.sessaoId ?? null, parte: e.parte ?? null, registros: e.registros }))
    .digest('hex');
}

export function montarLotes(e: EntradaLotes): LoteMontado[] {
  const fatias = dividirRegistros(e.registros, e.maxLinhas, e.maxBytes);
  return fatias.map((registros, i) => {
    const ehUltimaFatia = i === fatias.length - 1;
    const parte = e.sessao ? e.sessao.primeiraParte + i : null;
    const ultimo = Boolean(e.sessao && e.sessao.ultimaPagina && ehUltimaFatia);
    const envelope: LoteEnvelope = {
      versao_contrato: VERSAO_CONTRATO,
      entidade: e.entidade,
      modo: e.modo,
      sessao: e.sessao && parte !== null ? { id: e.sessao.id, parte, ultimo } : undefined,
      cursor: e.cursorDeclarado ?? undefined,
      enviado_em: e.enviadoEm,
      registros,
    };
    const corpo = JSON.stringify(envelope);
    return {
      envelope,
      corpo,
      chave: chaveDoLote({ entidade: e.entidade, modo: e.modo, geracao: e.geracao, sessaoId: e.sessao?.id, parte, registros }),
      linhas: registros.length,
      bytes: Buffer.byteLength(corpo, 'utf8'),
      parte,
      ultimo,
      cursorConfirmar: ehUltimaFatia ? e.cursorLeitura : null,
    };
  });
}
