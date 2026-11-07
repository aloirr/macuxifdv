/**
 * Conteúdo do `GET /integracao/v1/openapi.json` PÚBLICO (T-0092; decisão R-20261106-073936): só a especificação gerada dos
 * contratos v1, sem dado de tenant. A rota (sem token, limite por IP, Cache-Control, ETag e 304) é da plataforma; este módulo
 * só devolve o documento, puro e sem banco.
 */
import { openApiHub } from './gerar';

let memo: string | undefined;

/** JSON formatado, idêntico ao `docs/openapi-hub-v1.json`; gerado uma vez por processo. */
export function documentoOpenApiPublico(): string {
  memo ??= `${JSON.stringify(openApiHub(), null, 2)}\n`;
  return memo;
}
