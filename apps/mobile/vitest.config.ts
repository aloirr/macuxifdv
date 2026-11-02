/**
 * Testes do shell mobile em Node. `@/` aponta para `src/` (como no tsconfig/Metro) e o JSX usa o runtime automático:
 * os testes de componente (T-0059) renderizam as telas com `react-dom/server`, simulando `react-native` e o roteador.
 */
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [{ find: /^@\//, replacement: `${fileURLToPath(new URL('./src/', import.meta.url))}` }],
  },
  test: {
    environment: 'node',
  },
});
