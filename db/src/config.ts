/**
 * Configuração de conexão do banco (dono: banco-dados).
 * Valores vêm do ambiente (.env na raiz ou db/.env); os padrões abaixo servem SÓ ao Postgres local
 * do db/docker-compose.yml e não são segredo de produção. Ver db/.env.example.
 *
 * Fora do local (host fora de HOSTS_LOCAIS ou NODE_ENV=production) não há padrão de senha: faltar
 * MACUXI_PG_ADMIN_SENHA ou MACUXI_PG_APP_SENHA, ou usar a senha pública local, é ERRO em lerConfig —
 * assim a senha pública nunca é gravada no papel da API (garantirPapelApp) de um banco compartilhado.
 * O papel do worker da outbox (macuxi_worker, ADR 0007) usa MACUXI_PG_WORKER_SENHA: fora do local ela é
 * opcional (sem ela o papel fica NOLOGIN e workerSenha = ''), mas a senha pública local é recusada.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PASTA_DB = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PASTA_RAIZ = join(PASTA_DB, '..');
export const PASTA_MIGRACOES = join(PASTA_DB, 'migrations');

/** Nome fixo do papel de aplicação (as migrações concedem privilégios a ele). */
export const PAPEL_APP = 'macuxi_app';

/** Papel do despachante da outbox (ADR 0007): sem BYPASSRLS, só lê/marca plataforma.evento de todos os tenants. */
export const PAPEL_WORKER = 'macuxi_worker';

export interface ConfigBanco {
  host: string;
  porta: number;
  /** Usuário que aplica migrações e cria bancos/papéis (dono dos objetos). */
  adminUsuario: string;
  adminSenha: string;
  /** Banco de desenvolvimento. */
  banco: string;
  /** Senha do papel de aplicação macuxi_app (sem SUPERUSER, sem BYPASSRLS). */
  appSenha: string;
  /** Senha do papel macuxi_worker ('' = não configurada; o papel fica NOLOGIN). */
  workerSenha: string;
}

/** Senhas públicas do Postgres local (db/docker-compose.yml). Só valem quando ehBancoLocal() é verdadeiro. */
export const SENHA_ADMIN_LOCAL = 'postgres';
export const SENHA_APP_LOCAL = 'macuxi_app_local';
export const SENHA_WORKER_LOCAL = 'macuxi_worker_local';

/**
 * Hosts do Postgres local de desenvolvimento: a máquina do dev e o nome do container do
 * db/docker-compose.yml (rede do compose). É a mesma lista usada por testes/global-setup.ts.
 */
export const HOSTS_LOCAIS: readonly string[] = ['localhost', '127.0.0.1', '::1', 'macuxi-postgres'];

/** Banco local de desenvolvimento? Host em HOSTS_LOCAIS e NODE_ENV diferente de production. */
export function ehBancoLocal(host: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return typeof host === 'string' && HOSTS_LOCAIS.includes(host.trim().toLowerCase());
}

/** Recusa operar com padrão local (senha pública, seed de demonstração) fora do banco local. */
export function exigirBancoLocal(host: string | undefined, oQue: string, env: NodeJS.ProcessEnv = process.env): void {
  if (ehBancoLocal(host, env)) return;
  const onde = env.NODE_ENV === 'production' ? `NODE_ENV=production, host ${host ?? 'desconhecido'}` : `host ${host ?? 'desconhecido'} não é local`;
  throw new Error(`[db] ${oQue} recusado: banco fora do ambiente local (${onde}). Só vale para o Postgres local do db/docker-compose.yml.`);
}

/** Host de um cliente `pg` conectado (pg.Client e PoolClient expõem `host`); undefined se desconhecido. */
export function hostDoCliente(cliente: object): string | undefined {
  const host = (cliente as { host?: unknown }).host;
  return typeof host === 'string' ? host : undefined;
}

let envCarregado = false;

/** Carrega .env da raiz e de db/ (se existirem) sem sobrescrever variáveis já definidas. */
export function carregarEnv(): void {
  if (envCarregado) return;
  envCarregado = true;
  for (const arquivo of [join(PASTA_RAIZ, '.env'), join(PASTA_DB, '.env')]) {
    if (existsSync(arquivo)) process.loadEnvFile(arquivo);
  }
}

export function lerConfig(env: NodeJS.ProcessEnv = process.env): ConfigBanco {
  if (env === process.env) carregarEnv();
  const porta = Number(env.MACUXI_PG_PORTA ?? '5432');
  if (!Number.isInteger(porta) || porta <= 0) throw new Error(`MACUXI_PG_PORTA inválida: ${env.MACUXI_PG_PORTA}`);
  const host = env.MACUXI_PG_HOST || 'localhost';
  if (!ehBancoLocal(host, env)) {
    const onde = env.NODE_ENV === 'production' ? `NODE_ENV=production, host ${host}` : `host ${host} não é local`;
    const faltando = (['MACUXI_PG_ADMIN_SENHA', 'MACUXI_PG_APP_SENHA'] as const).filter((v) => !env[v]);
    if (faltando.length > 0) {
      throw new Error(
        `[db] Banco fora do ambiente local (${onde}): defina ${faltando.join(' e ')} no .env. ` +
          'As senhas padrão só valem para o Postgres local do db/docker-compose.yml.',
      );
    }
    if (env.MACUXI_PG_ADMIN_SENHA === SENHA_ADMIN_LOCAL || env.MACUXI_PG_APP_SENHA === SENHA_APP_LOCAL || env.MACUXI_PG_WORKER_SENHA === SENHA_WORKER_LOCAL) {
      throw new Error(`[db] Banco fora do ambiente local (${onde}): a senha pública do Postgres local não pode ser usada.`);
    }
  }
  return {
    host,
    porta,
    adminUsuario: env.MACUXI_PG_ADMIN_USUARIO || 'postgres',
    adminSenha: env.MACUXI_PG_ADMIN_SENHA || SENHA_ADMIN_LOCAL,
    banco: env.MACUXI_PG_BANCO || 'macuxi',
    appSenha: env.MACUXI_PG_APP_SENHA || SENHA_APP_LOCAL,
    workerSenha: env.MACUXI_PG_WORKER_SENHA || (ehBancoLocal(host, env) ? SENHA_WORKER_LOCAL : ''),
  };
}

function url(usuario: string, senha: string, cfg: ConfigBanco, banco: string): string {
  return `postgres://${encodeURIComponent(usuario)}:${encodeURIComponent(senha)}@${cfg.host}:${cfg.porta}/${encodeURIComponent(banco)}`;
}

/** URL do administrador (migrações, criação de banco). `banco` padrão: o de desenvolvimento. */
export function urlAdmin(cfg: ConfigBanco, banco = cfg.banco): string {
  return url(cfg.adminUsuario, cfg.adminSenha, cfg, banco);
}

/** URL do papel de aplicação — é a que a API e os testes de RLS usam. */
export function urlApp(cfg: ConfigBanco, banco = cfg.banco): string {
  return url(PAPEL_APP, cfg.appSenha, cfg, banco);
}

/** URL do papel do worker da outbox (macuxi_worker, ADR 0007). Exige MACUXI_PG_WORKER_SENHA fora do local. */
export function urlWorker(cfg: ConfigBanco, banco = cfg.banco): string {
  if (!cfg.workerSenha) throw new Error('[db] MACUXI_PG_WORKER_SENHA não definida: o papel macuxi_worker não tem login neste ambiente.');
  return url(PAPEL_WORKER, cfg.workerSenha, cfg, banco);
}

/** Nome de banco válido e seguro para interpolar em DDL (CREATE/DROP DATABASE). */
export function validarNomeBanco(nome: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(nome)) throw new Error(`Nome de banco inválido: "${nome}"`);
  return nome;
}
