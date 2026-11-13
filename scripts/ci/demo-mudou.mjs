#!/usr/bin/env node
/**
 * T-0160 item 6 (ADR 0044): o demo-publicar só publica quando muda o que vai para a VM. Sem dependência: node:child_process
 * e fetch do Node 24.
 *
 * Publica se, desde o último commit PUBLICADO (o do último run do "demo — publicar" com o job "deploy na VM" verde), algum
 * arquivo mudou em apps/**, modules/**, packages/** ou db/** — ou no que monta a imagem e o deploy (package.json da raiz,
 * pnpm-lock.yaml, pnpm-workspace.yaml, .nvmrc, turbo.json, scripts/deploy/demo/**). Commit só de docs, .coord, .github,
 * tests ou scripts de CI não publica. Na dúvida (sem base, erro de git ou da API), publica.
 *
 * Uso no CI: node scripts/ci/demo-mudou.mjs (lê SHA, GITHUB_REPOSITORY e GH_TOKEN; escreve publicar=true|false e base=<sha>
 * em $GITHUB_OUTPUT). O disparo manual sempre publica (decidido no workflow).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PASTAS_DA_DEMO = ['apps/', 'modules/', 'packages/', 'db/', 'scripts/deploy/demo/'];
export const ARQUIVOS_DA_DEMO = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.nvmrc',
  'turbo.json',
];
/** Nome do job que publica de fato (o "deploy na VM" do demo-publicar.yml). */
export const JOB_DEPLOY = 'deploy na VM';

/** Algum arquivo alterado vai para a VM? Lista null (sem base ou erro) = publica. */
export function precisaPublicar(arquivos) {
  if (arquivos === null) return true;
  return arquivos.some((a) => PASTAS_DA_DEMO.some((p) => a.startsWith(p)) || ARQUIVOS_DA_DEMO.includes(a));
}

async function api(caminho, env) {
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

/** Commit do último deploy verde na VM (null = nenhum nos últimos 30 runs verdes). */
async function ultimoPublicado(env) {
  const j = await api('actions/workflows/demo-publicar.yml/runs?status=success&per_page=30', env);
  for (const run of j.workflow_runs ?? []) {
    if (String(run.id) === env.GITHUB_RUN_ID) continue;
    const jobs = await api(`actions/runs/${run.id}/jobs?per_page=20`, env);
    if ((jobs.jobs ?? []).some((x) => x.name === JOB_DEPLOY && x.conclusion === 'success'))
      return run.head_sha;
  }
  return null;
}

async function principal(env) {
  let base = null;
  let arquivos = null;
  try {
    base = await ultimoPublicado(env);
    if (base)
      arquivos = execFileSync('git', ['diff', '--name-only', '--no-renames', base, env.SHA], {
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean);
  } catch (e) {
    console.warn(`[demo-mudou] sem comparação (${e.message.split('\n')[0]}): publica`);
    arquivos = null;
  }
  const publicar = precisaPublicar(arquivos);
  console.log(
    `[demo-mudou] publicado=${base ?? '?'} agora=${env.SHA} arquivos=${arquivos === null ? '?' : arquivos.length} publicar=${publicar}`,
  );
  if (arquivos) for (const a of arquivos.slice(0, 50)) console.log(`  ${a}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `publicar=${publicar}\nbase=${base ?? ''}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await principal(process.env);
}
