/**
 * `GET /v1/integracao/openapi` (ação `monitor.ver`; T-0087): o OpenAPI 3.1 do Hub `/integracao/v1`, gerado dos contratos Zod
 * (`api/openapi/gerar.ts`) e servido memoizado. É rota BKO comum (JWT) porque rota pública é exclusiva do core e o caminho de rota de módulo não admite ponto (por isso `openapi`, não `openapi.json`); o documento não
 * traz dado de tenant. O `GET /integracao/v1/openapi.json` sem autenticação (hub-api.md §15) depende de mudança de plataforma.
 */
import type { RotaModulo } from '@macuxi/platform-sdk';
import { openApiHub } from './openapi/gerar';

export const rotaOpenApi: RotaModulo = {
  metodo: 'GET',
  caminho: 'openapi',
  acao: 'monitor.ver',
  carteira: 'nao_se_aplica',
  executar: async () => openApiHub(),
};
