#!/usr/bin/env node
/**
 * Limpa os bancos de teste esquecidos num Postgres LOCAL (dono: banco-dados).
 *
 *   node db/scripts/limpar-bancos-teste.mjs                 só LISTA o que seria apagado (padrão, não apaga nada)
 *   node db/scripts/limpar-bancos-teste.mjs --apagar        apaga, um banco por vez
 *   opções: --porta N (padrão MACUXI_PG_PORTA ou 5432) · --host H (padrão MACUXI_PG_HOST ou localhost)
 *           --forcar   apaga também banco com conexão aberta (padrão: pula, pode ser uma suíte rodando agora)
 *   pnpm --filter @macuxi/db limpar-testes [-- --apagar]
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

const PASTA_DB = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const arquivo of [join(PASTA_DB, '..', '.env'), join(PASTA_DB, '.env')]) {
  if (existsSync(arquivo)) process.loadEnvFile(arquivo);
}

/** Padrões dos nomes criados pelos testes (conferidos com o código que os cria; ver cabeçalho). */
export const PADROES_TESTE = [/^macuxi_teste_[a-z0-9]+_[0-9]+_[0-9a-f]{6}$/, /^macuxi_conector_teste_[a-z0-9]+_[0-9a-f]{6}$/];
const HOSTS_LOCAIS = ['localhost', '127.0.0.1', '::1', 'macuxi-postgres', 'macuxi-postgres-testes'];

/** Banco que pode ser apagado: casa com um padrão de teste e não é protegido. */
export function ehBancoDeTeste(nome, protegidos) {
  if (protegidos.includes(nome) || nome.startsWith('template')) return false;
  return PADROES_TESTE.some((p) => p.test(nome));
}

async function main() {
  const { values } = parseArgs({
    options: {
      apagar: { type: 'boolean', default: false },
      forcar: { type: 'boolean', default: false },
      porta: { type: 'string' },
      host: { type: 'string' },
    },
  });
  const host = values.host ?? process.env.MACUXI_PG_HOST ?? 'localhost';
  const porta = Number(values.porta ?? process.env.MACUXI_PG_PORTA ?? '5432');
  if (!HOSTS_LOCAIS.includes(host)) throw new Error(`recusado: host ${host} não é local (só limpa o Postgres do db/docker-compose.yml).`);
  if (!Number.isInteger(porta) || porta <= 0) throw new Error(`porta inválida: ${porta}`);
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
    const r = await c.query(
      `select d.datname, d.datistemplate,
              (select count(*)::int from pg_stat_activity a where a.datname = d.datname) as conexoes
         from pg_database d order by 1`,
    );
    const todos = r.rows;
    const alvos = todos.filter((d) => !d.datistemplate && ehBancoDeTeste(d.datname, protegidos));
    const ficam = todos.filter((d) => !alvos.includes(d));
    const ocupados = alvos.filter((d) => d.conexoes > 0 && !values.forcar);
    const apagaveis = alvos.filter((d) => !ocupados.includes(d));

    console.log(`[limpar] ${host}:${porta} — ${todos.length} bancos no servidor`);
    console.log(`[limpar] ficam (${ficam.length}): ${ficam.map((d) => d.datname).join(', ')}`);
    if (ocupados.length) console.log(`[limpar] com conexão aberta, pulados (use --forcar): ${ocupados.map((d) => d.datname).join(', ')}`);
    console.log(`[limpar] bancos de teste ${values.apagar ? 'a apagar' : 'que seriam apagados (use --apagar)'} (${apagaveis.length}):`);
    for (const d of apagaveis) console.log(`  ${d.datname}`);
    if (!values.apagar) return;

    let apagados = 0;
    const falhas = [];
    for (const d of apagaveis) {
      // nome já validado pelo padrão acima ([a-z0-9_]): seguro para interpolar no DDL
      try {
        await c.query(`drop database if exists ${d.datname}${values.forcar ? ' with (force)' : ''}`);
        apagados += 1;
      } catch (e) {
        falhas.push(`${d.datname}: ${e.message}`);
      }
    }
    const resto = await c.query('select count(*)::int as n from pg_database');
    console.log(`[limpar] apagados: ${apagados}; falhas: ${falhas.length}; bancos que ficaram no servidor: ${resto.rows[0].n}`);
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
