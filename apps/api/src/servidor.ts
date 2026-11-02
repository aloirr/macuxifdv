/**
 * Sobe a API (`pnpm --filter api dev`). Porta `MACUXI_API_PORTA` (padrão 8100; o mock-api da Fase M fica na 8000
 * até a API cobrir as rotas). Conecta com o papel `macuxi_app` (`urlApp` do @macuxi/db, senha só no `.env`).
 * Segredo do JWT do Core: `MACUXI_JWT_SEGREDO` (mín. 32 caracteres, só no .env). Fora do ambiente local a API não sobe
 * sem ele (falha fechada); no local sobe com aviso e o login responde 503 (`config.ts`).
 * Fotos (ADR 0010): bytes no disco em `MACUXI_ARQUIVOS_DIR` (padrão `./.dados/arquivos`, relativo à pasta da API; fora
 * do git). Em servidor, aponte para um volume que entra no backup.
 * Hub do Conector (ADR 0013): `MACUXI_HUB_CHAVE_PEPPER` (≥ 32 bytes) lido pelo módulo Integração; sem ele as rotas
 * `/integracao/v1` respondem 503 (falha fechada).
 * Atrás de proxy/túnel: `MACUXI_TRUST_PROXY` (`config.ts`, `lerTrustProxy`) para o IP real valer nos limites por IP.
 */
import { lerConfig, urlApp } from '@macuxi/db';
import pg from 'pg';
import { createApp } from './app';
import { criarArmazenamentoEmDisco, DIR_ARQUIVOS_PADRAO } from './arquivos';
import { criarBancoApp } from './banco';
import { conferirSegredoJwt, lerTrustProxy, opcoesLogger } from './config';

const cfg = lerConfig(); // carrega o .env (raiz e db/) antes de ler as variáveis abaixo
const segredoJwt = conferirSegredoJwt(process.env, cfg.host);
if (!segredoJwt.ok && segredoJwt.fatal) {
  console.error(`[api] ${segredoJwt.mensagem}`);
  process.exit(1);
}
const pool = new pg.Pool({
  connectionString: urlApp(cfg),
  max: Number(process.env.MACUXI_API_POOL ?? 10),
  // transação esquecida aberta seguraria o horizonte do pull (desenho T-0004 §5): o Postgres derruba em 60 s
  options: '-c idle_in_transaction_session_timeout=60000 -c statement_timeout=30000',
});

const app = createApp({
  banco: criarBancoApp(pool),
  arquivos: criarArmazenamentoEmDisco(process.env.MACUXI_ARQUIVOS_DIR || DIR_ARQUIVOS_PADRAO),
  trustProxy: lerTrustProxy(process.env),
  // sem dado pessoal em log (CLAUDE.md regra 8): nada de cabeçalhos, IP, query string ou corpo; chave do Conector redigida
  logger: opcoesLogger(process.env.MACUXI_API_LOG ?? 'info'),
});

if (!segredoJwt.ok) app.log.warn(segredoJwt.mensagem);

const porta = Number(process.env.MACUXI_API_PORTA ?? 8100);
const host = process.env.MACUXI_API_HOST ?? '127.0.0.1';

const encerrar = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);

app.listen({ port: porta, host }).catch(async (e: unknown) => {
  app.log.error({ err: e }, 'a API não subiu');
  await pool.end().catch(() => undefined);
  process.exit(1);
});
