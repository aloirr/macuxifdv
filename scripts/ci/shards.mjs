#!/usr/bin/env node
/**
 * Shards do job testes-pacotes do CI (R-20261114-221000-alexandre: CI de ~13 para 8–10 min). Sem dependência: node:fs.
 *
 * Divide os pacotes do filtro de testes do escopo (filtro_test do escopo.mjs) entre TOTAL shards, por peso:
 *   - peso de um pacote = nº de arquivos *.test.* na pasta dele (fora de node_modules, .turbo, .next, .expo e dist);
 *     *.db.test.* pesa 3 (banco efêmero, migração); mínimo 1;
 *   - com DB_SEM_SUPER, entra o item virtual "(admin sem superusuário)" com o peso do @macuxi/db (a suíte do db de novo,
 *     no Postgres 5433 do mesmo job, T-0075).
 * Divisão LPT determinística: maior peso primeiro (empate pelo nome) vai para o shard de menor soma (empate no menor índice).
 *
 * Uso no CI: SHARD=1 TOTAL=3 FILTRO="--filter=a --filter=b" DB_SEM_SUPER=true node scripts/ci/shards.mjs
 *   FILTRO vazio = todos os pacotes; `--filter=//` (raiz) é ignorado. Saída no $GITHUB_OUTPUT (fora do CI, no stdout):
 *     filtro=<--filter=... do shard>   db_sem_super=true|false   vazio=true|false (nenhum pacote turbo no shard)
 * CRÍTICO: shard com vazio=true NÃO chama `turbo run test` (sem filtro o turbo rodaria todos os pacotes).
 * Saída: 0 = ok; 2 = erro de uso.
 */
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerWorkspace } from './escopo.mjs';

export const SEM_SUPER = '(admin sem superusuário)';
const IGNORADAS = new Set(['node_modules', '.turbo', '.next', '.expo', 'dist']);

/** Peso de uma pasta de pacote: arquivos *.test.* (os *.db.test.* pesam 3), mínimo 1. */
export function pesoDaPasta(pasta) {
  let peso = 0;
  const pilha = [pasta];
  while (pilha.length) {
    const d = pilha.pop();
    if (!existsSync(d)) continue;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!IGNORADAS.has(e.name)) pilha.push(join(d, e.name));
      } else if (/\.db\.test\.[^.]+$/.test(e.name)) peso += 3;
      else if (/\.test\.[^.]+$/.test(e.name)) peso += 1;
    }
  }
  return Math.max(1, peso);
}

/** Nomes do filtro do turbo (`--filter=a --filter=b`), sem a raiz (`--filter=//`). Vazio = null (todos). */
export function nomesDoFiltro(filtro) {
  const nomes = String(filtro ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const m = /^--filter=(.+)$/.exec(t);
      if (!m) throw new Error(`filtro inválido: "${t}" (esperado --filter=<pacote>)`);
      return m[1];
    })
    .filter((n) => n !== '//');
  return nomes.length ? nomes : null;
}

/**
 * Divisão LPT (função pura). itens: [{ nome, peso, virtual? }]. Devolve TOTAL listas com os itens de cada shard.
 */
export function dividir(itens, total) {
  const ordem = [...itens].sort(
    (a, b) => b.peso - a.peso || (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0),
  );
  const shards = Array.from({ length: total }, () => ({ itens: [], soma: 0 }));
  for (const it of ordem) {
    let alvo = 0;
    for (let i = 1; i < total; i++) if (shards[i].soma < shards[alvo].soma) alvo = i;
    shards[alvo].itens.push(it);
    shards[alvo].soma += it.peso;
  }
  return shards;
}

/** Itens a dividir: os pacotes do filtro (todos, se vazio) com o peso e, com dbSemSuper, o item virtual do admin. */
export function itensDoWorkspace({ pacotes }, raiz, filtro, dbSemSuper) {
  const nomes = nomesDoFiltro(filtro) ?? pacotes.map((p) => p.nome);
  const peso = (nome) => {
    const p = pacotes.find((x) => x.nome === nome);
    return p ? pesoDaPasta(join(raiz, p.dir)) : 1;
  };
  const itens = [...new Set(nomes)].map((nome) => ({ nome, peso: peso(nome) }));
  if (dbSemSuper) itens.push({ nome: SEM_SUPER, peso: peso('@macuxi/db'), virtual: true });
  return itens;
}

/** Decisão do shard (1-based). Saída: o que o GITHUB_OUTPUT recebe, mais a divisão inteira (para o log). */
export function decidirShard({ shard, total, itens }) {
  const divisao = dividir(itens, total);
  const meus = divisao[shard - 1].itens;
  const pacotes = meus
    .filter((i) => !i.virtual)
    .map((i) => i.nome)
    .sort();
  return {
    filtro: pacotes.map((n) => `--filter=${n}`).join(' '),
    db_sem_super: String(meus.some((i) => i.virtual)),
    vazio: String(pacotes.length === 0),
    divisao,
  };
}

/** Lê e valida SHARD e TOTAL (inteiros, 1 ≤ SHARD ≤ TOTAL). Erro = exceção (saída 2). */
export function lerParametros(env) {
  const total = Number(env.TOTAL);
  const shard = Number(env.SHARD);
  if (!Number.isInteger(total) || total < 1) throw new Error(`TOTAL inválido: "${env.TOTAL ?? ''}"`);
  if (!Number.isInteger(shard) || shard < 1 || shard > total)
    throw new Error(`SHARD inválido: "${env.SHARD ?? ''}" (de 1 a ${total})`);
  return { shard, total, filtro: env.FILTRO ?? '', dbSemSuper: env.DB_SEM_SUPER === 'true' };
}

function principal(env) {
  const raiz = process.cwd();
  const { shard, total, filtro, dbSemSuper } = lerParametros(env);
  const itens = itensDoWorkspace(lerWorkspace(raiz), raiz, filtro, dbSemSuper);
  const d = decidirShard({ shard, total, itens });
  d.divisao.forEach((s, i) =>
    console.log(
      `[shards] ${i + 1}/${total}${i + 1 === shard ? ' (este)' : ''} peso ${s.soma}: ${s.itens.map((x) => `${x.nome}=${x.peso}`).join(' ') || '-'}`,
    ),
  );
  const linhas = [`filtro=${d.filtro}`, `db_sem_super=${d.db_sem_super}`, `vazio=${d.vazio}`];
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${linhas.join('\n')}\n`);
  else console.log(linhas.join('\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    principal(process.env);
  } catch (e) {
    console.error(`::error title=shards::${e.message}`);
    process.exit(2);
  }
}
