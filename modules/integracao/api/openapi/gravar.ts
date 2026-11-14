/**
 * Regrava `docs/openapi-hub-v1.json`, derivado dos contratos (T-0087).
 * Uso: `pnpm --filter @macuxi/integracao openapi`. Rode depois de mudar `ROTAS_HUB`, um contrato do Hub ou um exemplo; o teste de
 * deriva (`openapi.test.ts`) cobra isso. O guia em PDF tem o próprio gerador (`pnpm --filter @macuxi/integracao guia-pdf`).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gerarOpenApiHub } from './gerar';

const aqui = (relativo: string) => fileURLToPath(new URL(relativo, import.meta.url));

writeFileSync(aqui('../../docs/openapi-hub-v1.json'), `${JSON.stringify(gerarOpenApiHub(), null, 2)}\n`, 'utf8');
