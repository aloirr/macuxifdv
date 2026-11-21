#!/usr/bin/env node
/**
 * Conferência da execução de origem do apk-publicar.yml (T-0190, ADR 0065). Sem dependência: node:child_process.
 *
 * O android-build.yml é disparado NA TAG da versão (ex.: v1.0.18 → run 44863193919, head_branch "v1.0.18"), então a
 * execução de origem vale quando:
 *   - é do .github/workflows/android-build.yml e terminou com sucesso; e
 *   - o head_branch é a tag v<versão> da versão informada, a tag existe no repositório e aponta (tag anotada resolvida
 *     até o commit) para o mesmo head_sha da execução; ou
 *   - o head_branch é o main (build disparado pelo main; o nome do artefato já carrega a versão).
 * Qualquer outro branch ou tag falha fechado.
 *
 * Uso no workflow: VERSAO (X.Y.Z), RUN_ID, GITHUB_REPOSITORY e GH_TOKEN no ambiente; `node scripts/ci/apk-origem.mjs`.
 * Saída: 0 = ok; 1 = conferência falhou ou entrada inválida (com ::error::).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKFLOW_BUILD = '.github/workflows/android-build.yml';
export const VERSAO_APP = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
export const SHA_COMPLETO = /^[0-9a-f]{40}$/;

/**
 * Decisão (função pura). `tagSha` = commit para onde a tag v<versão> aponta, ou null se a tag não existe.
 * @returns {string | null} mensagem de erro, ou null quando a execução de origem vale
 */
export function erroDaOrigem({ versao, runId, caminho, conclusao, ramo, sha, tagSha }) {
  if (!VERSAO_APP.test(String(versao || ''))) return `versão inválida: "${versao}" (use X.Y.Z)`;
  if (caminho !== WORKFLOW_BUILD) return `a execução ${runId} não é do android-build.yml (${caminho || '?'})`;
  if (conclusao !== 'success') return `a execução ${runId} não terminou verde (${conclusao || '?'})`;
  if (!SHA_COMPLETO.test(String(sha || ''))) return `a execução ${runId} não tem head_sha válido (${sha || '?'})`;
  if (ramo === 'main') return null;
  const tag = `v${versao}`;
  if (ramo !== tag) return `a execução ${runId} não é da tag ${tag} nem do main (${ramo || '?'})`;
  if (!tagSha) return `a tag ${tag} não existe no repositório`;
  if (tagSha !== sha) return `a tag ${tag} aponta para ${tagSha}, não para o commit da execução ${runId} (${sha})`;
  return null;
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

/**
 * Commit da tag (tag leve ou anotada, resolvida até o commit), ou null se a tag não existe.
 * `api(args)` devolve a saída do `gh api` ou lança (injetável nos testes).
 */
export function commitDaTag({ repositorio, tag }, api = gh) {
  let tipo;
  let alvo;
  try {
    [tipo, alvo] = api(['api', `repos/${repositorio}/git/ref/tags/${tag}`, '--jq', '[.object.type,.object.sha]|@tsv']).split('\t');
  } catch {
    return null; // 404: a tag não existe (ou ref/tags devolveu lista por prefixo, que o --jq não aceita)
  }
  for (let i = 0; tipo === 'tag' && i < 5; i++)
    [tipo, alvo] = api(['api', `repos/${repositorio}/git/tags/${alvo}`, '--jq', '[.object.type,.object.sha]|@tsv']).split('\t');
  return tipo === 'commit' && SHA_COMPLETO.test(String(alvo || '')) ? alvo : null;
}

/** Busca a execução (uma chamada só) e a tag, e aplica a decisão. */
export function conferirOrigem({ versao, runId, repositorio }, api = gh) {
  if (!/^[0-9]{1,20}$/.test(String(runId || ''))) return `run_id inválido: "${runId}"`;
  if (!repositorio) return 'falta GITHUB_REPOSITORY';
  if (!VERSAO_APP.test(String(versao || ''))) return `versão inválida: "${versao}" (use X.Y.Z)`;
  let caminho, conclusao, ramo, sha;
  try {
    [caminho, conclusao, ramo, sha] = api([
      'api', `repos/${repositorio}/actions/runs/${runId}`, '--jq', '[.path,.conclusion,.head_branch,.head_sha]|@tsv',
    ]).split('\t');
  } catch {
    return `a execução ${runId} não foi encontrada`;
  }
  const tagSha = ramo === `v${versao}` ? commitDaTag({ repositorio, tag: ramo }, api) : null;
  return erroDaOrigem({ versao, runId, caminho, conclusao, ramo, sha, tagSha });
}

function principal(env) {
  try {
    const e = conferirOrigem({ versao: env.VERSAO, runId: env.RUN_ID, repositorio: env.GITHUB_REPOSITORY });
    if (e) return console.log(`::error::${e}`), 1;
  } catch (err) {
    return console.log(`::error::conferência da origem falhou: ${err.message}`), 1;
  }
  console.log(`[apk] execução ${env.RUN_ID} do android-build.yml aceita para a v${env.VERSAO}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = principal(process.env);
}
