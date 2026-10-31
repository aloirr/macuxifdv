import AvisoPulos from '@macuxi/db/teste/aviso-pulos';
import { defineConfig } from 'vitest/config';

// Testes da API. Os de acesso rodam sem banco (fakes); os de banco (test/banco.test.ts) usam o mesmo
// globalSetup do @macuxi/db: banco efêmero com a fixture dois-tenants; sem Postgres/Docker PULAM com aviso,
// e com MACUXI_PG_EXIGIR=1 (CI) falham.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['@macuxi/db/teste/global-setup'],
    reporters: ['default', new AvisoPulos()],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
