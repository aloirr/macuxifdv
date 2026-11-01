import AvisoPulos from '@macuxi/db/teste/aviso-pulos';
import { defineConfig } from 'vitest/config';

/**
 * Testes de lógica pura rodam em Node. Os de banco (`*.db.test.ts`, ex.: vazamento por escopo de carteira) usam o
 * globalSetup do @macuxi/db (banco efêmero + fixture dois-tenants); sem Postgres/Docker PULAM com aviso, e com
 * MACUXI_PG_EXIGIR=1 (CI) falham.
 */
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    globalSetup: ['@macuxi/db/teste/global-setup'],
    reporters: ['default', new AvisoPulos()],
    // Os *.db.test.ts compartilham o MESMO banco efêmero e alguns inserem linhas temporárias no tenant A (ex.: o cliente
    // sem coordenada de visita.db.test.ts, RN-CORE-10). Em paralelo, a lista de clientes de carteira.db.test.ts (RN-CORE-04)
    // via o cliente alheio: arquivos em série.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
