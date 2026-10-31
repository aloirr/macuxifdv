import { defineConfig } from 'vitest/config';

// Testes do banco. Os que precisam de Postgres PULAM (com aviso) quando o banco não está de pé;
// com MACUXI_PG_EXIGIR=1 (CI) eles falham em vez de pular. Ver docs/banco/README.md.
export default defineConfig({
  test: {
    include: ['testes/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['testes/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
