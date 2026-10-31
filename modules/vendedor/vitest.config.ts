import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Testes de lógica pura rodam em Node. O kit mobile (`@macuxi/ui/mobile`) carrega react-native, que o
 * Vite não interpreta; nos testes apontamos só para o módulo de tempo, que é puro.
 */
export default defineConfig({
  resolve: { alias: { '@macuxi/ui/mobile': fileURLToPath(new URL('../../packages/ui/src/mobile/time.ts', import.meta.url)) } },
  test: { include: ['**/*.test.ts'], exclude: ['node_modules/**'], environment: 'node' },
});
