/**
 * Testes do agente `testes` (T-0006): integração entre módulos, fundação (T-0001), isolamento
 * multi-tenant no Postgres (T-0002) e, depois, sync/e2e.
 * Rodar da raiz: `pnpm test:tests` (ou `pnpm test`, tarefa raiz `//#test:tests` do turbo; também no CI).
 *
 * Banco: o globalSetup do `@macuxi/db` (docs/banco/README.md, "Para o agente testes") cria um banco
 * efêmero `macuxi_teste_*`, migra, carrega a fixture dois-tenants e apaga no fim. Se o container
 * estiver parado e o Docker aberto, sobe sozinho. Sem Docker, os testes de banco PULAM com aviso no fim;
 * com `MACUXI_PG_EXIGIR=1` (CI), a ausência do banco é ERRO.
 */
import AvisoPulos from '@macuxi/db/teste/aviso-pulos';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: __dirname,
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', 'fixtures/**'],
    globalSetup: ['../db/testes/global-setup.ts'],
    reporters: ['default', new AvisoPulos()],
    // Folga contra máquina carregada (vários agentes/arquivos em paralelo): tempo de caso não é medida
    // de desempenho; medição só em job próprio (tests/plano/sprint-1.md, "Testes de tempo").
    testTimeout: 60_000,
    hookTimeout: 300_000,
  },
});
