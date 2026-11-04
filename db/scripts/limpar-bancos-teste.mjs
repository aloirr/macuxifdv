#!/usr/bin/env node
/**
 * Limpa os bancos de teste esquecidos num Postgres LOCAL (dono: banco-dados).
 *
 *   node db/scripts/limpar-bancos-teste.mjs                 só LISTA o que seria apagado (padrão, não apaga nada)
 *   node db/scripts/limpar-bancos-teste.mjs --apagar        apaga, um banco por vez
 *   opções: --porta N (padrão MACUXI_PG_TESTES_PORTA ou 5434, o Postgres DOS TESTES; a demo, 5432, só com --porta 5432)
 *           --host H (padrão localhost)
 *           --idade-min-horas H  só apaga banco criado há pelo menos H horas (padrão 2; 0 = qualquer idade)
 *           --forcar   apaga também banco com conexão aberta (padrão: pula, pode ser uma suíte rodando agora)
 *   pnpm --filter @macuxi/db limpar-testes [-- --apagar]
 *
 * Seguro com outra rodada de testes em andamento: por padrão só apaga banco SEM conexão em pg_stat_activity E criado
 * há mais de 2 h. Idade = agora menos a data MAIS NOVA entre o instante do nome (Date.now() em base 36) e a do arquivo
 * PG_VERSION do banco (gravado no CREATE DATABASE). O DROP sem --forcar também falha sozinho se alguém conectar entre a
 * listagem e o apagar.
 *
 * Só apaga nomes que seguem EXATAMENTE o padrão de quem cria bancos de teste:
 *   macuxi_teste_<base36>_<pid>_<hex6>          db/src/banco-teste.ts (criarBancoDeTeste)
 *   macuxi_conector_teste_<base36>_<hex6>       apps/conector/test/integracao.pg.test.ts
 * Nunca apaga o banco da demo/dev (MACUXI_PG_BANCO ou "macuxi"), "postgres" nem template*: são recusados mesmo que
 * algum dia casem com o padrão. Só roda contra host local (localhost, 127.0.0.1, ::1, macuxi-postgres*).
 * Node puro + pg (dependência do @macuxi/db): não precisa de tsx nem de pnpm install.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';

/** Padrões dos nomes criados pelos testes (conferidos com o código que os cria; ver cabeçalho). */
export const PADROES_TESTE = [/^macuxi_teste_[a-z0-9]+_[0-9]+_[0-9a-f]{6}$/, /^macuxi_conector_teste_[a-z0-9]+_[0-9a-f]{6}$/];
const HOSTS_LOCAIS = ['localhost', '127.0.0.1', '::1', 'macuxi-postgres', 'macuxi-postgres-testes'];
/** Idade mínima padrão (horas) para apagar: uma rodada de testes não chega perto disso. */
export const IDADE_MIN_HORAS_PADRAO = 2;

/** Banco que pode ser apagado: casa com um padrão de teste e não é protegido. */
export function ehBancoDeTeste(nome, protegidos) {
  if (protegidos.includes(nome) || nome.startsWith('template')) return false;
  return PADROES_TESTE.some((p) => p.test(nome));
}

/** Instante (ms) gravado no nome do banco de teste (Date.now() em base 36), ou null se o nome não trouxer um plausível. */
export function instanteDoNome(nome) {
  const m = /^macuxi_(?:conector_)?teste_([a-z0-9]+)_/.exec(nome);
  if (!m) return null;
  const ms = parseInt(m[1], 36);
  // de 2020 a 2100: fora disso não é o Date.now() de quem criou
  return Number.isSafeInteger(ms) && ms >= 1_577_836_800_000 && ms <= 4_102_444_800_000 ? ms : null;
}

/**
 * Separa os bancos do servidor (função pura, testada em db/testes/banco-dos-testes.test.ts).
 * bancos: { datname, datistemplate, conexoes, criadoEm (ms do PG_VERSION | null) }.
 * Idade = agora menos a MAIS NOVA entre a data do nome e a do arquivo (na dúvida o banco parece mais novo e fica).
 * Sem nenhuma das duas datas, só sai com idadeMinMs = 0.
 */
export function classificar(bancos, { protegidos, agora, idadeMinMs, forcar }) {
  const alvos = bancos.filter((d) => !d.datistemplate && ehBancoDeTeste(d.datname, protegidos));
  const ficam = bancos.filter((d) => !alvos.includes(d));
  const ocupados = [];
  const recentes = [];
  const apagaveis = [];
  for (const d of alvos) {
    const datas = [instanteDoNome(d.datname), d.criadoEm].filter((x) => typeof x === 'number');
    const idadeMs = datas.length ? agora - Math.max(...datas) : null;
    if (d.conexoes > 0 && !forcar) ocupados.push(d);
    else if (idadeMinMs > 0 && (idadeMs === null || idadeMs < idadeMinMs)) recentes.push(d);
    else apagaveis.push(d);
  }
  return { ficam, ocupados, recentes, apagaveis };
}

function carregarEnv() {
  const pastaDb = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const arquivo of [join(pastaDb, '..', '.env'), join(pastaDb, '.env')]) {
    if (existsSync(arquivo)) process.loadEnvFile(arquivo);
  }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const SQL_BANCOS = (comArquivo) => `
  select d.datname, d.datistemplate, pg_database_size(d.oid)::float8 as bytes,
         (select count(*)::int from pg_stat_activity a where a.datname = d.datname) as conexoes,
         ${comArquivo ? "extract(epoch from (pg_stat_file('base/' || d.oid || '/PG_VERSION', true)).modification)::float8 * 1000" : 'null::float8'} as criado_em,
         extract(epoch from now())::float8 * 1000 as agora
    from pg_database d order by 1`;

async function main() {
  carregarEnv();
  const { values } = parseArgs({
    options: {
      apagar: { type: 'boolean', default: false },
      forcar: { type: 'boolean', default: false },
      porta: { type: 'string' },
      host: { type: 'string' },
      'idade-min-horas': { type: 'string' },
    },
  });
  const host = values.host ?? 'localhost';
  const porta = Number(values.porta ?? process.env.MACUXI_PG_TESTES_PORTA ?? '5434');
  const idadeMinHoras = Number(values['idade-min-horas'] ?? IDADE_MIN_HORAS_PADRAO);
  if (!HOSTS_LOCAIS.includes(host)) throw new Error(`recusado: host ${host} não é local (só limpa o Postgres do db/docker-compose.yml).`);
  if (!Number.isInteger(porta) || porta <= 0) throw new Error(`porta inválida: ${porta}`);
  if (!Number.isFinite(idadeMinHoras) || idadeMinHoras < 0) throw new Error(`--idade-min-horas inválida: ${values['idade-min-horas']}`);
  const protegidos = ['postgres', process.env.MACUXI_PG_BANCO || 'macuxi', 'macuxi'];

  const c = new pg.Client({
    host,
    port: porta,
    user: process.env.MACUXI_PG_ADMIN_USUARIO || 'postgres',
    password: process.env.MACUXI_PG_ADMIN_SENHA || 'postgres',
    database: 'postgres',
    connectionTimeoutMillis: 5_000,
  });
  await c.connect();
  try {
    // pg_stat_file exige superusuário (ou pg_read_server_files): sem permissão fica só a data do nome
    const r = await c.query(SQL_BANCOS(true)).catch(() => c.query(SQL_BANCOS(false)));
    const todos = r.rows.map((d) => ({ ...d, criadoEm: d.criado_em === null ? null : Math.round(d.criado_em) }));
    const agora = Math.round(todos[0]?.agora ?? Date.now());
    const { ficam, ocupados, recentes, apagaveis } = classificar(todos, {
      protegidos,
      agora,
      idadeMinMs: idadeMinHoras * 3_600_000,
      forcar: values.forcar,
    });

    console.log(`[limpar] ${host}:${porta} — ${todos.length} bancos no servidor`);
    console.log(`[limpar] ficam (${ficam.length}): ${ficam.map((d) => d.datname).join(', ')}`);
    if (ocupados.length) console.log(`[limpar] com conexão aberta, pulados (use --forcar): ${ocupados.map((d) => d.datname).join(', ')}`);
    if (recentes.length) console.log(`[limpar] criados há menos de ${idadeMinHoras} h, pulados: ${recentes.map((d) => d.datname).join(', ')}`);
    const total = apagaveis.reduce((s, d) => s + d.bytes, 0);
    console.log(`[limpar] bancos de teste ${values.apagar ? 'a apagar' : 'que seriam apagados (use --apagar)'} (${apagaveis.length}, ${mb(total)}):`);
    for (const d of apagaveis) console.log(`  ${d.datname}  ${mb(d.bytes)}`);
    if (!values.apagar) return;

    let apagados = 0;
    let liberado = 0;
    const falhas = [];
    for (const d of apagaveis) {
      // nome já validado pelo padrão acima ([a-z0-9_]): seguro para interpolar no DDL
      try {
        await c.query(`drop database if exists ${d.datname}${values.forcar ? ' with (force)' : ''}`);
        apagados += 1;
        liberado += d.bytes;
      } catch (e) {
        falhas.push(`${d.datname}: ${e.message}`);
      }
    }
    const resto = await c.query('select count(*)::int as n from pg_database');
    console.log(`[limpar] apagados: ${apagados} (${mb(liberado)} liberados); falhas: ${falhas.length}; bancos que ficaram no servidor: ${resto.rows[0].n}`);
    for (const f of falhas) console.log(`  falha ${f}`);
    if (falhas.length) process.exitCode = 1;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(`[limpar] ${e.message}`);
    process.exitCode = 1;
  });
}
