/**
 * Prepara o Postgres para os testes de db/ (roda no processo principal do Vitest).
 *
 * 0. Servidor: o Postgres DOS TESTES (lerConfigTestes): macuxi-postgres-testes em localhost:5434 (tmpfs, fsync off),
 *    ou MACUXI_PG_TESTES_URL; com MACUXI_PG_HOST/MACUXI_PG_PORTA no ambiente (CI), o servidor deles. Nunca a demo por padrão.
 * 1. Postgres acessível -> cria um banco efêmero `macuxi_teste_*`, aplica as migrações, carrega a
 *    fixture dois-tenants (+ a do Treinamento, testes/fixture-treinamento.ts) e apaga tudo no fim. Os testes de banco RODAM.
 * 2. Postgres fora do ar, host local e Docker rodando -> sobe SÓ o serviço dele no db/docker-compose.yml (`up -d --wait <serviço>`)
 *    e segue como em 1. Desligue com MACUXI_PG_AUTO_SUBIR=0.
 * 3. Sem Docker/Postgres -> os testes de banco PULAM e o relator (testes/aviso-pulos.ts) imprime no fim
 *    "Docker não está rodando: N testes de banco pulados".
 * Com MACUXI_PG_EXIGIR=1 (CI), o caso 3 é ERRO em vez de pulo.
 * MACUXI_AGORA=<instante ISO> simula o relógio no "hoje" da fixture (prova de que nada depende da hora do dia).
 * O instante da carga vai aos testes no estado (`agora`, ISO): use agoraDaFixture()/hojeDaFixture(fuso) de @macuxi/db/teste.
 */
import type { TestProject } from 'vitest/node';
import { criarBancoDeTeste, postgresDisponivel } from '../src/banco-teste';
import { lerConfigTestes, type ConfigBanco } from '../src/config';
import { dockerRodando, subirPostgres } from '../src/docker';
import { carregarDoisTenants } from '../seeds/fixtures/dois-tenants';
import { carregarTreinamentoDoisTenants } from './fixture-treinamento';
import { agoraDosTestes } from '../src/datas';
import { VAR_MOTIVO_PULO } from './aviso-pulos';

/**
 * Uma tentativa; se falhar por LENTIDÃO (timeout) ou com MACUXI_PG_EXIGIR=1 (CI: turbo roda os globalSetup de todos os
 * pacotes em paralelo contra o mesmo Postgres), tenta de novo com espera crescente por até ~30 s antes de desistir
 * (R-20261102-231119-testes: um timeout de 2 s derrubava o job inteiro). Conexão recusada sem EXIGIR desiste na hora.
 */
async function esperarPostgres(cfg: ConfigBanco): Promise<Awaited<ReturnType<typeof postgresDisponivel>>> {
  let d = await postgresDisponivel(cfg);
  const insistir = (r: typeof d) => !r.ok && (process.env.MACUXI_PG_EXIGIR === '1' || /timeout/i.test(r.motivo));
  const limite = Date.now() + 30_000;
  for (let espera = 1_000; insistir(d) && Date.now() < limite; espera = Math.min(espera * 2, 8_000)) {
    await new Promise((ok) => setTimeout(ok, espera));
    d = await postgresDisponivel(cfg, 5_000);
  }
  return d;
}

/** Motivo pelo qual o banco não está acessível (null = acessível, possivelmente após subir o Docker). */
async function garantirPostgres(cfg: ConfigBanco): Promise<string | null> {
  const d = await esperarPostgres(cfg);
  if (d.ok) return null;
  const semPostgres = `Postgres indisponível em ${cfg.host}:${cfg.porta} (${d.motivo})`;
  // sem serviço do compose (host fora do local, CI, porta avulsa): não há o que subir
  if (!cfg.servicoCompose) return semPostgres;
  const docker = dockerRodando();
  if (!docker.ok) return `Docker não está rodando (${docker.motivo})`;
  if (process.env.MACUXI_PG_AUTO_SUBIR === '0') return `${semPostgres}; Docker rodando, mas MACUXI_PG_AUTO_SUBIR=0`;
  console.info(`[db] Postgres dos testes fora do ar e Docker rodando: subindo o serviço ${cfg.servicoCompose} do db/docker-compose.yml...`);
  try {
    subirPostgres({ herdarSaida: false, servico: cfg.servicoCompose });
  } catch (e) {
    return `Docker rodando, mas o compose não subiu: ${(e as Error).message}`;
  }
  const depois = await postgresDisponivel(cfg, 5_000);
  return depois.ok ? null : `${semPostgres}; o container subiu mas não aceitou conexão (${depois.motivo})`;
}

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | void> {
  const cfg = lerConfigTestes();
  // UM instante para a carga e para os testes (agoraDaFixture() em @macuxi/db/teste); lido uma vez só (B3, T-0042).
  const agora = agoraDosTestes();
  const motivo = await garantirPostgres(cfg);
  if (motivo) {
    if (process.env.MACUXI_PG_EXIGIR === '1') throw new Error(`[db] ${motivo} e MACUXI_PG_EXIGIR=1: testes de banco não podem pular.`);
    process.env[VAR_MOTIVO_PULO] = motivo;
    project.provide('banco', { disponivel: false, motivo, agora: agora.toISOString() });
    return;
  }
  delete process.env[VAR_MOTIVO_PULO];
  // 0017 (T-0058): o schema treinamento tem fixture própria (testes/fixture-treinamento.ts), carregada logo depois
  const t = await criarBancoDeTeste({
    cfg,
    preparar: async (c) => {
      await carregarDoisTenants(c, { agora });
      await carregarTreinamentoDoisTenants(c, { agora });
    },
  });
  project.provide('banco', { disponivel: true, nome: t.nome, urlAdmin: t.urlAdmin, urlApp: t.urlApp, urlWorker: t.urlWorker, agora: agora.toISOString() });
  return async () => {
    await t.apagar();
  };
}
