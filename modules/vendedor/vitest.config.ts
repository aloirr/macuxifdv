import { defineConfig } from 'vitest/config';

/** Testes de lógica pura rodam em Node; as libs puras importam `@macuxi/ui/mobile/puro` (sem react-native). */
export default defineConfig({
  test: { include: ['**/*.test.ts'], exclude: ['node_modules/**'], environment: 'node' },
});
