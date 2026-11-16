#!/usr/bin/env node
/**
 * Escopo do "antes do push" (agente testes, R-20261115-213600-alexandre): a MESMA decisão do CI (`decidir` de
 * scripts/ci/escopo.mjs, modo manual = merge-base com origin/main), sem alterar o script do CI. Diferença única: a lista
 * de arquivos inclui o que ainda não foi commitado (diff da árvore de trabalho contra o merge-base + arquivos novos não
 * ignorados), para o comando servir antes e depois do `git commit --amend`.
 *
 *   node tests/scripts/escopo-local.mjs [--base origin/main]
 *
 * Saída (linhas CHAVE=valor, lidas pelo tests/scripts/rodar-antes-do-push.sh):
 *   base, arquivos (quantidade), escopo (documentacao|codigo|vazio), filtro_test, db_sem_super, pacotes (nenhum|filtro|todos).
 * "vazio" = nada mudou contra a base (o CI trataria lista vazia como "todos os pacotes"; aqui não roda nada).
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decidir, lerWorkspace } from '../../scripts/ci/escopo.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const git = (...a) =>
  execFileSync('git', a, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const linhas = (s) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const i = process.argv.indexOf('--base');
const ref = i > 0 ? process.argv[i + 1] : 'origin/main';
const base = git('merge-base', ref, 'HEAD');
const arquivos = [
  ...new Set([
    ...linhas(git('diff', '--name-only', '--no-renames', base)),
    ...linhas(git('ls-files', '--others', '--exclude-standard')),
  ]),
].sort();

// Data fixa numa segunda-feira: a matriz "completa" de sexta-feira (véspera da produção) é do push ao main, não do PR.
const d =
  arquivos.length === 0
    ? { escopo: 'vazio', filtro_test: '', db_sem_super: 'false' }
    : decidir({
        evento: 'workflow_dispatch',
        arquivos,
        agora: new Date('2026-11-16T15:00:00Z'),
        workspace: lerWorkspace(RAIZ),
      });

console.log(`base=${base}`);
console.log(`arquivos=${arquivos.length}`);
console.log(`escopo=${d.escopo}`);
console.log(`filtro_test=${d.filtro_test}`);
console.log(`db_sem_super=${d.db_sem_super}`);
// Sem o job testes-pacotes = nenhum pacote (só tests/ mudou). Com ele e filtro vazio = todos os pacotes (arquivo fora de
// pacote: lockfile, turbo.json, scripts...), como no CI.
const comPacotes = (d.jobs ?? []).includes('testes-pacotes');
console.log(`pacotes=${!comPacotes ? 'nenhum' : d.filtro_test ? 'filtro' : 'todos'}`);
