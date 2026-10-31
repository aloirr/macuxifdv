import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [{ find: /^@macuxi\/ui\/mobile$/, replacement: fileURLToPath(new URL('./app/testes/ui-mobile-puro.ts', import.meta.url)) }],
  },
  test: { include: ['**/*.test.ts'], exclude: ['**/node_modules/**'], environment: 'node' },
});
