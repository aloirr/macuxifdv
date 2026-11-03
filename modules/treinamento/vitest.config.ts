import AvisoPulos from '@macuxi/db/teste/aviso-pulos';
import { defineConfig } from 'vitest/config';

/**
 * Testes de lógica pura rodam em Node. Os de banco (api/*.db.test.ts) usam o globalSetup do @macuxi/db (banco efêmero +
 * fixture dois-tenants + fixture do Treinamento); sem Postgres/Docker PULAM com aviso, e com MACUXI_PG_EXIGIR=1 (CI) falham.
 */
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**'],
    environment: 'node',
    globalSetup: ['@macuxi/db/teste/global-setup'],
    reporters: ['default', new AvisoPulos()],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
