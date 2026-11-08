import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Testes do e-mail transacional (T-0094), sem banco. O vitest.config.ts da API só inclui test/**; até a pendência (b) do
// desenho (incluir src/**/*.test.ts lá), rode: pnpm --filter api exec vitest run --config src/email/vitest.config.ts
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
});
