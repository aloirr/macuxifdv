/**
 * Carrega `node:sqlite` (fila local do Conector).
 *
 * - Runtime: o pacote do Conector leva o PRÓPRIO Node 24 LTS portátil (>= 24.7, mínimo do projeto; decisão do Alexandre,
 *   R-20261031-233442 item 4) e `scripts/empacotar.mjs` mira `node24`. No Node 24 o `node:sqlite` não emite mais o
 *   "ExperimentalWarning", então a troca de `process.emitWarning` que existia para o Node 22 foi removida (T-0027).
 * - O Vite/Vitest 3 não conhece `node:sqlite` como módulo embutido; por isso o carregamento é por `createRequire`,
 *   que passa direto ao Node e funciona igual no executável, no tsx e no Vitest.
 */
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';

export type BancoSqlite = DatabaseSync;
type ModuloSqlite = typeof import('node:sqlite');

let modulo: ModuloSqlite | null = null;

export function carregarSqlite(): ModuloSqlite {
  modulo ??= createRequire(import.meta.url)('node:sqlite') as ModuloSqlite;
  return modulo;
}

export function abrirSqlite(caminho: string): BancoSqlite {
  const { DatabaseSync: Banco } = carregarSqlite();
  const db = new Banco(caminho);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  return db;
}
