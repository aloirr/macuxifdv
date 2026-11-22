/**
 * T-0092: cache HTTP da rota pública com `cache` (`RotaPublica.cache`, documento público como o OpenAPI do Hub).
 * ETag forte = hash SHA-256 do corpo serializado; `If-None-Match` com o mesmo valor (comparação fraca, RFC 9110 §13.1.2:
 * `W/` é ignorado), uma lista que o contém ou `*` = 304 sem corpo.
 */
import { createHash } from 'node:crypto';

export const TIPO_DOCUMENTO_PUBLICO = 'application/json; charset=utf-8';

/** Corpo serializado do documento: `string` vai como está; o resto, `JSON.stringify` (`undefined`/`null` = `{}`). */
export function corpoDoDocumento(resultado: unknown): string {
  if (typeof resultado === 'string') return resultado;
  return JSON.stringify(resultado ?? {});
}

/**
 * v1.0.21: corpo do documento binário (`RotaPublica.tipoConteudo`, ex.: PDF): só `Uint8Array`/`Buffer`, enviado como está.
 * Outra coisa é erro de programação do módulo (500).
 */
export function corpoBinarioDoDocumento(resultado: unknown, rotulo: string): Buffer {
  if (!(resultado instanceof Uint8Array)) throw new Error(`${rotulo}: documento binário exige Uint8Array no executar`);
  return Buffer.isBuffer(resultado) ? resultado : Buffer.from(resultado.buffer, resultado.byteOffset, resultado.byteLength);
}

/** ETag forte do corpo, texto ou bytes (32 caracteres hex do SHA-256, entre aspas). */
export function etagDoCorpo(corpo: string | Uint8Array): string {
  const h = createHash('sha256');
  if (typeof corpo === 'string') h.update(corpo, 'utf8');
  else h.update(corpo);
  return `"${h.digest('hex').slice(0, 32)}"`;
}

/** `If-None-Match` cru (pode vir repetido, em lista, com `W/` ou `*`) atende o ETag atual? */
export function ifNoneMatchAtende(cabecalho: string | readonly string[] | undefined, etag: string): boolean {
  if (cabecalho === undefined) return false;
  const valores = (typeof cabecalho === 'string' ? [cabecalho] : cabecalho).flatMap((v) => v.split(','));
  return valores.some((v) => {
    const t = v.trim();
    return t === '*' || t.replace(/^W\//, '') === etag;
  });
}

/**
 * Memo do último corpo de uma rota: o módulo devolve o mesmo documento a cada chamada (em geral a mesma `string`, ou o
 * mesmo `Buffer` lido na subida), então o hash só é recalculado quando o corpo muda (bytes: outra instância).
 */
export function criarMemoEtag(): (corpo: string | Uint8Array) => string {
  let ultimo: { corpo: string | Uint8Array; etag: string } | null = null;
  return (corpo) => {
    if (ultimo?.corpo !== corpo) ultimo = { corpo, etag: etagDoCorpo(corpo) };
    return ultimo.etag;
  };
}
