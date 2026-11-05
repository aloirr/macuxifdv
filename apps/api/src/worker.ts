/**
 * Processo do despachante da outbox (`pnpm --filter api worker`; ADR 0007, "Implementação (T-0022)").
 * Processo SEPARADO da API: dois pools — `macuxi_worker` (lê e marca `plataforma.evento` de todos os tenants) e
 * `macuxi_app` (licenças e handlers em `comTenant`). Senhas só no `.env` (`MACUXI_PG_WORKER_SENHA`, `MACUXI_PG_APP_SENHA`;
 * no Postgres local do db/docker-compose.yml valem as padrão). Falha fechada: não sobe com papel errado.
 * Variáveis: `MACUXI_DESPACHANTE_INTERVALO_MS` (padrão 1000), `MACUXI_DESPACHANTE_LOTE` (padrão 20),
 * `MACUXI_API_LOG` (nível do log), e as dos handlers (ex.: `MACUXI_PUSH_ATIVO=1` liga o push do Core).
 * T-0078: a cada `MACUXI_METRICAS_INTERVALO_MS` (padrão 5 min; 0 desliga) registra o resumo da outbox (`tipo: metricas`,
 * só contagens) e, se passar do limite (`observabilidade.ts`), a mesma linha em `warn` com `alertas`.
 */
import { lerConfigApp, urlApp, urlWorker } from '@macuxi/db';
import pg from 'pg';
import pino from 'pino';
import { criarBancoApp } from './banco';
import { criarDespachante, LOTE_PADRAO, MAX_TENTATIVAS_PADRAO, verificarPapelWorker } from './despachante';
import { MODULOS_API } from './modulos';
import { mensagemSegura, serializarErro } from './log-seguro';
import { registrarMetricasWorker, SQL_RESUMO_OUTBOX } from './observabilidade';

const cfg = lerConfigApp(); // carrega o .env (raiz e db/); fora do local não exige a senha do admin
const log = pino({ level: process.env.MACUXI_API_LOG ?? 'info', base: { processo: 'despachante' }, serializers: { err: serializarErro } });

// o lote fica travado no worker enquanto os handlers rodam: sem idle_in_transaction curto aqui
const poolWorker = new pg.Pool({ connectionString: urlWorker(cfg), max: 2, options: '-c statement_timeout=30000' });
const poolApp = new pg.Pool({
  connectionString: urlApp(cfg),
  max: Number(process.env.MACUXI_DESPACHANTE_POOL ?? 4),
  options: '-c idle_in_transaction_session_timeout=60000 -c statement_timeout=30000',
});
const app = criarBancoApp(poolApp);

async function principal(): Promise<void> {
  await verificarPapelWorker(poolWorker);
  await app.verificar();
  const despachante = criarDespachante({
    worker: poolWorker,
    app,
    modulos: MODULOS_API,
    lote: Number(process.env.MACUXI_DESPACHANTE_LOTE ?? LOTE_PADRAO),
    log: {
      info: (o, msg) => log.info(o, msg),
      warn: (o, msg) => log.warn(o, msg),
      error: (o, msg) => log.error(o, msg),
    },
  });
  log.info({ eventos: despachante.eventos() }, 'despachante no ar');
  const execucao = despachante.iniciar({ intervaloMs: Number(process.env.MACUXI_DESPACHANTE_INTERVALO_MS ?? 1_000) });
  const registrarMetricas = () =>
    registrarMetricasWorker(async () => (await poolWorker.query(SQL_RESUMO_OUTBOX, [despachante.eventos(), MAX_TENTATIVAS_PADRAO])).rows[0], log);
  const intervaloMetricas = Number(process.env.MACUXI_METRICAS_INTERVALO_MS ?? 300_000);
  const timerMetricas = intervaloMetricas > 0 ? setInterval(() => void registrarMetricas(), intervaloMetricas) : undefined;
  timerMetricas?.unref();
  const encerrar = async () => {
    if (timerMetricas) clearInterval(timerMetricas);
    await execucao.parar();
    await Promise.all([poolWorker.end(), poolApp.end()]);
    process.exit(0);
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

principal().catch(async (e: unknown) => {
  log.error({ erro: mensagemSegura(e) }, 'o despachante não subiu');
  await Promise.all([poolWorker.end(), poolApp.end()]).catch(() => undefined);
  process.exit(1);
});
