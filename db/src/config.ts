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
 * O papel do portal do super-admin (macuxi_portal, 0038, T-0091, ADR 0029) usa MACUXI_PG_PORTAL_SENHA com a mesma regra do
 * worker: opcional fora do local (sem ela, NOLOGIN e portalSenha = ''; urlPortal lança e a API responde 503 no portal), senha
 * pública local recusada. Só a API e o passo de papéis recebem essa senha (portal.env da VM), nunca o worker.
 * API e worker usam lerConfigApp: fora do local não exigem MACUXI_PG_ADMIN_SENHA (o contêiner não recebe a senha do
 * admin; urlAdmin falha se for chamada). Migrações, papéis e seeds seguem com lerConfig (admin obrigatório).
 * Seed da base de DEMONSTRAÇÃO num servidor (VM da demo, ADR 0020 §5): só com MACUXI_AMBIENTE=demo (exigirBancoDemo).
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

/**
 * Papel do portal do super-admin (0038, T-0091, ADR 0029): o ÚNICO com EXECUTE nas plataforma.sa_*; sem grant de tabela, sem
 * filiação, sem SUPERUSER/BYPASSRLS. Só o 2º pool da API (rotas plataforma/*, sessão e auditoria do super-admin) conecta com ele.
 */
export const PAPEL_PORTAL = 'macuxi_portal';

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
  /** Senha do papel macuxi_portal ('' = não configurada; o papel fica NOLOGIN e urlPortal lança). */
  portalSenha: string;
  /**
   * Serviço do db/docker-compose.yml que atende este endereço (o globalSetup sobe só ele se estiver parado):
   * 'postgres' (demo/dev, 5432) ou 'postgres-testes' (testes, 5434). Ausente = não subir nada pelo compose.
   */
  servicoCompose?: ServicoCompose;
}

export type ServicoCompose = 'postgres' | 'postgres-testes';

/** Porta padrão do Postgres dos testes (serviço postgres-testes do db/docker-compose.yml, container macuxi-postgres-testes). */
export const PORTA_TESTES_PADRAO = 5434;

/** Senhas públicas do Postgres local (db/docker-compose.yml). Só valem quando ehBancoLocal() é verdadeiro. */
export const SENHA_ADMIN_LOCAL = 'postgres';
export const SENHA_APP_LOCAL = 'macuxi_app_local';
export const SENHA_WORKER_LOCAL = 'macuxi_worker_local';
export const SENHA_PORTAL_LOCAL = 'macuxi_portal_local';

/**
 * Hosts do Postgres local de desenvolvimento: a máquina do dev e o nome do container do
 * db/docker-compose.yml (rede do compose). É a mesma lista usada por testes/global-setup.ts.
 */
export const HOSTS_LOCAIS: readonly string[] = ['localhost', '127.0.0.1', '::1', 'macuxi-postgres', 'macuxi-postgres-testes'];

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

/** Valor de MACUXI_AMBIENTE que libera o seed da base de demonstração (dados fictícios) fora do Postgres local. */
export const AMBIENTE_DEMO = 'demo';

/**
 * Seed da base de DEMONSTRAÇÃO (tenant demo, dados fictícios): aceita o Postgres local OU um servidor marcado
 * explicitamente com MACUXI_AMBIENTE=demo (a VM da demo, ADR 0020 §5), mesmo com NODE_ENV=production. Só o valor
 * exato "demo" vale. Não libera a senha pública dos papéis (lerConfig segue exigindo senhas próprias fora do local)
 * nem o seed da Fase M, nem a fixture dos testes, que continuam só no local (exigirBancoLocal).
 */
export function exigirBancoDemo(host: string | undefined, oQue: string, env: NodeJS.ProcessEnv = process.env): void {
  if (env.MACUXI_AMBIENTE === AMBIENTE_DEMO) return;
  if (ehBancoLocal(host, env)) return;
  const onde = env.NODE_ENV === 'production' ? `NODE_ENV=production, host ${host ?? 'desconhecido'}` : `host ${host ?? 'desconhecido'} não é local`;
  throw new Error(
    `[db] ${oQue} recusado: banco fora do ambiente local (${onde}). Só vale para o Postgres local do db/docker-compose.yml ` +
      `ou para o servidor da demo com MACUXI_AMBIENTE=${AMBIENTE_DEMO}.`,
  );
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

/** Configuração de quem administra o banco (migrações, papéis, seeds): fora do local exige a senha do admin. */
export function lerConfig(env: NodeJS.ProcessEnv = process.env): ConfigBanco {
  return lerConfigInterno(env, true);
}

/**
 * Configuração da API e do worker (só urlApp/urlWorker): fora do local MACUXI_PG_ADMIN_SENHA é OPCIONAL, para o
 * contêiner da aplicação não precisar da senha do admin. Sem ela, adminSenha = '' e urlAdmin lança. As demais travas
 * são as de lerConfig (MACUXI_PG_APP_SENHA obrigatória; senha pública local recusada, inclusive a do admin se vier).
 */
export function lerConfigApp(env: NodeJS.ProcessEnv = process.env): ConfigBanco {
  return lerConfigInterno(env, false);
}

function lerConfigInterno(env: NodeJS.ProcessEnv, exigirAdmin: boolean): ConfigBanco {
  if (env === process.env) carregarEnv();
  const porta = Number(env.MACUXI_PG_PORTA ?? '5432');
  if (!Number.isInteger(porta) || porta <= 0) throw new Error(`MACUXI_PG_PORTA inválida: ${env.MACUXI_PG_PORTA}`);
  const host = env.MACUXI_PG_HOST || 'localhost';
  const local = ehBancoLocal(host, env);
  if (!local) {
    const onde = env.NODE_ENV === 'production' ? `NODE_ENV=production, host ${host}` : `host ${host} não é local`;
    const exigidas = exigirAdmin ? (['MACUXI_PG_ADMIN_SENHA', 'MACUXI_PG_APP_SENHA'] as const) : (['MACUXI_PG_APP_SENHA'] as const);
    const faltando = exigidas.filter((v) => !env[v]);
    if (faltando.length > 0) {
      throw new Error(
        `[db] Banco fora do ambiente local (${onde}): defina ${faltando.join(' e ')} no .env. ` +
          'As senhas padrão só valem para o Postgres local do db/docker-compose.yml.',
      );
    }
    if (
      env.MACUXI_PG_ADMIN_SENHA === SENHA_ADMIN_LOCAL ||
      env.MACUXI_PG_APP_SENHA === SENHA_APP_LOCAL ||
      env.MACUXI_PG_WORKER_SENHA === SENHA_WORKER_LOCAL ||
      env.MACUXI_PG_PORTAL_SENHA === SENHA_PORTAL_LOCAL
    ) {
      throw new Error(`[db] Banco fora do ambiente local (${onde}): a senha pública do Postgres local não pode ser usada.`);
    }
  }
  return {
    host,
    porta,
    adminUsuario: env.MACUXI_PG_ADMIN_USUARIO || 'postgres',
    adminSenha: env.MACUXI_PG_ADMIN_SENHA || (local ? SENHA_ADMIN_LOCAL : ''),
    banco: env.MACUXI_PG_BANCO || 'macuxi',
    appSenha: env.MACUXI_PG_APP_SENHA || SENHA_APP_LOCAL,
    workerSenha: env.MACUXI_PG_WORKER_SENHA || (local ? SENHA_WORKER_LOCAL : ''),
    portalSenha: env.MACUXI_PG_PORTAL_SENHA || (local ? SENHA_PORTAL_LOCAL : ''),
  };
}

/**
 * Configuração do Postgres dos TESTES (globalSetup, criarBancoDeTeste, medir-sync). Separado do da demo desde 02/11:
 * a carga dos testes derrubava o macuxi-postgres (5432) que serve a demo. Ordem de decisão:
 * 1. MACUXI_PG_TESTES_URL (postgres://usuario:senha@host:porta[/qualquer]) — endereço explícito dos testes;
 * 2. MACUXI_PG_HOST ou MACUXI_PG_PORTA definidos no ambiente (CI: service container na 5432; varrer-relogio: porta 1)
 *    → o mesmo servidor de lerConfig, como antes (compatível com o workflow, que não define a variável nova);
 * 3. padrão local: localhost:MACUXI_PG_TESTES_PORTA (5434), o container macuxi-postgres-testes.
 * Usuário/senha do admin e senhas dos papéis seguem as mesmas de lerConfig (e as mesmas travas fora do local).
 */
export function lerConfigTestes(env: NodeJS.ProcessEnv = process.env): ConfigBanco {
  if (env === process.env) carregarEnv();
  const urlTestes = env.MACUXI_PG_TESTES_URL?.trim();
  if (urlTestes) {
    let u: URL;
    try {
      u = new URL(urlTestes);
    } catch {
      throw new Error('[db] MACUXI_PG_TESTES_URL inválida (esperado postgres://usuario:senha@host:porta).');
    }
    if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('[db] MACUXI_PG_TESTES_URL precisa começar com postgres://');
    const host = u.hostname.replace(/^\[(.*)\]$/, '$1');
    const cfg = lerConfig({
      ...env,
      MACUXI_PG_HOST: host,
      MACUXI_PG_PORTA: u.port || '5432',
      MACUXI_PG_ADMIN_USUARIO: u.username ? decodeURIComponent(u.username) : env.MACUXI_PG_ADMIN_USUARIO,
      MACUXI_PG_ADMIN_SENHA: u.password ? decodeURIComponent(u.password) : env.MACUXI_PG_ADMIN_SENHA,
    });
    return { ...cfg, servicoCompose: servicoDaPorta(cfg, env) };
  }
  if (env.MACUXI_PG_HOST || env.MACUXI_PG_PORTA) {
    const cfg = lerConfig(env);
    return { ...cfg, servicoCompose: servicoDaPorta(cfg, env) };
  }
  const porta = env.MACUXI_PG_TESTES_PORTA ?? String(PORTA_TESTES_PADRAO);
  const cfg = lerConfig({ ...env, MACUXI_PG_HOST: 'localhost', MACUXI_PG_PORTA: porta });
  return { ...cfg, servicoCompose: 'postgres-testes' };
}

/** Qual serviço do compose atende um endereço local (null/undefined = nenhum; ex.: CI ou porta arbitrária). */
function servicoDaPorta(cfg: ConfigBanco, env: NodeJS.ProcessEnv): ServicoCompose | undefined {
  if (!ehBancoLocal(cfg.host, env)) return undefined;
  if (cfg.porta === Number(env.MACUXI_PG_TESTES_PORTA ?? PORTA_TESTES_PADRAO)) return 'postgres-testes';
  if (cfg.porta === Number(env.MACUXI_PG_PORTA ?? '5432')) return 'postgres';
  return undefined;
}

function url(usuario: string, senha: string, cfg: ConfigBanco, banco: string): string {
  return `postgres://${encodeURIComponent(usuario)}:${encodeURIComponent(senha)}@${cfg.host}:${cfg.porta}/${encodeURIComponent(banco)}`;
}

/** URL do administrador (migrações, criação de banco). `banco` padrão: o de desenvolvimento. */
export function urlAdmin(cfg: ConfigBanco, banco = cfg.banco): string {
  if (!cfg.adminSenha) throw new Error('[db] MACUXI_PG_ADMIN_SENHA não definida: esta configuração (lerConfigApp) não administra o banco.');
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

/**
 * URL do papel do portal do super-admin (macuxi_portal, 0038, T-0091): o 2º pool da API. Exige MACUXI_PG_PORTAL_SENHA fora do
 * local; sem ela lança (a API sobe sem o pool e o portal responde 503: falha fechada).
 */
export function urlPortal(cfg: ConfigBanco, banco = cfg.banco): string {
  if (!cfg.portalSenha) {
    throw new Error('[db] MACUXI_PG_PORTAL_SENHA não definida: o papel macuxi_portal não tem login neste ambiente (portal do super-admin indisponível).');
  }
  return url(PAPEL_PORTAL, cfg.portalSenha, cfg, banco);
}

/** Nome de banco válido e seguro para interpolar em DDL (CREATE/DROP DATABASE). */
export function validarNomeBanco(nome: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(nome)) throw new Error(`Nome de banco inválido: "${nome}"`);
  return nome;
}
