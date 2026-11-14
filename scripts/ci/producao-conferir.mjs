#!/usr/bin/env node
/**
 * Conferência da publicação de PRODUÇÃO, usada pelos dois workflows (R-20261114-121700-alexandre: "Acabei com esse
 * negócio de eu entrar para criar tag. Quero só aprovar"). Sem dependência: node:child_process e node:fs.
 *
 *   producao-liberar.yml  — `entrada` (versão vX.Y.Z nova, SHA completo, disparo pelo main) e `conferir`; depois cria a
 *                           tag com o GITHUB_TOKEN e dispara o producao-publicar.yml na tag;
 *   producao-publicar.yml — `ref` (push de tag v* ou disparo manual NA tag v*) e `conferir`.
 *
 * Modos (tudo por variável de ambiente, nada interpolado no shell):
 *   ref       GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_REF_NAME → o publicar só roda numa tag v* (push ou workflow_dispatch).
 *   entrada   VERSAO, SHA, GITHUB_REF, GITHUB_REPOSITORY, GH_TOKEN → versão vX.Y.Z, SHA de 40 hex, liberar disparado do
 *             main e a tag ainda não existe no GitHub.
 *   conferir  SHA, VERSAO, DONO, GITHUB_REPOSITORY, GH_TOKEN → o commit está no main (origin/main do checkout com
 *             fetch-depth 0), tem CI verde de push no main e a imagem ghcr.io/<dono>/macuxi-api:<sha> existe no GHCR
 *             (docker login feito antes). Escreve sha, versao, dono e api (por digest) em $GITHUB_OUTPUT.
 * Saída: 0 = ok; 1 = conferência falhou (com ::error::); 2 = erro de uso.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TAG_PUBLICAR = /^v[0-9A-Za-z._-]{1,64}$/;
export const VERSAO_LIBERAR = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
export const SHA_COMPLETO = /^[0-9a-f]{40}$/;
export const DIGEST = /^sha256:[a-f0-9]{64}$/;
export const EVENTOS_PUBLICAR = ['push', 'workflow_dispatch'];

/** O producao-publicar roda nesta ref? Só tag v*, por push ou disparo manual (o environment PRODUCAO só aceita tag). */
export function erroDaRef({ evento, ref, tag }) {
  if (!EVENTOS_PUBLICAR.includes(evento)) return `evento ${evento || '?'} não publica produção (só push de tag ou disparo na tag)`;
  if (!String(ref || '').startsWith('refs/tags/v')) return `só tag v* publica produção (ref: ${ref || '?'})`;
  if (!TAG_PUBLICAR.test(String(tag || ''))) return `tag inválida: ${tag}`;
  return null;
}

/** Entrada do "producao — liberar versão" (função pura; a existência da tag é conferida à parte). */
export function errosDaEntrada({ versao, sha, ref }) {
  const erros = [];
  if (ref !== 'refs/heads/main') erros.push(`dispare o "producao — liberar versão" pelo main (ref: ${ref || '?'})`);
  if (!VERSAO_LIBERAR.test(String(versao || ''))) erros.push(`versão inválida: "${versao}" (formato vX.Y.Z, ex.: v1.0.7)`);
  if (!SHA_COMPLETO.test(String(sha || ''))) erros.push(`SHA inválido: "${sha}" (40 caracteres hexadecimais minúsculos)`);
  return erros;
}

/** A tag já existe? `matching-refs` devolve as refs com o prefixo; vale só o nome exato. */
export function tagExiste(refs, versao) {
  return (Array.isArray(refs) ? refs : []).some((r) => r && r.ref === `refs/tags/${versao}`);
}

const executar = (cmd, args, opcoes = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opcoes });

/**
 * Commit no main, CI verde e imagem da API. `exec(cmd, args)` devolve a saída padrão ou lança (injetável nos testes).
 * @returns {{erro: string} | {sha: string, versao: string, dono: string, api: string}}
 */
export function conferir({ sha, versao, dono, repositorio }, exec = executar) {
  if (!SHA_COMPLETO.test(String(sha || ''))) return { erro: `SHA inválido: "${sha}"` };
  const donoMin = String(dono || '').toLowerCase();
  if (!donoMin || !repositorio) return { erro: 'faltam DONO e GITHUB_REPOSITORY' };

  // fetch-depth: 0 já trouxe refs/remotes/origin/main (sem credencial guardada, não dá para fazer fetch de novo)
  try {
    exec('git', ['rev-parse', '--verify', '-q', 'origin/main']);
  } catch {
    return { erro: 'origin/main ausente no checkout' };
  }
  try {
    exec('git', ['merge-base', '--is-ancestor', sha, 'origin/main']);
  } catch {
    return { erro: `a versão ${versao} aponta para ${sha}, que não está no main` };
  }

  let n = 0;
  try {
    n = Number.parseInt(
      String(
        exec('gh', ['api', '-X', 'GET', `repos/${repositorio}/actions/workflows/ci.yml/runs`, '-f', `head_sha=${sha}`,
          '-f', 'event=push', '-f', 'branch=main', '-f', 'status=success', '--jq', '.total_count']),
      ).trim(),
      10,
    );
  } catch {
    n = 0;
  }
  if (!(n >= 1)) return { erro: `o commit ${sha} não tem CI verde de push no main: publique só um commit que passou no CI` };

  const img = `ghcr.io/${donoMin}/macuxi-api:${sha}`;
  let digest = '';
  try {
    // T-0154: a consulta ao GHCR também repete no 403/429/5xx (imagem inexistente não repete)
    digest = String(
      exec('bash', ['scripts/deploy/demo/ghcr-tentar.sh', 'digest da API no GHCR', '--',
        'docker', 'buildx', 'imagetools', 'inspect', img, '--format', '{{.Manifest.Digest}}']),
    ).trim();
  } catch {
    digest = '';
  }
  if (!DIGEST.test(digest))
    return { erro: `${img} não está no GHCR (o "demo — publicar" desse commit rodou verde? Commit só de .github/docs não monta imagem: rode o "demo — publicar" manual no main)` };

  return { sha, versao, dono: donoMin, api: `ghcr.io/${donoMin}/macuxi-api@${digest}`, ci: n };
}

const erro = (m) => console.log(`::error::${m}`);

function principal(modo, env) {
  if (modo === 'ref') {
    const e = erroDaRef({ evento: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, tag: env.GITHUB_REF_NAME });
    if (e) return erro(e), 1;
    console.log(`[producao] ${env.GITHUB_EVENT_NAME} na tag ${env.GITHUB_REF_NAME}`);
    return 0;
  }
  if (modo === 'entrada') {
    const erros = errosDaEntrada({ versao: env.VERSAO, sha: env.SHA, ref: env.GITHUB_REF });
    if (erros.length) return erros.forEach(erro), 1;
    let refs;
    try {
      refs = JSON.parse(executar('gh', ['api', `repos/${env.GITHUB_REPOSITORY}/git/matching-refs/tags/${env.VERSAO}`]));
    } catch (e) {
      return erro(`não consegui consultar as tags no GitHub (${String(e.message).split('\n')[0]})`), 1;
    }
    if (tagExiste(refs, env.VERSAO)) return erro(`a tag ${env.VERSAO} já existe: escolha a próxima versão`), 1;
    console.log(`[producao] versão ${env.VERSAO} nova; commit ${env.SHA}`);
    return 0;
  }
  if (modo === 'conferir') {
    const r = conferir({ sha: env.SHA, versao: env.VERSAO, dono: env.DONO, repositorio: env.GITHUB_REPOSITORY });
    if (r.erro) return erro(r.erro), 1;
    console.log(`[producao] ${r.versao} → ${r.sha}: no main, CI verde (${r.ci} execução(ões)), API ${r.api}`);
    if (env.GITHUB_OUTPUT)
      appendFileSync(env.GITHUB_OUTPUT, `sha=${r.sha}\nversao=${r.versao}\ndono=${r.dono}\napi=${r.api}\n`);
    return 0;
  }
  console.error('uso: node scripts/ci/producao-conferir.mjs ref|entrada|conferir');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = principal(process.argv[2], process.env);
}
