/**
 * Sobe a API (`pnpm --filter api dev`). Porta `MACUXI_API_PORTA` (padrão 8100; o mock-api da Fase M fica na 8000
 * até a API cobrir as rotas). Conecta com o papel `macuxi_app` (`urlApp` do @macuxi/db, senha só no `.env`).
 * Segredo do JWT do Core: `MACUXI_JWT_SEGREDO` (mín. 32 caracteres, só no .env). Fora do ambiente local a API não sobe
 * sem ele (falha fechada); no local sobe com aviso e o login responde 503 (`config.ts`).
 * Fotos (ADR 0010): bytes no disco em `MACUXI_ARQUIVOS_DIR` (padrão `./.dados/arquivos`, relativo à pasta da API; fora
 * do git), ou num bucket S3 com `MACUXI_ARQUIVOS_DRIVER=s3` e `MACUXI_S3_*` (ADR 0020, `armazenamento-s3.ts`; demo na Magalu).
 * Hub do Conector (ADR 0013): `MACUXI_HUB_CHAVE_PEPPER` (≥ 32 bytes) lido pelo módulo Integração; sem ele as rotas
 * `/integracao/v1` respondem 503 (falha fechada).
 * Atrás de proxy/túnel: `MACUXI_TRUST_PROXY` (`config.ts`, `lerTrustProxy`) para o IP real valer nos limites por IP.
 * T-0078: a cada `MACUXI_METRICAS_INTERVALO_MS` (padrão 5 min; 0 desliga) registra no log a linha `tipo: metricas` do
 * `/v1/saude` (5xx da janela, outbox, alertas), em `warn` quando há alerta. Cada linha de requisição já leva `request_id`.
 * T-0091 (condição da ADR 0029): com `MACUXI_PG_PORTAL_SENHA`, abre o 2º pool (papel `macuxi_portal`, `MACUXI_API_POOL_PORTAL`
 * conexões, padrão 2) só para a sessão do super-admin; conferido na subida (`criarBancoPortal().verificar`). Sem a senha, a API
 * sobe com aviso, o portal responde 503 `PORTAL_INDISPONIVEL` e os tenants seguem normais. Na VM a senha vem do `portal.env`
 * (só o contêiner `api` e o passo de papéis do `banco` recebem; o worker nunca).
 * T-0098 (ADR 0037): com S3, o link temporário do instalador do Conector sai do mesmo bucket, em `MACUXI_PACOTES_PREFIXO`
 * (padrão `pacotes/`), válido por `MACUXI_PACOTES_VALIDADE_S` (padrão 300 s); sem S3, a rota do download responde 503.
 */
import { lerConfigApp, urlApp, urlPortal } from '@macuxi/db';
import pg from 'pg';
import { createApp } from './app';
import { lerArmazenamentoDoAmbiente } from './armazenamento-s3';
import { lerPacotesDoAmbiente } from './pacotes';
import { criarBancoApp, criarBancoPortal, POOL_PORTAL_PADRAO } from './banco';
import { conferirSegredoJwt, lerSessaoWeb, lerTrustProxy, opcoesLogger } from './config';
import { criarServicoEmailDaConfig, lerConfigEmail, type ConfigEmail } from './email';
import { registrarMetricasApi } from './observabilidade';

const cfg = lerConfigApp(); // carrega o .env (raiz e db/) antes de ler as variáveis abaixo; fora do local não exige a senha do admin
const segredoJwt = conferirSegredoJwt(process.env, cfg.host);
if (!segredoJwt.ok && segredoJwt.fatal) {
  console.error(`[api] ${segredoJwt.mensagem}`);
  process.exit(1);
}
let arquivos: ReturnType<typeof lerArmazenamentoDoAmbiente>;
let pacotes: ReturnType<typeof lerPacotesDoAmbiente>;
try {
  arquivos = lerArmazenamentoDoAmbiente(process.env);
  pacotes = lerPacotesDoAmbiente(process.env); // T-0098: variáveis conferidas na subida (falha fechada)
} catch (e) {
  console.error(`[api] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
// T-0094: e-mail transacional (porta da outbox; o despachante roda no worker). Configuração inválida = não sobe (falha fechada)
let configEmail: ConfigEmail;
try {
  configEmail = lerConfigEmail(process.env);
} catch (e) {
  console.error(`[api] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
const pool = new pg.Pool({
  connectionString: urlApp(cfg),
  max: Number(process.env.MACUXI_API_POOL ?? 10),
  // transação esquecida aberta seguraria o horizonte do pull (desenho T-0004 §5): o Postgres derruba em 60 s
  options: '-c idle_in_transaction_session_timeout=60000 -c statement_timeout=30000',
});

// T-0091: sessão do super-admin num papel próprio; transação curta (o portal só chama funções `sa_*`)
const poolPortal = cfg.portalSenha
  ? new pg.Pool({
      connectionString: urlPortal(cfg),
      max: Number(process.env.MACUXI_API_POOL_PORTAL ?? POOL_PORTAL_PADRAO),
      options: '-c idle_in_transaction_session_timeout=10000 -c statement_timeout=10000',
    })
  : null;

const app = createApp({
  banco: criarBancoApp(pool),
  bancoPortal: poolPortal ? criarBancoPortal(poolPortal) : null,
  arquivos: arquivos.armazenamento,
  email: (log) => criarServicoEmailDaConfig(configEmail, log),
  pacotes: (log) => pacotes.criar(log),
  trustProxy: lerTrustProxy(process.env),
  // T-0117 (ADR 0038): cookie do token de renovação do BKO (Secure fora do PC)
  sessaoWeb: lerSessaoWeb(process.env, cfg.host),
  // sem dado pessoal em log (CLAUDE.md regra 8): nada de cabeçalhos, IP, query string ou corpo; chave do Conector redigida
  logger: opcoesLogger(process.env.MACUXI_API_LOG ?? 'info'),
});

if (!segredoJwt.ok) app.log.warn(segredoJwt.mensagem);
if (!poolPortal) app.log.warn('MACUXI_PG_PORTAL_SENHA não definida: o portal de implantação responde 503; os tenants seguem normais (T-0091).');
app.log.info({ armazenamento: arquivos.descricao, pacotes: pacotes.descricao }, 'armazenamento de arquivos');

const porta = Number(process.env.MACUXI_API_PORTA ?? 8100);
const host = process.env.MACUXI_API_HOST ?? '127.0.0.1';

/** Mesma leitura do monitor externo: o `/v1/saude` (sonda com cache e prazo) vira uma linha de log (`observabilidade.ts`). */
const registrarMetricas = () => registrarMetricasApi(app, app.log);
const intervaloMetricas = Number(process.env.MACUXI_METRICAS_INTERVALO_MS ?? 300_000);
const timerMetricas = intervaloMetricas > 0 ? setInterval(() => void registrarMetricas(), intervaloMetricas) : undefined;
timerMetricas?.unref();

const encerrar = async () => {
  if (timerMetricas) clearInterval(timerMetricas);
  await app.close();
  await pool.end();
  await poolPortal?.end();
  process.exit(0);
};
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);

app.listen({ port: porta, host }).catch(async (e: unknown) => {
  app.log.error({ err: e }, 'a API não subiu');
  await pool.end().catch(() => undefined);
  await poolPortal?.end().catch(() => undefined);
  process.exit(1);
});
