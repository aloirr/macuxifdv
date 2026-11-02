#!/usr/bin/env node
/**
 * Brechas do guardião v5 fechadas no CI (T-0049; PR #31 "Riscos e limites"; doc 07 "Merge de PR de governança").
 * Sem dependência: só node:child_process e a coord-lib (CAMINHOS_DE_GOVERNANCA, globParaRegex).
 *
 * 1. trailer  (push ao main) — todo commit do push (git rev-list ANTES..DEPOIS, merges inclusive) que altera caminho de
 *    governança (.claude/**, .coord/donos.json, scripts/coord*.mjs, .github/**) tem de trazer "Agente: alexandre" no
 *    ÚLTIMO bloco da mensagem (o bloco de trailers), e nenhum outro "Agente:" nesse bloco. Vale para qualquer origem:
 *    commit local, `gh pr merge --squash --body "Agente: alexandre"` e squash/merge feito pelo MCP do GitHub (que não
 *    passa pelo hook do Bash). Squash com o corpo padrão do GitHub (lista dos commits do PR, último bloco "Agente: <agente
 *    da nuvem>") fica VERMELHO. Commit de merge conta só os arquivos que diferem de TODOS os pais (git diff-tree -c:
 *    alteração feita no próprio merge); os commits trazidos pelo merge são conferidos um a um.
 * 2. recados  (pull_request) — o PR não pode adicionar nem alterar recado (.coord/recados/**) cujo texto contenha
 *    "autorizo o merge" (sem diferenciar maiúsculas, acentos, quebras de linha e marcação markdown). Autorização de merge
 *    só vale escrita localmente pelo Alexandre, nunca vinda de PR.
 *
 * Uso no CI (job governança; SHAs por variável de ambiente, nunca interpolados no shell):
 *   node scripts/ci/brechas-governanca.mjs trailer "$ANTES..$DEPOIS"
 *   node scripts/ci/brechas-governanca.mjs recados [BASE [TOPO]]   (padrão HEAD^1 HEAD: o checkout do PR é o merge)
 * Saída: 0 = ok; 1 = violação (com ::error:: por commit/recado); 2 = erro de uso ou de git (falha fechada).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMINHOS_DE_GOVERNANCA, globParaRegex } from '../coord-lib.mjs';

const TRAILER_AGENTE = /^\s*Agente:[ \t]*(\S+)[ \t]*$/i;
const RECADOS = globParaRegex('.coord/recados/**');
export const FRASE_AUTORIZACAO = 'autorizo o merge';

/** Linhas do último bloco (parágrafo) da mensagem; [] se a mensagem só tem o assunto (o assunto não é bloco de trailers). */
export function ultimoBloco(mensagem) {
  const blocos = [];
  let atual = [];
  for (const linha of String(mensagem || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (linha.trim() === '') {
      if (atual.length) blocos.push(atual);
      atual = [];
    } else atual.push(linha);
  }
  if (atual.length) blocos.push(atual);
  return blocos.length >= 2 ? blocos[blocos.length - 1] : [];
}

/** Nomes (minúsculos) dos "Agente: <nome>" do último bloco da mensagem. */
export function agentesDoUltimoBloco(mensagem) {
  return ultimoBloco(mensagem)
    .map((l) => l.match(TRAILER_AGENTE))
    .filter(Boolean)
    .map((m) => m[1].toLowerCase());
}

/** O último bloco declara "Agente: alexandre" e nenhum outro agente. */
export function temTrailerAlexandre(mensagem) {
  const nomes = agentesDoUltimoBloco(mensagem);
  return nomes.length > 0 && nomes.every((n) => n === 'alexandre');
}

/** Caminhos que casam com CAMINHOS_DE_GOVERNANCA (sem repetição, na ordem). */
export function caminhosDeGovernanca(arquivos, padroes = CAMINHOS_DE_GOVERNANCA) {
  const res = padroes.map(globParaRegex);
  return [...new Set(arquivos)].filter((a) => res.some((re) => re.test(a)));
}

/**
 * Commits que alteram governança sem o trailer "Agente: alexandre" no último bloco (função pura).
 * @param {{sha: string, mensagem: string, arquivos: string[]}[]} commits
 * @returns {{sha: string, assunto: string, arquivos: string[], agentes: string[]}[]}
 */
export function violacoesDeTrailer(commits, padroes = CAMINHOS_DE_GOVERNANCA) {
  const ruins = [];
  for (const c of commits) {
    const arquivos = caminhosDeGovernanca(c.arquivos, padroes);
    if (!arquivos.length || temTrailerAlexandre(c.mensagem)) continue;
    const assunto = String(c.mensagem || '').split(/\r?\n/)[0];
    ruins.push({ sha: c.sha, assunto, arquivos, agentes: agentesDoUltimoBloco(c.mensagem) });
  }
  return ruins;
}

/** Texto normalizado para procurar a frase: sem acento, minúsculo, sem marcação markdown, espaços colapsados. */
export function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u00ad\u200b-\u200f\u2060\ufeff]/g, '')
    .toLowerCase()
    .replace(/[*_`~>#|\\]/g, ' ')
    .replace(/\s+/g, ' ');
}

export const contemAutorizacao = (texto) => normalizarTexto(texto).includes(FRASE_AUTORIZACAO);

/**
 * Recados adicionados ou alterados (status A/M) que contêm "autorizo o merge" (função pura).
 * @param {{caminho: string, status: string, texto: string}[]} mudancas
 */
export function violacoesDeRecado(mudancas) {
  return mudancas.filter((m) => /^[AM]/.test(m.status) && RECADOS.test(m.caminho) && contemAutorizacao(m.texto)).map((m) => m.caminho);
}

// ---------------------------------------------------------------- git (CLI)

const git = (args, opcoes = {}) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opcoes });
const listaZ = (saida) => saida.split('\0').filter(Boolean);

/** Commits do intervalo (mais antigo primeiro, merges inclusive) com mensagem e arquivos alterados. */
export function commitsDoIntervalo(intervalo, cwd) {
  const shas = git(['rev-list', '--reverse', intervalo], { cwd }).split('\n').filter(Boolean);
  return shas.map((sha) => {
    const pais = git(['rev-list', '--parents', '-n', '1', sha], { cwd }).trim().split(/\s+/).length - 1;
    const mensagem = git(['log', '-1', '--format=%B', sha], { cwd });
    const args = pais > 1 ? ['diff-tree', '-r', '-c', '-z', '--no-commit-id', '--name-only', sha] : ['diff-tree', '-r', '--root', '-z', '--no-commit-id', '--name-only', '--no-renames', sha];
    return { sha, mensagem, arquivos: listaZ(git(args, { cwd })), merge: pais > 1 };
  });
}

/** Mudanças em recados entre BASE e TOPO, com o texto do arquivo no TOPO. */
export function recadosDoDiff(base, topo, cwd) {
  const partes = listaZ(git(['diff', '--name-status', '--no-renames', '-z', base, topo, '--', '.coord/recados'], { cwd }));
  const mudancas = [];
  for (let i = 0; i + 1 < partes.length; i += 2) {
    const status = partes[i];
    const caminho = partes[i + 1];
    const texto = /^[AM]/.test(status) ? git(['show', `${topo}:${caminho}`], { cwd }) : '';
    mudancas.push({ status, caminho, texto });
  }
  return mudancas;
}

function rodarTrailer(intervalo) {
  if (!intervalo || !/^[^.\s]+\.\.[^.\s]+$/.test(intervalo)) {
    console.error('uso: node scripts/ci/brechas-governanca.mjs trailer ANTES..DEPOIS');
    return 2;
  }
  const [antes] = intervalo.split('..');
  if (/^0+$/.test(antes)) {
    console.log('[trailer] ANTES zerado (branch novo): sem intervalo para conferir.');
    return 0;
  }
  const commits = commitsDoIntervalo(intervalo);
  const ruins = violacoesDeTrailer(commits);
  console.log(`[trailer] ${commits.length} commit(s) em ${intervalo}; ${ruins.length} alteram governança sem "Agente: alexandre".`);
  for (const r of ruins) {
    const declarado = r.agentes.length ? `último bloco declara "Agente: ${r.agentes.join('", "Agente: ')}"` : 'último bloco sem "Agente:"';
    console.log(`::error title=governança sem "Agente: alexandre"::commit ${r.sha} (${r.assunto}) altera ${r.arquivos.join(', ')} e o ${declarado}.`);
  }
  if (ruins.length) {
    console.log('Caminho de governança (.claude/**, .coord/donos.json, scripts/coord*.mjs, .github/**) só entra no main pelo rito do');
    console.log('doc 07: squash com --match-head-commit e corpo "Agente: alexandre", depois do recado de autorização LOCAL do Alexandre.');
    console.log('Não reescreva o histórico: avise o gerente-projetos e o Alexandre (recado), que decidem como regularizar.');
    return 1;
  }
  return 0;
}

function rodarRecados(base = 'HEAD^1', topo = 'HEAD') {
  const mudancas = recadosDoDiff(base, topo);
  const ruins = violacoesDeRecado(mudancas);
  console.log(`[recados] ${mudancas.length} recado(s) alterado(s) em ${base}..${topo}; ${ruins.length} com "${FRASE_AUTORIZACAO}".`);
  for (const c of ruins) {
    console.log(`::error file=${c},title=autorização de merge vinda de PR::${c} contém "${FRASE_AUTORIZACAO}". Autorização de merge só vale escrita localmente pelo Alexandre; tire a frase do recado (ou o recado) deste PR.`);
  }
  return ruins.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [modo, ...args] = process.argv.slice(2);
  let codigo;
  try {
    if (modo === 'trailer') codigo = rodarTrailer(args[0]);
    else if (modo === 'recados') codigo = rodarRecados(...args);
    else {
      console.error('uso: node scripts/ci/brechas-governanca.mjs trailer ANTES..DEPOIS | recados [BASE [TOPO]]');
      codigo = 2;
    }
  } catch (e) {
    console.log(`::error title=brechas-governanca::git falhou (${String(e.message).split('\n')[0]}): falha fechada.`);
    codigo = 2;
  }
  process.exit(codigo);
}
