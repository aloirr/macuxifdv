/**
 * Conteúdo do `GET /integracao/v1/openapi.json` PÚBLICO (T-0092; decisão R-20261106-073936): só a especificação gerada dos
 * contratos v1, sem autenticação e sem dado de tenant, com cache de 1 h e ETag. A rota em si (sem token, limite de taxa) é da
 * plataforma (SDK/API); este módulo entrega a resposta pronta, pura e sem banco, para ela só repassar.
 */
import { createHash } from 'node:crypto';
import { openApiHub } from './gerar';

export const CACHE_CONTROL_OPENAPI = 'public, max-age=3600';

export interface RespostaOpenApiPublica {
  status: 200 | 304;
  cabecalhos: { 'content-type'?: string; 'cache-control': string; etag: string };
  /** JSON já serializado (igual ao `docs/openapi-hub-v1.json`); `null` no 304. */
  corpo: string | null;
}

let memo: { corpo: string; etag: string } | undefined;

function documento(): { corpo: string; etag: string } {
  if (!memo) {
    const corpo = `${JSON.stringify(openApiHub(), null, 2)}\n`;
    memo = { corpo, etag: `"${createHash('sha256').update(corpo).digest('hex').slice(0, 32)}"` };
  }
  return memo;
}

/** `ifNoneMatch` é o cabeçalho cru (aceita lista, `W/` e `*`). Igual ao ETag atual = 304 sem corpo. */
export function respostaOpenApiPublica(ifNoneMatch?: string | null): RespostaOpenApiPublica {
  const { corpo, etag } = documento();
  const base = { 'cache-control': CACHE_CONTROL_OPENAPI, etag };
  const candidatos = (ifNoneMatch ?? '').split(',').map((v) => v.trim().replace(/^W\//, ''));
  if (candidatos.includes(etag) || candidatos.includes('*')) return { status: 304, cabecalhos: base, corpo: null };
  return { status: 200, cabecalhos: { ...base, 'content-type': 'application/json; charset=utf-8' }, corpo };
}
