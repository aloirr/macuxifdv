import AvisoPulos from '@macuxi/db/teste/aviso-pulos';
import { defineConfig } from 'vitest/config';

/**
 * Testes de lógica pura rodam em Node; as libs puras importam `@macuxi/ui/mobile/puro` (sem react-native).
 * Os de banco (api/sync.db.test.ts) usam o globalSetup do @macuxi/db (banco efêmero + fixture dois-tenants); sem
 * Postgres/Docker PULAM com aviso, e com MACUXI_PG_EXIGIR=1 (CI) falham.
 */
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**'],
    environment: 'node',
    globalSetup: ['@macuxi/db/teste/global-setup'],
    // T-0054: DDL proposta do faturamento no banco efêmero até a migração chegar (apagar junto com o arquivo)
    setupFiles: ['./api/teste/ddl-proposta.ts'],
    reporters: ['default', new AvisoPulos()],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
