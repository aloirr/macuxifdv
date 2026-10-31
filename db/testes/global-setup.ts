/**
 * Prepara o Postgres para os testes de db/ (roda no processo principal do Vitest).
 *
 * 1. Postgres acessível -> cria um banco efêmero `macuxi_teste_*`, aplica as migrações, carrega a
 *    fixture dois-tenants e apaga tudo no fim. Os testes de banco RODAM.
 * 2. Postgres fora do ar, host local e Docker rodando -> sobe o db/docker-compose.yml (`up -d --wait`)
 *    e segue como em 1. Desligue com MACUXI_PG_AUTO_SUBIR=0.
 * 3. Sem Docker/Postgres -> os testes de banco PULAM e o relator (testes/aviso-pulos.ts) imprime no fim
 *    "Docker não está rodando: N testes de banco pulados".
 * Com MACUXI_PG_EXIGIR=1 (CI), o caso 3 é ERRO em vez de pulo.
 */
import type { TestProject } from 'vitest/node';
import { criarBancoDeTeste, postgresDisponivel } from '../src/banco-teste';
import { HOSTS_LOCAIS, lerConfig, type ConfigBanco } from '../src/config';
import { dockerRodando, subirPostgres } from '../src/docker';
import { carregarDoisTenants } from '../seeds/fixtures/dois-tenants';
import { VAR_MOTIVO_PULO } from './aviso-pulos';

/** Motivo pelo qual o banco não está acessível (null = acessível, possivelmente após subir o Docker). */
async function garantirPostgres(cfg: ConfigBanco): Promise<string | null> {
  const d = await postgresDisponivel(cfg);
  if (d.ok) return null;
  const semPostgres = `Postgres indisponível em ${cfg.host}:${cfg.porta} (${d.motivo})`;
  if (!HOSTS_LOCAIS.includes(cfg.host)) return semPostgres;
  const docker = dockerRodando();
  if (!docker.ok) return `Docker não está rodando (${docker.motivo})`;
  if (process.env.MACUXI_PG_AUTO_SUBIR === '0') return `${semPostgres}; Docker rodando, mas MACUXI_PG_AUTO_SUBIR=0`;
  console.info('[db] Postgres fora do ar e Docker rodando: subindo db/docker-compose.yml...');
  try {
    subirPostgres({ herdarSaida: false });
  } catch (e) {
    return `Docker rodando, mas o compose não subiu: ${(e as Error).message}`;
  }
  const depois = await postgresDisponivel(cfg, 5_000);
  return depois.ok ? null : `${semPostgres}; o container subiu mas não aceitou conexão (${depois.motivo})`;
}

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | void> {
  const cfg = lerConfig();
  const motivo = await garantirPostgres(cfg);
  if (motivo) {
    if (process.env.MACUXI_PG_EXIGIR === '1') throw new Error(`[db] ${motivo} e MACUXI_PG_EXIGIR=1: testes de banco não podem pular.`);
    process.env[VAR_MOTIVO_PULO] = motivo;
    project.provide('banco', { disponivel: false, motivo });
    return;
  }
  delete process.env[VAR_MOTIVO_PULO];
  const t = await criarBancoDeTeste({ cfg, preparar: (c) => carregarDoisTenants(c).then(() => undefined) });
  project.provide('banco', { disponivel: true, nome: t.nome, urlAdmin: t.urlAdmin, urlApp: t.urlApp });
  return async () => {
    await t.apagar();
  };
}
