/**
 * Regrava os arquivos derivados dos contratos (T-0087): `docs/openapi-hub-v1.json`.
 * Uso: `pnpm --filter @macuxi/integracao openapi`. Rode depois de mudar `ROTAS_HUB`, um contrato do Hub ou um exemplo; os testes de
 * deriva (`openapi.test.ts`) cobram isso.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gerarOpenApiHub } from './gerar';

const aqui = (relativo: string) => fileURLToPath(new URL(relativo, import.meta.url));

writeFileSync(aqui('../../docs/openapi-hub-v1.json'), `${JSON.stringify(gerarOpenApiHub(), null, 2)}\n`, 'utf8');
