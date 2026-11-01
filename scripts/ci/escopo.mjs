#!/usr/bin/env node
/**
 * Escopo e matrizes do CI (T-0033, ADR 0013 §custo). Sem dependência: só node:child_process/node:fs.
 *
 * escopo:
 *   - "coord"    → TODO arquivo alterado está em `.coord/**` (recados, diário, quadro, lidos, tarefas, contratos).
 *                  Roda só o job de governança (coord, guardiões, verificar) e o ci-ok. `docs/**` NÃO entra: o teste da
 *                  Integração lê `docs/modulos/` (guarda grafo-turbo, R2); e nenhum código lê `.coord/` (guarda R4).
 *   - "completo" → qualquer outro caso, inclusive lista vazia, erro de git ou evento desconhecido (padrão seguro).
 * matrizes:
 *   - push ao main → COMPLETA (typecheck e testes de pacotes em 2 grupos; tests/ em 3 partes): menor tempo de parede.
 *   - PR           → ENXUTA (1 grupo cada; tests/ em 2 partes, visitas-campo junto da parte menor): menos minutos.
 *
 * Uso no CI: node scripts/ci/escopo.mjs   (lê GITHUB_EVENT_NAME, ANTES, DEPOIS; escreve em $GITHUB_OUTPUT)
 *   PR: arquivos = git diff HEAD^1 HEAD (o checkout do PR é o commit de merge com a base)
 *   push: arquivos = git diff ANTES DEPOIS (ANTES = 000…0 → completo)
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ZEROS = /^0+$/;
const EXCLUI_VISITAS = '--exclude=**/integracao/api/visitas-campo.test.ts';
const SO_VISITAS = 'integracao/api/visitas-campo.test.ts';

/** Matrizes por evento. `args` de integração: execuções do Vitest separadas por "|" (rodam em sequência no job). */
export const MATRIZES = {
  completa: {
    typecheck: [
      { grupo: 'core-vendedor', filtro: '--filter=@macuxi/core --filter=@macuxi/vendedor', cache: 'typecheck-core-vendedor', cache_extra: '' },
      { grupo: 'demais', filtro: '--filter=!@macuxi/core --filter=!@macuxi/vendedor', cache: 'typecheck-demais', cache_extra: '' },
    ],
    pacotes: [
      { grupo: 'core-db-api-mock', filtro: '--filter=@macuxi/core --filter=@macuxi/db --filter=api --filter=mock-api', cache: 'testes-core-db-api-mock', cache_extra: '' },
      { grupo: 'demais', filtro: '--filter=!@macuxi/core --filter=!@macuxi/db --filter=!api --filter=!mock-api', cache: 'testes-demais', cache_extra: '' },
    ],
    integracao: [
      { parte: 'visitas-campo', args: SO_VISITAS },
      { parte: 'resto 1/2', args: `${EXCLUI_VISITAS} --shard=1/2` },
      { parte: 'resto 2/2', args: `${EXCLUI_VISITAS} --shard=2/2` },
    ],
  },
  enxuta: {
    // 1 grupo lê o cache dos 2 grupos do main (cache_extra) e o próprio do PR.
    typecheck: [{ grupo: 'todos', filtro: '', cache: 'typecheck-todos', cache_extra: 'typecheck-core-vendedor typecheck-demais' }],
    pacotes: [{ grupo: 'todos', filtro: '', cache: 'testes-todos', cache_extra: 'testes-core-db-api-mock testes-demais' }],
    integracao: [
      { parte: 'visitas-campo + resto 2/2', args: `${SO_VISITAS}|${EXCLUI_VISITAS} --shard=2/2` },
      { parte: 'resto 1/2', args: `${EXCLUI_VISITAS} --shard=1/2` },
    ],
  },
};

/** "coord" só se a lista não é vazia e TODO caminho está em .coord/. */
export function classificar(arquivos) {
  const lista = arquivos.map((a) => a.trim()).filter(Boolean);
  if (lista.length === 0) return 'completo';
  return lista.every((a) => a.startsWith('.coord/')) ? 'coord' : 'completo';
}

export function decidir({ evento, arquivos }) {
  const escopo = arquivos === null ? 'completo' : classificar(arquivos);
  const matriz = evento === 'push' ? MATRIZES.completa : MATRIZES.enxuta;
  return { escopo, matriz: evento === 'push' ? 'completa' : 'enxuta', ...matriz };
}

function gitArquivos(a, b) {
  const saida = execFileSync('git', ['diff', '--name-only', '--no-renames', a, b], { encoding: 'utf8' });
  return saida.split('\n').filter(Boolean);
}

function arquivosDoEvento(env) {
  try {
    if (env.GITHUB_EVENT_NAME === 'pull_request') return gitArquivos('HEAD^1', 'HEAD');
    if (env.GITHUB_EVENT_NAME === 'push') {
      if (!env.ANTES || !env.DEPOIS || ZEROS.test(env.ANTES)) return null;
      return gitArquivos(env.ANTES, env.DEPOIS);
    }
  } catch (e) {
    console.warn(`[escopo] git falhou (${e.message.split('\n')[0]}): escopo completo`);
  }
  return null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arquivos = arquivosDoEvento(process.env);
  const d = decidir({ evento: process.env.GITHUB_EVENT_NAME, arquivos });
  console.log(`[escopo] evento=${process.env.GITHUB_EVENT_NAME} arquivos=${arquivos === null ? '?' : arquivos.length} escopo=${d.escopo} matriz=${d.matriz}`);
  if (arquivos) for (const a of arquivos.slice(0, 50)) console.log(`  ${a}`);
  const linhas = [
    `escopo=${d.escopo}`,
    `matriz=${d.matriz}`,
    `typecheck=${JSON.stringify(d.typecheck)}`,
    `pacotes=${JSON.stringify(d.pacotes)}`,
    `integracao=${JSON.stringify(d.integracao)}`,
  ];
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${linhas.join('\n')}\n`);
  else console.log(linhas.join('\n'));
}
