#!/usr/bin/env node
/**
 * Conferência da publicação de PRODUÇÃO, usada pelos dois workflows (R-20261114-121700-alexandre: "Acabei com esse
 * negócio de eu entrar para criar tag. Quero só aprovar"). Sem dependência: node:child_process e node:fs.
 * A aprovação é a trava por issue (ADR 0046, scripts/ci/producao-trava.mjs).
 *
 *   producao-liberar.yml  — `entrada` (versão vX.Y.Z nova, SHA completo, disparo pelo main) e `commit` (no main, CI
 *                           verde); monta a imagem da API do commit se ela ainda não existe no GHCR (ADR 0051); depois
 *                           `conferir` e abre a issue "Aprovar deploy vX.Y.Z";
 *   producao-aprovar.yml  — `entrada`, `suite` e `conferir` de novo no comentário "aprovado vX.Y.Z"; depois cria a tag
 *                           com o GITHUB_TOKEN e dispara o producao-publicar.yml na tag;
 *   producao-publicar.yml — `ref` (push de tag v* ou disparo manual NA tag v*), `suite` e `conferir`.
 *
 * Modos (tudo por variável de ambiente, nada interpolado no shell):
 *   ref       GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_REF_NAME → o publicar só roda numa tag v* (push ou workflow_dispatch).
 *   entrada   VERSAO, SHA, GITHUB_REF, GITHUB_REPOSITORY, GH_TOKEN → versão vX.Y.Z, SHA de 40 hex, liberar disparado do
 *             main e a tag ainda não existe no GitHub.
 *   commit    SHA, GITHUB_REPOSITORY, GH_TOKEN → o commit está no main (origin/main do checkout com fetch-depth 0) e
 *             tem CI verde de push no main. Sem GHCR: é o que o liberar confere ANTES de montar a imagem.
 *   imagem    SHA, DONO → a imagem ghcr.io/<dono>/macuxi-api:<sha> já existe? Escreve existe=1|0 em $GITHUB_OUTPUT;
 *             falha (sem build) se o GHCR não respondeu: tag existente nunca é montada de novo (o digest não muda).
 *   suite     SHA, GITHUB_REPOSITORY, GH_TOKEN → a árvore do SHA tem o artefato ci-verde-completa-<árvore> de um run do
 *             main (liberar ou ci.yml manual) com testes-pacotes e testes-integracao verdes.
 *   conferir  SHA, VERSAO, DONO, GITHUB_REPOSITORY, GH_TOKEN → o `commit` e a imagem ghcr.io/<dono>/macuxi-api:<sha>
 *             existe no GHCR (docker login feito antes). Escreve sha, versao, dono e api (por digest) em $GITHUB_OUTPUT.
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
 * Commit no main e CI verde de push no main. `exec(cmd, args)` devolve a saída padrão ou lança (injetável nos testes).
 * @returns {{erro: string} | {ci: number}}
 */
export function conferirCommit({ sha, versao, repositorio }, exec = executar) {
  if (!SHA_COMPLETO.test(String(sha || ''))) return { erro: `SHA inválido: "${sha}"` };
  if (!repositorio) return { erro: 'falta GITHUB_REPOSITORY' };

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
  return { ci: n };
}

/** Saída do docker quando a tag não existe no registro (não é falha passageira: o ghcr-tentar não repete). */
export const IMAGEM_AUSENTE = /not found|manifest unknown|MANIFEST_UNKNOWN|name unknown|NAME_UNKNOWN/i;

/**
 * Digest de uma imagem no GHCR (docker login feito antes). A consulta repete no 403/429/5xx (T-0154, ghcr-tentar.sh).
 * @returns {{digest: string} | {ausente: true} | {erro: string}} `ausente` só quando o registro diz que a tag não existe:
 *   qualquer outra falha é `erro`, para o liberar nunca montar (e sobrescrever) uma tag que existe mas não respondeu.
 */
export function digestNoGhcr(img, exec = executar) {
  let saida = '';
  try {
    saida = String(
      exec('bash', ['scripts/deploy/demo/ghcr-tentar.sh', 'digest da API no GHCR', '--',
        'docker', 'buildx', 'imagetools', 'inspect', img, '--format', '{{.Manifest.Digest}}']),
    ).trim();
  } catch (e) {
    const texto = `${e?.stdout ?? ''}${e?.message ?? ''}`;
    return IMAGEM_AUSENTE.test(texto) ? { ausente: true } : { erro: `não consegui consultar ${img} no GHCR` };
  }
  return DIGEST.test(saida) ? { digest: saida } : { erro: `digest inválido de ${img}: "${saida}"` };
}

/** Workflows aceitos como origem do artefato da suíte. */
const WORKFLOWS_SUITE = ['.github/workflows/producao-liberar.yml', '.github/workflows/ci.yml'];
/** Jobs da suíte (no liberar vêm com o prefixo "suíte completa no SHA da versão / "). */
const JOBS_SUITE = [/testes dos pacotes \(/, /testes de integração \(/];

/** Run do main, por disparo manual, com os dois testes verdes? */
function suiteVerdeNoRun(run, jobs) {
  if (!WORKFLOWS_SUITE.includes(run?.path) || run.event !== 'workflow_dispatch' || run.head_branch !== 'main') return false;
  return JOBS_SUITE.every((nome) => {
    const doNome = (Array.isArray(jobs) ? jobs : []).filter((j) => nome.test(String(j?.name || '')));
    return doNome.length > 0 && doNome.every((j) => j.conclusion === 'success');
  });
}

/**
 * Suíte completa (testes-pacotes e testes-integracao) verde na árvore do SHA (R-20261120-073449-alexandre). O head_sha
 * do run é o main no disparo: a ligação com a versão é a árvore no nome do artefato. Artefato expirado vale (o nome e
 * o run continuam na API: voltar versão). Falha de consulta nunca passa.
 * @returns {{erro: string} | {run: number}}
 */
export function conferirSuite({ sha, repositorio }, exec = executar) {
  if (!SHA_COMPLETO.test(String(sha || ''))) return { erro: `SHA inválido: "${sha}"` };
  if (!repositorio) return { erro: 'falta GITHUB_REPOSITORY' };
  // o workflow que gravou é o do main: uma tag "main" daria head_branch main com outro código
  const noMain = (s) => {
    if (!SHA_COMPLETO.test(String(s || ''))) return false;
    try {
      return exec('git', ['merge-base', '--is-ancestor', s, 'origin/main']), true;
    } catch {
      return false;
    }
  };
  const api = (caminho, ...f) =>
    JSON.parse(exec('gh', ['api', '-X', 'GET', `repos/${repositorio}/${caminho}`, ...f.flatMap((x) => ['-f', x])]));
  try {
    const arvore = String(exec('git', ['rev-parse', `${sha}^{tree}`])).trim();
    if (!SHA_COMPLETO.test(arvore)) return { erro: `árvore inválida de ${sha}: "${arvore}"` };
    const { artifacts } = api('actions/artifacts', `name=ci-verde-completa-${arvore}`, 'per_page=100');
    const ids = [...new Set((artifacts ?? []).map((a) => a?.workflow_run?.id).filter(Number.isInteger))];
    for (const id of ids) {
      const run = api(`actions/runs/${id}`);
      const { jobs } = api(`actions/runs/${id}/jobs`, 'per_page=100');
      if (!suiteVerdeNoRun(run, jobs) || !noMain(run.head_sha)) continue;
      return { run: id };
    }
  } catch (e) {
    return { erro: `não consegui conferir a suíte completa de ${sha} (${String(e?.message ?? e).split('\n')[0]})` };
  }
  return {
    erro: `o commit ${sha} não tem a suíte completa verde (testes-pacotes e testes-integracao): rode o "producao — liberar versão" nesse SHA`,
  };
}

/**
 * Commit no main, CI verde e imagem da API. `exec(cmd, args)` devolve a saída padrão ou lança (injetável nos testes).
 * @returns {{erro: string} | {sha: string, versao: string, dono: string, api: string}}
 */
export function conferir({ sha, versao, dono, repositorio }, exec = executar) {
  if (!SHA_COMPLETO.test(String(sha || ''))) return { erro: `SHA inválido: "${sha}"` };
  const donoMin = String(dono || '').toLowerCase();
  if (!donoMin || !repositorio) return { erro: 'faltam DONO e GITHUB_REPOSITORY' };
  const c = conferirCommit({ sha, versao, repositorio }, exec);
  if (c.erro) return c;
  const n = c.ci;

  const img = `ghcr.io/${donoMin}/macuxi-api:${sha}`;
  const d = digestNoGhcr(img, exec);
  if (d.erro) return { erro: d.erro };
  if (d.ausente)
    return { erro: `${img} não está no GHCR (o "producao — liberar versão" monta a imagem do commit: libere a versão por ele)` };

  return { sha, versao, dono: donoMin, api: `ghcr.io/${donoMin}/macuxi-api@${d.digest}`, ci: n };
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
  if (modo === 'commit') {
    const r = conferirCommit({ sha: env.SHA, versao: env.VERSAO, repositorio: env.GITHUB_REPOSITORY });
    if (r.erro) return erro(r.erro), 1;
    console.log(`[producao] ${env.SHA}: no main, CI verde (${r.ci} execução(ões))`);
    return 0;
  }
  if (modo === 'imagem') {
    const img = `ghcr.io/${String(env.DONO || '').toLowerCase()}/macuxi-api:${env.SHA}`;
    if (!env.DONO || !SHA_COMPLETO.test(String(env.SHA || ''))) return erro('faltam DONO e SHA completo'), 1;
    const d = digestNoGhcr(img);
    if (d.erro) return erro(`${d.erro}: a imagem não é montada de novo sem a certeza de que ela não existe`), 1;
    console.log(d.digest ? `[producao] ${img} já existe (${d.digest}): reaproveitada, sem build` : `[producao] ${img} não existe: monta agora`);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `existe=${d.digest ? 1 : 0}\n`);
    return 0;
  }
  if (modo === 'suite') {
    const r = conferirSuite({ sha: env.SHA, repositorio: env.GITHUB_REPOSITORY });
    if (r.erro) return erro(r.erro), 1;
    console.log(`[producao] ${env.SHA}: suíte completa verde no run ${r.run}`);
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
  console.error('uso: node scripts/ci/producao-conferir.mjs ref|entrada|commit|imagem|suite|conferir');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = principal(process.argv[2], process.env);
}
