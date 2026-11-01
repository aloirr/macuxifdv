#!/usr/bin/env node
/**
 * Guarda do cache do Turborepo (T-0033, ADR 0013). Sem dependência: só node:fs/node:path.
 *
 * O turbo só invalida o cache de uma tarefa quando muda (a) um arquivo do próprio pacote, (b) o hash de uma
 * dependência DECLARADA no package.json (via a tarefa `transit`) ou (c) um arquivo listado em `inputs`.
 * Import de pacote do workspace não declarado, import relativo que sai da pasta do pacote e leitura de arquivo
 * por caminho relativo (`resolve(__dirname, '../../../docs/...')`) escapam do hash — o cache devolveria
 * "verde" para um código que mudou por baixo. Este script falha o CI quando isso acontece sem cobertura.
 *
 * Regras (para cada pacote e para a "unidade" tests/ da raiz, em cada tarefa com cache ligado):
 *  R1. lint, typecheck e test (genéricos e por pacote) dependem de `transit` (hash das dependências declaradas).
 *  R2. Toda dependência fora do grafo declarado (import de @macuxi/* não declarado, import relativo ou — só para
 *      `test` — caminho literal `../` que sai da pasta) precisa estar coberta por um glob `$TURBO_ROOT$/<pasta>/**` nos `inputs`
 *      da tarefa (`<pacote>#<tarefa>` no turbo.json da raiz).
 *  R3. Tarefa com glob `$TURBO_ROOT$/...` nos inputs também exclui node_modules, .turbo, .next, .expo, dist e
 *      *.tsbuildinfo (EXCLUSOES_RAIZ), senão o hash muda sozinho e o cache nunca acerta (ou acerta por acaso).
 *
 * Uso: node scripts/ci/grafo-turbo.mjs [--json]   (saída 0 = ok; 1 = falha de cobertura; 2 = erro de uso)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_PADRAO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAREFAS = ['lint', 'typecheck', 'test'];
const IGNORAR_PASTAS = new Set(['node_modules', '.next', 'dist', '.turbo', '.expo', 'android', 'ios', 'coverage']);
/** Exclusões obrigatórias quando a tarefa usa glob `$TURBO_ROOT$/...`: o glob explícito do turbo NÃO respeita o
 *  .gitignore, e logs/artefatos (`.turbo/turbo-*.log`, `*.tsbuildinfo`) mudariam o hash a cada execução (R3). */
export const EXCLUSOES_RAIZ = ['node_modules/**', '.turbo/**', '.next/**', '.expo/**', 'dist/**', '*.tsbuildinfo'].map((x) => `!$TURBO_ROOT$/**/${x}`);
const EXTENSOES = /\.(?:[cm]?[jt]sx?)$/;

/** Unidade do tests/ da raiz: tarefas raiz do turbo (`//#lint:tests` etc.). */
const UNIDADE_TESTS = { nome: '//', dir: 'tests', tarefas: { lint: 'lint:tests', typecheck: 'typecheck:tests', test: 'test:tests' }, declaradas: new Set() };

const posix = (p) => p.split(sep).join('/');

function* arquivosFonte(dirAbs) {
  if (!existsSync(dirAbs)) return;
  for (const nome of readdirSync(dirAbs)) {
    if (IGNORAR_PASTAS.has(nome) || nome.startsWith('.')) continue;
    const abs = join(dirAbs, nome);
    const st = statSync(abs);
    if (st.isDirectory()) yield* arquivosFonte(abs);
    else if (EXTENSOES.test(nome) && !nome.endsWith('.d.ts')) yield abs;
  }
}

/** Pacotes do workspace (pnpm-workspace.yaml: apps/*, packages/*, modules/*, db). */
export function lerPacotes(raiz) {
  const dirs = [];
  for (const grupo of ['apps', 'packages', 'modules']) {
    const g = join(raiz, grupo);
    if (!existsSync(g)) continue;
    for (const n of readdirSync(g)) if (existsSync(join(g, n, 'package.json'))) dirs.push(`${grupo}/${n}`);
  }
  if (existsSync(join(raiz, 'db', 'package.json'))) dirs.push('db');
  return dirs.map((dir) => {
    const pj = JSON.parse(readFileSync(join(raiz, dir, 'package.json'), 'utf8'));
    const scripts = pj.scripts ?? {};
    const tarefas = Object.fromEntries(TAREFAS.filter((t) => scripts[t]).map((t) => [t, t]));
    const declaradas = new Set(Object.keys({ ...pj.dependencies, ...pj.devDependencies, ...pj.peerDependencies, ...pj.optionalDependencies }));
    return { nome: pj.name, dir, tarefas, declaradas };
  });
}

/** Dependências fora do grafo declarado de uma unidade: [{ alvo: 'modules/core/...', motivo, arquivo }]. */
export function dependenciasForaDoGrafo(raiz, unidade, pacotes) {
  const porNome = new Map(pacotes.map((p) => [p.nome, p]));
  const base = join(raiz, unidade.dir);
  const achados = [];
  const ja = new Set();
  const anotar = (alvo, motivo, arquivo) => {
    const chave = `${alvo}|${motivo}`;
    if (ja.has(chave)) return;
    ja.add(chave);
    achados.push({ alvo, motivo, arquivo: posix(relative(raiz, arquivo)) });
  };
  for (const arq of arquivosFonte(base)) {
    const src = readFileSync(arq, 'utf8');
    // imports/exports/require/import() com especificador literal
    for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"\n]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('.')) {
        const alvo = posix(relative(raiz, resolve(dirname(arq), spec)));
        if (!dentro(alvo, unidade.dir)) anotar(alvo, 'import relativo fora do pacote', arq);
        continue;
      }
      const nome = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      const alvoPkg = porNome.get(nome);
      if (alvoPkg && nome !== unidade.nome && !unidade.declaradas.has(nome)) anotar(alvoPkg.dir, `import de ${nome} não declarado no package.json`, arq);
    }
    // caminho literal relativo lido em tempo de execução (ex.: resolve(__dirname, '../../../docs/x.md'))
    for (const m of src.matchAll(/['"`]((?:\.\.\/)+[^'"`\n$]*)['"`]/g)) {
      const alvo = posix(relative(raiz, resolve(dirname(arq), m[1])));
      if (!dentro(alvo, unidade.dir) && !alvo.startsWith('..')) anotar(alvo, LEITURA, arq);
    }
  }
  return achados;
}

/** Leitura de arquivo em tempo de execução: só afeta o resultado da tarefa `test` (lint e typecheck não leem). */
const LEITURA = 'caminho relativo fora do pacote (leitura em tempo de execução)';

const dentro = (alvo, dir) => alvo === dir || alvo.startsWith(`${dir}/`);

/** Definição efetiva da tarefa: `<pacote>#<tarefa>` (ou `//#<tarefa>`) se existir; senão a genérica. */
function definicao(turbo, unidade, tarefa) {
  const nomeTarefa = unidade.tarefas[tarefa];
  return turbo.tasks[`${unidade.nome}#${nomeTarefa}`] ?? (unidade.nome === '//' ? undefined : turbo.tasks[nomeTarefa]);
}

function cobre(inputs, alvo) {
  return (inputs ?? []).some((g) => {
    const m = /^\$TURBO_ROOT\$\/(.+?)\/\*\*$/.exec(g);
    return m ? dentro(alvo, m[1]) : false;
  });
}

export function verificar(raiz = RAIZ_PADRAO) {
  const turbo = JSON.parse(readFileSync(join(raiz, 'turbo.json'), 'utf8'));
  const pacotes = lerPacotes(raiz);
  const problemas = [];
  if (!turbo.tasks.transit || !(turbo.tasks.transit.dependsOn ?? []).includes('^transit')) {
    problemas.push('turbo.json: falta a tarefa "transit" com dependsOn ["^transit"] (R1)');
  }
  for (const unidade of [...pacotes, UNIDADE_TESTS]) {
    const deps = dependenciasForaDoGrafo(raiz, unidade, pacotes);
    for (const tarefa of Object.keys(unidade.tarefas)) {
      const def = definicao(turbo, unidade, tarefa);
      const id = `${unidade.nome}#${unidade.tarefas[tarefa]}`;
      if (!def) {
        if (unidade.nome === '//') problemas.push(`${id}: tarefa raiz sem definição no turbo.json`);
        continue;
      }
      if (def.cache === false) continue; // sem cache, sem risco de resultado velho
      const inputs = def.inputs ?? [];
      if (inputs.some((g) => g.startsWith('$TURBO_ROOT$/'))) {
        const faltam = EXCLUSOES_RAIZ.filter((x) => !inputs.includes(x));
        if (faltam.length) problemas.push(`${id}: inputs com $TURBO_ROOT$ sem as exclusões ${faltam.join(', ')} (R3)`);
      }
      if (unidade.nome !== '//' && !(def.dependsOn ?? []).includes('transit')) problemas.push(`${id}: dependsOn precisa de "transit" (R1)`);
      for (const d of deps) {
        if (d.motivo === LEITURA && tarefa !== 'test') continue;
        if (!cobre(def.inputs, d.alvo)) problemas.push(`${id}: ${d.motivo} → ${d.alvo} (${d.arquivo}) sem "$TURBO_ROOT$/<pasta>/**" nos inputs (R2)`);
      }
    }
  }
  return problemas;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const problemas = verificar();
    if (process.argv.includes('--json')) console.log(JSON.stringify(problemas, null, 2));
    else if (problemas.length === 0) console.log('[grafo-turbo] ok: cache do turbo cobre todas as dependências fora do grafo declarado.');
    else {
      console.error(`[grafo-turbo] ${problemas.length} problema(s) — o cache do turbo poderia devolver resultado velho:`);
      for (const p of problemas) console.error(`  - ${p}`);
      console.error('Corrija declarando a dependência no package.json do pacote ou cobrindo a pasta nos inputs da tarefa no turbo.json (ADR 0013).');
    }
    process.exit(problemas.length ? 1 : 0);
  } catch (e) {
    console.error(`[grafo-turbo] erro: ${e.message}`);
    process.exit(2);
  }
}
