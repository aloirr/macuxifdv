#!/usr/bin/env node
/**
 * Economia do Actions (ADR 0045, item "economia"). Sem dependência: node:child_process. Não roda job nem passo novo pago:
 * os dois modos são passos de segundos no job "governança", que já existe.
 *
 * 1. tentativa — (todo evento, PRIMEIRO passo do job) a regra é "um rerun só, e só para infraestrutura" (saída 137,
 *    desligamento do runner). GITHUB_RUN_ATTEMPT 1 = run original; 2 = o rerun permitido (aviso); 3 ou mais = vermelho
 *    ANTES do escopo, então nenhum job pesado roda. Vale para "Re-run all jobs" (a governança roda de novo). O "Re-run
 *    failed jobs" não roda a governança de novo; ali vale a regra escrita no doc 07.
 * 2. commits  — (só PR) a regra é "um commit por PR": cada push no PR é um CI inteiro. Mais de um commit (sem os de merge)
 *    vira AVISO no PR, não vermelho: o squash junta tudo no main, e a correção pedida pela revisão é a exceção prevista.
 *    O checkout do PR é o commit de merge (HEAD^1 = base, HEAD^2 = topo do PR).
 *
 * Uso no CI:  node scripts/ci/economia-actions.mjs tentativa   (lê GITHUB_RUN_ATTEMPT)
 *             node scripts/ci/economia-actions.mjs commits     (PR; lê o git)
 * Saída: 0 = ok ou só aviso; 1 = violação; 2 = erro de uso.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_TENTATIVAS = 2;

/** Decisão sobre a tentativa do run (função pura). */
export function decidirTentativa(valor) {
  const n = Number.parseInt(String(valor ?? '1'), 10);
  const tentativa = Number.isFinite(n) && n > 0 ? n : 1;
  if (tentativa <= 1) return { codigo: 0, nivel: null, tentativa };
  if (tentativa <= MAX_TENTATIVAS) {
    return { codigo: 0, nivel: 'warning', tentativa, mensagem: `rerun ${tentativa - 1} de ${MAX_TENTATIVAS - 1}: só para falha de infraestrutura (137, runner desligado). O próximo rerun fica vermelho.` };
  }
  return {
    codigo: 1, nivel: 'error', tentativa,
    mensagem: `tentativa ${tentativa} do mesmo run: a regra é um rerun só, para infraestrutura (ADR 0045). Corrija e mande um commit novo; falha de infraestrutura que se repete vai ao gerente-projetos.`,
  };
}

/** Decisão sobre o número de commits do PR (função pura). */
export function decidirCommits(quantidade) {
  if (!(quantidade > 1)) return { codigo: 0, nivel: null };
  return {
    codigo: 0, nivel: 'warning',
    mensagem: `o PR tem ${quantidade} commits: cada push é um CI inteiro. A regra é um commit por PR; commit novo só para correção pedida na revisão ou para CI vermelho (ADR 0045).`,
  };
}

const anotar = (nivel, titulo, mensagem) => console.log(`::${nivel} title=${titulo}::${mensagem}`);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const modo = process.argv[2];
  let codigo = 0;
  if (modo === 'tentativa') {
    const d = decidirTentativa(process.env.GITHUB_RUN_ATTEMPT);
    console.log(`[economia] tentativa ${d.tentativa} do run.`);
    if (d.nivel) anotar(d.nivel, 'rerun do CI', d.mensagem);
    codigo = d.codigo;
  } else if (modo === 'commits') {
    let quantidade = 0;
    try {
      const pais = execFileSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], { encoding: 'utf8' }).trim().split(/\s+/).length - 1;
      if (pais < 2) {
        console.log('[economia] HEAD não é o commit de merge do PR: contagem pulada.');
      } else {
        quantidade = Number(execFileSync('git', ['rev-list', '--count', '--no-merges', 'HEAD^1..HEAD^2'], { encoding: 'utf8' }).trim());
      }
    } catch (e) {
      console.log(`[economia] git falhou (${String(e.message).split('\n')[0]}): contagem pulada (é só aviso).`);
    }
    console.log(`[economia] ${quantidade} commit(s) no PR (sem merges).`);
    const d = decidirCommits(quantidade);
    if (d.nivel) anotar(d.nivel, 'commits no PR', d.mensagem);
    codigo = d.codigo;
  } else {
    console.error('uso: node scripts/ci/economia-actions.mjs tentativa | commits');
    codigo = 2;
  }
  process.exit(codigo);
}
