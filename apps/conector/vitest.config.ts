import { defineConfig } from 'vitest/config';

// Testes do Conector. `node:sqlite` é carregado por createRequire (src/util/sqlite.ts), porque o Vite
// do Vitest 3 não reconhece esse módulo embutido do Node. Os testes de integração (test/*.integracao.test.ts)
// usam o PostgreSQL de MACUXI_PG_*; sem Postgres PULAM com aviso, e com MACUXI_PG_EXIGIR=1 (CI) falham.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
