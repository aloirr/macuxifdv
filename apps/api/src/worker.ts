/**
 * Processo do despachante da outbox (`pnpm --filter api worker`; ADR 0007, "Implementação (T-0022)").
 * Processo SEPARADO da API: dois pools — `macuxi_worker` (lê e marca `plataforma.evento` de todos os tenants) e
 * `macuxi_app` (licenças e handlers em `comTenant`). Senhas só no `.env` (`MACUXI_PG_WORKER_SENHA`, `MACUXI_PG_APP_SENHA`;
 * no Postgres local do db/docker-compose.yml valem as padrão). Falha fechada: não sobe com papel errado.
 * Variáveis: `MACUXI_DESPACHANTE_INTERVALO_MS` (padrão 1000), `MACUXI_DESPACHANTE_LOTE` (padrão 20),
 * `MACUXI_API_LOG` (nível do log), e as dos handlers (ex.: `MACUXI_PUSH_ATIVO=1` liga o push do Core).
 * T-0078: a cada `MACUXI_METRICAS_INTERVALO_MS` (padrão 5 min; 0 desliga) registra o resumo da outbox (`tipo: metricas`,
 * só contagens) e, se passar do limite (`observabilidade.ts`), a mesma linha em `warn` com `alertas`.
 * ADR 0022: o agendador das tarefas periódicas dos módulos (`ModuloApi.tarefas`, a cada 15 min, por tenant ativo) roda
 * aqui também; os tenants vêm de `plataforma.tenants_ativos()` (papel `macuxi_worker`). Sem a função no banco (migração
 * ainda não aplicada) ou sem tarefa instalada, o agendador não liga e o despachante segue.
 * T-0094 (ADR 0032; desenho §10 item 3): o despachante da outbox de e-mail (`plataforma.email_saida`) roda aqui também, no mesmo
 * pool do `macuxi_worker`, com o adaptador da configuração (`MACUXI_SMTP_*` ou `MACUXI_EMAIL_ARQUIVO_DIR`; chave HKDF do
 * `MACUXI_JWT_SEGREDO`, o mesmo da API). Sem adaptador: desligado. Variável: `MACUXI_EMAIL_INTERVALO_MS` (padrão 5000).
 * T-0158 (ADR 0043; `diagnosticos-worker.ts`): com `MACUXI_DIAGNOSTICOS=1` (padrão DESLIGADO) e a migração 0058 no banco, o
 * alerta (recado automático do remetente `diagnostico`, só com `MACUXI_RECADOS_TOKEN_SERVIDOR`; sem ele as linhas viram
 * `desligado`) e o expurgo de 90 dias rodam aqui também. `MACUXI_DIAGNOSTICOS_INTERVALO_MS` (padrão 60000) e
 * `MACUXI_DIAGNOSTICOS_PORTAL_URL` (link do recado; padrão https://config.macuxifdv.com.br).
 */
import { lerConfigApp, urlApp, urlWorker } from '@macuxi/db';
import pg from 'pg';
import pino from 'pino';
import { criarAgendador } from './agendador';
import type { ArmazenamentoArquivos } from './arquivos';
import { lerArmazenamentoDoAmbiente } from './armazenamento-s3';
import { diagnosticosLigados } from './config';
import { criarWorkerDiagnosticos, SQL_EXISTE_0058, URL_PORTAL_PADRAO } from './diagnosticos-worker';
import { criarBancoApp } from './banco';
import { criarDespachante, LOTE_PADRAO, MAX_TENTATIVAS_PADRAO, verificarPapelWorker } from './despachante';
import { criarCifraEmail, criarDespachanteEmail, criarTransporteDaConfig, descreverConfigEmail, lerConfigEmail } from './email';
import { MODULOS_API } from './modulos';
import { mensagemSegura, serializarErro } from './log-seguro';
import { registrarMetricasWorker, SQL_RESUMO_OUTBOX } from './observabilidade';
import { criarClienteRecadosGithub } from './recados-github';

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
  const agendamento = await iniciarAgendador();
  const envioEmail = iniciarEmail();
  const diagnosticos = await iniciarDiagnosticos();
  const encerrar = async () => {
    if (timerMetricas) clearInterval(timerMetricas);
    await agendamento?.parar();
    await envioEmail?.parar();
    await diagnosticos?.parar();
    await execucao.parar();
    await Promise.all([poolWorker.end(), poolApp.end()]);
    process.exit(0);
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

/** T-0094: despachante da outbox de e-mail (falha fechada: configuração inválida derruba o worker na subida). */
function iniciarEmail(): { parar(): Promise<void> } | undefined {
  const logEmail = {
    info: (o: Record<string, unknown>, msg?: string) => log.info(o, msg),
    warn: (o: Record<string, unknown>, msg?: string) => log.warn(o, msg),
    error: (o: Record<string, unknown>, msg?: string) => log.error(o, msg),
  };
  const config = lerConfigEmail(process.env);
  log.info({ tipo: 'email', ...descreverConfigEmail(config), avisos: config.avisos }, 'e-mail transacional');
  const transporte = criarTransporteDaConfig(config, { log: logEmail });
  if (!transporte) return undefined;
  const despachante = criarDespachanteEmail({ worker: poolWorker, transporte, cifra: criarCifraEmail(config.chave), remetente: config.remetente, log: logEmail });
  return despachante.iniciar({ intervaloMs: Number(process.env.MACUXI_EMAIL_INTERVALO_MS ?? 5_000) });
}

/**
 * T-0158: alerta e expurgo dos diagnósticos. Desligado sem `MACUXI_DIAGNOSTICOS=1` ou sem a 0058 no banco (o despachante segue).
 * O token do repositório de recados fica só na memória deste processo (nunca em log).
 */
async function iniciarDiagnosticos(): Promise<{ parar(): Promise<void> } | undefined> {
  if (!diagnosticosLigados(process.env)) return undefined;
  const existe = await poolWorker.query<{ ok: boolean }>(SQL_EXISTE_0058);
  if (!existe.rows[0]?.ok) {
    log.warn({ tipo: 'diagnostico' }, 'diagnósticos desligados: falta a migração 0058 no banco');
    return undefined;
  }
  const token = (process.env.MACUXI_RECADOS_TOKEN_SERVIDOR ?? '').trim();
  const logDiag = {
    info: (o: Record<string, unknown>, msg?: string) => log.info(o, msg),
    warn: (o: Record<string, unknown>, msg?: string) => log.warn(o, msg),
    error: (o: Record<string, unknown>, msg?: string) => log.error(o, msg),
  };
  let armazenamento: ArmazenamentoArquivos | null = null;
  try {
    armazenamento = lerArmazenamentoDoAmbiente(process.env).armazenamento;
  } catch (e) {
    // sem armazenamento o expurgo apaga as linhas e não os bytes: avisa e segue (o despachante não cai por isso)
    log.warn({ tipo: 'diagnostico', erro: mensagemSegura(e) }, 'diagnósticos sem armazenamento de arquivos: o expurgo não remove os bytes dos prints');
  }
  const w = criarWorkerDiagnosticos({
    worker: poolWorker,
    recados: token ? criarClienteRecadosGithub({ token }) : null,
    armazenamento,
    urlPortal: process.env.MACUXI_DIAGNOSTICOS_PORTAL_URL?.trim() || URL_PORTAL_PADRAO,
    log: logDiag,
  });
  log.info({ tipo: 'diagnostico', alerta: token ? 'ligado' : 'desligado' }, 'diagnósticos no ar (alerta e expurgo)');
  return w.iniciar({ intervaloMs: Number(process.env.MACUXI_DIAGNOSTICOS_INTERVALO_MS ?? 60_000) });
}

/** ADR 0022: liga o agendador se houver tarefa instalada e a função de tenants ativos existir no banco. */
async function iniciarAgendador(): Promise<{ parar(): Promise<void> } | undefined> {
  const agendador = criarAgendador({
    app,
    modulos: MODULOS_API,
    tenantsAtivos: async () => (await poolWorker.query<{ id: string }>('select id from plataforma.tenants_ativos()')).rows.map((r) => r.id),
    log: {
      info: (o, msg) => log.info(o, msg),
      warn: (o, msg) => log.warn(o, msg),
      error: (o, msg) => log.error(o, msg),
    },
  });
  if (agendador.tarefas().length === 0) return undefined;
  const existe = await poolWorker.query<{ ok: boolean }>("select to_regprocedure('plataforma.tenants_ativos()') is not null as ok");
  if (!existe.rows[0]?.ok) {
    log.warn({ tarefas: agendador.tarefas() }, 'agendador desligado: falta plataforma.tenants_ativos() no banco');
    return undefined;
  }
  log.info({ tarefas: agendador.tarefas() }, 'agendador no ar');
  return agendador.iniciar();
}

principal().catch(async (e: unknown) => {
  log.error({ erro: mensagemSegura(e) }, 'o despachante não subiu');
  await Promise.all([poolWorker.end(), poolApp.end()]).catch(() => undefined);
  process.exit(1);
});
