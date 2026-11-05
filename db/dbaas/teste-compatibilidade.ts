/**
 * Teste de compatibilidade do DBaaS PostgreSQL da Magalu (T-0075; dono: banco-dados). Parte que roda DENTRO de um
 * contêiner descartável da imagem da API (node 24 + tsx + pg + o @macuxi/db do commit), chamada pelo
 * db/dbaas/teste-compatibilidade.sh na VM da demo. Fala SÓ com o DBaaS (DBAAS_HOST:DBAAS_PORTA); recusa host local.
 *
 *   node --import tsx db/dbaas/teste-compatibilidade.ts            teste completo (relatório + limpeza)
 *   node --import tsx db/dbaas/teste-compatibilidade.ts --so-limpar  só apaga as bases macuxi_dbaas_* e macuxi_teste_*
 *
 * Ambiente: DBAAS_HOST, DBAAS_PORTA (5432), DBAAS_USUARIO (macuxi_admin), DBAAS_BANCO (postgres), DBAAS_SSLMODE
 * (prefer|require|verify-full|disable), DBAAS_MIGRAR_ATE (0027), DBAAS_SUITE (1; 0 pula a suíte), DBAAS_VITEST_WORKERS (2),
 * DBAAS_TEMPO_SUITE_MIN (16), DBAAS_HNSW_LINHAS (5000), DBAAS_HNSW_DIM (1536), DBAAS_SAIDA_CONTEINER (/saida),
 * DBAAS_RELATORIO_CONTEINER (/saida/relatorio.md), DBAAS_DONO (uid:gid dos arquivos de saída), DBAAS_IMAGEM (só para o
 * relatório). Senha do admin: 1ª linha do stdin com DBAAS_SENHA_STDIN=1 (o .sh usa assim) ou DBAAS_SENHA.
 * As senhas de macuxi_app e macuxi_worker são geradas aqui, só na memória (os papéis ficam na instância temporária).
 *
 * Saída: linhas ✅/❌ no stdout, relatório Markdown no DBAAS_RELATORIO_CONTEINER e, na mesma pasta, suite.json e
 * suite.log (mascarados). Nunca imprime senha nem URL com senha (mascarar) nem dado pessoal (só dados fictícios da demo,
 * e nem esses: só contagens). Código de saída: SAIDA em ./relatorio.ts.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chownSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { apagarBanco, criarBanco } from '../src/banco-teste';
import { HOSTS_LOCAIS, lerConfig, PASTA_DB, PASTA_RAIZ, urlAdmin, urlApp, urlWorker, validarNomeBanco, type ConfigBanco } from '../src/config';
import { lerMigracoes, listarAplicadas, migrarUp } from '../src/migrador';
import { diagnosticarPapelApp, garantirPapelApp, garantirPapelWorker } from '../src/papeis';
import { carregarDemo, TENANT_DEMO } from '../seeds/demo/demo';
import {
  classificarErroConexao,
  formatarItem,
  formatarMs,
  indicesDoPlano,
  mascarar,
  montarMarkdown,
  nomeBaseTeste,
  percentil,
  primeiraLinhaUtil,
  problemasSearchPath,
  resumir,
  resumirVitest,
  SAIDA,
  searchPathDoProconfig,
  tentativasTls,
  versaoAtende,
  versaoVitestDoLock,
  type Grupo,
  type Item,
} from './relatorio';

const env = process.env;
const PASTA_DBAAS = dirname(fileURLToPath(import.meta.url));
const PREFIXO_VITEST = '/tmp/macuxi-vitest';
const EXTENSOES_DE_INTERESSE = ['vector', 'pg_stat_statements', 'pgcrypto', 'pg_trgm', 'unaccent', 'citext', 'uuid-ossp', 'btree_gin', 'btree_gist'];
const PARAMETROS = ['max_connections', 'shared_buffers', 'work_mem', 'maintenance_work_mem', 'effective_cache_size', 'TimeZone', 'server_encoding', 'password_encryption', 'ssl', 'shared_preload_libraries'];
/** Falha de teste causada pela trava de ambiente local do @macuxi/db (seed da Fase M, senha pública), não pelo DBaaS. */
const TRAVA_LOCAL = /fora do ambiente local/i;

const itens: Item[] = [];
let segredos: string[] = [];
const m = (t: string): string => mascarar(t, segredos);
const msgErro = (e: unknown): string => m(primeiraLinhaUtil(e instanceof Error ? e.message : String(e)));

function registrar(item: Item): void {
  const i: Item = { ...item, detalhe: item.detalhe === undefined ? undefined : m(item.detalhe), subitens: item.subitens?.map(m) };
  itens.push(i);
  console.log(formatarItem(i));
  for (const s of i.subitens ?? []) console.log(`     · ${s}`);
}

interface ResultadoPasso {
  ok: boolean;
  detalhe?: string;
  subitens?: string[];
}

/** Roda um passo, mede o tempo e registra ✅/❌ (exceção = ❌ com a 1ª linha da mensagem, mascarada). */
async function passo(grupo: Grupo, codigo: string, titulo: string, fn: () => Promise<ResultadoPasso>): Promise<boolean> {
  const t0 = performance.now();
  try {
    const r = await fn();
    registrar({ grupo, codigo, titulo, situacao: r.ok ? 'ok' : 'falha', detalhe: r.detalhe, subitens: r.subitens, ms: performance.now() - t0 });
    return r.ok;
  } catch (e) {
    registrar({ grupo, codigo, titulo, situacao: 'falha', detalhe: msgErro(e), ms: performance.now() - t0 });
    return false;
  }
}

function naoRodou(grupo: Grupo, codigo: string, titulo: string, motivo: string): void {
  registrar({ grupo, codigo, titulo, situacao: 'falha', detalhe: `não rodou: ${motivo}` });
}

async function conectar(url: string, timeoutMs = 15_000): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeoutMs });
  c.on('error', () => undefined); // sessão derrubada (drop database with force) não derruba o processo
  try {
    await c.connect();
  } catch (e) {
    await c.end().catch(() => undefined);
    throw e;
  }
  return c;
}

async function com<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = await conectar(url);
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => undefined);
  }
}

/** Executa fn numa transação com o tenant da sessão (app.tenant_id, como a API faz). */
async function comTenantNaTransacao<T>(c: pg.Client, tenant: string | null, fn: () => Promise<T>): Promise<T> {
  await c.query('begin');
  try {
    if (tenant) await c.query("select set_config('app.tenant_id', $1, true)", [tenant]);
    const r = await fn();
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  }
}

function ehHostLocal(host: string): boolean {
  const h = host.trim().toLowerCase();
  return HOSTS_LOCAIS.includes(h) || h === 'postgres' || h === '0.0.0.0' || h.startsWith('127.') || h === 'host.docker.internal';
}

function lerSenhaAdmin(): string {
  if (env.DBAAS_SENHA_STDIN === '1') return (readFileSync(0, 'utf8').split(/\r?\n/)[0] ?? '').trim();
  const s = env.DBAAS_SENHA ?? '';
  delete env.DBAAS_SENHA;
  return s;
}

/** Ambiente sem nenhuma credencial (para o npm). */
function ambienteSemSegredo(): NodeJS.ProcessEnv {
  const limpo: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (!/SENHA|PASSWORD|^PG/i.test(k)) limpo[k] = v;
  return limpo;
}

interface Config {
  host: string;
  porta: number;
  usuario: string;
  bancoManutencao: string;
  modoTls: string;
  ate: string;
}

function lerConfiguracao(): { cfg: Config | null; erros: string[] } {
  const erros: string[] = [];
  const host = (env.DBAAS_HOST ?? '').trim();
  const porta = Number(env.DBAAS_PORTA ?? '5432');
  const usuario = (env.DBAAS_USUARIO ?? 'macuxi_admin').trim();
  const bancoManutencao = (env.DBAAS_BANCO ?? 'postgres').trim();
  const modoTls = (env.DBAAS_SSLMODE ?? 'prefer').trim();
  const ate = (env.DBAAS_MIGRAR_ATE ?? '0027').trim();
  if (!host) erros.push('DBAAS_HOST vazio');
  else if (ehHostLocal(host)) erros.push(`DBAAS_HOST=${host} é local ou o Postgres da demo: recusado (só o DBaaS)`);
  if (!Number.isInteger(porta) || porta <= 0 || porta > 65_535) erros.push('DBAAS_PORTA inválida');
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(usuario)) erros.push('DBAAS_USUARIO inválido');
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(bancoManutencao)) erros.push('DBAAS_BANCO inválido');
  if (!tentativasTls(modoTls)) erros.push('DBAAS_SSLMODE: use prefer, require, verify-full ou disable');
  if (!/^\d{4}$/.test(ate)) erros.push('DBAAS_MIGRAR_ATE: 4 dígitos (ex.: 0027)');
  return { cfg: erros.length ? null : { host, porta, usuario, bancoManutencao, modoTls, ate }, erros };
}

/** Prepara o ambiente do @macuxi/db apontado para o DBaaS (lerConfig) e devolve a configuração. */
function configurarBanco(c: Config, senhaAdmin: string, appSenha: string, workerSenha: string): ConfigBanco {
  for (const k of Object.keys(env)) if (k.startsWith('MACUXI_PG_')) delete env[k];
  Object.assign(env, {
    MACUXI_PG_HOST: c.host,
    MACUXI_PG_PORTA: String(c.porta),
    MACUXI_PG_ADMIN_USUARIO: c.usuario,
    MACUXI_PG_ADMIN_SENHA: senhaAdmin,
    MACUXI_PG_APP_SENHA: appSenha,
    MACUXI_PG_WORKER_SENHA: workerSenha,
    // seed da base de DEMONSTRAÇÃO (dados fictícios) fora do local: só com a marca explícita (exigirBancoDemo)
    MACUXI_AMBIENTE: 'demo',
  });
  return lerConfig();
}

async function listarBases(cfg: ConfigBanco, bancoManutencao: string): Promise<string[]> {
  return com(urlAdmin(cfg, bancoManutencao), async (c) => (await c.query<{ datname: string }>('select datname from pg_database order by 1')).rows.map((r) => r.datname));
}

async function apagarBaseDireto(cfg: ConfigBanco, bancoManutencao: string, nome: string): Promise<void> {
  validarNomeBanco(nome);
  await com(urlAdmin(cfg, bancoManutencao), (c) => c.query(`drop database if exists ${nome} with (force)`));
}

/** Apaga a base do teste e toda base criada durante o teste (as que não existiam no início). */
async function limpar(cfg: ConfigBanco, bancoManutencao: string, base: string | null, antes: Set<string> | null): Promise<void> {
  if (base) {
    await passo('limpeza', 'L1', `Base de teste ${base} apagada`, async () => {
      await apagarBanco(base, cfg).catch(() => apagarBaseDireto(cfg, bancoManutencao, base));
      const resta = (await listarBases(cfg, bancoManutencao)).includes(base);
      return { ok: !resta, detalhe: resta ? 'a base ainda existe' : 'drop database … with (force)' };
    });
  }
  await passo('limpeza', 'L2', 'Bases criadas pela suíte apagadas', async () => {
    const agora = await listarBases(cfg, bancoManutencao);
    const alvos = agora.filter((n) => n !== base && (antes ? !antes.has(n) : /^macuxi_(teste|dbaas)_/.test(n)));
    const falhas: string[] = [];
    for (const n of alvos) {
      try {
        await apagarBaseDireto(cfg, bancoManutencao, n);
      } catch (e) {
        falhas.push(`${n}: ${msgErro(e)}`);
      }
    }
    return { ok: falhas.length === 0, detalhe: `${alvos.length - falhas.length} de ${alvos.length} apagadas`, subitens: falhas };
  });
}

/** Mede uma consulta N vezes (tempo de parede, com a rede) e devolve o p95 e os índices do plano. */
async function medirConsulta(c: pg.Client, sql: string, params: unknown[], rodadas: number): Promise<{ p95: number; indices: string[] }> {
  let indices: string[] = [];
  try {
    const plano = await c.query<{ 'QUERY PLAN': unknown }>(`explain (format json) ${sql}`, params);
    indices = indicesDoPlano(plano.rows[0]?.['QUERY PLAN']);
  } catch {
    indices = [];
  }
  const tempos: number[] = [];
  for (let i = 0; i < rodadas; i++) {
    const t0 = performance.now();
    await c.query(sql, params);
    tempos.push(performance.now() - t0);
  }
  return { p95: percentil(tempos, 95), indices };
}

function instalarVitest(): string {
  const link = join(PASTA_RAIZ, 'node_modules', 'vitest');
  if (!existsSync(join(link, 'package.json'))) {
    const lock = join(PASTA_RAIZ, 'pnpm-lock.yaml');
    const versao = env.DBAAS_VITEST_VERSAO || (existsSync(lock) ? versaoVitestDoLock(readFileSync(lock, 'utf8')) : null) || '3.2.7';
    if (!/^\d+\.\d+\.\d+$/.test(versao)) throw new Error('DBAAS_VITEST_VERSAO inválida');
    mkdirSync(PREFIXO_VITEST, { recursive: true });
    const r = spawnSync(
      'npm',
      ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', '--omit=dev', '--loglevel=error', '--prefix', PREFIXO_VITEST, `vitest@${versao}`],
      { encoding: 'utf8', timeout: 6 * 60_000, env: { ...ambienteSemSegredo(), NODE_ENV: 'production' } },
    );
    if (r.status !== 0) throw new Error(`npm install vitest@${versao} falhou: ${primeiraLinhaUtil(r.stderr || r.error?.message || '')}`);
    mkdirSync(join(PASTA_RAIZ, 'node_modules'), { recursive: true });
    symlinkSync(join(PREFIXO_VITEST, 'node_modules', 'vitest'), link, 'dir');
  }
  return (JSON.parse(readFileSync(join(link, 'package.json'), 'utf8')) as { version: string }).version;
}

function gravarSaida(pasta: string, nome: string, conteudo: string): void {
  try {
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, nome), m(conteudo), { mode: 0o644 });
  } catch (e) {
    console.error(`[dbaas] não gravei ${nome}: ${msgErro(e)}`);
  }
}

function devolverDono(pasta: string): void {
  const dono = /^(\d+):(\d+)$/.exec(env.DBAAS_DONO ?? '');
  if (!dono || !existsSync(pasta)) return;
  for (const f of readdirSync(pasta)) {
    try {
      chownSync(join(pasta, f), Number(dono[1]), Number(dono[2]));
    } catch {
      // sem permissão: o arquivo fica com o dono do contêiner
    }
  }
}

interface InfoServidor {
  num: number;
  versao: string;
  curta: string;
  ssl: boolean | null;
  tls: string | null;
}

interface AtributosAdmin {
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  membro_de: string | null;
}

interface Estado {
  conectado: boolean;
  semAlcance: boolean;
  servidor: InfoServidor | null;
  admin: AtributosAdmin | null;
  vector: { versao: string; trusted: boolean | null; superuser: boolean | null } | null;
  vectorVersao: string | null;
  base: string | null;
  antes: Set<string> | null;
  explain: string | null;
}

/** Linha mais útil de uma saída de erro: a 1ª que fala em erro/falha; senão a 1ª que não é pilha. */
function linhaDeErro(texto: string): string {
  const achada = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /error|erro|falha|recusad/i.test(l) && !/^at\s/.test(l));
  return (achada ?? primeiraLinhaUtil(texto)).slice(0, 240);
}

async function principal(): Promise<number> {
  const inicio = Date.now();
  const soLimpar = process.argv.includes('--so-limpar');
  const { cfg: conf, erros } = lerConfiguracao();
  const senhaAdmin = lerSenhaAdmin();
  if (!senhaAdmin) erros.push('senha do admin ausente (DBAAS_SENHA_STDIN=1 com a senha no stdin, ou DBAAS_SENHA)');
  if (!conf || erros.length) {
    console.error(`[dbaas] configuração: ${erros.join('; ')}`);
    return SAIDA.CONFIGURACAO;
  }
  const appSenha = randomBytes(24).toString('hex');
  const workerSenha = randomBytes(24).toString('hex');
  segredos = [senhaAdmin, appSenha, workerSenha];
  const cfg = configurarBanco(conf, senhaAdmin, appSenha, workerSenha);
  const saida = env.DBAAS_SAIDA_CONTEINER || '/saida';
  const arqRelatorio = env.DBAAS_RELATORIO_CONTEINER || join(saida, 'relatorio.md');
  const versoes: string[] = [`Node ${process.version}`];
  if (env.DBAAS_IMAGEM) versoes.push(`Imagem: ${env.DBAAS_IMAGEM}`);
  // estado num objeto: atribuído dentro dos passos (closures), sem o estreitamento de tipo de variável local do TS
  const st: Estado = { conectado: false, semAlcance: false, servidor: null, admin: null, vector: null, vectorVersao: null, base: null, antes: null, explain: null };

  try {
    // ---------------- pré-requisitos ----------------
    // P0 vem do .sh (rota e TCP conferidos no host da VM, antes de subir o contêiner)
    if (env.DBAAS_ALCANCE_MS && !soLimpar) {
      registrar({
        grupo: 'pre',
        codigo: 'P0',
        titulo: `Alcance TCP de ${conf.host}:${conf.porta} a partir da VM`,
        situacao: 'ok',
        detalhe: `rota pela interface ${env.DBAAS_ROTA_DEV ?? '?'} (não é rede do Docker)`,
        ms: Number(env.DBAAS_ALCANCE_MS),
      });
    }
    let tlsUsado = '';
    await passo('pre', 'P1', `Conexão do admin ${conf.usuario} em ${conf.host}:${conf.porta}/${conf.bancoManutencao} (DBAAS_SSLMODE=${conf.modoTls})`, async () => {
      let ultimo: ReturnType<typeof classificarErroConexao> | null = null;
      for (const t of tentativasTls(conf.modoTls) ?? []) {
        env.PGSSLMODE = t; // lido pelo node-pg a cada cliente novo (e herdado pela suíte)
        try {
          st.servidor = await com(urlAdmin(cfg, conf.bancoManutencao), async (c) => {
            const r = await c.query<InfoServidor>(
              `select current_setting('server_version_num')::int as num, version() as versao, current_setting('server_version') as curta,
                      (select s.ssl from pg_stat_ssl s where s.pid = pg_backend_pid()) as ssl,
                      (select s.version from pg_stat_ssl s where s.pid = pg_backend_pid()) as tls`,
            );
            return r.rows[0] ?? null;
          });
          tlsUsado = t;
          ultimo = null;
          break;
        } catch (e) {
          ultimo = classificarErroConexao(e);
          if (ultimo.tipo !== 'tls') break;
        }
      }
      const sv = st.servidor;
      if (ultimo || !sv) {
        st.semAlcance = ultimo?.tipo === 'tempo' || ultimo?.tipo === 'recusada';
        return { ok: false, detalhe: ultimo?.mensagem ?? 'sem resposta' };
      }
      st.conectado = true;
      const tls = sv.ssl ? `TLS ${sv.tls ?? '?'}${tlsUsado === 'verify-full' ? ' com certificado conferido' : ' sem conferir certificado'}` : 'sem TLS';
      return { ok: true, detalhe: tls };
    });
    const servidor = st.servidor;
    if (!st.conectado || !servidor) return st.semAlcance ? SAIDA.SEM_ALCANCE : SAIDA.FALHA;
    versoes.unshift(`Servidor: ${servidor.versao}`);

    if (soLimpar) {
      await limpar(cfg, conf.bancoManutencao, null, null);
      return resumir(itens).codigo;
    }

    await passo('pre', 'P2', 'PostgreSQL 16', async () => ({
      ok: servidor.num >= 160_000 && servidor.num < 170_000,
      detalhe: `server_version ${servidor.curta} (${servidor.num})`,
    }));

    await passo('pre', 'P3', 'Admin cria bases e papéis (CREATEDB e CREATEROLE)', async () => {
      const admin = await com(urlAdmin(cfg, conf.bancoManutencao), async (c) => {
        const r = await c.query<AtributosAdmin>(
          `select r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole,
                  (select string_agg(b.rolname, ', ' order by b.rolname) from pg_auth_members am join pg_roles b on b.oid = am.roleid where am.member = r.oid) as membro_de
             from pg_roles r where r.rolname = current_user`,
        );
        return r.rows[0] ?? null;
      });
      st.admin = admin;
      if (!admin) return { ok: false, detalhe: 'papel do admin não encontrado em pg_roles' };
      return {
        ok: admin.rolsuper || (admin.rolcreatedb && admin.rolcreaterole),
        detalhe: `SUPERUSER ${admin.rolsuper ? 'sim' : 'não'} · CREATEDB ${admin.rolcreatedb ? 'sim' : 'não'} · CREATEROLE ${admin.rolcreaterole ? 'sim' : 'não'} · membro de: ${admin.membro_de ?? 'nenhum'}`,
      };
    });

    // ---------------- complementares do servidor ----------------
    await passo('comp', 'X1', 'Admin ignora RLS (SUPERUSER ou BYPASSRLS): exigido pelo seed, pela fixture dos testes e pelas funções SECURITY DEFINER entre tenants', async () => {
      const admin = st.admin;
      if (!admin) return { ok: false, detalhe: 'atributos do admin desconhecidos (P3)' };
      const ok = admin.rolsuper || admin.rolbypassrls;
      return {
        ok,
        detalhe: ok
          ? `SUPERUSER ${admin.rolsuper ? 'sim' : 'não'} · BYPASSRLS ${admin.rolbypassrls ? 'sim' : 'não'}`
          : 'sem SUPERUSER e sem BYPASSRLS: com FORCE RLS o dono das tabelas não grava nem lê linha de tenant (seed, fixture e funções DEFINER falham)',
      };
    });
    await passo('comp', 'X2', 'Admin pode SET session_replication_role (seed demo --recriar e plataforma.excluir_tenant, LGPD)', async () => {
      const r = await com(urlAdmin(cfg, conf.bancoManutencao), (c) =>
        c.query<{ ok: boolean }>("select current_setting('is_superuser') = 'on' or coalesce(has_parameter_privilege('session_replication_role', 'SET'), false) as ok"),
      );
      const ok = r.rows[0]?.ok === true;
      return { ok, detalhe: ok ? 'permitido' : 'só superusuário (ou GRANT SET ON PARAMETER): o --recriar e a exclusão de tenant precisam de outro caminho' };
    });
    await passo('comp', 'X3', 'Parâmetros do servidor', async () => {
      const r = await com(urlAdmin(cfg, conf.bancoManutencao), (c) =>
        c.query<{ name: string; valor: string }>('select name, current_setting(name) as valor from pg_settings where name = any($1::text[]) order by name', [PARAMETROS]),
      );
      return { ok: true, detalhe: r.rows.map((x) => `${x.name}=${x.valor || '(vazio)'}`).join(' · ') };
    });
    await passo('comp', 'X4', 'Extensões disponíveis no DBaaS (além da vector)', async () => {
      const r = await com(urlAdmin(cfg, conf.bancoManutencao), (c) =>
        c.query<{ name: string; default_version: string; trusted: boolean | null; superuser: boolean | null }>(
          `select e.name, e.default_version, v.trusted, v.superuser
             from pg_available_extensions e
             left join pg_available_extension_versions v on v.name = e.name and v.version = e.default_version
            where e.name = any($1::text[])`,
          [EXTENSOES_DE_INTERESSE],
        ),
      );
      const porNome = new Map(r.rows.map((x) => [x.name, x]));
      const v = porNome.get('vector');
      if (v) st.vector = { versao: v.default_version, trusted: v.trusted, superuser: v.superuser };
      const outras = EXTENSOES_DE_INTERESSE.filter((n) => n !== 'vector');
      const existem = outras.filter((n) => porNome.has(n)).map((n) => `${n} ${porNome.get(n)!.default_version}`);
      const faltam = outras.filter((n) => !porNome.has(n));
      return { ok: true, detalhe: `disponíveis: ${existem.join(', ') || 'nenhuma'} · NÃO existem: ${faltam.join(', ') || 'nenhuma'} (nenhuma delas é exigida hoje pelas migrações)` };
    });

    // ---------------- critério 1 (disponibilidade) ----------------
    await passo('c1', 'C1.1', 'Extensão vector disponível no DBaaS (pg_available_extensions)', async () => {
      const v = st.vector;
      if (!v) return { ok: false, detalhe: 'vector NÃO existe neste DBaaS' };
      return { ok: true, detalhe: `default_version ${v.versao} · trusted ${v.trusted ? 'sim' : 'não'} · exige superusuário ${v.superuser ? 'sim' : 'não'} (referência local: 0.8.2)` };
    });

    // ---------------- critério 2: papéis, base, migrações ----------------
    st.antes = new Set(await listarBases(cfg, conf.bancoManutencao));
    const papeisOk = await passo('c2', 'C2.1', 'Papéis macuxi_app e macuxi_worker (LOGIN, sem SUPERUSER/BYPASSRLS)', async () => {
      await com(urlAdmin(cfg, 'postgres'), async (c) => {
        await garantirPapelApp(c, appSenha);
        await garantirPapelWorker(c, workerSenha);
      });
      const r = await com(urlAdmin(cfg, conf.bancoManutencao), (c) =>
        c.query<{ rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }>(
          "select rolname, rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname in ('macuxi_app', 'macuxi_worker') order by 1",
        ),
      );
      const ok = r.rows.length === 2 && r.rows.every((x) => x.rolcanlogin && !x.rolsuper && !x.rolbypassrls);
      return { ok, detalhe: r.rows.map((x) => `${x.rolname}: LOGIN ${x.rolcanlogin ? 'sim' : 'não'}, SUPERUSER ${x.rolsuper ? 'sim' : 'não'}, BYPASSRLS ${x.rolbypassrls ? 'sim' : 'não'}`).join(' · ') };
    });

    const nomeBase = nomeBaseTeste(new Date());
    const baseOk = await passo('c2', 'C2.2', `Base nova de teste ${nomeBase}`, async () => {
      st.base = nomeBase; // antes do CREATE: se ele falhar no meio, a limpeza confere
      await criarBanco(nomeBase, cfg);
      const r = await com(urlAdmin(cfg, conf.bancoManutencao), (c) =>
        c.query<{ datcollate: string; datctype: string; codif: string }>(
          'select datcollate, datctype, pg_encoding_to_char(encoding) as codif from pg_database where datname = $1',
          [nomeBase],
        ),
      );
      const d = r.rows[0];
      return { ok: !!d, detalhe: d ? `encoding ${d.codif} · collate ${d.datcollate} · ctype ${d.datctype}` : 'base não apareceu em pg_database' };
    });

    if (baseOk) {
      await passo('c1', 'C1.2', 'CREATE EXTENSION vector com o admin do DBaaS', async () => {
        const v = await com(urlAdmin(cfg, nomeBase), async (c) => {
          await c.query('create extension if not exists vector');
          return (await c.query<{ v: string }>("select extversion as v from pg_extension where extname = 'vector'")).rows[0]?.v ?? null;
        });
        st.vectorVersao = v;
        if (!v) return { ok: false, detalhe: 'pg_extension sem a vector depois do CREATE' };
        return { ok: versaoAtende(v, '0.8.0'), detalhe: `vector ${v} (mínimo 0.8.0; referência local 0.8.2)` };
      });
    } else naoRodou('c1', 'C1.2', 'CREATE EXTENSION vector com o admin do DBaaS', 'sem base de teste (C2.2)');
    const vectorVersao = st.vectorVersao;
    if (vectorVersao) versoes.push(`vector ${vectorVersao}`);

    const esperadas = lerMigracoes().filter((x) => x.versao <= conf.ate);
    const ultimaPacote = lerMigracoes().at(-1)?.versao ?? '?';
    let migrou = false;
    if (baseOk) {
      migrou = await passo('c2', 'C2.3', `Migrações 0001..${conf.ate}`, async () => {
        await com(urlAdmin(cfg, nomeBase), (c) => migrarUp(c, { ate: conf.ate }));
        const aplicadas = await com(urlAdmin(cfg, nomeBase), (c) => listarAplicadas(c));
        const vers = aplicadas.map((a) => a.versao);
        const iguais = vers.length === esperadas.length && esperadas.every((x, i) => vers[i] === x.versao);
        const contiguas = esperadas.length === Number(conf.ate);
        return {
          ok: iguais && contiguas,
          detalhe: `${vers.length} aplicadas (${vers[0] ?? '-'}..${vers.at(-1) ?? '-'}); no pacote da imagem: ${lerMigracoes().length} (última ${ultimaPacote})${contiguas ? '' : ' — faltam arquivos na sequência'}`,
        };
      });
    } else naoRodou('c2', 'C2.3', `Migrações 0001..${conf.ate}`, 'sem base de teste (C2.2)');

    if (migrou) {
      await passo('c2', 'C2.4', 'RLS ligado e FORCE em toda tabela, com política do macuxi_app (db/scripts/conferir-rls.sql = 0 linhas)', async () => {
        const arq = [join(PASTA_DBAAS, 'conferir-rls.sql'), join(PASTA_DB, 'scripts', 'conferir-rls.sql')].find((f) => existsSync(f));
        if (!arq) return { ok: false, detalhe: 'conferir-rls.sql não encontrado na imagem' };
        const sql = readFileSync(arq, 'utf8');
        return com(urlAdmin(cfg, nomeBase), async (c) => {
          const total = await c.query<{ n: number }>(
            `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema', 'public') and n.nspname not like 'pg\\_%'`,
          );
          const r = await c.query<{ tabela: string; problema: string }>(sql);
          return {
            ok: r.rows.length === 0,
            detalhe: `${total.rows[0]?.n ?? 0} tabelas conferidas · ${r.rows.length} problema(s)`,
            subitens: r.rows.slice(0, 20).map((x) => `${x.tabela}: ${x.problema}`),
          };
        });
      });

      await passo('c2', 'C2.5', 'Funções SECURITY DEFINER com search_path fixo e seguro (pg_temp por último) e sem EXECUTE para PUBLIC', async () =>
        com(urlAdmin(cfg, nomeBase), async (c) => {
          const r = await c.query<{ funcao: string; config: string[] | null; dono: string; publico: boolean }>(
            `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as funcao,
                    p.proconfig as config, pg_get_userbyid(p.proowner) as dono,
                    coalesce(exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'), false) as publico
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
              order by 1`,
          );
          const problemas: string[] = [];
          for (const f of r.rows) {
            const ps = problemasSearchPath(searchPathDoProconfig(f.config));
            if (f.publico) ps.push('EXECUTE para PUBLIC');
            if (ps.length) problemas.push(`${f.funcao}: ${ps.join('; ')}`);
          }
          const donos = [...new Set(r.rows.map((x) => x.dono))].join(', ') || '-';
          return { ok: r.rows.length > 0 && problemas.length === 0, detalhe: `${r.rows.length} funções · dono: ${donos} · ${problemas.length} problema(s)`, subitens: problemas.slice(0, 20) };
        }),
      );

      await passo('c2', 'C2.6', 'macuxi_app e macuxi_worker não ignoram RLS e não são donos de tabela', async () =>
        com(urlAdmin(cfg, nomeBase), async (c) => {
          const partes: string[] = [];
          let ok = true;
          for (const papel of ['macuxi_app', 'macuxi_worker']) {
            const d = await diagnosticarPapelApp(c, papel);
            ok &&= !d.superusuario && !d.ignoraRls && d.tabelasDeQueEDono.length === 0;
            partes.push(`${papel}: ${d.tabelasDeQueEDono.length} tabela(s) própria(s)`);
          }
          return { ok, detalhe: partes.join(' · ') };
        }),
      );
    } else {
      for (const [codigo, titulo] of [
        ['C2.4', 'RLS ligado e FORCE em toda tabela (conferir-rls.sql)'],
        ['C2.5', 'Funções SECURITY DEFINER com search_path seguro'],
        ['C2.6', 'macuxi_app e macuxi_worker não ignoram RLS e não são donos de tabela'],
      ] as const)
        naoRodou('c2', codigo, titulo, 'migrações não aplicadas (C2.3)');
    }

    let semeou = false;
    if (migrou) {
      semeou = await passo('c2', 'C2.7', 'Seed demo (tenant demo, dados fictícios)', async () => {
        const r = await com(urlAdmin(cfg, nomeBase), (c) => carregarDemo(c));
        const tabelas = Object.values(r.dados).filter((l) => l.length > 0).length;
        const linhas = Object.values(r.dados).reduce((s, l) => s + l.length, 0);
        return { ok: true, detalhe: `${tabelas} tabelas, ${linhas} linhas` };
      });
    } else naoRodou('c2', 'C2.7', 'Seed demo', 'migrações não aplicadas (C2.3)');

    // ---------------- critério 3: RLS na prática ----------------
    if (semeou && papeisOk) {
      await passo('c3', 'C3.1', 'RLS na prática como macuxi_app: sem tenant 0 linhas · tenant demo > 0 · outro tenant 0', async () =>
        com(urlApp(cfg, nomeBase), async (c) => {
          const papel = await c.query<{ u: string; s: string }>("select current_user as u, current_setting('is_superuser') as s");
          const contar = (t: string | null) =>
            comTenantNaTransacao(c, t, async () => (await c.query<{ n: number }>('select count(*)::int as n from core.cliente')).rows[0]?.n ?? -1);
          const sem = await contar(null);
          const demo = await contar(TENANT_DEMO);
          const outro = await contar(randomUUID());
          const ok = papel.rows[0]?.u === 'macuxi_app' && papel.rows[0]?.s === 'off' && sem === 0 && demo > 0 && outro === 0;
          return { ok, detalhe: `core.cliente: sem tenant ${sem} · demo ${demo} · outro ${outro} · is_superuser ${papel.rows[0]?.s ?? '?'}` };
        }),
      );
      await passo('c3', 'C3.2', 'SECURITY DEFINER entre tenants funciona sem superusuário (plataforma.tenants_ativos() como macuxi_worker)', async () =>
        com(urlWorker(cfg, nomeBase), async (c) => {
          const n = (await c.query<{ n: number }>('select count(*)::int as n from plataforma.tenants_ativos()')).rows[0]?.n ?? 0;
          return { ok: n >= 1, detalhe: `${n} tenant(s) ativo(s) visto(s)${n === 0 ? ' — o dono da função (admin) não enxerga as linhas por causa do FORCE RLS' : ''}` };
        }),
      );

      // ---------------- complementar: p95 das consultas críticas ----------------
      await passo('comp', 'X5', 'p95 < 300 ms nas consultas críticas (macuxi_app, tenant demo, 20 rodadas, tempo com a rede)', async () =>
        com(urlApp(cfg, nomeBase), async (c) =>
          comTenantNaTransacao(c, TENANT_DEMO, async () => {
            const cursor = ['1970-01-01T00:00:00Z', '00000000-0000-0000-0000-000000000000'];
            const consultas: Array<[string, string, unknown[]]> = [
              ['sync core.cliente', 'select id, updated_at from core.cliente where (updated_at, id) > ($1::timestamptz, $2::uuid) order by updated_at, id limit 500', cursor],
              ['sync core.produto', 'select id, updated_at from core.produto where (updated_at, id) > ($1::timestamptz, $2::uuid) order by updated_at, id limit 500', cursor],
              [
                'busca do catálogo (FTS)',
                "select produto_id from catalogo.produto_busca where deleted_at is null and documento @@ plainto_tsquery('portuguese', catalogo.sem_acento($1)) order by ts_rank(documento, plainto_tsquery('portuguese', catalogo.sem_acento($1))) desc limit 20",
                ['oleo'],
              ],
            ];
            const partes: string[] = [];
            let ok = true;
            for (const [nome, sql, params] of consultas) {
              const r = await medirConsulta(c, sql, params, 20);
              ok &&= r.p95 < 300;
              partes.push(`${nome} p95 ${formatarMs(r.p95)} (índices: ${r.indices.join(', ') || 'nenhum'})`);
            }
            return { ok, detalhe: 'veja os subitens', subitens: partes };
          }),
        ),
      );
    } else {
      naoRodou('c3', 'C3.1', 'RLS na prática como macuxi_app', 'sem seed demo (C2.7) ou papéis (C2.1)');
      naoRodou('c3', 'C3.2', 'SECURITY DEFINER entre tenants (tenants_ativos como macuxi_worker)', 'sem seed demo (C2.7) ou papéis (C2.1)');
    }

    // ---------------- critério 4: HNSW ----------------
    const linhasHnsw = Number(env.DBAAS_HNSW_LINHAS ?? '5000');
    const dim = Number(env.DBAAS_HNSW_DIM ?? '1536');
    if (vectorVersao && Number.isInteger(linhasHnsw) && Number.isInteger(dim) && linhasHnsw > 0 && dim > 0 && dim <= 2000) {
      const TABELA = 'public.dbaas_produto_embedding';
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      const hnswOk = await passo('c4', 'C4.1', `Índice HNSW (vector_cosine_ops) sobre ${linhasHnsw} vetores de dimensão ${dim} (forma de catalogo.produto_embedding)`, async () =>
        com(urlAdmin(cfg, nomeBase), async (c) => {
          await c.query(`create table ${TABELA} (id bigint generated always as identity primary key, tenant_id uuid not null, produto_id uuid not null default gen_random_uuid(), embedding vector(${dim}) not null)`);
          const t0 = performance.now();
          // subconsulta correlacionada (where g > 0): um vetor aleatório por linha
          await c.query(
            `insert into ${TABELA} (tenant_id, embedding)
             select case when g % 4 = 0 then $1::uuid else $2::uuid end,
                    (select array_agg(random()::real) from generate_series(1, ${dim}) where g > 0)::vector
               from generate_series(1, ${linhasHnsw}) g`,
            [tenantA, tenantB],
          );
          const carga = performance.now() - t0;
          const t1 = performance.now();
          await c.query(`create index dbaas_produto_embedding_hnsw on ${TABELA} using hnsw (embedding vector_cosine_ops)`);
          const indice = performance.now() - t1;
          await c.query(`analyze ${TABELA}`);
          return { ok: true, detalhe: `carga ${formatarMs(carga)} · create index ${formatarMs(indice)}` };
        }),
      );
      if (hnswOk) {
        await passo('c4', 'C4.2', 'EXPLAIN da busca por vizinhos (order by embedding <=> $1 limit 10) usa o HNSW', async () =>
          com(urlAdmin(cfg, nomeBase), async (c) => {
            const q = (await c.query<{ v: string }>(`select embedding::text as v from ${TABELA} where id = 1`)).rows[0]?.v;
            if (!q) return { ok: false, detalhe: 'sem vetor de consulta' };
            const sql = `select id from ${TABELA} order by embedding <=> $1::vector limit 10`;
            const planoJson = async () => indicesDoPlano((await c.query<{ 'QUERY PLAN': unknown }>(`explain (format json) ${sql}`, [q])).rows[0]?.['QUERY PLAN']);
            let forcado = false;
            let indices = await planoJson();
            await c.query('begin');
            try {
              if (!indices.includes('dbaas_produto_embedding_hnsw')) {
                forcado = true;
                await c.query('set local enable_seqscan = off');
                indices = await planoJson();
              }
              const texto = await c.query<{ 'QUERY PLAN': string }>(`explain (analyze, costs on) ${sql}`, [q]);
              st.explain = texto.rows.map((x) => x['QUERY PLAN']).join('\n');
              const r = await medirConsulta(c, sql, [q], 20);
              await c.query('commit');
              const usa = indices.includes('dbaas_produto_embedding_hnsw');
              return {
                ok: usa,
                detalhe: `${usa ? 'usa dbaas_produto_embedding_hnsw' : 'NÃO usa o HNSW'}${forcado ? ' (o planejador só escolheu o índice com enable_seqscan=off)' : ''} · p95 ${formatarMs(r.p95)} em 20 rodadas`,
              };
            } catch (e) {
              await c.query('rollback').catch(() => undefined);
              throw e;
            }
          }),
        );
        if (versaoAtende(vectorVersao, '0.8.0')) {
          await passo('comp', 'X6', 'Busca filtrada por tenant com hnsw.iterative_scan = relaxed_order (pgvector 0.8) devolve 10 vizinhos', async () =>
            com(urlAdmin(cfg, nomeBase), async (c) => {
              const q = (await c.query<{ v: string }>(`select embedding::text as v from ${TABELA} where id = 2`)).rows[0]?.v;
              await c.query('begin');
              try {
                await c.query("set local hnsw.iterative_scan = 'relaxed_order'");
                const r = await c.query(`select id from ${TABELA} where tenant_id = $2 order by embedding <=> $1::vector limit 10`, [q, tenantA]);
                await c.query('commit');
                return { ok: r.rowCount === 10, detalhe: `${r.rowCount} linhas (25% da tabela é do tenant filtrado)` };
              } catch (e) {
                await c.query('rollback').catch(() => undefined);
                throw e;
              }
            }),
          );
        }
      } else naoRodou('c4', 'C4.2', 'EXPLAIN da busca por vizinhos usa o HNSW', 'índice não criado (C4.1)');
    } else {
      naoRodou('c4', 'C4.1', 'Índice HNSW', vectorVersao ? 'DBAAS_HNSW_LINHAS/DBAAS_HNSW_DIM inválidos (dim até 2000)' : 'sem extensão vector (C1.2)');
      naoRodou('c4', 'C4.2', 'EXPLAIN da busca por vizinhos usa o HNSW', 'sem índice (C4.1)');
    }

    // ---------------- critério 3: suíte @macuxi/db ----------------
    if (env.DBAAS_SUITE === '0') {
      naoRodou('c3', 'C3.4', 'Suíte de banco @macuxi/db contra o DBaaS', 'DBAAS_SUITE=0');
    } else if (!papeisOk) {
      naoRodou('c3', 'C3.4', 'Suíte de banco @macuxi/db contra o DBaaS', 'papéis não criados (C2.1)');
    } else {
      let vitest = '';
      const instalou = await passo('c3', 'C3.3', 'Vitest no contêiner (versão do pnpm-lock; nada instalado na VM)', async () => {
        vitest = instalarVitest();
        return { ok: true, detalhe: `vitest ${vitest}` };
      });
      if (vitest) versoes.push(`Vitest ${vitest}`);
      if (instalou) {
        const workers = /^\d+$/.test(env.DBAAS_VITEST_WORKERS ?? '') ? env.DBAAS_VITEST_WORKERS! : '2';
        const limiteMin = Number(env.DBAAS_TEMPO_SUITE_MIN ?? '16') || 16;
        await passo('c3', 'C3.4', `Suíte de banco @macuxi/db contra o DBaaS (globalSetup com fixture dois-tenants; ${workers} workers; limite ${limiteMin} min)`, async () => {
          const arqJson = join(PREFIXO_VITEST, 'resultado.json');
          const envSuite: NodeJS.ProcessEnv = { ...env, NODE_ENV: 'test', MACUXI_PG_EXIGIR: '1', MACUXI_PG_AUTO_SUBIR: '0' };
          delete envSuite.MACUXI_PG_BANCO;
          delete envSuite.DBAAS_SENHA;
          const r = spawnSync(
            process.execPath,
            [join(PASTA_RAIZ, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--reporter=json', `--outputFile=${arqJson}`, `--maxWorkers=${workers}`, '--minWorkers=1'],
            { cwd: PASTA_DB, env: envSuite, encoding: 'utf8', timeout: limiteMin * 60_000, maxBuffer: 256 * 1024 * 1024 },
          );
          gravarSaida(saida, 'suite.log', `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
          if (r.error) return { ok: false, detalhe: `a suíte não terminou: ${msgErro(r.error)}${/ETIMEDOUT/.test(String(r.error)) ? ` (passou de ${limiteMin} min)` : ''}` };
          const motivo = () => m(linhaDeErro(`${r.stderr ?? ''}\n${r.stdout ?? ''}`));
          if (!existsSync(arqJson)) return { ok: false, detalhe: `sem resultado JSON (código ${r.status}): ${motivo()}` };
          const bruto = readFileSync(arqJson, 'utf8');
          gravarSaida(saida, 'suite.json', bruto);
          const resumo = resumirVitest(JSON.parse(bruto));
          if (resumo.arquivos === 0) return { ok: false, detalhe: `nenhum arquivo de teste rodou (código ${r.status}): ${motivo()}` };
          const trava = resumo.falhas.filter((f) => TRAVA_LOCAL.test(f.mensagem));
          const reais = resumo.falhas.filter((f) => !TRAVA_LOCAL.test(f.mensagem));
          const subitens = [
            ...reais.map((f) => `❌ ${f.arquivo}: ${f.casos.length} caso(s) — ${f.mensagem}`),
            ...trava.map((f) => `❌ ${f.arquivo}: ${f.casos.length} caso(s) — trava de ambiente local do @macuxi/db (não é incompatibilidade do DBaaS): ${f.mensagem}`),
          ];
          return {
            ok: resumo.arquivos > 0 && reais.length === 0,
            detalhe: `${resumo.arquivosVerdes}/${resumo.arquivos} arquivos verdes · casos: ${resumo.casosVerdes} ✅, ${resumo.casosFalhos} ❌, ${resumo.casosPulados} pulados${trava.length ? ` · ${trava.length} arquivo(s) só com a trava de ambiente local` : ''}`,
            subitens: subitens.slice(0, 30),
          };
        });
      } else naoRodou('c3', 'C3.4', 'Suíte de banco @macuxi/db contra o DBaaS', 'vitest não instalado (C3.3)');
    }
  } catch (e) {
    registrar({ grupo: 'pre', codigo: 'E0', titulo: 'Erro inesperado do teste', situacao: 'falha', detalhe: msgErro(e) });
  } finally {
    if (st.conectado && !soLimpar) await limpar(cfg, conf.bancoManutencao, st.base, st.antes).catch((e: unknown) => console.error(`[dbaas] limpeza: ${msgErro(e)}`));
    if (!soLimpar) {
      const md = montarMarkdown(
        { quando: new Date(inicio).toISOString(), alvo: `${conf.host}:${conf.porta} · admin ${conf.usuario} · base de manutenção ${conf.bancoManutencao}`, versoes, duracaoMs: Date.now() - inicio },
        itens,
        st.explain,
      );
      gravarSaida(dirname(arqRelatorio), basename(arqRelatorio), md);
      devolverDono(saida);
    }
  }
  const r = resumir(itens);
  console.log(r.linha);
  return r.codigo;
}

principal().then(
  (codigo) => process.exit(codigo),
  (e: unknown) => {
    console.error(`[dbaas] erro: ${msgErro(e)}`);
    process.exit(SAIDA.FALHA);
  },
);
