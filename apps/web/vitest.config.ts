import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Testes do shell web em Node: partes puras (`lib/`) e testes de componente (`components/**\/*.test.tsx`), renderizados com
 * `react-dom/server` (o tsconfig usa `jsx: preserve` para o Next; aqui o JSX vai pelo runtime automático).
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: { include: ['lib/**/*.test.ts', 'components/**/*.test.tsx'], environment: 'node' },
});
