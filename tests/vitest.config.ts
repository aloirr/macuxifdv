/**
 * Testes do agente `testes` (T-0006): integração entre módulos, fundação (T-0001) e, depois, sync/e2e.
 * Rodar da raiz: `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts`
 * (tests/ ainda não é pacote do workspace nem entra no `pnpm test` do turbo — pedido ao engenheiro).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: __dirname,
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', 'fixtures/**'],
    testTimeout: 30_000,
  },
});
