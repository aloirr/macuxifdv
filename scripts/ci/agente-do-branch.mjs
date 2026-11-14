#!/usr/bin/env node
/**
 * Agente declarado no nome do branch da nuvem × trailer "Agente:" dos commits do PR (ADR 0045, item "identidade").
 * Sem dependência: node:child_process e a coord-lib (AGENTES, agenteDosTrailers).
 *
 * Com o time 100% na nuvem, cada sessão declara o agente no SUFIXO do branch: `nuvem/<assunto>--<agente>` (dois hífens).
 * O "verificar donos do PR" já confere os arquivos do PR contra o agente do trailer; este passo fecha a outra ponta:
 * o trailer tem de ser o agente que o branch declara (quem abriu a sessão escolheu o branch; quem fez o commit escolheu o
 * trailer). Regras, só para PR de `nuvem/*`:
 *   - `--<agente do time>` + trailer de outro agente (alexandre inclusive)      → VERMELHO;
 *   - `--alexandre` ou `--<nome fora do time>`                                   → VERMELHO (branch nunca dá a identidade
 *                                                                                  alexandre; sufixo inválido não declara);
 *   - sufixo de um hífen só que casa com um agente (`nuvem/x-modulo-core`) e trailer de outro → AVISO (pode ser só o fim do
 *     assunto, ex.: `nuvem/T-0170-ajuste-testes`);
 *   - trailer "Agente: alexandre" num nuvem/*                                     → AVISO (merge só pelo rito com o recado
 *                                                                                  de autorização do Alexandre);
 *   - trailer ausente, parcial ou ambíguo: o "verificar donos do PR" já fica vermelho; aqui só registra.
 *
 * Uso no CI (job governança, só PR):  HEAD_REF=<github.head_ref> node scripts/ci/agente-do-branch.mjs
 * O checkout do PR é o commit de merge (HEAD^1 = base, HEAD^2 = topo do PR).
 * Saída: 0 = ok ou só aviso; 1 = violação; 2 = erro de git (falha fechada).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTES, agenteDosTrailers } from '../coord-lib.mjs';

/**
 * Agente que o nome do branch declara (função pura).
 * @returns {{agente: string|null, forma: 'explicita'|'sufixo'|null, erro?: string}}
 */
export function agenteDeclaradoNoBranch(branch, agentes = AGENTES) {
  const b = String(branch || '').replace(/^refs\/heads\//, '');
  if (!/^nuvem\//i.test(b)) return { agente: null, forma: null };
  const resto = b.slice('nuvem/'.length);
  const i = resto.lastIndexOf('--');
  if (i >= 0) {
    const nome = resto.slice(i + 2).toLowerCase();
    if (nome === 'alexandre') return { agente: null, forma: 'explicita', erro: `o branch "${b}" declara "alexandre": branch nunca dá a identidade alexandre (use MACUXI_AGENTE=alexandre no ambiente da sessão)` };
    if (agentes.includes(nome)) return { agente: nome, forma: 'explicita' };
    return { agente: null, forma: 'explicita', erro: `o branch "${b}" declara "${nome}", que não é um agente do time (sufixo --<agente>)` };
  }
  const minusculo = b.toLowerCase();
  const casados = agentes.filter((a) => minusculo.endsWith(`-${a}`)).sort((x, y) => y.length - x.length);
  return casados.length ? { agente: casados[0], forma: 'sufixo' } : { agente: null, forma: null };
}

/**
 * Confere o branch contra os trailers dos commits do PR (função pura).
 * @param {{branch: string, commits: {sha: string, assunto?: string, corpo: string}[]}} p
 * @returns {{codigo: 0|1, anotacoes: {nivel: 'error'|'warning'|'notice', mensagem: string}[]}}
 */
export function conferirAgenteDoBranch({ branch, commits }) {
  const anotacoes = [];
  const declarado = agenteDeclaradoNoBranch(branch);
  if (declarado.erro) anotacoes.push({ nivel: 'error', mensagem: declarado.erro });
  const t = /^nuvem\//i.test(String(branch || '').replace(/^refs\/heads\//, '')) ? agenteDosTrailers(commits) : { agente: null };
  if (t.erro) anotacoes.push({ nivel: 'notice', mensagem: `trailer: ${t.mensagem} (o "verificar donos do PR" cobra)` });
  if (t.agente && declarado.agente && t.agente !== declarado.agente) {
    anotacoes.push({
      nivel: declarado.forma === 'explicita' ? 'error' : 'warning',
      mensagem: `o branch "${branch}" declara "${declarado.agente}" e os commits trazem "Agente: ${t.agente}". Branch e trailer precisam ser do mesmo agente (ADR 0045).`,
    });
  }
  if (t.agente === 'alexandre') {
    anotacoes.push({ nivel: 'warning', mensagem: `PR de "${branch}" com "Agente: alexandre" pelo trailer: o merge só sai pelo rito de governança, com o recado de autorização do Alexandre (doc 07).` });
  }
  return { codigo: anotacoes.some((a) => a.nivel === 'error') ? 1 : 0, anotacoes };
}

/** Commits do PR (sem merges): HEAD^1..HEAD^2 do commit de merge do checkout. null se HEAD não for merge. */
function commitsDoPr() {
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const pais = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/).length - 1;
  if (pais < 2) return null;
  return git(['log', '--no-merges', '--format=%H%x1f%s%x1f%B%x1e', 'HEAD^1..HEAD^2'])
    .split('\x1e').map((s) => s.replace(/^\n/, '')).filter(Boolean)
    .map((s) => { const [sha, assunto, corpo] = s.split('\x1f'); return { sha, assunto, corpo: corpo || '' }; });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const branch = String(process.env.HEAD_REF || '').trim();
  let codigo = 0;
  try {
    if (!/^nuvem\//i.test(branch)) {
      console.log(`[agente do branch] "${branch || '(sem HEAD_REF)'}" não é nuvem/*: nada a conferir.`);
    } else {
      const commits = commitsDoPr();
      if (commits === null) {
        console.log('::error title=agente do branch::HEAD não é o commit de merge do PR: falha fechada.');
        codigo = 2;
      } else {
        const r = conferirAgenteDoBranch({ branch, commits });
        const d = agenteDeclaradoNoBranch(branch);
        console.log(`[agente do branch] ${branch}: declara ${d.agente || '(nenhum)'}${d.forma ? ` (${d.forma})` : ''}; ${commits.length} commit(s).`);
        for (const a of r.anotacoes) console.log(`::${a.nivel} title=agente do branch::${a.mensagem}`);
        codigo = r.codigo;
      }
    }
  } catch (e) {
    console.log(`::error title=agente do branch::git falhou (${String(e.message).split('\n')[0]}): falha fechada.`);
    codigo = 2;
  }
  process.exit(codigo);
}
