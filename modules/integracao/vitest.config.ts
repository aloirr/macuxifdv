import AvisoPulos from '@macuxi/db/teste/aviso-pulos';
import { defineConfig } from 'vitest/config';

/**
 * Testes de lógica pura rodam em Node. Os de banco (`*.db.test.ts`: consumidores A7/A8 × Postgres) usam o globalSetup do
 * @macuxi/db (banco efêmero + fixture dois-tenants); sem Postgres/Docker PULAM com aviso, e com MACUXI_PG_EXIGIR=1 (CI) falham.
 * Arquivos em série: os de banco compartilham o mesmo banco efêmero.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    globalSetup: ['@macuxi/db/teste/global-setup'],
    reporters: ['default', new AvisoPulos()],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
