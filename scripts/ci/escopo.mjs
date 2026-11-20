#!/usr/bin/env node
/**
 * Escopo do CI (T-0033 → T-0160; ADR 0014 e ADR 0044). Sem dependência: node:child_process, node:fs e fetch do Node 24.
 *
 * escopo:
 *   - "documentacao"  → TODO arquivo alterado é documentação: .coord/**, docs/** e *.md da raiz, menos as pastas que o
 *                       código lê (as dos inputs `$TURBO_ROOT$/docs/...` do turbo.json, ex.: docs/modulos/, que o teste da
 *                       Integração lê). Roda só a governança e o ci-ok. A guarda R4 (grafo-turbo.mjs) prova que nenhum
 *                       código lê documentação fora dessas pastas.
 *   - "reaproveitado" → push ao main de uma árvore (tree SHA) que já passou VERDE no CI com os testes (manual; run de PR
 *                       não conta, porque não roda as suítes): a governança roda (donos por commit, trailer) e o estático
 *                       não se repete.
 *   - "codigo"        → o resto. Lista vazia, erro de git e evento sem lista caem aqui, com TODOS os pacotes.
 *                       PR e push ao main: só o job estatico, o CI leve (R-20261120-073449-alexandre). testes-pacotes e
 *                       testes-integracao rodam só no manual (workflow_dispatch: o ensaio e a suíte da versão) e na
 *                       chamada do producao-liberar.yml (workflow_call, que chega aqui com o evento workflow_dispatch do
 *                       liberar), uma vez por versão, e na sessão antes de cada push. Só o run com as suítes grava o
 *                       artefato ci-verde-* (ci.yml).
 * matriz:
 *   - "completa" → manual com `completo` (a suíte da versão sempre): todos os pacotes.
 *   - "afetados" → PR, push ao main e ensaio (manual): só os pacotes alterados e os que dependem deles (dependência
 *                  declarada no package.json ou pasta nos inputs da tarefa no turbo.json), por tarefa. O tests/ da raiz
 *                  (lint, typecheck e a suíte de integração) roda inteiro sempre que há código.
 *
 * Base da comparação:
 *   PR       → HEAD^1..HEAD (o checkout do PR é o commit de merge com a base);
 *   push     → último push do main com CI verde (API), se for ancestral do DEPOIS; senão ANTES. Com cancel-in-progress, o
 *              push cancelado não deixa commit sem verificação de donos nem pacote sem o estático;
 *   manual   → merge-base(origin/main, HEAD)..HEAD (o ensaio do branch verificacao/*); no próprio main = todos.
 *
 * Uso no CI: node scripts/ci/escopo.mjs (lê GITHUB_EVENT_NAME, ANTES, DEPOIS, COMPLETO, GITHUB_REPOSITORY, GH_TOKEN;
 * escreve em $GITHUB_OUTPUT). MACUXI_CI_SEM_API=1 não consulta a API (testes).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ZEROS = /^0+$/;

/** Pastas de documentação (nenhum código as lê fora das pastas dos inputs do turbo — guarda R4). Mais os *.md da raiz. */
export const DOCUMENTACAO = ['.coord/', 'docs/'];

/** Pastas de documentação que o código lê (inputs `$TURBO_ROOT$/<pasta>/**` do turbo.json dentro de DOCUMENTACAO). */
export function lidosPeloCodigo(turbo) {
  const pastas = new Set();
  for (const t of Object.values(turbo?.tasks ?? {})) {
    for (const g of t.inputs ?? []) {
      const m = /^\$TURBO_ROOT\$\/(.+?)\/\*\*$/.exec(g);
      if (m && DOCUMENTACAO.some((d) => `${m[1]}/`.startsWith(d))) pastas.add(`${m[1]}/`);
    }
  }
  return [...pastas].sort();
}

/** Documentação = .coord/**, docs/** e *.md da raiz, fora das pastas que o código lê. */
export function ehDocumentacao(arquivo, lidos = []) {
  const a = arquivo.trim();
  if (!a) return false;
  if (lidos.some((l) => a.startsWith(l))) return false;
  if (!a.includes('/')) return a.endsWith('.md');
  return DOCUMENTACAO.some((d) => a.startsWith(d));
}

/** "documentacao" só se a lista não é vazia e TODO caminho é documentação; senão "codigo". */
export function classificar(arquivos, lidos = []) {
  const lista = arquivos.map((a) => a.trim()).filter(Boolean);
  if (lista.length === 0) return 'codigo';
  return lista.every((a) => ehDocumentacao(a, lidos)) ? 'documentacao' : 'codigo';
}

// ---------- grafo do workspace ----------

const TAREFAS = ['lint', 'typecheck', 'test'];

/** Pacotes do workspace (apps/*, packages/*, modules/*, db) com as dependências do workspace declaradas, e o turbo.json. */
export function lerWorkspace(raiz) {
  const dirs = [];
  for (const grupo of ['apps', 'packages', 'modules']) {
    const g = join(raiz, grupo);
    if (!existsSync(g)) continue;
    for (const n of readdirSync(g).sort())
      if (existsSync(join(g, n, 'package.json'))) dirs.push(`${grupo}/${n}`);
  }
  if (existsSync(join(raiz, 'db', 'package.json'))) dirs.push('db');
  const pacotes = dirs.map((dir) => {
    const pj = JSON.parse(readFileSync(join(raiz, dir, 'package.json'), 'utf8'));
    const deps = {
      ...pj.dependencies,
      ...pj.devDependencies,
      ...pj.peerDependencies,
      ...pj.optionalDependencies,
    };
    return {
      nome: pj.name,
      dir,
      deps: Object.keys(deps).filter((d) => String(deps[d]).startsWith('workspace:')),
    };
  });
  const turbo = existsSync(join(raiz, 'turbo.json'))
    ? JSON.parse(readFileSync(join(raiz, 'turbo.json'), 'utf8'))
    : { tasks: {} };
  return { pacotes, turbo };
}

/** Pastas `$TURBO_ROOT$/<pasta>/**` dos inputs de `<pacote>#<tarefa>` (as dependências fora do grafo declarado). */
function pastasDosInputs(turbo, nome, tarefa) {
  const def = turbo.tasks?.[`${nome}#${tarefa}`];
  return (def?.inputs ?? [])
    .map((g) => /^\$TURBO_ROOT\$\/(.+?)\/\*\*$/.exec(g)?.[1])
    .filter(Boolean)
    .map((p) => `${p}/`);
}

/**
 * Pacotes afetados, por tarefa: os alterados, os que leem a pasta alterada (inputs do turbo.json) e os dependentes
 * declarados, em cadeia (o `transit` = `^transit` põe o hash das dependências no de cada pacote). `todos` = arquivo fora de
 * pacote, de tests/ e de documentação (package.json da raiz, lockfile, turbo.json, tsconfig, .github, scripts...).
 */
export function afetados(arquivos, { pacotes, turbo }) {
  const lidos = lidosPeloCodigo(turbo);
  const codigo = arquivos.map((a) => a.trim()).filter((a) => a && !ehDocumentacao(a, lidos));
  if (codigo.length === 0) return { todos: true };
  let todos = false;
  const diretos = new Set();
  for (const a of codigo) {
    const p = pacotes.find((x) => a.startsWith(`${x.dir}/`));
    if (p) diretos.add(p.nome);
    else if (!a.startsWith('tests/') && !lidos.some((l) => a.startsWith(l))) todos = true;
  }
  if (todos) return { todos: true };
  const porTarefa = {};
  for (const tarefa of TAREFAS) {
    const sel = new Set(diretos);
    for (const p of pacotes)
      if (pastasDosInputs(turbo, p.nome, tarefa).some((d) => codigo.some((a) => a.startsWith(d))))
        sel.add(p.nome);
    for (let mudou = true; mudou;) {
      mudou = false;
      for (const p of pacotes) {
        if (!sel.has(p.nome) && p.deps.some((d) => sel.has(d))) {
          sel.add(p.nome);
          mudou = true;
        }
      }
    }
    porTarefa[tarefa] = sel;
  }
  return { todos: false, porTarefa };
}

const filtro = (nomes, comRaiz) =>
  [...[...nomes].sort().map((n) => `--filter=${n}`), ...(comRaiz ? ['--filter=//'] : [])].join(' ');

/** Matriz completa: manual com `completo`. */
export const matrizCompleta = ({ evento, completo = false }) => evento === 'workflow_dispatch' && completo;

/**
 * Decisão (função pura). `arquivos` null = sem lista (erro de git, push sem base) → código, todos os pacotes.
 * `reaproveitado` = id do run verde da mesma árvore (push), ou null. Saída: o que o GITHUB_OUTPUT recebe.
 */
export function decidir({
  evento,
  arquivos,
  completo = false,
  workspace,
  reaproveitado = null,
}) {
  const matriz = matrizCompleta({ evento, completo }) ? 'completa' : 'afetados';
  const vazio = {
    matriz,
    jobs: [],
    filtro_lint: '',
    filtro_typecheck: '',
    filtro_test: '',
    build: 'false',
    db_sem_super: 'false',
    reaproveitado_de: '',
  };
  const forcado = evento === 'workflow_dispatch' && completo;
  if (
    !forcado &&
    arquivos?.length &&
    classificar(arquivos, lidosPeloCodigo(workspace.turbo)) === 'documentacao'
  )
    return { ...vazio, escopo: 'documentacao' };
  if (evento === 'push' && reaproveitado)
    return { ...vazio, escopo: 'reaproveitado', reaproveitado_de: String(reaproveitado) };
  const af = matriz === 'completa' || !arquivos?.length ? { todos: true } : afetados(arquivos, workspace);
  const todosOsPacotes = new Set(workspace.pacotes.map((p) => p.nome));
  const sel = (t) => (af.todos ? todosOsPacotes : af.porTarefa[t]);
  const testes = sel('test');
  const estatico = new Set([...sel('lint'), ...sel('typecheck')]);
  // Suítes só no manual e na chamada do liberar; PR e push só com o estático (cabeçalho).
  const comTestes = evento === 'workflow_dispatch';
  return {
    ...vazio,
    escopo: 'codigo',
    jobs: [
      'estatico',
      ...(comTestes && testes.size > 0 ? ['testes-pacotes'] : []),
      ...(comTestes ? ['testes-integracao'] : []),
    ],
    filtro_lint: af.todos ? '' : filtro(sel('lint'), true),
    filtro_typecheck: af.todos ? '' : filtro(sel('typecheck'), true),
    filtro_test: af.todos ? '' : filtro(testes, false),
    build: String(af.todos || estatico.has('web') || estatico.has('mobile')),
    db_sem_super: String(af.todos || testes.has('@macuxi/db')),
  };
}

// ---------- git e API (só no CLI) ----------

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tenta = (f) => {
  try {
    return f();
  } catch {
    return null;
  }
};
const gitArquivos = (a, b) => git('diff', '--name-only', '--no-renames', a, b).split('\n').filter(Boolean);

async function api(caminho, env) {
  if (env.MACUXI_CI_SEM_API === '1' || !env.GH_TOKEN || !env.GITHUB_REPOSITORY) return null;
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${caminho}`, {
    headers: {
      authorization: `Bearer ${env.GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`API ${caminho.split('?')[0]}: HTTP ${r.status}`);
  return r.json();
}

/** Base do push: último push do main com CI verde, se for ancestral do DEPOIS; senão ANTES ('' = sem intervalo). */
async function baseDoPush(env) {
  const antes = env.ANTES && !ZEROS.test(env.ANTES) ? env.ANTES : '';
  try {
    const j = await api(
      'actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=1',
      env,
    );
    const verde = j?.workflow_runs?.[0]?.head_sha;
    if (
      verde &&
      verde !== env.DEPOIS &&
      tenta(() => git('merge-base', '--is-ancestor', verde, env.DEPOIS)) !== null
    )
      return verde;
  } catch (e) {
    console.warn(`[escopo] último push verde do main indisponível (${e.message}): base = ANTES`);
  }
  return antes;
}

/** Run VERDE do CI que testou a mesma árvore (artefato ci-verde-<matriz>-<arvore>; a árvore é conferida no commit do run). */
async function verificacaoDaArvore(arvore, env) {
  const nomes = [`ci-verde-completa-${arvore}`, `ci-verde-afetados-${arvore}`];
  try {
    for (const nome of nomes) {
      const j = await api(`actions/artifacts?name=${encodeURIComponent(nome)}&per_page=10`, env);
      for (const art of j?.artifacts ?? []) {
        if (art.expired || !art.workflow_run?.id) continue;
        const run = await api(`actions/runs/${art.workflow_run.id}`, env);
        if (run?.conclusion !== 'success' || run?.path !== '.github/workflows/ci.yml') continue;
        // Run de PR não dispensa os testes (cabeçalho).
        if (run?.event === 'pull_request') continue;
        // Mesma árvore no commit do run = o ci.yml que rodou é o desta árvore: um branch com outro ci.yml não forja o artefato.
        if (tenta(() => git('cat-file', '-e', `${run.head_sha}^{commit}`)) === null)
          tenta(() => git('fetch', '-q', '--depth=1', 'origin', run.head_sha));
        if (tenta(() => git('rev-parse', `${run.head_sha}^{tree}`)) === arvore) return run.id;
      }
    }
  } catch (e) {
    console.warn(`[escopo] verificação anterior indisponível (${e.message}): roda o que mudou`);
  }
  return null;
}

async function arquivosDoEvento(evento, env) {
  try {
    if (evento === 'pull_request') return { base: '', arquivos: gitArquivos('HEAD^1', 'HEAD') };
    if (evento === 'push') {
      const base = await baseDoPush(env);
      return { base, arquivos: base && env.DEPOIS ? gitArquivos(base, env.DEPOIS) : null };
    }
    if (evento === 'workflow_dispatch') {
      const mb = tenta(() => git('merge-base', 'origin/main', 'HEAD'));
      return { base: mb ?? '', arquivos: mb ? gitArquivos(mb, 'HEAD') : null };
    }
  } catch (e) {
    console.warn(`[escopo] git falhou (${e.message.split('\n')[0]}): todos os pacotes`);
  }
  return { base: '', arquivos: null };
}

async function principal(env) {
  const evento = env.GITHUB_EVENT_NAME;
  const workspace = lerWorkspace(process.cwd());
  const arvore = tenta(() => git('rev-parse', 'HEAD^{tree}')) ?? '';
  const { base, arquivos } = await arquivosDoEvento(evento, env);
  const completo = env.COMPLETO === 'true';
  const reaproveitado = evento === 'push' && arvore ? await verificacaoDaArvore(arvore, env) : null;
  const d = decidir({ evento, arquivos, completo, workspace, reaproveitado });
  console.log(
    `[escopo] evento=${evento} base=${base || '-'} arquivos=${arquivos === null ? '?' : arquivos.length} escopo=${d.escopo} matriz=${d.matriz} jobs=${d.jobs.join(',') || '-'}`,
  );
  if (d.reaproveitado_de)
    console.log(`[escopo] árvore ${arvore} já verde no run ${d.reaproveitado_de}: o estático não se repete`);
  for (const k of ['filtro_lint', 'filtro_typecheck', 'filtro_test'])
    console.log(`  ${k}: ${d[k] || '(todos)'}`);
  if (arquivos) for (const a of arquivos.slice(0, 50)) console.log(`  ${a}`);
  const linhas = [
    `escopo=${d.escopo}`,
    `matriz=${d.matriz}`,
    `base=${base}`,
    `arvore=${arvore}`,
    `jobs=${JSON.stringify(d.jobs)}`,
    `filtro_lint=${d.filtro_lint}`,
    `filtro_typecheck=${d.filtro_typecheck}`,
    `filtro_test=${d.filtro_test}`,
    `build=${d.build}`,
    `db_sem_super=${d.db_sem_super}`,
    `reaproveitado_de=${d.reaproveitado_de}`,
  ];
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${linhas.join('\n')}\n`);
  else console.log(linhas.join('\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await principal(process.env);
}
