import { defineConfig } from 'vitest/config';
import AvisoPulos from './testes/aviso-pulos';

// Testes do banco. Com Postgres acessível (ou Docker rodando: o globalSetup sobe o compose) eles RODAM;
// sem Docker/Postgres PULAM e o relator AvisoPulos imprime "Docker não está rodando: N testes de banco
// pulados". Com MACUXI_PG_EXIGIR=1 (CI) eles falham em vez de pular. Ver docs/banco/README.md.
export default defineConfig({
  test: {
    include: ['testes/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['testes/global-setup.ts'],
    reporters: ['default', new AvisoPulos()],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
