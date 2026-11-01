/**
 * Idempotência do LOTE (T-0025; complementa a do registro, RN-INT-02): o Conector manda `Idempotency-Key` (SHA-256 do conteúdo do
 * lote) e o Hub devolve o MESMO lote_id se a chave já foi vista com o mesmo conteúdo; com conteúdo diferente é conflito (409).
 *
 * O hash do conteúdo é calculado pela API (SHA-256 de `conteudoCanonicoLote`, `node:crypto`); aqui só a parte pura.
 */
import type { EstadoLote } from '../contracts';
import { jsonCanonico } from './idempotencia';

const REGEX_CHAVE = /^[A-Za-z0-9._:-]{16,128}$/;

export type ResultadoChaveIdempotencia = { ok: true; chave: string } | { ok: false; codigo: 'chave_idempotencia_invalida'; mensagem: string };

/** RN-INT-12 (proposta): 16 a 128 caracteres seguros (o Conector envia SHA-256 hex, 64). Nada de espaço, quebra de linha ou `/`. */
export function validarChaveIdempotencia(chave: unknown): ResultadoChaveIdempotencia {
  if (typeof chave === 'string' && REGEX_CHAVE.test(chave)) return { ok: true, chave };
  return {
    ok: false,
    codigo: 'chave_idempotencia_invalida',
    mensagem: 'O cabeçalho Idempotency-Key é obrigatório em POST /lotes e deve ter de 16 a 128 caracteres (letras, números, ponto, hífen, sublinhado e dois-pontos). O Conector envia o SHA-256 do lote.',
  };
}

/**
 * Conteúdo que identifica o lote para a idempotência: versão, entidade, modo, sessão, registros e linhas inválidas.
 * FICAM DE FORA os campos informativos que mudam a cada montagem (`enviado_em`, `cursor` declarado, `conector_id`,
 * `versao_conector`): remontar o mesmo lote depois de `retomar` ou de uma atualização do Conector tem a mesma chave e não pode
 * virar conflito.
 */
export function conteudoCanonicoLote(envelope: unknown): string {
  const e = (envelope && typeof envelope === 'object' ? envelope : {}) as Record<string, unknown>;
  return jsonCanonico({
    versao_contrato: e.versao_contrato,
    entidade: e.entidade,
    modo: e.modo,
    sessao: e.sessao,
    registros: e.registros,
    linhas_invalidas: e.linhas_invalidas,
    linhas_invalidas_omitidas: e.linhas_invalidas_omitidas,
  });
}

export interface LoteRegistradoPorChave {
  lote_id: string;
  hash_conteudo: string;
  status: EstadoLote;
}

export type DecisaoIdempotenciaLote =
  | { acao: 'processar' }
  | { acao: 'repetir'; lote_id: string; status: EstadoLote }
  | { acao: 'conflito'; lote_id: string; status_http: 409; codigo: 'chave_idempotencia_reutilizada'; mensagem: string };

/**
 * RN-INT-12 (proposta): chave nova → processar; mesma chave e mesmo conteúdo → repetir a resposta (mesmo lote, sem reprocessar,
 * em qualquer status — quem quer reprocessar usa o BKO); mesma chave e conteúdo diferente → 409.
 * A chave vale por (tenant, conector): o escopo é do chamador, que busca `existente` já nesse escopo.
 */
export function decidirIdempotenciaLote(e: { chave: string; hashConteudo: string; existente: LoteRegistradoPorChave | null }): DecisaoIdempotenciaLote {
  if (e.existente === null) return { acao: 'processar' };
  if (e.existente.hash_conteudo === e.hashConteudo) return { acao: 'repetir', lote_id: e.existente.lote_id, status: e.existente.status };
  return {
    acao: 'conflito',
    lote_id: e.existente.lote_id,
    status_http: 409,
    codigo: 'chave_idempotencia_reutilizada',
    mensagem: 'A Idempotency-Key já foi usada por outro lote com conteúdo diferente. Gere uma chave nova para o conteúdo novo (o Conector usa o SHA-256 do lote) ou reenvie exatamente o mesmo lote.',
  };
}
