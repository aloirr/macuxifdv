/**
 * Configuração de conexão do banco (dono: banco-dados).
 * Valores vêm do ambiente (.env na raiz ou db/.env); os padrões abaixo servem SÓ ao Postgres local
 * do db/docker-compose.yml e não são segredo de produção. Ver db/.env.example.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PASTA_DB = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PASTA_RAIZ = join(PASTA_DB, '..');
export const PASTA_MIGRACOES = join(PASTA_DB, 'migrations');

/** Nome fixo do papel de aplicação (as migrações concedem privilégios a ele). */
export const PAPEL_APP = 'macuxi_app';

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
  return {
    host: env.MACUXI_PG_HOST ?? 'localhost',
    porta,
    adminUsuario: env.MACUXI_PG_ADMIN_USUARIO ?? 'postgres',
    adminSenha: env.MACUXI_PG_ADMIN_SENHA ?? 'postgres',
    banco: env.MACUXI_PG_BANCO ?? 'macuxi',
    appSenha: env.MACUXI_PG_APP_SENHA ?? 'macuxi_app_local',
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

/** Nome de banco válido e seguro para interpolar em DDL (CREATE/DROP DATABASE). */
export function validarNomeBanco(nome: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(nome)) throw new Error(`Nome de banco inválido: "${nome}"`);
  return nome;
}
