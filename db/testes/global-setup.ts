/**
 * Prepara o Postgres para os testes de db/: se houver Postgres (Docker), cria um banco efêmero
 * `macuxi_teste_*`, aplica as migrações, carrega a fixture dois-tenants e apaga tudo no fim.
 * Sem Postgres, os testes de integração PULAM com aviso (para não quebrar o `pnpm test` sem Docker);
 * com MACUXI_PG_EXIGIR=1 (CI), a ausência do banco é erro.
 */
import type { TestProject } from 'vitest/node';
import { criarBancoDeTeste, postgresDisponivel } from '../src/banco-teste';
import { lerConfig } from '../src/config';
import { carregarDoisTenants } from '../seeds/fixtures/dois-tenants';

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | void> {
  const cfg = lerConfig();
  const d = await postgresDisponivel(cfg);
  if (!d.ok) {
    const motivo = `Postgres indisponível em ${cfg.host}:${cfg.porta} (${d.motivo})`;
    if (process.env.MACUXI_PG_EXIGIR === '1') throw new Error(`${motivo} e MACUXI_PG_EXIGIR=1.`);
    console.warn(
      `\n[db] ${motivo}.\n[db] Testes de banco (migrações, RLS/vazamento, seed, Drizzle x banco) PULADOS.\n` +
        '[db] Para rodar: Docker Desktop aberto + "pnpm --filter @macuxi/db banco subir" (docs/banco/README.md).\n',
    );
    project.provide('banco', { disponivel: false, motivo });
    return;
  }
  const t = await criarBancoDeTeste({ cfg, preparar: (c) => carregarDoisTenants(c).then(() => undefined) });
  project.provide('banco', { disponivel: true, nome: t.nome, urlAdmin: t.urlAdmin, urlApp: t.urlApp });
  return async () => {
    await t.apagar();
  };
}
